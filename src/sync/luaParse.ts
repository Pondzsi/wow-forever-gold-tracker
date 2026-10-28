// Parser for WoW SavedVariables files. They only contain assignments of
// Lua literals: strings, numbers, booleans, nil and tables.
//   GoldTrackerDB = { ["key"] = 1, [2] = "x", { ... }, -- [1] }

export type LuaValue = string | number | boolean | null | LuaTable;
export type LuaTable = LuaValue[] | { [key: string]: LuaValue };

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parseFile(): Record<string, LuaValue> {
    const out: Record<string, LuaValue> = {};
    this.skip();
    while (this.i < this.s.length) {
      const name = this.identifier();
      this.skip();
      this.expect('=');
      out[name] = this.value();
      this.skip();
      if (this.s[this.i] === ';') this.i++;
      this.skip();
    }
    return out;
  }

  private error(msg: string): never {
    const line = this.s.slice(0, this.i).split('\n').length;
    throw new Error(`SavedVariables parse error on line ${line}: ${msg}`);
  }

  private skip() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('--', this.i)) {
        if (this.s.startsWith('--[[', this.i)) {
          const end = this.s.indexOf(']]', this.i);
          this.i = end < 0 ? this.s.length : end + 2;
        } else {
          const end = this.s.indexOf('\n', this.i);
          this.i = end < 0 ? this.s.length : end + 1;
        }
        continue;
      }
      return;
    }
  }

  private expect(ch: string) {
    if (this.s[this.i] !== ch) this.error(`expected "${ch}"`);
    this.i++;
  }

  private identifier(): string {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 200));
    if (!m) this.error('expected a variable name');
    this.i += m[0].length;
    return m[0];
  }

  private value(): LuaValue {
    this.skip();
    const c = this.s[this.i];
    if (c === '{') return this.table();
    if (c === '"' || c === "'") return this.string();
    if (this.s.startsWith('true', this.i)) {
      this.i += 4;
      return true;
    }
    if (this.s.startsWith('false', this.i)) {
      this.i += 5;
      return false;
    }
    if (this.s.startsWith('nil', this.i)) {
      this.i += 3;
      return null;
    }
    return this.number();
  }

  private number(): number {
    const m = /^-?(0x[0-9a-fA-F]+|\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?|inf|nan)/i.exec(
      this.s.slice(this.i, this.i + 64),
    );
    if (!m) this.error('expected a value');
    this.i += m[0].length;
    const t = m[0].toLowerCase();
    if (t.endsWith('inf')) return t.startsWith('-') ? -Infinity : Infinity;
    if (t.endsWith('nan')) return NaN;
    if (t.includes('0x')) return (t.startsWith('-') ? -1 : 1) * parseInt(t.replace('-', ''), 16);
    return parseFloat(t);
  }

  private string(): string {
    const quote = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === '\n') out += '\n';
      else if (/\d/.test(e)) {
        let digits = e;
        while (digits.length < 3 && /\d/.test(this.s[this.i])) digits += this.s[this.i++];
        out += String.fromCharCode(Number(digits));
      } else out += e; // \\ \" \' and anything else
    }
    this.error('unterminated string');
  }

  private table(): LuaTable {
    this.expect('{');
    const entries: [string | number, LuaValue][] = [];
    let nextIndex = 1;
    for (;;) {
      this.skip();
      if (this.s[this.i] === '}') {
        this.i++;
        break;
      }
      let key: string | number;
      if (this.s[this.i] === '[') {
        this.i++;
        const k = this.value();
        this.skip();
        this.expect(']');
        this.skip();
        this.expect('=');
        if (typeof k !== 'string' && typeof k !== 'number') this.error('unsupported table key');
        key = k;
      } else if (/[A-Za-z_]/.test(this.s[this.i]) && /^[A-Za-z_]\w*\s*=(?!=)/.test(this.s.slice(this.i, this.i + 100))) {
        key = this.identifier();
        this.skip();
        this.expect('=');
      } else {
        key = nextIndex++;
      }
      entries.push([key, this.value()]);
      this.skip();
      if (this.s[this.i] === ',' || this.s[this.i] === ';') this.i++;
    }
    // A table with keys 1..n becomes an array; anything else an object.
    const isArray = entries.length > 0 && entries.every(([k], idx) => k === idx + 1);
    if (isArray) return entries.map(([, v]) => v);
    const obj: { [key: string]: LuaValue } = {};
    for (const [k, v] of entries) obj[String(k)] = v;
    return obj;
  }
}

export function parseSavedVariables(text: string): Record<string, LuaValue> {
  return new Parser(text.replace(/^﻿/, '')).parseFile();
}

/** Lua tables that are empty or sparse arrive as objects; this gives a list either way. */
export function asArray<T = LuaValue>(v: LuaValue | undefined): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (v as Record<string, LuaValue>)[k] as T);
  }
  return [];
}

/** Numeric-keyed Lua table (like { [2589] = 3 }) as a map. Arrays count from index 1. */
export function asNumberMap(v: LuaValue | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (Array.isArray(v)) v.forEach((n, i) => typeof n === 'number' && out.set(i + 1, n));
  else if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v)) if (/^\d+$/.test(k) && typeof n === 'number') out.set(Number(k), n);
  }
  return out;
}
