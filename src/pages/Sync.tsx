import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, sharedDb } from '../db';
import {
  chooseWowFolder,
  fileStatus,
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
  const folderName = useLiveQuery(async () => ((await sharedDb.meta.get('wowFolder'))?.value as { name?: string })?.name, [lastSync]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const noFile = { found: false, imported: null, hasData: false };
  const gt = useLiveQuery(() => fileStatus('GoldTracker.lua'), [lastSync]) ?? noFile;
  const atr = useLiveQuery(() => fileStatus('Auctionator.lua'), [lastSync]) ?? noFile;

  const connected = permission === 'granted' || permission === 'prompt';
  const doneList = [atr.found, gt.found, connected, gt.hasData, atr.hasData];
  const allDone = doneList.every(Boolean);
  // Auctionator can only be detected once the folder is connected, so it doesn't hold up the steps before that.
  const checkable = [atr.found || !gt.hasData, gt.found, connected, gt.hasData, atr.hasData];
  const current = checkable.findIndex((d) => !d) + 1; // 0 when all done

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
      for (const f of sorted) out.push(describeResult(await importFile(f.name, await f.arrayBuffer())));
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
            {allDone && !showSteps ? (
              <div className="row" style={{ alignItems: 'center' }}>
                <span className="good">✓ Connected to {folderName}</span>
                <span className="muted small">
                  syncs when you switch to this tab{lastSync ? ` · last sync ${fmtAge(lastSync)}` : ''}
                </span>
                <button onClick={() => void syncNow()} disabled={busy}>
                  Sync now
                </button>
                <button className="link" style={{ color: 'var(--accent)' }} onClick={() => setShowSteps(true)}>
                  setup steps
                </button>
              </div>
            ) : (
              <>
                <ol className="steps">
                  <Step n={1} done={atr.found} current={current === 1} title="Install Auctionator in WoW">
                    From CurseForge or Wago. It provides the Auction House prices.
                    {gt.hasData && !atr.found
                      ? ' Auctionator.lua was not found yet: install it, log in once, then /gt sync.'
                      : ' This turns green after step 4.'}
                  </Step>
                  <Step n={2} done={gt.found} current={current === 2} title="Download the setup and run setup.bat">
                    <a className="button" href="./ForeverGoldTracker-setup.zip" download>
                      Download setup
                    </a>{' '}
                    Unzip it and double-click <b>setup.bat</b>. Press Enter to track <code>_forever_</code> (or pick
                    another game version). It installs the addon and creates <code>Documents\ForeverGoldTracker</code>.
                  </Step>
                  <Step n={3} done={connected} current={current === 3} title="Connect the folder">
                    {permission === 'prompt' ? (
                      <button onClick={() => void syncNow()} disabled={busy}>
                        Allow access again
                      </button>
                    ) : (
                      <button onClick={() => void connect()} disabled={busy}>
                        {connected ? 'Change folder…' : 'Choose folder…'}
                      </button>
                    )}{' '}
                    In the window: <b>Documents</b> → <b>ForeverGoldTracker</b> → <b>Select Folder</b>, then{' '}
                    <b>Allow on every visit</b>.
                  </Step>
                  <Step n={4} done={gt.hasData} current={current === 4} title="Log in to WoW, then save">
                    Play as usual. Type <code>/gt sync</code> in chat (or log out) to save. Switch back to this tab:
                    your characters appear by themselves.
                  </Step>
                  <Step n={5} done={atr.hasData} current={current === 5} title="Scan the Auction House">
                    At the AH, open the Auctionator tab and run a full scan. Then <code>/gt sync</code> again.
                  </Step>
                </ol>
                <div className="row">
                  {connected && (
                    <button className="secondary" onClick={() => void syncNow()} disabled={busy}>
                      Sync now
                    </button>
                  )}
                  {allDone && (
                    <button className="link" style={{ color: 'var(--accent)' }} onClick={() => setShowSteps(false)}>
                      hide steps
                    </button>
                  )}
                  <button className="link" style={{ color: 'var(--muted)' }} onClick={() => fileRef.current?.click()}>
                    import files by hand instead…
                  </button>
                </div>
                <p className="hint">
                  Why a copy in Documents: browsers can't open folders inside Program Files, where WoW is usually
                  installed. setup.bat's background copier keeps the copy up to date.
                </p>
              </>
            )}
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
          <div className="table-wrap"><table>
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
          </table></div>
        )}
      </div>

      <div className="card">
        <h3>What fills in by itself</h3>
        <div className="table-wrap"><table>
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
        </table></div>
        <p className="hint">
          Requires the Gold Tracker addon and Auctionator. The addon's game calls are not verified on Forever yet; check
          this page after your first session at launch.
        </p>
      </div>
    </>
  );
}

function Step({
  n,
  done,
  current,
  title,
  children,
}: {
  n: number;
  done: boolean;
  current: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
      <span className="step-mark">{done ? '✓' : n}</span>
      <div>
        <div className="step-title">{title}</div>
        {!done || current ? <div className="small muted step-body">{children}</div> : null}
      </div>
    </li>
  );
}

export function ValueBadge({ value }: { value: Value }) {
  const cls = value === 'High' ? 'Craft' : value === 'Medium' ? 'Vendor' : '';
  return <span className={`badge ${cls}`}>{value}</span>;
}
