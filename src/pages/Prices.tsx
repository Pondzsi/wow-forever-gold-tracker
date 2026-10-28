import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { isStale, vendorBeatsAH } from '../calc';
import { db, getOrCreateItem, type PriceSource } from '../db';
import { formatMoney, parseMoney } from '../money';
import {
  fmtAge,
  fmtDate,
  fromLocalInput,
  ItemField,
  Money,
  MoneyField,
  toLocalInput,
  useItems,
  usePriceMap,
  useSettings,
  EmptyState,
} from '../ui';
import { deleteWithUndo, useToast } from '../toast';

export function Prices() {
  const toast = useToast();
  const items = useItems();
  const latest = usePriceMap();
  const settings = useSettings();
  const all = useLiveQuery(() => db.prices.orderBy('time').reverse().toArray(), []) ?? [];

  const [itemName, setItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<PriceSource>('AH');
  const [note, setNote] = useState('');
  const [time, setTime] = useState(toLocalInput(Date.now()));
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const parsed = parseMoney(amount);
  const valid = itemName.trim() !== '' && parsed !== null && parsed >= 0;

  async function add() {
    if (!valid) return;
    const itemId = await getOrCreateItem(itemName);
    await db.prices.add({ itemId, copper: parsed!, source, note: note.trim(), time: fromLocalInput(time) });
    setAmount('');
    setNote('');
    setTime(toLocalInput(Date.now()));
    setSelected(itemId);
  }

  async function setItemMoney(itemId: number, field: 'vendorPrice' | 'depositPerUnit', text: string) {
    const v = text.trim() === '' ? undefined : parseMoney(text);
    if (v === null) return;
    await db.items.update(itemId, { [field]: v });
  }

  const shownItems = items.list.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
  const history = selected === null ? [] : all.filter((p) => p.itemId === selected);

  return (
    <>
      <h2>Prices</h2>
      <div className="card">
        <h3>Record a price</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <ItemField value={itemName} onChange={setItemName} items={items.list} />
          <MoneyField label="Price per unit" value={amount} onChange={setAmount} />
          <label className="field">
            Source
            <select value={source} onChange={(e) => setSource(e.target.value as PriceSource)}>
              <option value="AH">AH</option>
              <option value="manual">Manual / other</option>
            </select>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lowest of 4 listings" />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Date
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
            Save
          </button>
        </form>
        <p className="hint">
          Always enter the price for <b>one</b> unit. Prices older than {settings.staleDays} days are marked in orange.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Items</h3>
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {shownItems.length === 0 ? (
          <EmptyState>No items yet. Prices come from Auctionator: run a full scan at the AH, then <code>/reload</code>. You can also record one by hand above.</EmptyState>
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Latest price</th>
                <th>Age</th>
                <th>Source</th>
                <th>Vendor price</th>
                <th>Deposit / unit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownItems.map((i) => {
                const p = latest.get(i.id!);
                return (
                  <tr
                    key={i.id}
                    className={`clickable ${selected === i.id ? 'selected' : ''}`}
                    onClick={() => setSelected(i.id!)}
                  >
                    <td>{i.name}</td>
                    <td className="num">{p ? <Money copper={p.copper} /> : <span className="muted">none</span>}</td>
                    <td className={`small ${p && isStale(p, settings.staleDays) ? 'warn' : 'muted'}`}>
                      {p ? fmtAge(p.time) : ''}
                    </td>
                    <td className="small muted">{p?.source}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        className="money-input"
                        key={`${i.id}-v-${i.vendorPrice ?? ''}`}
                        defaultValue={i.vendorPrice !== undefined ? formatMoney(i.vendorPrice) : ''}
                        placeholder="unknown"
                        onBlur={(e) => void setItemMoney(i.id!, 'vendorPrice', e.target.value)}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        className="money-input"
                        key={`${i.id}-d-${i.depositPerUnit ?? ''}`}
                        defaultValue={i.depositPerUnit !== undefined ? formatMoney(i.depositPerUnit) : ''}
                        placeholder="unknown"
                        onBlur={(e) => void setItemMoney(i.id!, 'depositPerUnit', e.target.value)}
                      />
                    </td>
                    <td>
                      {vendorBeatsAH(i, p, settings) && (
                        <span className="badge Vendor" title="Vendor pays at least as much as the AH after fees">
                          Vendor it
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="hint">
          Vendor price: what a vendor pays you for one unit. Deposit: the AH deposit you saw for one unit. Leave either
          empty if you don't know it. "Vendor it" means the vendor pays at least as much as the AH after the cut
          {settings.depositRefundedOnSale === false ? ' and deposit' : ''}.
        </p>
      </div>

      {selected !== null && (
        <div className="card">
          <h3>Price history: {items.byId.get(selected)?.name}</h3>
          {history.length === 0 ? (
            <p className="muted">No prices recorded.</p>
          ) : (
            <div className="table-wrap"><table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Price</th>
                  <th>Source</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="small muted">{fmtDate(p.time)}</td>
                    <td className="num">
                      <Money copper={p.copper} />
                    </td>
                    <td className="small">{p.source}</td>
                    <td className="small">{p.note}</td>
                    <td className="num">
                      <button className="link" title="Delete" onClick={() => void deleteWithUndo(db.prices, p.id!, 'Price', toast)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
    </>
  );
}
