// "What still needs you": things the addon and Auctionator cannot fill in,
// ranked by how much they matter for gold decisions.
import { evaluateRecipe, isStale, type PriceMap } from './calc';
import { canSellOnAH, type InventoryRow, type Item, type Recipe, type Session, type Settings } from './db';
import { formatMoney } from './money';
import { healthLabel, type AddonHealth } from './sync/importAddon';

export type Value = 'High' | 'Medium' | 'Low';

export interface Todo {
  value: Value;
  title: string;
  why: string;
  how: string;
  items?: string[];
}

export interface TodoInput {
  items: Map<number, Item>;
  prices: PriceMap;
  inventory: InventoryRow[];
  recipes: Recipe[];
  sessions: Session[];
  settings: Settings;
  goals: number;
  lastSync: number | null;
  folderConnected: boolean;
  /** The addon's last /gt check result; null when the addon has never sent one. */
  addonHealth?: AddonHealth | null;
  now?: number;
}

const RANK: Record<Value, number> = { High: 0, Medium: 1, Low: 2 };
const TOP = 8;

export function buildTodos(input: TodoInput): Todo[] {
  const { items, prices, inventory, recipes, sessions, settings } = input;
  const now = input.now ?? Date.now();
  const name = (id: number) => items.get(id)?.name ?? `item #${id}`;
  const todos: Todo[] = [];

  // 1. Sync connection.
  if (!input.folderConnected) {
    todos.push({
      value: 'High',
      title: 'Connect the game data folder',
      why: 'Without it, everything below has to be typed in by hand.',
      how: 'Sync & to-do → download and run setup.bat, then "Choose folder…" → Documents\\ForeverGoldTracker. One time only.',
    });
  } else if (!input.lastSync || now - input.lastSync > 2 * 86_400_000) {
    todos.push({
      value: 'Medium',
      title: 'No sync for more than 2 days',
      why: 'Gold, inventory and prices on this dashboard are getting old.',
      how: 'Log out or type /reload in game, then switch back to this tab.',
    });
  }

  // Addon health: data the addon can't read in this game version.
  const failed = input.addonHealth?.checks.filter((c) => !c.ok) ?? [];
  if (failed.length) {
    todos.push({
      value: 'High',
      title: `Addon can't read ${failed.map((c) => healthLabel(c.name)).join(', ')} in this game version`,
      why: 'That data stays empty or wrong on the dashboard until the addon is fixed.',
      how: 'Sync & to-do → Addon health shows the details. Run /gt check in game after an addon update, then /reload.',
      items: failed.map((c) => `${healthLabel(c.name)}: ${c.detail}`),
    });
  } else if (input.addonHealth === null && input.lastSync) {
    todos.push({
      value: 'Medium',
      title: 'No addon health check yet',
      why: 'You can\'t tell which data the addon records in this game version.',
      how: 'Run setup.bat again to update the Gold Tracker addon (0.2.0 or later). Then log in and type /reload.',
    });
  }

  // 2. Recipes that cannot get a verdict because of missing prices.
  const missingForRecipes = new Set<string>();
  for (const r of recipes) {
    for (const m of evaluateRecipe(r, prices, items, settings).missing) missingForRecipes.add(m.replace('AH price: ', ''));
  }
  if (missingForRecipes.size) {
    todos.push({
      value: 'High',
      title: `${missingForRecipes.size} recipe item(s) have no AH price`,
      why: 'The craft-or-sell verdict needs a price for the product and every material.',
      how: 'Sell list → "Copy Auctionator shopping list". In game: Auctionator → Shopping → Import, then Search.',
      items: [...missingForRecipes].slice(0, TOP),
    });
  }

  // 3. Items you hold that have no AH price, ranked by vendor value as a rough size guide.
  const held = new Map<number, number>();
  for (const r of inventory) held.set(r.itemId, (held.get(r.itemId) ?? 0) + r.count);
  const unpriced = [...held.entries()]
    // Soulbound, quest and warbound items can't be listed, so they never need an AH price.
    .filter(([id]) => !prices.get(id) && canSellOnAH(items.get(id)) && (items.get(id)?.vendorPrice ?? 0) > 0)
    .map(([id, count]) => ({ id, count, weight: count * (items.get(id)?.vendorPrice ?? 0) }))
    .sort((a, b) => b.weight - a.weight);
  if (unpriced.length) {
    const big = unpriced.some((u) => u.weight >= 10_000);
    todos.push({
      value: big ? 'High' : 'Medium',
      title: `${unpriced.length} sellable item(s) in your bags or bank have no AH price`,
      why: 'You can\'t tell whether to sell, vendor or keep them. Sorted by vendor value × count. Soulbound, quest and warbound items are left out.',
      how: 'Sell list → "Copy Auctionator shopping list", import it in Auctionator, then Search. Nobody lists an item? Vendor or keep it.',
      items: unpriced.slice(0, TOP).map((u) => `${name(u.id)} ×${u.count}`),
    });
  }

  // 4. Stale prices on items you hold, ranked by held value.
  const stale = [...held.entries()]
    .map(([id, count]) => ({ id, count, p: prices.get(id) }))
    .filter((x) => x.p && isStale(x.p, settings.staleDays, now))
    .map((x) => ({ ...x, value: x.count * x.p!.copper }))
    .sort((a, b) => b.value - a.value);
  if (stale.length) {
    todos.push({
      value: stale[0].value >= 50_000 ? 'Medium' : 'Low',
      title: `${stale.length} price(s) older than ${settings.staleDays} days on items you hold`,
      why: 'Old prices can point you to the wrong decision.',
      how: 'Sell list → "Copy Auctionator shopping list" (it includes old prices), or run an Auctionator full scan.',
      items: stale.slice(0, TOP).map((s) => `${name(s.id)} (${formatMoney(s.value)} held)`),
    });
  }

  // 5. AH fees: unverified until the addon reads a sale mail.
  if (!settings.observedSales) {
    todos.push({
      value: 'High',
      title: 'AH cut and deposit are not verified for Forever',
      why: `Every profit number uses a ${settings.ahCutPercent}% cut and assumes the deposit is ${
        settings.depositRefundedOnSale === false ? 'lost' : 'refunded'
      }.`,
      how: 'Sell any item on the AH and take the money from the mailbox. The addon reads the real cut and deposit.',
    });
  } else {
    const observed = settings.observedCutPercent ?? settings.ahCutPercent;
    const refundDiffers =
      settings.observedDepositRefunded !== undefined &&
      settings.observedDepositRefunded !== (settings.depositRefundedOnSale !== false);
    if (Math.abs(observed - settings.ahCutPercent) > 0.5 || refundDiffers) {
      todos.push({
        value: 'High',
        title: 'Your fee settings differ from what the AH charged',
        why: `Observed from ${settings.observedSales} sale(s): ${observed}% cut, deposit ${
          settings.observedDepositRefunded ? 'refunded' : 'not refunded'
        }.`,
        how: 'Settings → "Use observed fees".',
      });
    }
  }

  // 6. Pattern costs: only matters for patterns you bought.
  const noPattern = recipes.filter((r) => r.source === 'addon' && r.patternCost === undefined);
  if (noPattern.length) {
    todos.push({
      value: 'Low',
      title: `${noPattern.length} recipe(s) without a pattern cost`,
      why: 'Only needed for patterns you bought, to see when they pay for themselves.',
      how: 'Crafting → edit the recipe → pattern cost. Skip trainer recipes.',
      items: noPattern.slice(0, TOP).map((r) => name(r.productItemId)),
    });
  }

  // 7. Fishing details the game does not tell the addon.
  const fishing = sessions.filter((s) => s.type === 'fishing' && s.end !== undefined && !s.water);
  if (fishing.length) {
    todos.push({
      value: 'Low',
      title: `${fishing.length} fishing session(s) without pools/open water and fish rack info`,
      why: 'Only used to compare fishing methods. Gold per hour works without it.',
      how: 'Sessions → set "Water" and "Rack" on the finished sessions.',
    });
  }

  if (input.goals === 0) {
    todos.push({
      value: 'Low',
      title: 'No savings goal yet',
      why: 'Optional. Shows progress and an estimated date.',
      how: 'Goals → add one (e.g. riding skill).',
    });
  }

  return todos.sort((a, b) => RANK[a.value] - RANK[b.value]);
}

