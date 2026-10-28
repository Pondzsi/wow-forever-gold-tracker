import {
  db,
  DEFAULT_SETTINGS,
  LEDGER_CATEGORIES,
  type InventoryLocation,
  type LedgerCategory,
  type Recipe,
  type SessionType,
} from '../db';
import { asArray, asNumberMap, type LuaValue } from './luaParse';

// Shape of GoldTrackerDB as written by addon/GoldTracker/GoldTracker.lua.
type Obj = Record<string, LuaValue>;

export interface ImportReport {
  newEvents: number;
  ledger: number;
  sessions: number;
  recipes: number;
  prices: number;
  characters: string[];
  warnings: string[];
}

const ms = (seconds: unknown) => (typeof seconds === 'number' ? seconds * 1000 : Date.now());
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Removes WoW UI markup from item names. Retail adds a crafting-quality icon
 * (|A:Professions-ChatIcon-Quality-12-Tier1:...|a); its tier is kept as "(tier 1)"
 * because each tier is a different item.
 */
export function cleanItemName(raw: string): string {
  const tier = /Quality-(?:\d+-)?Tier(\d)/i.exec(raw)?.[1];
  const name = raw
    .replace(/\|A:[^|]*\|a/g, '')
    .replace(/\|T[^|]*\|t/g, '')
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return tier ? `${name} (tier ${tier})` : name;
}

const CLASS_NAMES: Record<string, string> = {
  WARRIOR: 'Warrior', PALADIN: 'Paladin', HUNTER: 'Hunter', ROGUE: 'Rogue', PRIEST: 'Priest',
  SHAMAN: 'Shaman', MAGE: 'Mage', WARLOCK: 'Warlock', DRUID: 'Druid', DEATHKNIGHT: 'Death Knight',
};

