import { describe, expect, it } from 'vitest';
import {
  ahNet,
  decideHoldings,
  priceSpikes,
  evaluateRecipe,
  goldChangeSince,
  latestPrices,
  planBankAltMail,
  sessionStats,
  summarizeContainers,
  vendorBeatsAH,
} from './calc';
import type { Character, InventoryRow, Item, Price, Recipe } from './db';

const price = (itemId: number, copper: number, time = 1): Price => ({
  itemId,
  copper,
  time,
  source: 'AH',
  note: '',
});

const items = new Map<number, Item>([
  [1, { id: 1, name: 'Bolt of Silk Cloth' }],
  [2, { id: 2, name: 'Silk Bag', vendorPrice: 2000 }],
  [3, { id: 3, name: 'Fine Thread', vendorPrice: 25 }],
]);
const recipe = {
  profession: 'Tailoring',
  productItemId: 2,
  productCount: 1,
  reagents: [
    { itemId: 1, count: 3 },
    { itemId: 3, count: 1 },
  ],
};

describe('latestPrices', () => {
  it('keeps the newest price per item', () => {
    const map = latestPrices([price(1, 100, 1), price(1, 200, 5), price(1, 150, 3)]);
    expect(map.get(1)?.copper).toBe(200);
  });
});

describe('evaluateRecipe', () => {
  it('picks crafting when it pays more', () => {
    const prices = latestPrices([price(1, 3000), price(2, 15000), price(3, 50)]);
    const r = evaluateRecipe(recipe, prices, items, { ahCutPercent: 5 });
    expect(r.matCost).toBe(9050);
    expect(r.profit).toBe(14250 - 9050);
    expect(r.best?.verdict).toBe('Craft');
    expect(r.missing).toEqual([]);
  });

  it('picks selling mats when the product is cheap', () => {
    const prices = latestPrices([price(1, 3000), price(2, 5000), price(3, 50)]);
    expect(evaluateRecipe(recipe, prices, items, { ahCutPercent: 5 }).best?.verdict).toBe('Sell mats');
  });

  it('gives no verdict and lists gaps when the product has no price', () => {
    const prices = latestPrices([price(1, 3000)]);
    const r = evaluateRecipe(recipe, prices, items, { ahCutPercent: 5 });
    expect(r.best).toBeNull();
    expect(r.missing).toContain('AH price: Silk Bag');
    expect(r.missing).toContain('AH price: Fine Thread');
  });
});

describe('fees', () => {
  it('subtracts the deposit only when it is not refunded', () => {
    expect(ahNet(1000, 2, { ahCutPercent: 5 }, 100)).toBe(1900);
    expect(ahNet(1000, 2, { ahCutPercent: 5, depositRefundedOnSale: false }, 100)).toBe(1700);
  });

  it('flags items where vendoring pays at least as much', () => {
    const green: Item = { id: 5, name: 'Green', vendorPrice: 1000, depositPerUnit: 150 };
    const fees = { ahCutPercent: 5, depositRefundedOnSale: false };
    expect(vendorBeatsAH(green, price(5, 1000), fees)).toBe(true);
    expect(vendorBeatsAH(green, price(5, 2000), fees)).toBe(false);
    expect(vendorBeatsAH({ id: 6, name: 'No vendor' }, price(6, 1), fees)).toBe(false);
  });

  it('computes pattern payback from profit', () => {
    const prices = latestPrices([price(1, 3000), price(2, 15000), price(3, 50)]);
    const r = evaluateRecipe({ ...recipe, patternCost: 20000 }, prices, items, { ahCutPercent: 5 });
    expect(r.profit).toBe(5200);
    expect(r.paybackCrafts).toBe(4);
  });
});

describe('sessionStats', () => {
  it('adds gold change and item value per hour', () => {
    const prices = latestPrices([price(1, 1000)]);
    const s = sessionStats(
      { characterId: 1, type: 'fishing', zone: 'X', start: 0, end: 3_600_000, startCopper: 0, endCopper: 5000, notes: '' },
      [{ sessionId: 1, itemId: 1, count: 2 }],
      prices,
    );
    expect(s.total).toBe(7000);
    expect(s.perHour).toBe(7000);
  });
});

