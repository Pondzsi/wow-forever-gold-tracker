import type { ContainerOpen, GoldSnapshot, Item, Price, Recipe, Session, SessionItem } from './db';

export type PriceMap = Map<number, Price>;

/** Latest recorded price per item. */
export function latestPrices(prices: Price[]): PriceMap {
  const map: PriceMap = new Map();
  for (const p of prices) {
    const cur = map.get(p.itemId);
    if (!cur || p.time > cur.time) map.set(p.itemId, p);
  }
  return map;
}

export function isStale(price: Price, staleDays: number, now = Date.now()): boolean {
  return now - price.time > staleDays * 86_400_000;
}

export interface Fees {
  ahCutPercent: number;
  depositRefundedOnSale?: boolean;
}

/**
 * What you keep from selling `count` units on the AH at `unitPrice`:
 * price minus the AH cut, minus the deposit when it is not refunded on sale.
 */
export function ahNet(unitPrice: number, count: number, fees: Fees, depositPerUnit = 0): number {
  const afterCut = Math.floor(unitPrice * count * (1 - fees.ahCutPercent / 100));
  return afterCut - (fees.depositRefundedOnSale === false ? depositPerUnit * count : 0);
}

/** True when vendoring pays at least as much as selling on the AH after fees. */
export function vendorBeatsAH(item: Item, price: Price | undefined, fees: Fees): boolean {
  if (!price || item.vendorPrice === undefined) return false;
  return item.vendorPrice >= ahNet(price.copper, 1, fees, item.depositPerUnit);
}

export interface CraftOption {
  label: string;
  verdict: 'Craft' | 'Sell mats' | 'Vendor';
  copper: number;
}

export interface RecipeEval {
  matCost: number | null; // buying the mats at latest AH prices
  profit: number | null; // craft & sell net, minus mat cost
  options: CraftOption[]; // only options with complete data
  best: CraftOption | null;
  missing: string[]; // what to record to complete the picture
  paybackCrafts: number | null; // crafts needed to pay back the pattern cost
}

/**
 * Compares what one craft's worth of materials earns on each path:
 * craft and sell on the AH, craft and vendor, sell the mats, vendor the mats.
 * Paths with a missing price are left out and listed in `missing`.
 */
export function evaluateRecipe(
  recipe: Recipe,
  prices: PriceMap,
  items: Map<number, Item>,
  fees: Fees,
): RecipeEval {
  const name = (id: number) => items.get(id)?.name ?? `item #${id}`;
  const missing: string[] = [];

  let matCost: number | null = 0;
  let matSaleNet: number | null = 0;
  let matVendor: number | null = 0;
  for (const r of recipe.reagents) {
    const p = prices.get(r.itemId);
    if (p && matCost !== null && matSaleNet !== null) {
      matCost += p.copper * r.count;
      matSaleNet += ahNet(p.copper, r.count, fees, items.get(r.itemId)?.depositPerUnit);
    } else if (!p) {
      matCost = null;
      matSaleNet = null;
      missing.push(`AH price: ${name(r.itemId)}`);
    }
    const v = items.get(r.itemId)?.vendorPrice;
    matVendor = v !== undefined && matVendor !== null ? matVendor + v * r.count : null;
  }

  const options: CraftOption[] = [];
  const productPrice = prices.get(recipe.productItemId);
  let profit: number | null = null;
  if (productPrice) {
    const net = ahNet(
      productPrice.copper,
      recipe.productCount,
      fees,
      items.get(recipe.productItemId)?.depositPerUnit,
    );
    options.push({ label: 'Craft and sell on AH', verdict: 'Craft', copper: net });
    if (matCost !== null) profit = net - matCost;
  } else {
    missing.push(`AH price: ${name(recipe.productItemId)}`);
  }
  const productVendor = items.get(recipe.productItemId)?.vendorPrice;
  if (productVendor !== undefined) {
    options.push({ label: 'Craft and vendor', verdict: 'Vendor', copper: productVendor * recipe.productCount });
  }
  if (matSaleNet !== null) {
    options.push({ label: 'Sell mats on AH', verdict: 'Sell mats', copper: matSaleNet });
  }
  if (matVendor !== null && recipe.reagents.length) {
    options.push({ label: 'Vendor the mats', verdict: 'Vendor', copper: matVendor });
  }

  // A verdict needs the craft path and at least one alternative.
  const hasCraft = options.some((o) => o.verdict === 'Craft');
  const best = hasCraft && options.length > 1 ? options.reduce((a, b) => (b.copper > a.copper ? b : a)) : null;
  const paybackCrafts =
    recipe.patternCost && profit !== null && profit > 0 ? Math.ceil(recipe.patternCost / profit) : null;
  return { matCost, profit, options, best, missing: [...new Set(missing)], paybackCrafts };
}