/** Imports a parsed GoldTracker.lua. Safe to run repeatedly: known events are skipped. */
export async function importGoldTracker(saved: Record<string, LuaValue>): Promise<ImportReport> {
  const root = saved.GoldTrackerDB as Obj | undefined;
  if (!root || typeof root !== 'object') throw new Error('GoldTrackerDB not found in this file.');

  const report: ImportReport = { newEvents: 0, ledger: 0, sessions: 0, recipes: 0, prices: 0, characters: [], warnings: [] };
  const gameItems = (root.items ?? {}) as Record<string, Obj>;
  const chars = (root.chars ?? {}) as Record<string, Obj>;
  const events = asArray<Obj>(root.events);
  const recipes = (root.recipes ?? {}) as Record<string, Obj>;

  // No single transaction here: the helpers below are plain async functions that
  // sometimes finish without a database call, and IndexedDB would then commit a
  // surrounding transaction too early. Each event is marked as imported only after
  // it is saved, so a failed import can be rerun without duplicates.
  await (async () => {
    // ---- Items: match by game item id, then by name; vendor price from game data.
    const allItems = await db.items.toArray();
    const byGameId = new Map(allItems.filter((i) => i.gameItemId).map((i) => [i.gameItemId!, i]));
    const byName = new Map(allItems.map((i) => [i.name.toLowerCase(), i]));

    async function itemFor(gameId: number): Promise<number> {
      const known = byGameId.get(gameId);
      const info = gameItems[String(gameId)] ?? {};
      const rawName = str(info.n);
      let name = rawName ? cleanItemName(rawName) : undefined;
      // Names are unique in the dashboard; a different item with the same name gets its id appended.
      const clash = name ? byName.get(name.toLowerCase()) : undefined;
      const conflict = known
        ? clash && clash.id !== known.id
        : clash && clash.gameItemId !== undefined && clash.gameItemId !== gameId;
      if (name && conflict) name = `${name} #${gameId}`;
      const vendor = num(info.v);
      const bound = typeof info.b === 'boolean' ? info.b : undefined;
      const bindType = num(info.bt);
      const quality = num(info.q);
      if (known) {
        const patch: Record<string, unknown> = {};
        if (vendor !== undefined && known.vendorPrice !== vendor) patch.vendorPrice = vendor;
        if (bound !== undefined && known.bound !== bound) patch.bound = bound;
        if (bindType !== undefined && known.bindType !== bindType) patch.bindType = bindType;
        if (quality !== undefined && known.quality !== quality) patch.quality = quality;
        // Fix placeholder names and names saved with markup by an earlier version.
        if (name && name !== known.name && (known.name.startsWith('item #') || known.name.includes('|'))) {
          patch.name = name;
          byName.set(name.toLowerCase(), known);
        }
        if (Object.keys(patch).length) {
          await db.items.update(known.id!, patch);
          Object.assign(known, patch);
        }
        return known.id!;
      }
      const named = name ? byName.get(name.toLowerCase()) : undefined;
      if (named) {
        await db.items.update(named.id!, {
          gameItemId: gameId,
          ...(vendor !== undefined ? { vendorPrice: vendor } : {}),
          ...(bound !== undefined ? { bound } : {}),
          ...(bindType !== undefined ? { bindType } : {}),
          ...(quality !== undefined ? { quality } : {}),
        });
        named.gameItemId = gameId;
        byGameId.set(gameId, named);
        return named.id!;
      }
      const item = { name: name ?? `item #${gameId}`, gameItemId: gameId, vendorPrice: vendor, bound, bindType, quality };
      const id = await db.items.add(item);
      byGameId.set(gameId, { ...item, id });
      byName.set(item.name.toLowerCase(), { ...item, id });
      return id;
    }

    async function itemByName(rawName: string): Promise<number> {
      const name = cleanItemName(rawName);
      const known = byName.get(name.toLowerCase());
      if (known) return known.id!;
      const id = await db.items.add({ name });
      byName.set(name.toLowerCase(), { id, name });
      return id;
    }

    // Keep vendor prices current for every item the addon has seen.
    for (const key of Object.keys(gameItems)) if (/^\d+$/.test(key)) await itemFor(Number(key));

    // ---- Characters: match by name, create if new.
    const characters = await db.characters.toArray();
    const charIds = new Map<string, number>();
    async function charFor(key: string): Promise<number> {
      const cached = charIds.get(key);
      if (cached !== undefined) return cached;
      const info = chars[key] ?? {};
      const name = str(info.name) ?? key.split('-')[0];
      let c = characters.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!c) {
        const cls = str(info.class);
        const id = await db.characters.add({ name, className: (cls && CLASS_NAMES[cls]) ?? cls ?? '', professions: [] });
        c = { id, name, className: cls ?? '', professions: [] };
        characters.push(c);
      }
      charIds.set(key, c.id!);
      return c.id!;
    }

    for (const [key, info] of Object.entries(chars)) {
      const characterId = await charFor(key);
      report.characters.push(str(info.name) ?? key);
      // Inventory: the addon keeps the latest full snapshot, which replaces ours.
      for (const loc of ['bags', 'bank'] as InventoryLocation[]) {
        const snap = asNumberMap(info[loc]);
        const t = ms(info[loc + 'T']);
        if (info[loc] === undefined) continue;
        await db.inventory.where({ characterId }).filter((r) => r.location === loc).delete();
        for (const [gameId, count] of snap) {
          await db.inventory.add({ characterId, location: loc, itemId: await itemFor(gameId), count, updated: t });
        }
      }
      // Professions listed on the character, from the addon's skill list.
      const skills = info.skills as Obj | undefined;
      if (skills && typeof skills === 'object') {
        const c = characters.find((x) => x.id === characterId)!;
        const names = [...new Set([...c.professions, ...Object.keys(skills)])];
        if (names.length !== c.professions.length) {
          await db.characters.update(characterId, { professions: names });
          c.professions = names;
        }
      }
    }

    // ---- Events, once each.
    const seen = new Set((await db.syncLog.toArray()).map((r) => r.id));
    const settings = (await db.settings.get('main')) ?? DEFAULT_SETTINGS;
    let sales = settings.observedSales ?? 0;
    let cutSum = (settings.observedCutPercent ?? 0) * sales;
    let refunded = settings.observedDepositRefunded;

    for (const e of events) {
      const id = str(e.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      report.newEvents++;
      const characterId = await charFor(str(e.c) ?? '?');
      const time = ms(e.t);

      switch (e.k) {
        case 'gold': {
          const g = num(e.g);
          if (g !== undefined) await db.goldSnapshots.add({ characterId, time, copper: g, source: 'addon' });
          break;
        }
        case 'money': {
          const d = num(e.d);
          const g = num(e.g);
          if (d === undefined) break;
          const cat = (LEDGER_CATEGORIES as readonly string[]).includes(str(e.cat) ?? '')
            ? (e.cat as LedgerCategory)
            : 'other';
          await db.ledger.add({ characterId, time, copper: d, category: cat, note: str(e.note) ?? '', source: 'addon' });
          if (g !== undefined) await db.goldSnapshots.add({ characterId, time, copper: g, source: 'addon' });
          report.ledger++;
          break;
        }
        case 'skill': {
          const name = str(e.n);
          const r = num(e.r);
          if (name && r !== undefined) {
            await db.professionSnapshots.add({ characterId, profession: name, skill: r, maxSkill: num(e.m) ?? r, time });
          }
          break;
        }
        case 'sale': {
          // An AH sale mail: exact price, deposit and cut.
          const name = str(e.item);
          const bid = num(e.bid);
          const n = num(e.n) ?? 1;
          if (!name || !bid) break;
          const itemId = await itemByName(name);
          await db.prices.add({ itemId, time, copper: Math.round(bid / n), source: 'AH', note: 'your sale' });
          report.prices++;
          const dep = num(e.dep);
          const cut = num(e.cut);
          if (dep !== undefined) await db.items.update(itemId, { depositPerUnit: Math.round(dep / n) });
          if (cut !== undefined) {
            cutSum += (100 * cut) / bid;
            sales++;
          }
          const got = num(e.got);
          if (got !== undefined && dep !== undefined && cut !== undefined && dep > 0) {
            refunded = got >= bid - cut + dep - 1;
          }
          break;
        }
        case 'buy': {
          const name = str(e.item);
          const bid = num(e.bid);
          if (!name || !bid) break;
          const n = num(e.n) ?? 1;
          await db.prices.add({ itemId: await itemByName(name), time, copper: Math.round(bid / n), source: 'AH', note: 'you bought' });
          report.prices++;
          break;
        }
        case 'session': {
          const s = e.s as Obj | undefined;
          if (!s) break;
          const type: SessionType = s.type === 'fishing' ? 'fishing' : 'farming';
          const sessionId = await db.sessions.add({
            characterId,
            type,
            zone: str(s.zone) ?? '?',
            start: ms(s.start),
            end: ms(s.stop),
            startCopper: num(s.g0),
            endCopper: num(s.g1),
            notes: [s.auto ? 'auto-detected' : '', str(s.reason) ?? ''].filter(Boolean).join(', '),
            fishingSkillStart: type === 'fishing' ? num(s.fs0) : undefined,
            fishingSkillEnd: type === 'fishing' ? num(s.fs1) : undefined,
            catches: num(s.catches),
            source: 'addon',
          });
          for (const [gameId, count] of asNumberMap(s.loot)) {
            if (count > 0) await db.sessionItems.add({ sessionId, itemId: await itemFor(gameId), count });
          }
          for (const c of asArray<Obj>(s.containers)) {
            const containerGameId = num(c.item);
            if (containerGameId === undefined) continue;
            const openId = await db.containerOpens.add({
              sessionId,
              containerItemId: await itemFor(containerGameId),
              time: ms(c.t),
              copper: num(c.copper) ?? 0,
            });
            for (const [gameId, count] of asNumberMap(c.items)) {
              await db.sessionItems.add({ sessionId, itemId: await itemFor(gameId), count, containerOpenId: openId });
            }
          }
          report.sessions++;
          break;
        }
        default:
          report.warnings.push(`Unknown event type: ${String(e.k)}`);
      }
      await db.syncLog.add({ id });
    }

    await db.settings.put({
      ...settings,
      observedSales: sales,
      observedCutPercent: sales ? Math.round((cutSum / sales) * 100) / 100 : undefined,
      observedDepositRefunded: refunded,
    });

    // ---- Recipes read from the profession window. Manual recipes are never touched.
    const existing = await db.recipes.toArray();
    for (const r of Object.values(recipes)) {
      const out = num(r.out);
      const profession = str(r.p);
      if (out === undefined || !profession) continue;
      const productItemId = await itemFor(out);
      const reagents = [];
      for (const [gameId, count] of asNumberMap(r.r)) reagents.push({ itemId: await itemFor(gameId), count });
      const current = existing.find((x) => x.productItemId === productItemId);
      const recipe: Recipe = { profession, productItemId, productCount: num(r.n) ?? 1, reagents, source: 'addon' };
      if (!current) {
        await db.recipes.add(recipe);
        report.recipes++;
      } else if (current.source === 'addon') {
        await db.recipes.update(current.id!, { ...recipe, patternCost: current.patternCost });
      }
    }

    const lastError = str(root.lastError);
    if (lastError) report.warnings.push(`Addon reported an error: ${lastError}`);
  })();

  return report;
}