describe('summarizeContainers', () => {
  it('averages coins and priced contents per open', () => {
    const prices = latestPrices([price(1, 1000)]);
    const opens = [
      { id: 10, sessionId: 1, containerItemId: 9, time: 0, copper: 500 },
      { id: 11, sessionId: 1, containerItemId: 9, time: 0, copper: 0 },
    ];
    const contents = [
      { sessionId: 1, itemId: 1, count: 1, containerOpenId: 10 },
      { sessionId: 1, itemId: 4, count: 1, containerOpenId: 11 },
    ];
    const [s] = summarizeContainers(opens, contents, prices);
    expect(s.opens).toBe(2);
    expect(s.avgValue).toBe(750);
    expect(s.unpricedStacks).toBe(1);
  });
});

describe('goldChangeSince', () => {
  it('uses the first snapshot as baseline for new characters', () => {
    const snaps = [
      { characterId: 1, time: 100, copper: 1000, source: 'manual' as const },
      { characterId: 1, time: 200, copper: 3000, source: 'manual' as const },
    ];
    expect(goldChangeSince(snaps, [1], 50, 300)).toBe(2000);
    expect(goldChangeSince(snaps, [1], 150, 300)).toBe(2000);
    expect(goldChangeSince(snaps, [1], 250, 300)).toBe(0);
  });
});

describe('decideHoldings', () => {
  const fees = { ahCutPercent: 5 };
  const it2 = new Map<number, Item>([
    [1, { id: 1, name: 'Bolt of Silk Cloth', vendorPrice: 100 }],
    [2, { id: 2, name: 'Silk Bag', vendorPrice: 2000 }],
    [3, { id: 3, name: 'Fine Thread', vendorPrice: 25 }],
    [10, { id: 10, name: 'Gray Junk', vendorPrice: 50 }],
    [11, { id: 11, name: 'Soulbound Sword', vendorPrice: 900, bound: true }],
    [12, { id: 12, name: 'Quest Thing', bindType: 4 }],
    [13, { id: 13, name: 'Unknown Ore', vendorPrice: 10 }],
  ]);
  const decide = (held: [number, number][], prices: Price[], recipes = [] as typeof recipe[]) =>
    new Map(decideHoldings(new Map(held), it2, latestPrices(prices), fees, recipes, 3, 10).map((d) => [d.itemId, d]));

  it('sells on the AH when it pays more than a vendor', () => {
    const d = decide([[1, 10]], [price(1, 500, 5)]).get(1)!;
    expect(d.decision).toBe('Sell on AH');
    expect(d.ahNet).toBe(4750);
    expect(d.vendor).toBe(1000);
  });

  it('vendors when the vendor pays at least the AH net', () => {
    expect(decide([[10, 4]], [price(10, 50, 5)]).get(10)!.decision).toBe('Vendor');
  });

  it('vendors or keeps items that cannot go on the AH', () => {
    const d = decide([[11, 1], [12, 1]], []);
    expect(d.get(11)!.decision).toBe('Vendor');
    expect(d.get(12)!.decision).toBe('Keep');
  });

  it('asks to check the AH when there is no price', () => {
    expect(decide([[13, 5]], []).get(13)!.decision).toBe('Check AH');
  });

  it('keeps materials when crafting pays more', () => {
    const prices = [price(1, 3000, 5), price(2, 15000, 5), price(3, 50, 5)];
    const d = decide([[1, 6]], prices, [recipe]).get(1)!;
    expect(d.decision).toBe('Keep');
    expect(d.reason).toMatch(/Silk Bag/);
  });

  it('flags old prices', () => {
    const d = decideHoldings(new Map([[1, 1]]), it2, latestPrices([price(1, 500, 0)]), fees, [], 3, 10 * 86_400_000);
    expect(d[0].stale).toBe(true);
  });
});

