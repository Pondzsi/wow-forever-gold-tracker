import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { isStale, vendorBeatsAH, type PriceMap } from '../calc';
import {
  bindLabel,
  db,
  getOrCreateItem,
  type Character,
  type InventoryLocation,
  type InventoryRow,
  type Item,
} from '../db';
import { formatMoney } from '../money';
import { CharacterSelect, charName, fmtAge, ItemField, Money, useCharacters, useItems, usePriceMap, useSettings, EmptyState, Skeleton, Disclosure } from '../ui';
import { ItemLink, qualityClass } from '../wowhead';

import { useSort } from '../sort';

export function Inventory() {
  const characters = useCharacters();
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const rowsQ = useLiveQuery(() => db.inventory.toArray(), []);
  const rows = rowsQ ?? [];

  const [characterId, setCharacterId] = useState<number | 'all'>(-1);
  const [location, setLocation] = useState<InventoryLocation>('bags');
  const [itemName, setItemName] = useState('');
  const [count, setCount] = useState('1');
  const [view, setView] = useState<number | 'all'>('all');
  const [mode, setMode] = useState<'bags' | 'list'>(() => {
    try {
      return localStorage.getItem('fgt-inventory-view') === 'list' ? 'list' : 'bags';
    } catch {
      return 'bags';
    }
  });
  const chooseMode = (m: 'bags' | 'list') => {
    setMode(m);
    try {
      localStorage.setItem('fgt-inventory-view', m);
    } catch {
      // Only a convenience: the default view is used next time.
    }
  };

  const countNum = Number(count);
  const valid = itemName.trim() !== '' && Number.isInteger(countNum) && countNum >= 0 && characterId !== 'all';

  async function setStack() {
    if (characterId === 'all' || !valid) return;
    const itemId = await getOrCreateItem(itemName);
    const existing = await db.inventory.where({ characterId, location, itemId }).first();
    if (existing) {
      if (countNum === 0) await db.inventory.delete(existing.id!);
      else await db.inventory.update(existing.id!, { count: countNum, updated: Date.now() });
    } else if (countNum > 0) {
      await db.inventory.add({ characterId, location, itemId, count: countNum, updated: Date.now() });
    }
    setItemName('');
    setCount('1');
  }

  // Group by item for the chosen view.
  const visible = rows.filter((r) => view === 'all' || r.characterId === view);
  const grouped = new Map<number, { itemId: number; count: number; where: string[] }>();
  for (const r of visible) {
    const g = grouped.get(r.itemId) ?? { itemId: r.itemId, count: 0, where: [] };
    g.count += r.count;
    g.where.push(`${charName(characters, r.characterId)} ${r.location} ×${r.count}`);
    grouped.set(r.itemId, g);
  }
  const list = [...grouped.values()].sort((a, b) =>
    (items.byId.get(a.itemId)?.name ?? '').localeCompare(items.byId.get(b.itemId)?.name ?? ''),
  );
  const invSort = useSort(
    list,
    {
      item: (g) => items.byId.get(g.itemId)?.name ?? '',
      count: (g) => g.count,
      price: (g) => prices.get(g.itemId)?.copper,
      age: (g) => prices.get(g.itemId)?.time,
      value: (g) => (prices.get(g.itemId) ? prices.get(g.itemId)!.copper * g.count : undefined),
    },
    { key: 'value', desc: true },
  );
  let total = 0;
  let unpriced = 0;
  for (const g of list) {
    const p = prices.get(g.itemId);
    if (p) total += p.copper * g.count;
    else unpriced++;
  }

  return (
    <>
      <h2>Inventory</h2>
      <Disclosure title="Set item count by hand" defaultOpen={rowsQ !== undefined && rowsQ.length === 0}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void setStack();
          }}
        >
          <CharacterSelect value={characterId} onChange={setCharacterId} characters={characters} />
          <label className="field">
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value as InventoryLocation)}>
              <option value="bags">Bags</option>
              <option value="bank">Bank</option>
            </select>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <ItemField value={itemName} onChange={setItemName} items={items.list} />
          <label className="field">
            Count
            <input className="narrow" type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
            Set
          </button>
        </form>
        <p className="hint">This sets the total count at that location. Count 0 removes the item.</p>
      </Disclosure>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <CharacterSelect value={view} onChange={setView} characters={characters} allowAll label="Show" />
            <div className="segmented" role="group" aria-label="View">
              {(['bags', 'list'] as const).map((m) => (
                <button
                  key={m}
                  className={mode === m ? '' : 'secondary'}
                  aria-pressed={mode === m}
                  onClick={() => chooseMode(m)}
                >
                  {m === 'bags' ? 'Bags' : 'List'}
                </button>
              ))}
            </div>
          </div>
          <div>
            Estimated value <Money copper={total} />
            {unpriced > 0 && <span className="warn small"> · {unpriced} item(s) without a price</span>}
          </div>
        </div>
        {mode === 'bags' && list.length > 0 ? (
          <BagView rows={visible} items={items.byId} prices={prices} characters={characters} />
        ) : list.length === 0 ? (
          rowsQ === undefined ? (
          <Skeleton />
        ) : (
          <EmptyState>No items yet. Your bags and bank arrive with the next sync (open the bank once in game for bank items). See <a href="#/sync">Sync &amp; to-do</a>.</EmptyState>
        )
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <invSort.Th k="item" label="Item" />
                <th>Where</th>
                <invSort.Th k="count" label="Count" num />
                <invSort.Th k="price" label="Unit price" num />
                <invSort.Th k="age" label="Price date" num />
                <invSort.Th k="value" label="Value" num />
              </tr>
            </thead>
            <tbody>
              {invSort.sorted.map((g) => {
                const p = prices.get(g.itemId);
                return (
                  <tr key={g.itemId}>
                    <td>
                      <ItemLink item={items.byId.get(g.itemId)} />{' '}
                      {bindLabel(items.byId.get(g.itemId)) && (
                        <span className="badge" title="Can't be sold on the AH">
                          {bindLabel(items.byId.get(g.itemId))}
                        </span>
                      )}{' '}
                      {items.byId.get(g.itemId) && vendorBeatsAH(items.byId.get(g.itemId)!, p, settings) && (
                        <span className="badge Vendor">Vendor it</span>
                      )}
                    </td>
                    <td className="small muted">{g.where.join(' · ')}</td>
                    <td className="num">{g.count}</td>
                    <td className="num">{p ? <Money copper={p.copper} /> : <span className="muted">no price</span>}</td>
                    <td className={`small ${p && isStale(p, settings.staleDays) ? 'warn' : 'muted'}`}>
                      {p ? fmtAge(p.time) : ''}
                    </td>
                    <td className="num">{p ? <Money copper={p.copper * g.count} /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

const LOCATION_LABEL: Record<InventoryLocation, string> = { bags: 'Bags', bank: 'Bank' };

/** Game-style bag grid per character and location: icon, stack count, quality border. */
function BagView({
  rows,
  items,
  prices,
  characters,
}: {
  rows: InventoryRow[];
  items: Map<number, Item>;
  prices: PriceMap;
  characters: Character[];
}) {
  const groups = new Map<string, InventoryRow[]>();
  for (const r of rows) {
    const key = `${r.characterId}|${r.location}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const value = (r: InventoryRow) => (prices.get(r.itemId)?.copper ?? 0) * r.count;
  return (
    <div className="bags">
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, list]) => {
          const [cid, loc] = key.split('|');
          const sorted = [...list].sort(
            (a, b) => (items.get(b.itemId)?.quality ?? 1) - (items.get(a.itemId)?.quality ?? 1) || value(b) - value(a),
          );
          const total = list.reduce((s, r) => s + value(r), 0);
          return (
            <section key={key} className="bag">
              <div className="bag-head">
                <span>
                  {charName(characters, Number(cid))} · {LOCATION_LABEL[loc as InventoryLocation]}
                </span>
                <span className="small muted">
                  {list.length} slots · <Money copper={total} />
                </span>
              </div>
              <div className="bag-grid">
                {sorted.map((r) => {
                  const item = items.get(r.itemId);
                  const p = prices.get(r.itemId);
                  const bound = bindLabel(item);
                  const tip = [
                    item?.name ?? '?',
                    `×${r.count}`,
                    p ? `${formatMoney(p.copper)} each` : 'no AH price',
                    bound ?? '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <div key={r.id} className={`bag-slot ${qualityClass(item)} ${bound ? 'bound' : ''}`} title={tip}>
                      <ItemLink item={item} size="medium">
                        <span className="slot-name">{item?.name ?? '?'}</span>
                      </ItemLink>
                      {r.count > 1 && <span className="slot-count">{r.count}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      <p className="hint">Hover or tap an item for its tooltip. Dimmed items are bound and can't go on the AH.</p>
    </div>
  );
}
