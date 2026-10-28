import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

describe('formatMoney', () => {
  it('formats gold, silver and copper', () => {
    expect(formatMoney(123456)).toBe('12g 34s 56c');
    expect(formatMoney(10000)).toBe('1g');
    expect(formatMoney(150)).toBe('1s 50c');
    expect(formatMoney(0)).toBe('0c');
    expect(formatMoney(-2500)).toBe('-25s');
  });
});

describe('parseMoney', () => {
  it('reads unit notation', () => {
    expect(parseMoney('12g 34s 56c')).toBe(123456);
    expect(parseMoney('12g34s56c')).toBe(123456);
    expect(parseMoney('50s')).toBe(5000);
    expect(parseMoney('123456c')).toBe(123456);
    expect(parseMoney('-1g')).toBe(-10000);
  });
  it('reads a plain number as gold', () => {
    expect(parseMoney('12.3456')).toBe(123456);
    expect(parseMoney('2')).toBe(20000);
  });
  it('rejects invalid text', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('12g abc')).toBeNull();
  });
});
