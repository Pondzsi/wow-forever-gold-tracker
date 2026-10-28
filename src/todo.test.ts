import { describe, expect, it } from 'vitest';
import { latestPrices } from './calc';
import { DEFAULT_SETTINGS, type Item } from './db';
import { buildTodos } from './todo';

const items = new Map<number, Item>([
  [1, { id: 1, name: 'Silk Cloth', vendorPrice: 37 }],
  [2, { id: 2, name: 'Small Silk Pack', vendorPrice: 500 }],
  [3, { id: 3, name: 'Heavy Leather', vendorPrice: 2000 }],
]);

const base = {
  items,
  prices: latestPrices([]),
  inventory: [],
  recipes: [],
  sessions: [],
  settings: DEFAULT_SETTINGS,
  goals: 1,
  lastSync: Date.now(),
  folderConnected: true,
};

describe('buildTodos', () => {
  it('asks to connect the folder first when not connected', () => {
    const t = buildTodos({ ...base, folderConnected: false });
    expect(t[0]).toMatchObject({ value: 'High', title: 'Connect your WoW folder' });
  });

  it('flags unverified AH fees until a sale is observed', () => {
    expect(buildTodos(base).some((t) => t.title.startsWith('AH cut'))).toBe(true);
    const verified = { ...DEFAULT_SETTINGS, observedSales: 2, observedCutPercent: 5, observedDepositRefunded: true };
    expect(buildTodos({ ...base, settings: verified }).some((t) => t.title.includes('fee'))).toBe(false);
    const differs = { ...verified, observedCutPercent: 7.5 };
    expect(buildTodos({ ...base, settings: differs })[0].title).toMatch(/differ/);
  });

  it('ranks unpriced held items by vendor value and marks big ones High', () => {
    const t = buildTodos({
      ...base,
      inventory: [
        { characterId: 1, location: 'bags', itemId: 1, count: 20, updated: 0 },
        { characterId: 1, location: 'bank', itemId: 3, count: 10, updated: 0 },
      ],
    }).find((x) => x.title.includes('have no AH price'))!;
    expect(t.value).toBe('High');
    expect(t.items).toEqual(['Heavy Leather ×10', 'Silk Cloth ×20']);
  });

  it('leaves warbound items out', () => {
    const warbound = new Map(items);
    warbound.set(3, { ...items.get(3)!, bindType: 9 }); // warbound until equipped
    const t = buildTodos({
      ...base,
      items: warbound,
      inventory: [{ characterId: 1, location: 'bags', itemId: 3, count: 1, updated: 0 }],
    });
    expect(t.some((x) => x.title.includes('have no AH price'))).toBe(false);
  });

  it('leaves soulbound items out', () => {
    const withBound = new Map(items);
    withBound.set(3, { ...items.get(3)!, bound: true });
    const t = buildTodos({
      ...base,
      items: withBound,
      inventory: [
        { characterId: 1, location: 'bags', itemId: 1, count: 20, updated: 0 },
        { characterId: 1, location: 'bank', itemId: 3, count: 10, updated: 0 },
      ],
    }).find((x) => x.title.includes('have no AH price'))!;
    expect(t.items).toEqual(['Silk Cloth ×20']);
  });

  it('lists recipe items without prices', () => {
    const t = buildTodos({
      ...base,
      recipes: [{ profession: 'Tailoring', productItemId: 2, productCount: 1, reagents: [{ itemId: 1, count: 4 }] }],
    }).find((x) => x.title.includes('recipe item'))!;
    expect(t.items).toEqual(['Silk Cloth', 'Small Silk Pack']);
  });

  it('flags failed addon health checks as High', () => {
    const addonHealth = {
      time: 0,
      checks: [
        { name: 'gold', ok: true, detail: 'gold is readable' },
        { name: 'loot', ok: false, detail: 'missing: GetLootSourceInfo' },
        { name: 'bound', ok: false, detail: 'C_Item.IsBound gave no answer' },
      ],
    };
    const t = buildTodos({ ...base, addonHealth }).find((x) => x.title.startsWith("Addon can't read"))!;
    expect(t).toMatchObject({ value: 'High', title: "Addon can't read loot, soulbound status in this game version" });
    expect(t.items).toEqual(['loot: missing: GetLootSourceInfo', 'soulbound status: C_Item.IsBound gave no answer']);

    const allOk = { ...addonHealth, checks: [addonHealth.checks[0]] };
    expect(buildTodos({ ...base, addonHealth: allOk }).some((x) => x.title.includes('Addon'))).toBe(false);
  });

  it('asks for a health check only after a sync without one', () => {
    const missing = buildTodos({ ...base, addonHealth: null }).find((x) => x.title === 'No addon health check yet');
    expect(missing?.value).toBe('Medium');
    expect(buildTodos({ ...base, addonHealth: null, lastSync: null }).some((x) => x.title.includes('health'))).toBe(false);
    // Callers that don't load health data (undefined) get no health to-do.
    expect(buildTodos(base).some((x) => x.title.includes('health'))).toBe(false);
  });

  it('puts optional fishing details last', () => {
    const t = buildTodos({
      ...base,
      sessions: [{ characterId: 1, type: 'fishing', zone: 'X', start: 0, end: 1, notes: '' }],
    });
    expect(t[t.length - 1]).toMatchObject({ value: 'Low' });
  });
});
