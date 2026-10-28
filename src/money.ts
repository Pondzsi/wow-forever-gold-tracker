// All money is stored as integer copper. 1g = 100s = 10000c.
export const COPPER_PER_SILVER = 100;
export const COPPER_PER_GOLD = 10000;

export interface MoneyParts {
  negative: boolean;
  gold: number;
  silver: number;
  copper: number;
}

export function splitMoney(copper: number): MoneyParts {
  const negative = copper < 0;
  let rest = Math.abs(Math.round(copper));
  const gold = Math.floor(rest / COPPER_PER_GOLD);
  rest %= COPPER_PER_GOLD;
  const silver = Math.floor(rest / COPPER_PER_SILVER);
  return { negative, gold, silver, copper: rest % COPPER_PER_SILVER };
}

/** 123456 -> "12g 34s 56c". Zero parts are left out; 0 -> "0c". */
export function formatMoney(copper: number): string {
  const p = splitMoney(copper);
  const parts: string[] = [];
  if (p.gold) parts.push(`${p.gold}g`);
  if (p.silver) parts.push(`${p.silver}s`);
  if (p.copper || parts.length === 0) parts.push(`${p.copper}c`);
  return (p.negative && parts[0] !== '0c' ? '-' : '') + parts.join(' ');
}

/**
 * Accepts "12g 34s 56c", "12g", "50s", "123456c", or a plain number in gold
 * ("12.3456" = 12g 34s 56c). Returns copper, or null if the text is not valid.
 */
export function parseMoney(input: string): number | null {
  let text = input.trim().toLowerCase().replace(/,/g, '');
  if (!text) return null;
  let sign = 1;
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1).trim();
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    return sign * Math.round(parseFloat(text) * COPPER_PER_GOLD);
  }
  const unit: Record<string, number> = { g: COPPER_PER_GOLD, s: COPPER_PER_SILVER, c: 1 };
  const re = /(\d+(?:\.\d+)?)\s*([gsc])/g;
  let total = 0;
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    total += parseFloat(match[1]) * unit[match[2]];
    found = true;
  }
  if (!found || text.replace(re, '').trim() !== '') return null;
  return sign * Math.round(total);
}

export function copperToGold(copper: number): number {
  return copper / COPPER_PER_GOLD;
}
