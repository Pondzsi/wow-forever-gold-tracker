import { describe, expect, it } from 'vitest';
import { latestPrices } from './calc';
import type { Item, Price } from './db';
import { auctionatorImportText, buildShoppingLists, searchName } from './shopping';

const price = (itemId: number, copper: number, time: number): Price => ({ itemId, copper, time, source: 'import', note: '' });
const items = new Map<number, Item>([
  [1, { id: 1, name: 'Silk Cloth', vendorPrice: 37 }],
  [2, { id: 2, name: 'Small Silk Pack', vendorPrice: 500 }],
  [3, { id: 3, name: 'Potion of Recklessness (tier 1)', vendorPrice: 100 }],
  [4, { id: 4, name: 'Hearthstone', bindType: 1 }],
  [5, { id: 5, name: 'Old Price Ore', vendorPrice: 5 }],
  [6, { id: 6, name: 'Priced Leather', vendorPrice: 15 }],
]);
const inv = (itemId: number) => ({ characterId: 1, location: 'bags' as const, itemId, count: 1, updated: 0 });
const DAY = 86_400_000;

describe('buildShoppingLists', () => {
  it('lists held sellable items without a fresh price, and recipe items without a price', () => {
    const prices = latestPrices([price(5, 40, 0), price(6, 90, 10 * DAY)]);
    const recipes = [{ profession: 'Tailoring', productItemId: 2, productCount: 1, reagents: [{ itemId: 1, count: 3 }] }];
    const lists = buildShoppingLists([inv(3), inv(4), inv(5), inv(6)], items, prices, recipes, { ahCutPercent: 5 }, 3, 10 * DAY);
    expect(lists).toEqual([
      { name: 'GT check prices', items: ['Old Price Ore', 'Potion of Recklessness'] },
      { name: 'GT craft materials', items: ['Silk Cloth', 'Small Silk Pack'] },
    ]);
  });

  it('returns no lists when everything has a price', () => {
    const prices = latestPrices([price(6, 90, 10 * DAY)]);
    expect(buildShoppingLists([inv(6)], items, prices, [], { ahCutPercent: 5 }, 3, 10 * DAY)).toEqual([]);
  });
});

describe('auctionatorImportText', () => {
  it('writes one line per list with exact-match terms', () => {
    expect(
      auctionatorImportText([
        { name: 'GT check prices', items: ['Silk Cloth', 'Bad^Name'] },
        { name: 'GT craft materials', items: ['Linen Cloth'] },
      ]),
    ).toBe('GT check prices^"Silk Cloth"^"Bad Name"\nGT craft materials^"Linen Cloth"');
  });

  it('strips our tier and id suffixes from names', () => {
    expect(searchName('Potion of Recklessness (tier 2)')).toBe('Potion of Recklessness');
    expect(searchName('Ore #1234')).toBe('Ore');
  });
});
