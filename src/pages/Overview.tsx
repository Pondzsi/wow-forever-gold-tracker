import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { decideHoldings, goldAt, goldChangeSince, goldTimeline, sessionStats } from '../calc';
import { db, sharedDb, type Character } from '../db';
import { copperToGold, formatMoney, parseMoney } from '../money';
import { folderPermission, requestFolderPermission, syncFromFolder } from '../sync/folder';
import { useToast } from '../toast';
import {
  charName,
  fmtAge,
  fmtDate,
  fmtHours,
  Money,
  MoneyField,
  themeColor,
  useCharacters,
  useItems,
  usePriceMap,
  useSettings,
} from '../ui';
import { useTodos } from '../useTodos';
import { describeResult, ValueBadge } from './Sync';

const DAY = 86_400_000;

export function Overview() {
  const characters = useCharacters();
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const todos = useTodos();
  const data = useLiveQuery(async () => {
    const [snapshots, ledger, sessions, goals, inventory, recipes, lastSync, folder] = await Promise.all([
      db.goldSnapshots.toArray(),
      db.ledger.orderBy('time').reverse().limit(8).toArray(),
      db.sessions.orderBy('start').reverse().limit(3).toArray(),
      db.goals.toArray(),
      db.inventory.toArray(),
      db.recipes.toArray(),
      db.meta.get('lastSync'),
      sharedDb.meta.get('wowFolder'),
    ]);
    const sessionItems = await db.sessionItems.where('sessionId').anyOf(sessions.map((s) => s.id!)).toArray();
    return { snapshots, ledger, sessions, sessionItems, goals, inventory, recipes, lastSync: lastSync?.value as number | undefined, connected: !!folder };
  }, []);

  if (!data) return <h2>Overview</h2>;
  const { snapshots, ledger, sessions, sessionItems, goals, inventory, recipes } = data;
  const ids = characters.map((c) => c.id!);
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const total = goldAt(snapshots, ids, now);
  const timeline = goldTimeline(snapshots, ids).map((p) => ({ time: p.time, gold: copperToGold(p.copper) }));

  const held = new Map<number, number>();
  for (const r of inventory) held.set(r.itemId, (held.get(r.itemId) ?? 0) + r.count);
  const decisions = decideHoldings(held, items.byId, prices, settings, recipes, settings.staleDays, now);
  const toSell = decisions.filter((d) => d.decision === 'Sell on AH');
  const toVendor = decisions.filter((d) => d.decision === 'Vendor');
  const sum = (list: typeof decisions) => list.reduce((s, d) => s + d.best, 0);

  return (
    <>
      <h2>Overview</h2>
      <SyncStatus lastSync={data.lastSync} connected={data.connected} />

      {characters.length === 0 && (
        <div className="card">
          <h3>Welcome</h3>
          <p style={{ margin: 0 }}>
            No characters yet. Follow the steps on <a href="#/sync">Sync &amp; to-do</a>: run setup.bat once, log in to
            WoW, then type <code>/reload</code>. Your characters appear here by themselves.
          </p>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <div className="muted small">Total gold</div>
          <Money copper={total} size="xl" />
          <div className="delta-row">
            <Delta label="Today" value={goldChangeSince(snapshots, ids, startOfToday, now)} />
            <Delta label="7 days" value={goldChangeSince(snapshots, ids, now - 7 * DAY, now)} />
            <Delta label="Since start" value={goldChangeSince(snapshots, ids, 0, now)} />
          </div>
        </div>
        <a className="card stat-link" href="#/sell">
          <div className="muted small">Ready to sell</div>
          <div className="stat">
            <Money copper={sum(toSell)} />
          </div>
          <div className="small muted">
            {toSell.length} item(s) for the AH · {toVendor.length} to vendor (<Money copper={sum(toVendor)} />)
          </div>
        </a>
      </div>

      {todos.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--s4)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3>Needs you</h3>
            <a href="#/sync" className="small">
              All to-dos →
            </a>
          </div>
          <ul className="plain-list">
            {todos.slice(0, 3).map((t) => (
              <li key={t.title}>
                <ValueBadge value={t.value} /> {t.title}
                <div className="small muted">{t.how}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {characters.length > 0 && (
        <div className="grid" style={{ marginTop: 'var(--s4)' }}>
          {characters.map((c) => (
            <CharacterTile key={c.id} character={c} snapshots={snapshots.filter((s) => s.characterId === c.id)} />
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <h3>Total gold over time</h3>
        {timeline.length < 2 ? (
          <p className="muted">The chart appears after a few syncs.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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

      {goals.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3>Goals</h3>
            <a href="#/goals" className="small">
              All goals →
            </a>
          </div>
          {goals.map((g) => {
            const current = goldAt(snapshots, g.characterIds, now) ?? 0;
            const pct = Math.min(100, (100 * current) / g.targetCopper);
            return (
              <div key={g.id} style={{ marginBottom: 'var(--s3)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{g.name}</span>
                  <span className="small muted">
                    <Money copper={current} /> / <Money copper={g.targetCopper} />
                  </span>
                </div>
                <div className="bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h3>Recent activity</h3>
        {ledger.length === 0 && sessions.length === 0 ? (
          <p className="muted">Gold changes and sessions appear here after your next sync.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Character</th>
                  <th>What</th>
                  <th className="num">Gold</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...ledger.map((e) => ({
                    key: `l${e.id}`,
                    time: e.time,
                    who: e.characterId,
                    what: [e.category, e.note].filter(Boolean).join(' · '),
                    copper: e.copper,
                  })),
                  ...sessions
                    .filter((s) => s.end !== undefined)
                    .map((s) => {
                      const st = sessionStats(s, sessionItems.filter((i) => i.sessionId === s.id), prices);
                      return {
                        key: `s${s.id}`,
                        time: s.end!,
                        who: s.characterId,
                        what: `${s.type} session · ${s.zone} · ${fmtHours(st.hours)}`,
                        copper: st.total,
                      };
                    }),
                ]
                  .sort((a, b) => b.time - a.time)
                  .slice(0, 10)
                  .map((r) => (
                    <tr key={r.key}>
                      <td className="small muted" title={fmtDate(r.time)}>
                        {fmtAge(r.time)}
                      </td>
                      <td>{charName(characters, r.who)}</td>
                      <td>{r.what}</td>
                      <td className="num">
                        <Money copper={r.copper} signed />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SyncStatus({ lastSync, connected }: { lastSync?: number; connected: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function syncNow() {
    setBusy(true);
    try {
      if ((await folderPermission()) !== 'granted' && !(await requestFolderPermission())) {
        toast({ text: 'Folder access was not allowed.', tone: 'warn' });
        return;
      }
      toast({ text: `Synced: ${describeResult(await syncFromFolder(true))}`, tone: 'good' });
    } catch (e) {
      toast({ text: `Sync failed: ${(e as Error).message}`, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="status-line">
      {connected ? (
        <>
          <span className="good">●</span>
          <span>{lastSync ? `Synced ${fmtAge(lastSync)}` : 'Connected, not synced yet'}</span>
          <button className="secondary" onClick={() => void syncNow()} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </>
      ) : (
        <>
          <span className="warn">●</span>
          <span>
            Not connected to the game yet. <a href="#/sync">Set up sync</a>
          </span>
        </>
      )}
    </div>
  );
}

function Delta({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <Money copper={value} signed />
    </div>
  );
}

function CharacterTile({
  character,
  snapshots,
}: {
  character: Character;
  snapshots: { time: number; copper: number }[];
}) {
  const [editing, setEditing] = useState(false);
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
    setEditing(false);
  }

  return (
    <div className="card">
      <div className="muted small">
        {character.name} · {character.className}
      </div>
      <div className="stat">
        <Money copper={latest?.copper} />
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{latest ? `updated ${fmtAge(latest.time)}` : 'no data yet'}</span>
        {!editing && (
          <button className="link" style={{ color: 'var(--link)' }} onClick={() => setEditing(true)}>
            Correct gold
          </button>
        )}
      </div>
      {editing && (
        <form
          className="row"
          style={{ marginTop: 'var(--s2)' }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <MoneyField label="Current gold" value={value} onChange={setValue} />
          <button type="submit" disabled={parsed === null || parsed < 0}>
            Save
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
