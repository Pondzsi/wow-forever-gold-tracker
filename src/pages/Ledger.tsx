import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, LEDGER_CATEGORIES, type LedgerCategory } from '../db';
import { parseMoney } from '../money';
import {
  CharacterSelect,
  charName,
  fmtDate,
  fromLocalInput,
  Money,
  MoneyField,
  toLocalInput,
  useCharacters,
} from '../ui';

export function Ledger() {
  const characters = useCharacters();
  const entries = useLiveQuery(() => db.ledger.orderBy('time').reverse().toArray(), []) ?? [];

  const [characterId, setCharacterId] = useState<number | 'all'>(-1);
  const [kind, setKind] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<LedgerCategory>('auction');
  const [note, setNote] = useState('');
  const [time, setTime] = useState(toLocalInput(Date.now()));

  const [filterChar, setFilterChar] = useState<number | 'all'>('all');
  const [filterCat, setFilterCat] = useState<LedgerCategory | 'all'>('all');

  const parsed = parseMoney(amount);
  const valid = parsed !== null && parsed > 0 && characterId !== 'all';

  async function add() {
    if (characterId === 'all' || !valid) return;
    await db.ledger.add({
      characterId,
      time: fromLocalInput(time),
      copper: kind === 'income' ? parsed! : -parsed!,
      category,
      note: note.trim(),
      source: 'manual',
    });
    setAmount('');
    setNote('');
    setTime(toLocalInput(Date.now()));
  }

  const shown = entries.filter(
    (e) => (filterChar === 'all' || e.characterId === filterChar) && (filterCat === 'all' || e.category === filterCat),
  );
  const income = shown.filter((e) => e.copper > 0).reduce((s, e) => s + e.copper, 0);
  const expense = shown.filter((e) => e.copper < 0).reduce((s, e) => s + e.copper, 0);

  return (
    <>
      <h2>Ledger</h2>
      <div className="card">
        <h3>Add entry</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <CharacterSelect value={characterId} onChange={setCharacterId} characters={characters} />
          <label className="field">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as 'income' | 'expense')}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <label className="field">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as LedgerCategory)}>
              {LEDGER_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 5x Light Leather" />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Date
            <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
            Add
          </button>
        </form>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <CharacterSelect value={filterChar} onChange={setFilterChar} characters={characters} allowAll label="Show" />
            <label className="field">
              Category
              <select value={filterCat} onChange={(e) => setFilterCat(e.target.value as LedgerCategory | 'all')}>
                <option value="all">All</option>
                {LEDGER_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <span className="small" style={{ minHeight: 16 }} />
            </label>
          </div>
          <div className="row" style={{ gap: 20, marginBottom: 20 }}>
            <span>
              Income <Money copper={income} signed />
            </span>
            <span>
              Expenses <Money copper={expense} signed />
            </span>
            <span>
              Net <Money copper={income + expense} signed />
            </span>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="muted">No entries.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Character</th>
                <th>Category</th>
                <th>Note</th>
                <th>Source</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="small muted">{fmtDate(e.time)}</td>
                  <td>{charName(characters, e.characterId)}</td>
                  <td>{e.category}</td>
                  <td>{e.note}</td>
                  <td className="small muted">{e.source}</td>
                  <td className="num">
                    <Money copper={e.copper} signed />
                  </td>
                  <td className="num">
                    <button className="link" title="Delete" onClick={() => db.ledger.delete(e.id!)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
