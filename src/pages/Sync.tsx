import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db } from '../db';
import {
  chooseWowFolder,
  folderAccessSupported,
  folderPermission,
  importFile,
  requestFolderPermission,
  syncFromFolder,
  type SyncResult,
} from '../sync/folder';
import { COVERAGE, type Value } from '../todo';
import { fmtAge } from '../ui';
import { useTodos } from '../useTodos';

export function describeResult(r: Partial<SyncResult>): string {
  const parts: string[] = [];
  if (r.addon) {
    parts.push(
      `Gold Tracker: ${r.addon.newEvents} new event(s), ${r.addon.sessions} session(s), ${r.addon.recipes} new recipe(s)`,
    );
    for (const w of r.addon.warnings) parts.push(`Warning: ${w}`);
  }
  if (r.auctionator) {
    parts.push(
      r.auctionator.realm
        ? `Auctionator (${r.auctionator.realm}): ${r.auctionator.newPrices} new price(s) for ${r.auctionator.itemsWithPrices} item(s)`
        : 'Auctionator: no price data yet',
    );
  }
  if (r.skipped?.length) parts.push(`Unchanged: ${r.skipped.join(', ')}`);
  if (r.missing?.length) parts.push(`Not found: ${r.missing.join(', ')}`);
  return parts.join(' · ') || 'Nothing new.';
}

export function Sync() {
  const todos = useTodos();
  const lastSync = useLiveQuery(async () => (await db.meta.get('lastSync'))?.value as number | undefined, []);
  const permission = useLiveQuery(() => folderPermission(), [lastSync]);
  const folderName = useLiveQuery(async () => ((await db.meta.get('wowFolder'))?.value as { name?: string })?.name, [lastSync]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      await chooseWowFolder();
      return describeResult(await syncFromFolder(true));
    });

  const syncNow = () =>
    run(async () => {
      if ((await folderPermission()) !== 'granted' && !(await requestFolderPermission())) {
        return 'Folder access was not allowed.';
      }
      return describeResult(await syncFromFolder(true));
    });

  const importFiles = (files: FileList) =>
    run(async () => {
      const out: string[] = [];
      // GoldTracker first, so its items exist before Auctionator prices are matched.
      const sorted = [...files].sort((a) => (a.name.startsWith('GoldTracker') ? -1 : 1));
      for (const f of sorted) out.push(describeResult(await importFile(f.name, await f.text())));
      await db.meta.put({ key: 'lastSync', value: Date.now() });
      return out.join(' · ');
    });

  return (
    <>
      <h2>Sync &amp; to-do</h2>

      <div className="card">
        <h3>Game data</h3>
        {folderAccessSupported() ? (
          <>
            <p style={{ marginTop: 0 }}>
              {permission === 'none' || permission === undefined ? (
                <span className="warn">No WoW folder connected.</span>
              ) : (
                <>
                  Folder: <b>{folderName}</b> ·{' '}
                  {permission === 'granted' ? (
                    <span className="good">access allowed, syncs when you switch to this tab</span>
                  ) : (
                    <span className="warn">access needs a click on "Sync now"</span>
                  )}
                </>
              )}
              {lastSync ? <span className="muted"> · last sync {fmtAge(lastSync)}</span> : null}
            </p>
            <div className="row">
              {permission !== 'none' && permission !== undefined && (
                <button onClick={() => void syncNow()} disabled={busy}>
                  Sync now
                </button>
              )}
              <button className={permission === 'none' ? '' : 'secondary'} onClick={() => void connect()} disabled={busy}>
                {permission === 'none' || permission === undefined ? 'Choose WoW folder…' : 'Change folder…'}
              </button>
              <button className="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                Import files manually…
              </button>
            </div>
            <p className="hint">
              First run <b>setup.bat</b> once (download below). Then choose the folder{' '}
              <code>Documents\ForeverGoldTracker</code>. Setup keeps a copy of the game's save files there, because
              browsers may not open folders inside Program Files. If WoW is installed elsewhere, you can choose the{' '}
              <b>World of Warcraft</b> folder directly. WoW saves when you log out or type <code>/gt sync</code>.
            </p>
            <p className="hint">
              <a href="./ForeverGoldTracker-setup.zip" download>
                Download setup (addon + setup.bat)
              </a>{' '}
              · unzip it, double-click <b>setup.bat</b>. Run it again later to update the addon.
            </p>
          </>
        ) : (
          <>
            <p className="warn" style={{ marginTop: 0 }}>
              This browser can't read folders. Use Chrome or Edge for automatic sync, or import the files by hand.
            </p>
            <button onClick={() => fileRef.current?.click()} disabled={busy}>
              Import GoldTracker.lua / Auctionator.lua…
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".lua"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {message && <p className="hint">{message}</p>}
      </div>

      <div className="card">
        <h3>What still needs you</h3>
        {todos.length === 0 ? (
          <p className="good">Nothing. Everything is filled in automatically.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Value</th>
                <th>What</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {todos.map((t) => (
                <tr key={t.title}>
                  <td>
                    <ValueBadge value={t.value} />
                  </td>
                  <td>
                    <div>{t.title}</div>
                    <div className="small muted">{t.why}</div>
                    {t.items && <div className="small">{t.items.join(', ')}</div>}
                  </td>
                  <td className="small">{t.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>What fills in by itself</h3>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Source</th>
              <th>Status</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {COVERAGE.map((c) => (
              <tr key={c.data}>
                <td>{c.data}</td>
                <td className="small muted">{c.how}</td>
                <td className={c.auto === 'Automatic' ? 'good' : c.auto === 'Partly' ? 'warn' : 'muted'}>{c.auto}</td>
                <td>
                  <ValueBadge value={c.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Requires the Gold Tracker addon and Auctionator. The addon's game calls are not verified on Forever yet; check
          this page after your first session at launch.
        </p>
      </div>
    </>
  );
}

export function ValueBadge({ value }: { value: Value }) {
  const cls = value === 'High' ? 'Craft' : value === 'Medium' ? 'Vendor' : '';
  return <span className={`badge ${cls}`}>{value}</span>;
}
