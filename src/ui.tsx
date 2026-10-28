import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, db, type Character, type Item, type Settings } from './db';
import { latestPrices, type PriceMap } from './calc';
import { formatMoney, parseMoney, splitMoney } from './money';

// ---------- Data hooks ----------

export function useCharacters(): Character[] {
  return useLiveQuery(() => db.characters.toArray(), []) ?? [];
}

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('main'), []) ?? DEFAULT_SETTINGS;
}

export function useItems(): { list: Item[]; byId: Map<number, Item> } {
  const list = useLiveQuery(() => db.items.orderBy('name').toArray(), []) ?? [];
  return { list, byId: new Map(list.map((i) => [i.id!, i])) };
}

export function usePriceMap(): PriceMap {
  const prices = useLiveQuery(() => db.prices.toArray(), []) ?? [];
  return latestPrices(prices);
}

// ---------- Display ----------

export function Money({ copper, signed = false }: { copper: number | null | undefined; signed?: boolean }) {
  if (copper === null || copper === undefined) return <span className="muted">—</span>;
  const p = splitMoney(copper);
  const parts: ReactNode[] = [];
  if (p.gold) parts.push(<span key="g" className="g">{p.gold.toLocaleString()}g</span>);
  if (p.silver) parts.push(<span key="s" className="s">{p.silver}s</span>);
  if (p.copper || parts.length === 0) parts.push(<span key="c" className="c">{p.copper}c</span>);
  const sign = p.negative && copper !== 0 ? '-' : signed && copper > 0 ? '+' : '';
  const cls = signed ? (copper > 0 ? 'good' : copper < 0 ? 'bad' : '') : '';
  return (
    <span className={`money ${cls}`} title={formatMoney(copper)}>
      {sign}
      {parts.reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
    </span>
  );
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtAge(ms: number, now = Date.now()): string {
  const h = (now - ms) / 3_600_000;
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtHours(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

// ---------- Inputs ----------

/** Text field that accepts "12g 34s 56c" style input and shows the parsed value. */
export function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const parsed = value.trim() ? parseMoney(value) : null;
  return (
    <label className="field">
      {label}
      <input
        className="money-input"
        value={value}
        placeholder="1g 20s 5c"
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="small" style={{ minHeight: 16 }}>
        {value.trim() ? parsed === null ? <span className="error">invalid</span> : <Money copper={parsed} /> : ''}
      </span>
    </label>
  );
}

/** Item name field with suggestions. New names create a new item on save. */
export function ItemField({
  label = 'Item',
  value,
  onChange,
  items,
  width = 200,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  items: Item[];
  width?: number;
}) {
  const [listId] = useState(() => `items-${Math.random().toString(36).slice(2)}`);
  return (
    <label className="field">
      {label}
      <input list={listId} value={value} style={{ width }} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {items.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
      <span className="small" style={{ minHeight: 16 }} />
    </label>
  );
}

export function CharacterSelect({
  value,
  onChange,
  characters,
  allowAll = false,
  label = 'Character',
}: {
  value: number | 'all';
  onChange: (v: number | 'all') => void;
  characters: Character[];
  allowAll?: boolean;
  label?: string;
}) {
  // Pick the first character when the current value is not a known character.
  const valid = value === 'all' ? allowAll : characters.some((c) => c.id === value);
  useEffect(() => {
    if (!valid && characters.length) onChange(allowAll ? 'all' : characters[0].id!);
  }, [valid, characters, allowAll, onChange]);
  if (!characters.length) {
    return (
      <label className="field">
        {label}
        <select disabled>
          <option>no characters yet</option>
        </select>
        <span className="small" style={{ minHeight: 16 }} />
      </label>
    );
  }
  return (
    <label className="field">
      {label}
      <select value={String(value)} onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
        {allowAll && <option value="all">All characters</option>}
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="small" style={{ minHeight: 16 }} />
    </label>
  );
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

export function charName(characters: Character[], id: number): string {
  return characters.find((c) => c.id === id)?.name ?? `#${id}`;
}
