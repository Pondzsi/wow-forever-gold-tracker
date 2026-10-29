import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { decideHoldings, type Decision } from '../calc';
import { db, type InventoryRow, type Recipe } from '../db';
import { auctionatorImportText, buildShoppingLists } from '../shopping';
import { useToast } from '../toast';
import { useSort } from '../sort';
import { EmptyState, fmtAge, Money, Skeleton, useCharacters, useItems, usePriceMap, useSettings, CharacterSelect } from '../ui';
import { ItemLink } from '../wowhead';

const ORDER: Decision[] = ['Sell on AH', 'Vendor', 'Check AH', 'Keep'];
const BADGE: Record<Decision, string> = { 'Sell on AH': 'Craft', Vendor: 'Vendor', 'Check AH': 'Sell', Keep: '' };

/** What to do with everything you hold: sell on the AH, vendor, keep, or check the AH first. */
export function SellList() {
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const characters = useCharacters();
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) ?? [];
  const [who, setWho] = useState<number | 'all'>('all');
  const [filter, setFilter] = useState<Decision | 'all'>('all');

  const held = new Map<number, number>();
  for (const r of inventory ?? []) {
    if (who !== 'all' && r.characterId !== who) continue;
    held.set(r.itemId, (held.get(r.itemId) ?? 0) + r.count);
  }
  const all = decideHoldings(held, items.byId, prices, settings, recipes, settings.staleDays);
  const totals = new Map<Decision, { n: number; value: number }>();
  for (const d of all) {
    const t = totals.get(d.decision) ?? { n: 0, value: 0 };
    totals.set(d.decision, { n: t.n + 1, value: t.value + d.best });
  }
  const shown = all.filter((d) => filter === 'all' || d.decision === filter);
  const { sorted, Th } = useSort(
    shown,
    {
      item: (d) => items.byId.get(d.itemId)?.name ?? '',
      count: (d) => d.count,
      decision: (d) => ORDER.indexOf(d.decision),
      ah: (d) => d.ahNet,
      vendor: (d) => d.vendor,
      best: (d) => d.best,
    },
    { key: 'best', desc: true },
  );

  return (
    <>
      <h2>Sell list</h2>
      <div className="grid">
        {ORDER.map((d) => (
          <button
            key={d}
            className={`card stat-tile ${filter === d ? 'selected' : ''}`}
            aria-pressed={filter === d}
            onClick={() => setFilter(filter === d ? 'all' : d)}
          >
            <span className="muted small">{d}</span>
            <span className="stat">{totals.get(d)?.n ?? 0}</span>
            {d !== 'Keep' && (
              <span className="small">
                <Money copper={totals.get(d)?.value ?? 0} />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <CharacterSelect value={who} onChange={setWho} characters={characters} allowAll label="Items of" />
          {filter !== 'all' && (
            <button className="secondary" onClick={() => setFilter('all')}>
              Show all
            </button>
          )}
        </div>
        {inventory === undefined ? (
          <Skeleton />
        ) : sorted.length === 0 ? (
          <EmptyState>
            Nothing to decide yet. Your bags and bank arrive with the next sync. See <a href="#/sync">Sync &amp; to-do</a>.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <Th k="item" label="Item" />
                  <Th k="count" label="Count" num />
                  <Th k="decision" label="Do" />
                  <Th k="ah" label="AH after fees" num />
                  <Th k="vendor" label="Vendor" num />
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.itemId}>
                    <td>
                      <ItemLink item={items.byId.get(d.itemId)} />
                    </td>
                    <td className="num">{d.count}</td>
                    <td>
                      <span className={`badge ${BADGE[d.decision]}`}>{d.decision}</span>
                    </td>
                    <td className="num">
                      <Money copper={d.ahNet} />
                    </td>
                    <td className="num">
                      <Money copper={d.vendor} />
                    </td>
                    <td className={`small ${d.stale ? 'warn' : 'muted'}`}>
                      {d.reason}
                      {d.stale && prices.get(d.itemId) ? ` (price ${fmtAge(prices.get(d.itemId)!.time)})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          AH values use the latest price for the whole stack, minus a {settings.ahCutPercent}% cut
          {settings.depositRefundedOnSale === false ? ' and the deposit' : ''}. Materials for recipes that pay more when
          crafted are kept. Disenchanting isn't compared yet.
        </p>
      </div>

      <ShoppingListCard inventory={inventory ?? []} recipes={recipes} />
    </>
  );
}

/** One Auctionator search for every item the dashboard has no (fresh) price for. */
function ShoppingListCard({ inventory, recipes }: { inventory: InventoryRow[]; recipes: Recipe[] }) {
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const toast = useToast();
  const lists = buildShoppingLists(inventory, items.byId, prices, recipes, settings, settings.staleDays);
  const text = auctionatorImportText(lists);
  const count = lists.reduce((s, l) => s + l.items.length, 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: 'Copied. In game: Auctionator → Shopping → Import, paste, then Search.', tone: 'good' });
    } catch {
      toast({ text: 'Copy failed: select the text below and press Ctrl+C.', tone: 'warn' });
    }
  }

  return (
    <div className="card">
      <h3>Auctionator shopping list</h3>
      {count === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Nothing to search: every item you hold and every recipe item has a recent AH price.
        </p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            {count} item(s) need an AH price:{' '}
            {lists.map((l) => `${l.name} (${l.items.length})`).join(', ')}. One Auctionator search prices them all.
          </p>
          <div className="row">
            <button onClick={() => void copy()}>Copy Auctionator shopping list</button>
          </div>
          <ol className="small muted" style={{ margin: 'var(--s3) 0 var(--s2)', paddingLeft: 'var(--s5)' }}>
            <li>At the AH, open the Auctionator tab <b>Shopping</b> and click <b>Import</b>.</li>
            <li>Paste the text and confirm. The lists appear with the names above.</li>
            <li>Select a list and click <b>Search</b>. Then <code>/reload</code>: the prices sync here.</li>
          </ol>
          <textarea
            readOnly
            value={text}
            rows={Math.min(4, lists.length + 1)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Auctionator import text"
          />
        </>
      )}
    </div>
  );
}
