import { describe, expect, it } from 'vitest';
import {
  ahNet,
  decideHoldings,
  evaluateRecipe,
  goldChangeSince,
  latestPrices,
  sessionStats,
  summarizeContainers,
  vendorBeatsAH,
} from './calc';
import type { Item, Price } from './db';

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
