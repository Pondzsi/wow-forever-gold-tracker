import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { goldAt, goldChangeSince, goldTimeline } from '../calc';
import { db, type Character } from '../db';
import { copperToGold, formatMoney, parseMoney } from '../money';
import { charName, fmtAge, fmtDate, Money, MoneyField, themeColor, useCharacters } from '../ui';

const DAY = 86_400_000;

export function Overview() {
  const characters = useCharacters();
  const snapshots = useLiveQuery(() => db.goldSnapshots.toArray(), []) ?? [];
  const ledger = useLiveQuery(() => db.ledger.orderBy('time').reverse().limit(8).toArray(), []) ?? [];
  const ids = characters.map((c) => c.id!);
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);

  const total = goldAt(snapshots, ids, now);
  const timeline = goldTimeline(snapshots, ids).map((p) => ({ time: p.time, gold: copperToGold(p.copper) }));

  return (
    <>
      <h2>Overview</h2>
      {characters.length === 0 && (
        <div className="card">
          <h3>Welcome</h3>
          <p style={{ margin: 0 }}>
            No characters yet. Run <b>setup.bat</b> once (see <a href="#/sync">Sync &amp; to-do</a>), log in to WoW, then
            log out or type <code>/gt sync</code>. Your characters appear here by themselves.
          </p>
        </div>
      )}
      <div className="grid">
        <div className="card">
          <div className="muted small">Total gold</div>
          <div className="stat">
            <Money copper={total} size="xl" />
          </div>
          <div className="table-wrap"><table style={{ marginTop: 8 }}>
            <tbody>
              <ChangeRow label="Today" value={goldChangeSince(snapshots, ids, startOfToday, now)} />
              <ChangeRow label="Last 7 days" value={goldChangeSince(snapshots, ids, now - 7 * DAY, now)} />
              <ChangeRow label="Since start" value={goldChangeSince(snapshots, ids, 0, now)} />
            </tbody>
          </table></div>
        </div>
        {characters.map((c) => (
          <CharacterCard key={c.id} character={c} snapshots={snapshots.filter((s) => s.characterId === c.id)} />
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Total gold over time</h3>
        {timeline.length < 2 ? (
          <p className="muted">Record gold at least twice to see a chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeline} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={themeColor('--border')} strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString()}
                stroke={themeColor('--muted')}
                fontSize={12}
              />
              <YAxis stroke={themeColor('--muted')} fontSize={12} unit="g" width={60} />
              <Tooltip
                contentStyle={{ background: themeColor('--panel-2'), border: `1px solid ${themeColor('--trim')}`, color: themeColor('--text') }}
                labelFormatter={(t) => fmtDate(Number(t))}
                formatter={(v) => [formatMoney(Math.round(Number(v) * 10000)), 'Total']}
              />
              <Line type="monotone" dataKey="gold" stroke={themeColor('--gold')} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3>Recent ledger entries</h3>
        {ledger.length === 0 ? (
          <p className="muted">Gold changes appear here after your next sync.</p>
        ) : (
          <div className="table-wrap"><table>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="muted small">{fmtDate(e.time)}</td>
                  <td>{charName(characters, e.characterId)}</td>
                  <td>{e.category}</td>
                  <td>{e.note}</td>
                  <td className="num">
                    <Money copper={e.copper} signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function ChangeRow({ label, value }: { label: string; value: number | null }) {
  return (
    <tr>
      <td className="muted">{label}</td>
      <td className="num">
        <Money copper={value} signed />
      </td>
    </tr>
  );
}

function CharacterCard({
  character,
  snapshots,
}: {
  character: Character;
  snapshots: { time: number; copper: number }[];
}) {
  const [value, setValue] = useState('');
  const latest = snapshots.reduce<{ time: number; copper: number } | null>(
    (a, b) => (!a || b.time > a.time ? b : a),
    null,
  );
  const parsed = parseMoney(value);

  async function save() {
    if (parsed === null || parsed < 0) return;
    await db.goldSnapshots.add({ characterId: character.id!, time: Date.now(), copper: parsed, source: 'manual' });
    setValue('');
  }

  return (
    <div className="card">
      <div className="muted small">
        {character.name} · {character.className}
      </div>
      <div className="stat">
        <Money copper={latest?.copper} />
      </div>
      <div className="muted small">{latest ? `updated ${fmtAge(latest.time)}` : 'no data yet'}</div>
      <form
        className="row"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <MoneyField label="Current gold" value={value} onChange={setValue} />
        <button type="submit" disabled={parsed === null || parsed < 0} style={{ marginBottom: 20 }}>
          Save
        </button>
      </form>
    </div>
  );
}
