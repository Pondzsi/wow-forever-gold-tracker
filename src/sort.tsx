import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';

type SortValue = string | number | null | undefined;
export type SortKeys<T> = Record<string, (row: T) => SortValue>;

/**
 * Click-to-sort for a table. `keys` maps a column key to the value it sorts by.
 * Empty values always go last. Numbers start descending, text ascending.
 */
export function useSort<T>(rows: T[], keys: SortKeys<T>, initial: { key: string; desc?: boolean }) {
  const [sort, setSort] = useState({ key: initial.key, desc: initial.desc ?? false });
  const get = keys[sort.key];
  const sorted = get
    ? [...rows].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -c : c;
      })
    : rows;

  /** A sortable header cell. */
  function Th({ k, label, num = false }: { k: string; label: string; num?: boolean }) {
    const active = sort.key === k;
    return (
      <th className={num ? 'num' : ''} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
        <button
          className="sort-btn"
          onClick={() => setSort(active ? { key: k, desc: !sort.desc } : { key: k, desc: num })}
        >
          {label}
          {active && (sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
        </button>
      </th>
    );
  }

  return { sorted, Th };
}
