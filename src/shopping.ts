// Auctionator shopping lists, so one "Search" in game prices everything the dashboard is missing.
// Import format (Auctionator Source/ShoppingLists/ImportExport.lua): one list per line,
//   List name^search term^search term
// A term in double quotes is an exact name match.
import { evaluateRecipe, isStale, type Fees, type PriceMap } from './calc';
import { canSellOnAH, type InventoryRow, type Item, type Recipe } from './db';

export interface ShoppingList {
  name: string;
  items: string[]; // item names
}

/** The game's item name: our "(tier N)" suffix is not part of it. */
export function searchName(name: string): string {
  return name.replace(/\s*\(tier \d\)$/, '').replace(/\s*#\d+$/, '').trim();
}

export function buildShoppingLists(
  inventory: InventoryRow[],
  items: Map<number, Item>,
  prices: PriceMap,
  recipes: Recipe[],
  fees: Fees,
  staleDays: number,
  now = Date.now(),
): ShoppingList[] {
  const held = new Set(inventory.map((r) => r.itemId));
  const check = new Set<string>();
  for (const id of held) {
    const item = items.get(id);
    if (!item || !canSellOnAH(item) || !(item.vendorPrice ?? 0)) continue;
    const p = prices.get(id);
    if (!p || isStale(p, staleDays, now)) check.add(searchName(item.name));
  }

  const mats = new Set<string>();
  for (const r of recipes) {
    if (!evaluateRecipe(r, prices, items, fees).missing.length) continue;
    for (const id of [r.productItemId, ...r.reagents.map((x) => x.itemId)]) {
      const item = items.get(id);
      if (item && !prices.get(id)) mats.add(searchName(item.name));
    }
  }

  const sorted = (s: Set<string>) => [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return [
    { name: 'GT check prices', items: sorted(check) },
    { name: 'GT craft materials', items: sorted(mats) },
  ].filter((l) => l.items.length > 0);
}

/** Text for Auctionator's Shopping tab → Import. */
export function auctionatorImportText(lists: ShoppingList[]): string {
  const term = (n: string) => `"${n.replace(/[\^"\n]/g, ' ').trim()}"`;
  return lists.map((l) => [l.name, ...l.items.map(term)].join('^')).join('\n');
}
