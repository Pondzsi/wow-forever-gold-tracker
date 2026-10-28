import Dexie, { type Table } from 'dexie';

export type Source = 'manual' | 'addon' | 'import';

export interface Character {
  id?: number;
  name: string;
  className: string;
  professions: string[];
}

export interface GoldSnapshot {
  id?: number;
  characterId: number;
  time: number; // ms since epoch
  copper: number;
  source: Source;
}

export const LEDGER_CATEGORIES = [
  'vendor',
  'auction',
  'mail',
  'trade',
  'quest/loot',
  'training',
  'repair',
  'profession',
  'other',
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export interface LedgerEntry {
  id?: number;
  characterId: number;
  time: number;
  copper: number; // positive = income, negative = expense
  category: LedgerCategory;
  note: string;
  source: Source;
}

export interface Item {
  id?: number;
  name: string;
  gameItemId?: number; // filled in later by the addon
  vendorPrice?: number; // copper per unit, when known
  depositPerUnit?: number; // observed AH deposit in copper per unit (lost if it doesn't sell)
  bound?: boolean; // every copy you hold is soulbound: can't be sold on the AH
}

export type InventoryLocation = 'bags' | 'bank';

export interface InventoryRow {
  id?: number;
  characterId: number;
  location: InventoryLocation;
  itemId: number;
  count: number;
  updated: number;
}

export type PriceSource = 'AH' | 'manual' | 'import';

export interface Price {
  id?: number;
  itemId: number;
  time: number;
  copper: number; // per unit
  source: PriceSource;
  note: string;
}

export interface Reagent {
  itemId: number;
  count: number;
}

export interface Recipe {
  id?: number;
  profession: string;
  productItemId: number;
  productCount: number;
  reagents: Reagent[];
  patternCost?: number; // copper paid for the pattern, if bought
  source?: Source; // 'addon' recipes are updated by sync; manual ones never
}

export interface ProfessionSnapshot {
  id?: number;
  characterId: number;
  profession: string;
  skill: number;
  maxSkill: number;
  time: number;
}

export type SessionType = 'farming' | 'fishing';
export type WaterType = 'pools' | 'open water' | 'mixed';

export interface Session {
  id?: number;
  characterId: number;
  type: SessionType;
  zone: string;
  start: number;
  end?: number;
  startCopper?: number;
  endCopper?: number;
  notes: string;
  // Fishing only
  water?: WaterType;
  fishRackUsed?: boolean;
  lureUsed?: boolean;
  fishingSkillStart?: number;
  fishingSkillEnd?: number;
  catches?: number;
  source?: Source;
}

export interface SessionItem {
  id?: number;
  sessionId: number;
  itemId: number;
  count: number;
  containerOpenId?: number; // set when the item came out of a container
}

export interface ContainerOpen {
  id?: number;
  sessionId: number;
  containerItemId: number;
  time: number;
  copper: number; // coins found inside
}

export interface Goal {
  id?: number;
  name: string;
  targetCopper: number;
  characterIds: number[];
  note?: string;
}

export interface Settings {
  id: 'main';
  ahCutPercent: number;
  staleDays: number;
  depositNote: string;
  depositRefundedOnSale?: boolean; // Classic refunds it; unverified for Forever
  // Filled in from AH sale mails read by the addon:
  observedSales?: number;
  observedCutPercent?: number;
  observedDepositRefunded?: boolean;
  auctionatorRealm?: string; // which realm's prices to use, when several
}

/** Small key/value store for sync state (folder handle, last import). */
export interface Meta {
  key: string;
  value: unknown;
}

/** Ids of addon events and Auctionator prices already imported. */
export interface SyncLogRow {
  id: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  ahCutPercent: 5, // unverified for Forever: edit in Settings
  staleDays: 3,
  depositNote: '',
  depositRefundedOnSale: true,
};

export class GoldDB extends Dexie {
  characters!: Table<Character, number>;
  goldSnapshots!: Table<GoldSnapshot, number>;
  ledger!: Table<LedgerEntry, number>;
  items!: Table<Item, number>;
  inventory!: Table<InventoryRow, number>;
  prices!: Table<Price, number>;
  recipes!: Table<Recipe, number>;
  professionSnapshots!: Table<ProfessionSnapshot, number>;
  sessions!: Table<Session, number>;
  sessionItems!: Table<SessionItem, number>;
  containerOpens!: Table<ContainerOpen, number>;
  goals!: Table<Goal, number>;
  settings!: Table<Settings, string>;
  meta!: Table<Meta, string>;
  syncLog!: Table<SyncLogRow, string>;

  constructor() {
    super('wow-forever-gold');
    this.version(1).stores({
      characters: '++id, name',
      goldSnapshots: '++id, characterId, time',
      ledger: '++id, characterId, time, category',
      items: '++id, &name, gameItemId',
      inventory: '++id, &[characterId+location+itemId], characterId, itemId',
      prices: '++id, itemId, time',
      recipes: '++id, profession, productItemId',
      professionSnapshots: '++id, characterId, profession, time',
      sessions: '++id, characterId, start, type',
      sessionItems: '++id, sessionId, itemId, containerOpenId',
      containerOpens: '++id, sessionId, containerItemId',
      goals: '++id',
      settings: 'id',
    });
    this.version(2).stores({
      meta: 'key',
      syncLog: 'id',
    });
    // Characters are not seeded: the addon sync creates them, or you add them in Settings.
    this.on('populate', (tx) => {
      tx.table('settings').add(DEFAULT_SETTINGS);
    });
  }
}

export const db = new GoldDB();

export const TABLE_NAMES = [
  'characters',
  'goldSnapshots',
  'ledger',
  'items',
  'inventory',
  'prices',
  'recipes',
  'professionSnapshots',
  'sessions',
  'sessionItems',
  'containerOpens',
  'goals',
  'settings',
  'syncLog', // kept in backups so a restore does not import events twice
] as const;

/** Finds an item by name (case-insensitive) or creates it. */
export async function getOrCreateItem(name: string): Promise<number> {
  const clean = name.trim();
  if (!clean) throw new Error('Item name is empty');
  const existing = await db.items.filter((i) => i.name.toLowerCase() === clean.toLowerCase()).first();
  if (existing?.id !== undefined) return existing.id;
  return db.items.add({ name: clean });
}

export interface BackupFile {
  app: 'wow-forever-gold-tracker';
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) tables[name] = await db.table(name).toArray();
  return { app: 'wow-forever-gold-tracker', version: 1, exportedAt: new Date().toISOString(), tables };
}

/** Replaces all data with the backup contents. */
export async function importAll(backup: BackupFile): Promise<void> {
  if (backup.app !== 'wow-forever-gold-tracker' || backup.version !== 1) {
    throw new Error('This file is not a Forever Gold Tracker backup.');
  }
  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      await db.table(name).clear();
      const rows = backup.tables[name];
      if (Array.isArray(rows) && rows.length) await db.table(name).bulkAdd(rows);
    }
  });
}