/** What the addon and Auctionator fill in, and what stays manual. Shown on the Sync page. */
export const COVERAGE: { data: string; how: string; value: Value; auto: 'Automatic' | 'Partly' | 'Manual' }[] = [
  { data: 'Gold per character', how: 'Addon, every gold change', value: 'High', auto: 'Automatic' },
  { data: 'Income and expenses', how: 'Addon; category from the open window (vendor, AH, mail, trainer…)', value: 'High', auto: 'Automatic' },
  { data: 'Bags', how: 'Addon, a few seconds after a bag change (after combat ends)', value: 'High', auto: 'Automatic' },
  { data: 'Bank', how: 'Addon, when you open the bank (character bank, not the warband bank)', value: 'Medium', auto: 'Automatic' },
  { data: 'Vendor prices', how: 'Addon reads them from game data', value: 'High', auto: 'Automatic' },
  { data: 'Item quality and bind type', how: 'Addon reads them from game data', value: 'Medium', auto: 'Automatic' },
  { data: 'Soulbound status', how: 'Addon, per bag and bank slot', value: 'Medium', auto: 'Automatic' },
  { data: 'AH market prices', how: 'Auctionator (full scan or searches); you only press scan', value: 'High', auto: 'Partly' },
  { data: 'Your AH sales, cut and deposit', how: 'Addon reads AH sale mails when you open the mailbox', value: 'High', auto: 'Automatic' },
  { data: 'Your AH purchases', how: 'Addon reads AH purchase mails when you open the mailbox', value: 'Low', auto: 'Automatic' },
  { data: 'Profession skill levels', how: 'Addon', value: 'Medium', auto: 'Automatic' },
  { data: 'Recipes and materials', how: 'Addon, your learned recipes, when you open a profession window', value: 'High', auto: 'Automatic' },
  { data: 'Fishing sessions', how: 'Addon; starts on first catch, ends after 15 min without a catch, a zone change or logout', value: 'High', auto: 'Automatic' },
  { data: 'Trunk and fish contents', how: 'Addon, when you open them during a session', value: 'High', auto: 'Automatic' },
  { data: 'Farming sessions', how: 'Type /gt start farming and /gt stop (logout also ends it)', value: 'Medium', auto: 'Partly' },
  { data: 'Pools vs open water, fish rack', how: 'You set it on the session', value: 'Low', auto: 'Manual' },
  { data: 'Pattern cost', how: 'You enter it for bought patterns', value: 'Low', auto: 'Manual' },
  { data: 'Savings goals', how: 'You add them once', value: 'Low', auto: 'Manual' },
  { data: 'Addon health', how: 'Addon checks itself 10 s after each login; /gt check runs it again', value: 'Medium', auto: 'Automatic' },
  { data: 'Send to bank alt list', how: 'Calculated from synced bags and banks; you choose the bank alt once', value: 'Medium', auto: 'Partly' },
  { data: 'Disenchant results', how: 'Not yet (no verified data)', value: 'Medium', auto: 'Manual' },
];
