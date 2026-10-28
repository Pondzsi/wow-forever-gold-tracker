import { describe, expect, it } from 'vitest';
import { cleanItemName } from './importAddon';
import { decodeCbor } from './cbor';
import { parseSavedVariablesBytes, utf8Strings } from './luaParse';

// Bytes copied from a real retail Auctionator.lua (database version 8):
// { "55408": { a: {"2492": 1}, l: [], h: {"2492": 285508300}, m: 285508300 } }
const sample = [
  0xa1, 0x45, ...'55408'.split('').map((c) => c.charCodeAt(0)),
  0xa4,
  0x41, 0x61, 0xa1, 0x44, 0x32, 0x34, 0x39, 0x32, 0x01,
  0x41, 0x6c, 0x80,
  0x41, 0x68, 0xa1, 0x44, 0x32, 0x34, 0x39, 0x32, 0x1a, 0x11, 0x04, 0x82, 0xcc,
  0x41, 0x6d, 0x1a, 0x11, 0x04, 0x82, 0xcc,
];

describe('decodeCbor', () => {
  it('decodes an Auctionator price entry', () => {
    expect(decodeCbor(new Uint8Array(sample))).toEqual({
      '55408': { a: { '2492': 1 }, l: [], h: { '2492': 285508300 }, m: 285508300 },
    });
  });

  it('decodes negative numbers, floats and booleans', () => {
    expect(decodeCbor(new Uint8Array([0x83, 0x20, 0xf5, 0xfb, 0x40, 0x09, 0x21, 0xfb, 0x54, 0x44, 0x2d, 0x18]))).toEqual([
      -1,
      true,
      Math.PI,
    ]);
  });
});

describe('parseSavedVariablesBytes', () => {
  it('keeps binary string bytes and \\ddd escapes exact', () => {
    const file = new Uint8Array([
      ...new TextEncoder().encode('X = "'),
      0xb9, 0x7d, 0x80, // raw high bytes
      ...new TextEncoder().encode('\\000"'),
    ]);
    const s = parseSavedVariablesBytes(file.buffer).X as string;
    expect([...s].map((c) => c.charCodeAt(0))).toEqual([0xb9, 0x7d, 0x80, 0]);
  });

  it('turns text back into UTF-8', () => {
    const file = new TextEncoder().encode('X = { ["n"] = "Ragnarös" }');
    expect(utf8Strings(parseSavedVariablesBytes(file.buffer).X)).toEqual({ n: 'Ragnarös' });
  });
});

describe('cleanItemName', () => {
  it('removes retail quality markup but keeps the tier', () => {
    expect(cleanItemName('Potion of Recklessness |A:Professions-ChatIcon-Quality-12-Tier1:17:15::1|a')).toBe(
      'Potion of Recklessness (tier 1)',
    );
    expect(cleanItemName('|cff1eff00Hexing Spiritrender|r')).toBe('Hexing Spiritrender');
    expect(cleanItemName('Linen Cloth')).toBe('Linen Cloth');
  });
});
