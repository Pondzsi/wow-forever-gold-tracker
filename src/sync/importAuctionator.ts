import { db } from '../db';
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

export interface AuctionatorRealm {
  name: string;
  items: number;
  lastDay: number | null; // ms timestamp of the newest scan day
}

export function listAuctionatorRealms(saved: Record<string, LuaValue>): AuctionatorRealm[] {
  const root = saved.AUCTIONATOR_PRICE_DATABASE as Obj | undefined;
  if (!root || typeof root !== 'object') return [];
  const day0 = auctionatorDay0();
  return Object.entries(root)
    .filter(([k, v]) => !k.startsWith('__') && v && typeof v === 'object')
    .map(([name, realm]) => {
      let last = -1;
      let items = 0;
      for (const [key, entry] of Object.entries(realm as Obj)) {
        if (!/^\d+$/.test(key) || !entry || typeof entry !== 'object') continue;
        items++;
        for (const d of Object.keys(((entry as Obj).h ?? {}) as Obj)) last = Math.max(last, Number(d));
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

  const data = (saved.AUCTIONATOR_PRICE_DATABASE as Obj)[realm.name] as Obj;
  const day0 = auctionatorDay0();
  let newPrices = 0;
  let itemsWithPrices = 0;

  await db.transaction('rw', db.items, db.prices, db.syncLog, async () => {
    const items = await db.items.filter((i) => i.gameItemId !== undefined).toArray();
    const seen = new Set((await db.syncLog.where('id').startsWith('atr:').primaryKeys()) as string[]);

    for (const item of items) {
      const entry = data[String(item.gameItemId)] as Obj | undefined;
      if (!entry || typeof entry !== 'object') continue;
      const highs = (entry.h ?? {}) as Obj;
      const lows = (entry.l ?? {}) as Obj;
      const days = Object.keys(highs).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!days.length) continue;
      itemsWithPrices++;
      const lastDay = days[days.length - 1];

      for (const day of days) {
        // The day's lowest price: "l" is only stored when lower than "h".
        const low = typeof lows[day] === 'number' ? (lows[day] as number) : (highs[day] as number);
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
