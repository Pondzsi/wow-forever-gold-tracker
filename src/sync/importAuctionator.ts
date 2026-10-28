import { db } from '../db';
import { binaryStringToBytes, decodeCbor } from './cbor';
import type { LuaValue } from './luaParse';

// Auctionator saves AUCTIONATOR_PRICE_DATABASE in Auctionator.lua:
//   { __dbversion = n, ["Realm"] = { ["2589"] = { m = lastMin, h = {[day] = high}, l = {[day] = low}, a = {...} } } }
// Days count from 1 Jan 2020 (local time). Gear can use keys like "g:itemID:ilvl"; those are skipped.
// Format checked against Auctionator 9.x source; verify with a real Forever file at launch.

type Obj = Record<string, LuaValue>;
const DAY_MS = 86_400_000;

export function auctionatorDay0(): number {
  return new Date(2020, 0, 1, 0, 0, 0).getTime();
}

// Retail Auctionator (database version 8) stores each realm as one CBOR string;
// older versions use a plain Lua table. Decoded realms are cached per parse.
const decoded = new WeakMap<object, Map<string, Obj>>();

function realmTables(saved: Record<string, LuaValue>): Map<string, Obj> {
  const root = saved.AUCTIONATOR_PRICE_DATABASE as Obj | undefined;
  if (!root || typeof root !== 'object') return new Map();
  const cached = decoded.get(root);
  if (cached) return cached;
  const out = new Map<string, Obj>();
  for (const [name, value] of Object.entries(root)) {
    if (name.startsWith('__')) continue;
    if (typeof value === 'string') {
      try {
        const data = decodeCbor(binaryStringToBytes(value));
        if (data && typeof data === 'object' && !Array.isArray(data)) out.set(name, data as Obj);
      } catch {
        // Unknown encoding: skip this realm.
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.set(name, value as Obj);
    }
  }
  decoded.set(root, out);
  return out;
}

/** Entry for a game item id: the plain key, or a gear key "g:<id>:<ilvl>" as fallback. */
function entryFor(data: Obj, gameId: number, gearIndex: Map<number, Obj>): Obj | undefined {
  const plain = data[String(gameId)];
  if (plain && typeof plain === 'object') return plain as Obj;
  return gearIndex.get(gameId);
}

function buildGearIndex(data: Obj): Map<number, Obj> {
  const index = new Map<number, Obj>();
  for (const [key, entry] of Object.entries(data)) {
    const m = /^g:(\d+):/.exec(key);
    if (m && entry && typeof entry === 'object' && !index.has(Number(m[1]))) index.set(Number(m[1]), entry as Obj);
  }
  return index;
}

/** Day numbers with a price, from "h" (a {day: price} table; Lua arrays come back as lists). */
function dayPrices(t: LuaValue | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (Array.isArray(t)) t.forEach((v, idx) => typeof v === 'number' && out.set(idx + 1, v));
  else if (t && typeof t === 'object') {
    for (const [d, v] of Object.entries(t)) if (/^\d+$/.test(d) && typeof v === 'number') out.set(Number(d), v);
  }
  return out;
}

export interface AuctionatorRealm {
  name: string;
  items: number;
  lastDay: number | null; // ms timestamp of the newest scan day
}

export function listAuctionatorRealms(saved: Record<string, LuaValue>): AuctionatorRealm[] {
  const day0 = auctionatorDay0();
  return [...realmTables(saved).entries()]
    .map(([name, realm]) => {
      let last = -1;
      let items = 0;
      for (const entry of Object.values(realm)) {
        if (!entry || typeof entry !== 'object') continue;
        items++;
        for (const d of dayPrices((entry as Obj).h).keys()) last = Math.max(last, d);
      }
      return { name, items, lastDay: last >= 0 ? day0 + last * DAY_MS : null };
    })
    .sort((a, b) => (b.lastDay ?? 0) - (a.lastDay ?? 0));
}

export interface AuctionatorReport {
  realm: string | null;
  newPrices: number;
  itemsWithPrices: number;
}

/**
 * Imports daily prices for items the dashboard knows (by game item id), plus the
 * latest minimum price. Unknown items are skipped so the item list stays small.
 */
export async function importAuctionator(
  saved: Record<string, LuaValue>,
  preferredRealm?: string,
): Promise<AuctionatorReport> {
  const realms = listAuctionatorRealms(saved);
  const realm = realms.find((r) => r.name === preferredRealm) ?? realms[0];
  if (!realm) return { realm: null, newPrices: 0, itemsWithPrices: 0 };

  const data = realmTables(saved).get(realm.name)!;
  const gearIndex = buildGearIndex(data);
  const day0 = auctionatorDay0();
  let newPrices = 0;
  let itemsWithPrices = 0;

  await db.transaction('rw', db.items, db.prices, db.syncLog, async () => {
    const items = await db.items.filter((i) => i.gameItemId !== undefined).toArray();
    const seen = new Set((await db.syncLog.where('id').startsWith('atr:').primaryKeys()) as string[]);

    for (const item of items) {
      const entry = entryFor(data, item.gameItemId!, gearIndex);
      if (!entry) continue;
      const highs = dayPrices(entry.h);
      const lows = dayPrices(entry.l);
      const days = [...highs.keys()].sort((a, b) => a - b);
      if (!days.length) continue;
      itemsWithPrices++;
      const lastDay = days[days.length - 1];

      for (const day of days) {
        // The day's lowest price: "l" is only stored when lower than "h".
        const low = lows.get(day) ?? highs.get(day)!;
        const isLast = day === lastDay && typeof entry.m === 'number' && entry.m > 0;
        const copper = isLast ? (entry.m as number) : low;
        if (typeof copper !== 'number' || copper <= 0) continue;
        const id = `atr:${realm.name}:${item.gameItemId}:${day}:${copper}`;
        if (seen.has(id)) continue;
        seen.add(id);
        await db.syncLog.add({ id });
        // Latest price sits at the end of its day, so it wins over that day's low.
        const time = day0 + day * DAY_MS + (isLast ? DAY_MS - 1000 : DAY_MS / 2);
        // A later scan the same day replaces the earlier "latest" value.
        await db.prices.where({ itemId: item.id! }).filter((p) => p.time === time && p.source === 'import').delete();
        await db.prices.add({
          itemId: item.id!,
          time,
          copper,
          source: 'import',
          note: isLast ? 'Auctionator latest' : 'Auctionator daily low',
        });
        newPrices++;
      }
    }
  });

  return { realm: realm.name, newPrices, itemsWithPrices };
}