export interface ItemValue {
  copper: number;
  unpriced: number; // number of item stacks with no price
}

export function valueItems(rows: { itemId: number; count: number }[], prices: PriceMap): ItemValue {
  let copper = 0;
  let unpriced = 0;
  for (const r of rows) {
    const p = prices.get(r.itemId);
    if (p) copper += p.copper * r.count;
    else unpriced++;
  }
  return { copper, unpriced };
}

export interface SessionStats {
  hours: number;
  goldDelta: number | null;
  itemValue: ItemValue;
  total: number; // gold delta (if known) + priced items
  perHour: number | null;
}

export function sessionStats(
  session: Session,
  items: SessionItem[],
  prices: PriceMap,
  now = Date.now(),
): SessionStats {
  const hours = ((session.end ?? now) - session.start) / 3_600_000;
  const goldDelta =
    session.startCopper !== undefined && session.endCopper !== undefined
      ? session.endCopper - session.startCopper
      : null;
  const itemValue = valueItems(items, prices);
  const total = (goldDelta ?? 0) + itemValue.copper;
  return { hours, goldDelta, itemValue, total, perHour: hours > 0.01 ? total / hours : null };
}

export interface ContainerSummary {
  containerItemId: number;
  opens: number;
  avgValue: number; // coins + priced contents, per open
  unpricedStacks: number;
}

export function summarizeContainers(
  opens: ContainerOpen[],
  items: SessionItem[],
  prices: PriceMap,
): ContainerSummary[] {
  const byType = new Map<number, ContainerSummary & { totalValue: number }>();
  for (const o of opens) {
    const contents = items.filter((i) => i.containerOpenId === o.id);
    const v = valueItems(contents, prices);
    const s = byType.get(o.containerItemId) ?? {
      containerItemId: o.containerItemId,
      opens: 0,
      avgValue: 0,
      unpricedStacks: 0,
      totalValue: 0,
    };
    s.opens++;
    s.totalValue += o.copper + v.copper;
    s.unpricedStacks += v.unpriced;
    s.avgValue = s.totalValue / s.opens;
    byType.set(o.containerItemId, s);
  }
  return [...byType.values()].map(({ totalValue: _t, ...rest }) => rest);
}

/** Latest gold per character at or before `time`. Characters without data then are skipped. */
export function goldAt(snapshots: GoldSnapshot[], characterIds: number[], time: number): number | null {
  let total = 0;
  let any = false;
  for (const cid of characterIds) {
    let best: GoldSnapshot | undefined;
    for (const s of snapshots) {
      if (s.characterId === cid && s.time <= time && (!best || s.time > best.time)) best = s;
    }
    if (best) {
      total += best.copper;
      any = true;
    }
  }
  return any ? total : null;
}

/** Total gold after each snapshot, for charts. */
export function goldTimeline(snapshots: GoldSnapshot[], characterIds: number[]): { time: number; copper: number }[] {
  const sorted = snapshots.filter((s) => characterIds.includes(s.characterId)).sort((a, b) => a.time - b.time);
  return sorted.map((s) => ({ time: s.time, copper: goldAt(sorted, characterIds, s.time) ?? 0 }));
}

/**
 * Gold change since `since`. Uses the earliest snapshot as the baseline when
 * there is no data before `since`, so a new character does not count as income.
 */
export function goldChangeSince(
  snapshots: GoldSnapshot[],
  characterIds: number[],
  since: number,
  now = Date.now(),
): number | null {
  let change = 0;
  let any = false;
  for (const cid of characterIds) {
    const mine = snapshots.filter((s) => s.characterId === cid).sort((a, b) => a.time - b.time);
    if (!mine.length) continue;
    const end = goldAt(mine, [cid], now);
    const start = goldAt(mine, [cid], since) ?? mine[0].copper;
    if (end === null) continue;
    change += end - start;
    any = true;
  }
  return any ? change : null;
}
