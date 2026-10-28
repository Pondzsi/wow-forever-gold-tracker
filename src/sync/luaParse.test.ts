import { describe, expect, it } from 'vitest';
import { asArray, asNumberMap, parseSavedVariables } from './luaParse';

const sample = `
GoldTrackerDB = {
	["version"] = 1,
	["seq"] = 42,
	["name"] = "Legally \\"Un\\"Dead\\\\x",
	["ok"] = true,
	["off"] = false,
	["neg"] = -1250,
	["float"] = 0.05,
	["items"] = {
		[2589] = {
			["n"] = "Linen Cloth",
			["v"] = 13,
		},
	},
	["events"] = {
		{
			["k"] = "money",
			["d"] = -500,
		}, -- [1]
		{
			["k"] = "gold",
		}, -- [2]
	},
	["empty"] = {
	},
}
OtherVar = nil
`;

describe('parseSavedVariables', () => {
  const out = parseSavedVariables(sample);
  const db = out.GoldTrackerDB as Record<string, unknown>;

  it('reads scalars and escapes', () => {
    expect(db.version).toBe(1);
    expect(db.name).toBe('Legally "Un"Dead\\x');
    expect(db.ok).toBe(true);
    expect(db.off).toBe(false);
    expect(db.neg).toBe(-1250);
    expect(db.float).toBe(0.05);
    expect(out.OtherVar).toBeNull();
  });

  it('turns 1..n tables into arrays and keyed tables into objects', () => {
    expect(asArray(db.events as never)).toHaveLength(2);
    expect((db.items as Record<string, { n: string }>)['2589'].n).toBe('Linen Cloth');
    expect(asArray(db.empty as never)).toEqual([]);
  });

  it('reads numeric-keyed maps', () => {
    const m = asNumberMap(parseSavedVariables('X = { [2589] = 3, [4306] = 10 }').X);
    expect(m.get(2589)).toBe(3);
    expect(m.get(4306)).toBe(10);
  });

  it('reports errors with a line number', () => {
    expect(() => parseSavedVariables('X = {\n ["a"] = ,\n}')).toThrow(/line 2/);
  });
});
