import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { evaluateRecipe } from '../calc';
import { db, getOrCreateItem, type Recipe } from '../db';
import { formatMoney, parseMoney } from '../money';
import { ItemField, Money, MoneyField, useItems, usePriceMap, useSettings, EmptyState, Skeleton } from '../ui';
import { deleteWithUndo, useToast } from '../toast';

const PROFESSIONS = ['Leatherworking', 'Tailoring', 'Enchanting', 'Cooking', 'First Aid', 'Other'];

interface ReagentDraft {
  name: string;
  count: string;
}

export function Crafting() {
  const toast = useToast();
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const recipesQ = useLiveQuery(() => db.recipes.toArray(), []);
  const recipes = recipesQ ?? [];

  const [editId, setEditId] = useState<number | null>(null);
  const [profession, setProfession] = useState('Tailoring');
  const [product, setProduct] = useState('');
  const [productCount, setProductCount] = useState('1');
  const [reagents, setReagents] = useState<ReagentDraft[]>([{ name: '', count: '1' }]);
  const [patternCost, setPatternCost] = useState('');
  const [filter, setFilter] = useState('all');

  const cleanReagents = reagents.filter((r) => r.name.trim() !== '');
  const patternParsed = patternCost.trim() ? parseMoney(patternCost) : undefined;
  const valid =
    patternParsed !== null &&
    product.trim() !== '' &&
    Number(productCount) > 0 &&
    cleanReagents.length > 0 &&
    cleanReagents.every((r) => Number(r.count) > 0);

  function reset() {
    setEditId(null);
    setProduct('');
    setProductCount('1');
    setReagents([{ name: '', count: '1' }]);
    setPatternCost('');
  }

  async function save() {
    if (!valid) return;
    const recipe: Recipe = {
      profession,
      productItemId: await getOrCreateItem(product),
      productCount: Number(productCount),
      reagents: [],
      patternCost: patternParsed ?? undefined,
    };
    for (const r of cleanReagents) {
      recipe.reagents.push({ itemId: await getOrCreateItem(r.name), count: Number(r.count) });
    }
    if (editId !== null) await db.recipes.update(editId, { ...recipe });
    else await db.recipes.add(recipe);
    reset();
  }

  function edit(r: Recipe) {
    setEditId(r.id!);
    setProfession(r.profession);
    setProduct(items.byId.get(r.productItemId)?.name ?? '');
    setProductCount(String(r.productCount));
    setReagents(r.reagents.map((x) => ({ name: items.byId.get(x.itemId)?.name ?? '', count: String(x.count) })));
    setPatternCost(r.patternCost ? formatMoney(r.patternCost) : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const shown = recipes.filter((r) => filter === 'all' || r.profession === filter);

  return (
    <>
      <h2>Crafting</h2>
      <div className="card">
        <h3>{editId !== null ? 'Edit recipe' : 'Add recipe'}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="row">
            <label className="field">
              Profession
              <select value={profession} onChange={(e) => setProfession(e.target.value)}>
                {PROFESSIONS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <span className="small" style={{ minHeight: 16 }} />
            </label>
            <ItemField label="Product" value={product} onChange={setProduct} items={items.list} width={220} />
            <label className="field">
              Makes
              <input
                className="narrow"
                type="number"
                min={1}
                value={productCount}
                onChange={(e) => setProductCount(e.target.value)}
              />
              <span className="small" style={{ minHeight: 16 }} />
            </label>
            <MoneyField label="Pattern cost (optional)" value={patternCost} onChange={setPatternCost} />
          </div>
          <div className="muted small" style={{ margin: '6px 0' }}>
            Materials
          </div>
          {reagents.map((r, i) => (
            <div className="row" key={i}>
              <ItemField
                label={`Material ${i + 1}`}
                value={r.name}
                items={items.list}
                width={220}
                onChange={(v) => setReagents(reagents.map((x, j) => (j === i ? { ...x, name: v } : x)))}
              />
              <label className="field">
                Count
                <input
                  className="narrow"
                  type="number"
                  min={1}
                  value={r.count}
                  onChange={(e) =>
                    setReagents(reagents.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))
                  }
                />
                <span className="small" style={{ minHeight: 16 }} />
              </label>
              {reagents.length > 1 && (
                <button
                  type="button"
                  className="link"
                  style={{ marginBottom: 24 }}
                  onClick={() => setReagents(reagents.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button type="button" className="secondary" onClick={() => setReagents([...reagents, { name: '', count: '1' }])}>
              + Material
            </button>
            <button type="submit" disabled={!valid}>
              {editId !== null ? 'Save changes' : 'Add recipe'}
            </button>
            {editId !== null && (
              <button type="button" className="secondary" onClick={reset}>
                Cancel
              </button>
            )}
          </div>
        </form>
        <p className="hint">
          Profit uses the latest price of each item and an AH cut of {settings.ahCutPercent}%.{' '}
          {settings.depositRefundedOnSale === false
            ? 'Deposits are subtracted where recorded.'
            : 'Deposits are treated as refunded on sale.'}{' '}
          Change both in Settings.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Recipes</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All professions</option>
            {PROFESSIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        {shown.length === 0 ? (
          recipesQ === undefined ? (
          <Skeleton />
        ) : (
          <EmptyState>No recipes yet. They arrive when you open a profession window in game, or add one by hand above.</EmptyState>
        )
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Recipe</th>
                <th className="num">Mat cost</th>
                <th className="num">Profit (craft &amp; sell)</th>
                <th>Options per craft</th>
                <th>Verdict</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const ev = evaluateRecipe(r, prices, items.byId, settings);
                return (
                  <tr key={r.id}>
                    <td>
                      <div>
                        {items.byId.get(r.productItemId)?.name}
                        {r.productCount > 1 ? ` ×${r.productCount}` : ''}
                      </div>
                      <div className="small muted">
                        {r.profession} ·{' '}
                        {r.reagents.map((x) => `${x.count}× ${items.byId.get(x.itemId)?.name}`).join(', ')}
                      </div>
                    </td>
                    <td className="num">
                      <Money copper={ev.matCost} />
                    </td>
                    <td className="num">
                      <Money copper={ev.profit} signed />
                      {r.patternCost ? (
                        <div className="small muted">
                          pattern <Money copper={r.patternCost} />
                          {ev.paybackCrafts !== null ? ` · paid back after ${ev.paybackCrafts} craft(s)` : ' · no payback yet'}
                        </div>
                      ) : null}
                    </td>
                    <td className="small">
                      {ev.options.map((o) => (
                        <div key={o.label}>
                          {o.label}: <Money copper={o.copper} />
                        </div>
                      ))}
                      {ev.missing.length > 0 && <div className="warn">Missing: {ev.missing.join(', ')}</div>}
                    </td>
                    <td>
                      {ev.best ? (
                        <span className={`badge ${ev.best.verdict.split(' ')[0]}`}>{ev.best.verdict}</span>
                      ) : (
                        <span className="muted small">Not enough data</span>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="link" onClick={() => edit(r)} title="Edit">
                        ✎
                      </button>
                      <button className="link" onClick={() => void deleteWithUndo(db.recipes, r.id!, 'Recipe', toast)} title="Delete">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="hint">
          "Options per craft" shows what one craft's materials earn on each path. The verdict picks the highest. "Keep"
          is your call: the dashboard only compares values it has data for.
        </p>
      </div>
    </>
  );
}
