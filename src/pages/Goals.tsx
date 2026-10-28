import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { goldAt, goldChangeSince } from '../calc';
import { db } from '../db';
import { parseMoney } from '../money';
import { charName, Money, MoneyField, useCharacters } from '../ui';

const DAY = 86_400_000;

// Common goals. Targets are WoW Classic Era (1.12) reference prices where known.
// Forever may differ: they are marked as unverified and can be edited.
const PRESETS: { name: string; target: string; note: string }[] = [
  {
    name: 'Riding + first mount (level 40)',
    target: '100g',
    note: 'Classic Era reference: 20g riding training + about 80g mount, less with Honored/Exalted reputation. Not verified for Forever.',
  },
  {
    name: 'Epic riding + epic mount (level 60)',
    target: '1000g',
    note: 'Classic Era reference: 900g training + about 100g mount, less with reputation. Not verified for Forever.',
  },
  { name: 'Class training (next levels)', target: '', note: "Enter what your trainer charges; it rises with level." },
  { name: 'Profession training (next rank)', target: '', note: 'Enter the trainer price for the next rank and key recipes.' },
  { name: 'Bag upgrades', target: '', note: 'Check current bag prices on the Prices page (Auctionator) or craft them on the Mage.' },
  { name: 'Gold reserve', target: '', note: 'A buffer for buying AH price dips and paying deposits.' },
  { name: 'Key BoE item', target: '', note: 'Rename to the item you want; use its latest AH price as the target.' },
];

export function Goals() {
  const characters = useCharacters();
  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const snapshots = useLiveQuery(() => db.goldSnapshots.toArray(), []) ?? [];

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState<number[]>([]);

  const parsed = parseMoney(target);
  const ids = characters.map((c) => c.id!).filter((id) => !excluded.includes(id));
  const valid = name.trim() !== '' && parsed !== null && parsed > 0 && ids.length > 0;

  async function add() {
    if (!valid) return;
    await db.goals.add({ name: name.trim(), targetCopper: parsed!, characterIds: ids, note: note.trim() || undefined });
    setName('');
    setTarget('');
    setNote('');
  }

  const now = Date.now();

  return (
    <>
      <h2>Savings goals</h2>
      <div className="card">
        <h3>Add goal</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="secondary small"
              onClick={() => {
                setName(p.name);
                setTarget(p.target);
                setNote(p.note);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {note && <p className="hint" style={{ marginTop: 0 }}>{note}</p>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riding skill" />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <MoneyField label="Target" value={target} onChange={setTarget} />
          <label className="field">
            Counts gold of
            <span>
              {characters.map((c) => (
                <label key={c.id} style={{ marginRight: 12, color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    checked={!excluded.includes(c.id!)}
                    onChange={(e) =>
                      setExcluded(e.target.checked ? excluded.filter((x) => x !== c.id) : [...excluded, c.id!])
                    }
                  />{' '}
                  {c.name}
                </label>
              ))}
            </span>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
            Add
          </button>
        </form>
      </div>

      {goals.length === 0 ? (
        <p className="muted">No goals yet.</p>
      ) : (
        goals.map((g) => {
          const current = goldAt(snapshots, g.characterIds, now) ?? 0;
          const pct = Math.min(100, (100 * current) / g.targetCopper);
          const weekChange = goldChangeSince(snapshots, g.characterIds, now - 7 * DAY, now);
          const perDay = weekChange !== null ? weekChange / 7 : null;
          const left = g.targetCopper - current;
          const daysLeft = left <= 0 ? 0 : perDay && perDay > 0 ? Math.ceil(left / perDay) : null;
          return (
            <div className="card" key={g.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{g.name}</h3>
                <button className="link" onClick={() => db.goals.delete(g.id!)} title="Delete">
                  ✕
                </button>
              </div>
              {g.note && <p className="hint" style={{ marginTop: 0 }}>{g.note}</p>}
              <div className="bar" style={{ height: 12 }}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <span>
                  <Money copper={current} /> of <Money copper={g.targetCopper} /> ({pct.toFixed(0)}%)
                </span>
                <span className="muted small">
                  {g.characterIds.map((id) => charName(characters, id)).join(' + ')}
                  {' · '}
                  {left <= 0
                    ? 'reached'
                    : daysLeft === null
                      ? 'no estimate (gold not rising over the last 7 days)'
                      : `about ${daysLeft} day(s) at the last 7 days' pace`}
                </span>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
