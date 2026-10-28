import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { isStale, vendorBeatsAH } from '../calc';
import { db, getOrCreateItem, type InventoryLocation } from '../db';
import { CharacterSelect, charName, fmtAge, ItemField, Money, useCharacters, useItems, usePriceMap, useSettings } from '../ui';

export function Inventory() {
  const characters = useCharacters();
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const rows = useLiveQuery(() => db.inventory.toArray(), []) ?? [];

  const [characterId, setCharacterId] = useState<number | 'all'>(2);
  const [location, setLocation] = useState<InventoryLocation>('bags');
  const [itemName, setItemName] = useState('');
  const [count, setCount] = useState('1');
  const [view, setView] = useState<number | 'all'>('all');

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
      <div className="card">
        <h3>Set item count</h3>
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
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <CharacterSelect value={view} onChange={setView} characters={characters} allowAll label="Show" />
          <div style={{ marginBottom: 20 }}>
            Estimated value <Money copper={total} />
            {unpriced > 0 && <span className="warn small"> · {unpriced} item(s) without a price</span>}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="muted">No items recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Where</th>
                <th className="num">Count</th>
                <th className="num">Unit price</th>
                <th>Price age</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const p = prices.get(g.itemId);
                return (
                  <tr key={g.itemId}>
                    <td>
                      {items.byId.get(g.itemId)?.name}{' '}
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
          </table>
        )}
      </div>
    </>
  );
}
