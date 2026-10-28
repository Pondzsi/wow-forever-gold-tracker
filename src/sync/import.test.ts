import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { importFile } from './folder';
import { auctionatorDay0 } from './importAuctionator';
// Written to match what addon/GoldTracker/GoldTracker.lua saves.
import goldTrackerFile from './fixtures/GoldTracker.sample.lua?raw';


const day = Math.floor((new Date(2026, 10, 10).getTime() - auctionatorDay0()) / 86_400_000);
const auctionatorFile = `
AUCTIONATOR_PRICE_DATABASE = {
	["__dbversion"] = 6,
	["Realm"] = {
		["4306"] = { ["m"] = 95, ["h"] = { [${day - 1}] = 120, [${day}] = 110 }, ["l"] = { [${day - 1}] = 100 } },
		["99999"] = { ["m"] = 1, ["h"] = { [${day}] = 1 } },
		["g:4245:20"] = { ["m"] = 5000, ["h"] = { [${day}] = 5000 } },
	},
}
`;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('GoldTracker import', () => {
  it('imports gold, ledger, inventory, sales, sessions and recipes', async () => {
    const { addon } = await importFile('GoldTracker.lua', goldTrackerFile);
    expect(addon?.newEvents).toBe(6);

    const mage = (await db.characters.toArray()).find((c) => c.name === 'Legally Dead')!;
    expect(mage.professions).toEqual(expect.arrayContaining(['Tailoring', 'Enchanting', 'Fishing']));
    expect((await db.characters.toArray()).map((c) => c.name)).toContain('Newalt');

    const ledger = await db.ledger.toArray();
    expect(ledger.map((l) => [l.category, l.copper])).toEqual([
      ['repair', -500],
      ['auction', 2500],
    ]);
    expect((await db.goldSnapshots.toArray()).length).toBe(3);

    const silk = await db.items.where({ gameItemId: 4306 }).first();
    expect(silk?.vendorPrice).toBe(37);
    const bags = await db.inventory.where({ characterId: mage.id! }).toArray();
    expect(bags.find((r) => r.itemId === silk!.id)?.count).toBe(20);

    const settings = await db.settings.get('main');
    expect(settings?.observedSales).toBe(1);
    expect(settings?.observedCutPercent).toBe(5);
    expect(settings?.observedDepositRefunded).toBe(true);
    const pack = await db.items.where({ gameItemId: 4245 }).first();
    expect(pack?.depositPerUnit).toBe(60);

    const [session] = await db.sessions.toArray();
    expect(session).toMatchObject({ type: 'fishing', catches: 40, fishingSkillStart: 75, fishingSkillEnd: 80 });
    const sessionItems = await db.sessionItems.toArray();
    expect(sessionItems.filter((i) => i.containerOpenId === undefined)).toHaveLength(1);
    expect(sessionItems.filter((i) => i.containerOpenId !== undefined)[0].count).toBe(3);
    expect((await db.containerOpens.toArray())[0].copper).toBe(450);

    const [recipe] = await db.recipes.toArray();
    expect(recipe.source).toBe('addon');
    expect(recipe.reagents).toHaveLength(2);
  });

  it('does not import the same events twice', async () => {
    await importFile('GoldTracker.lua', goldTrackerFile);
    const again = await importFile('GoldTracker.lua', goldTrackerFile);
    expect(again.addon?.newEvents).toBe(0);
    expect(await db.ledger.count()).toBe(2);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.recipes.count()).toBe(1);
  });

  it('leaves manual recipes alone', async () => {
    const productItemId = await db.items.add({ name: 'Small Silk Pack' });
    await db.recipes.add({ profession: 'Tailoring', productItemId, productCount: 1, reagents: [], patternCost: 100 });
    await importFile('GoldTracker.lua', goldTrackerFile);
    const recipes = await db.recipes.toArray();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].reagents).toEqual([]);
    // The manual item got linked to its game id instead of being duplicated.
    expect((await db.items.where({ gameItemId: 4245 }).first())?.id).toBe(productItemId);
  });
});

describe('Auctionator import', () => {
  it('imports daily lows and the latest price for known items only', async () => {
    await importFile('GoldTracker.lua', goldTrackerFile);
    const { auctionator } = await importFile('Auctionator.lua', auctionatorFile);
    expect(auctionator).toMatchObject({ realm: 'Realm', itemsWithPrices: 1, newPrices: 2 });

    const silk = await db.items.where({ gameItemId: 4306 }).first();
    const prices = (await db.prices.where({ itemId: silk!.id! }).toArray()).sort((a, b) => a.time - b.time);
    expect(prices.map((p) => p.copper)).toEqual([100, 95]);
    expect(await db.items.where({ gameItemId: 99999 }).count()).toBe(0);

    const again = await importFile('Auctionator.lua', auctionatorFile);
    expect(again.auctionator?.newPrices).toBe(0);
  });
});