describe('planBankAltMail', () => {
  const fees = { ahCutPercent: 5 };
  const rogue: Character = { id: 1, name: 'Rogue', className: 'Rogue', professions: ['Skinning', 'Leatherworking'] };
  const mage: Character = { id: 2, name: 'Mage', className: 'Mage', professions: ['Tailoring', 'Enchanting'] };
  const it3 = new Map<number, Item>([
    [1, { id: 1, name: 'Silk Cloth', vendorPrice: 100 }],
    [2, { id: 2, name: 'Silk Bag', vendorPrice: 2000 }],
    [3, { id: 3, name: 'Light Leather', vendorPrice: 15 }],
    [4, { id: 4, name: 'Leather Belt', vendorPrice: 300 }],
    [5, { id: 5, name: 'Iron Ore', vendorPrice: 50 }],
    [6, { id: 6, name: 'Gray Junk', vendorPrice: 40 }],
    [7, { id: 7, name: 'Soulbound Ring', vendorPrice: 900, bound: true }],
    [8, { id: 8, name: 'Warbound Pet', bindType: 8 }],
    [9, { id: 9, name: 'Healing Potion', vendorPrice: 25 }],
    [10, { id: 10, name: 'Odd Rock' }],
    [11, { id: 11, name: 'Copper Bar', vendorPrice: 1 }],
    [12, { id: 12, name: 'Mystery Herb', vendorPrice: 30 }],
  ]);
  const bag: Recipe = { profession: 'Tailoring', productItemId: 2, productCount: 1, reagents: [{ itemId: 1, count: 3 }] };
  const belt: Recipe = { profession: 'Leatherworking', productItemId: 4, productCount: 1, reagents: [{ itemId: 3, count: 4 }] };
  const prices = [price(1, 3000, 5), price(2, 15000, 5), price(3, 200, 5), price(4, 1500, 5), price(5, 400, 5), price(6, 40, 5), price(9, 100, 5), price(11, 3, 5)];
  const inv = (characterId: number, itemId: number, count: number, location: 'bags' | 'bank' = 'bags'): InventoryRow => ({
    characterId,
    location,
    itemId,
    count,
    updated: 0,
  });
  const plan = (inventory: InventoryRow[], opts: { items?: Map<number, Item>; recipes?: Recipe[]; itemsPerMail?: number } = {}) =>
    planBankAltMail({
      bankAltId: 2,
      characters: [rogue, mage],
      inventory,
      items: opts.items ?? it3,
      prices: latestPrices(prices),
      fees,
      recipes: opts.recipes ?? [bag, belt],
      staleDays: 3,
      postage: 30,
      itemsPerMail: opts.itemsPerMail ?? 12,
      now: 10,
    });
  const rows = (inventory: InventoryRow[], opts?: Parameters<typeof plan>[1]) =>
    new Map(plan(inventory, opts)[0].rows.map((r) => [r.itemId, r]));

  it('plans only for characters other than the bank alt', () => {
    const p = plan([inv(1, 5, 10), inv(2, 5, 10)]);
    expect(p.map((s) => s.characterId)).toEqual([1]);
  });

  it('returns nothing when the bank alt is unknown', () => {
    const p = planBankAltMail({
      bankAltId: 99,
      characters: [rogue, mage],
      inventory: [inv(1, 5, 1)],
      items: it3,
      prices: latestPrices(prices),
      fees,
      recipes: [],
      staleDays: 3,
      postage: 30,
      itemsPerMail: 12,
    });
    expect(p).toEqual([]);
  });

  it('adds bags and bank of one character into one stack', () => {
    const r = rows([inv(1, 5, 10, 'bags'), inv(1, 5, 5, 'bank')]).get(5)!;
    expect(r.count).toBe(15);
    expect(r.locations).toEqual(['bags', 'bank']);
  });

  it('leaves out soulbound and warbound items', () => {
    const r = rows([inv(1, 7, 1), inv(1, 8, 1), inv(1, 5, 1)]);
    expect([...r.keys()]).toEqual([5]);
  });

  it('keeps items marked "never send"', () => {
    const items = new Map(it3);
    items.set(9, { ...it3.get(9)!, keepOnCharacter: true });
    const r = rows([inv(1, 9, 20)], { items }).get(9)!;
    expect(r.action).toBe('Keep here');
    expect(r.reason).toMatch(/never send/i);
  });

  it("keeps materials of the sender's own professions", () => {
    const r = rows([inv(1, 3, 20)]).get(3)!;
    expect(r.action).toBe('Keep here');
    expect(r.reason).toMatch(/Leatherworking/);
  });

  it('sends materials the bank alt crafts with', () => {
    const r = rows([inv(1, 1, 6)]).get(1)!;
    expect(r.action).toBe('Send');
    expect(r.reason).toMatch(/Silk Bag/);
    expect(r.value).toBe(ahNet(3000, 6, fees));
  });

  it('does not send materials when crafting is not the best option', () => {
    const cheapBag = [price(1, 3000, 5), price(2, 5000, 5)];
    const p = planBankAltMail({
      bankAltId: 2,
      characters: [rogue, mage],
      inventory: [inv(1, 1, 6)],
      items: it3,
      prices: latestPrices(cheapBag),
      fees,
      recipes: [bag],
      staleDays: 3,
      postage: 30,
      itemsPerMail: 12,
      now: 10,
    });
    expect(p[0].rows[0].action).toBe('Send to sell');
  });

  it('maps the sell list decisions to send actions', () => {
    const r = rows([inv(1, 5, 10), inv(1, 6, 3), inv(1, 12, 2), inv(1, 10, 1)]);
    expect(r.get(5)!.action).toBe('Send to sell');
    expect(r.get(6)!.action).toBe('Vendor here');
    expect(r.get(12)!.action).toBe('Send, check AH there');
    expect(r.get(10)!.action).toBe('Keep here');
  });

  it('vendors here when a stack is worth less than its share of the postage', () => {
    // 30c postage / 12 slots = 2.5c per slot. One Copper Bar nets 2c on the AH (more than its 1c vendor price).
    const r = rows([inv(1, 11, 1)]).get(11)!;
    expect(r.action).toBe('Vendor here');
    expect(r.reason).toMatch(/postage/);
  });

  it('builds the mail plan from the stacks to send', () => {
    const p = plan([inv(1, 5, 10), inv(1, 1, 6), inv(1, 12, 2), inv(1, 6, 3)], { itemsPerMail: 2 })[0];
    expect(p.plan.stacks).toBe(3);
    expect(p.plan.mails).toBe(2);
    expect(p.plan.postage).toBe(60);
    expect(p.plan.value).toBe(ahNet(400, 10, fees) + ahNet(3000, 6, fees) + 60);
  });
});

describe('priceSpikes', () => {
  const DAY = 86_400_000;
  const items = new Map<number, Item>([
    [1, { id: 1, name: 'Silk Cloth' }],
    [2, { id: 2, name: 'Flat Ore' }],
    [3, { id: 3, name: 'Bound Thing', bound: true }],
  ]);
  const p = (itemId: number, copper: number, day: number): Price => ({ itemId, copper, time: day * DAY, source: 'import', note: '' });
  const prices = [
    p(1, 100, 1), p(1, 110, 3), p(1, 150, 5), // +43% vs 105
    p(2, 100, 1), p(2, 100, 3), p(2, 105, 5), // +5%: no alert
    p(3, 10, 1), p(3, 10, 3), p(3, 50, 5), // bound: never
  ];
  const held = new Map([[1, 20], [2, 10], [3, 1]]);

  it('flags held items clearly above their 7-day average', () => {
    const s = priceSpikes(held, items, prices, 3, 0.15, 5 * DAY);
    expect(s.map((x) => [x.itemId, x.changePercent, x.heldValue])).toEqual([[1, 43, 3000]]);
  });

  it('ignores old latest prices', () => {
    expect(priceSpikes(held, items, prices, 3, 0.15, 20 * DAY)).toEqual([]);
  });
});
