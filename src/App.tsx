import { useEffect, useState, type ComponentType } from 'react';
import { Crafting } from './pages/Crafting';
import { Goals } from './pages/Goals';
import { Inventory } from './pages/Inventory';
import { Ledger } from './pages/Ledger';
import { Overview } from './pages/Overview';
import { Prices } from './pages/Prices';
import { Professions } from './pages/Professions';
import { Sessions } from './pages/Sessions';
import { SettingsPage } from './pages/Settings';
import { describeResult, Sync } from './pages/Sync';
import { autoSync } from './sync/folder';
import { useTodos } from './useTodos';

const PAGES: { path: string; label: string; component: ComponentType }[] = [
  { path: 'overview', label: 'Overview', component: Overview },
  { path: 'sync', label: 'Sync & to-do', component: Sync },
  { path: 'ledger', label: 'Ledger', component: Ledger },
  { path: 'inventory', label: 'Inventory', component: Inventory },
  { path: 'prices', label: 'Prices', component: Prices },
  { path: 'crafting', label: 'Crafting', component: Crafting },
  { path: 'professions', label: 'Professions', component: Professions },
  { path: 'sessions', label: 'Sessions', component: Sessions },
  { path: 'goals', label: 'Goals', component: Goals },
  { path: 'settings', label: 'Settings & backup', component: SettingsPage },
];

function currentPath(): string {
  const p = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((x) => x.path === p) ? p : 'overview';
}

/** Syncs quietly whenever the tab gets focus, e.g. after alt-tabbing out of WoW. */
function useAutoSync(): string {
  const [note, setNote] = useState('');
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const r = await autoSync();
        if (r) setNote(`Synced: ${describeResult(r)}`);
      } catch (e) {
        setNote(`Sync failed: ${(e as Error).message}`);
      } finally {
        running = false;
      }
    };
    void run();
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 8000);
    return () => clearTimeout(t);
  }, [note]);
  return note;
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const note = useAutoSync();
  const high = useTodos().filter((t) => t.value === 'High').length;
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const Page = PAGES.find((p) => p.path === path)!.component;

  return (
    <div className="app">
      <nav className="side">
        <h1>Forever Gold</h1>
        {PAGES.map((p) => (
          <a key={p.path} href={`#/${p.path}`} className={p.path === path ? 'active' : ''}>
            {p.label}
            {p.path === 'sync' && high > 0 && <span className="badge Craft" style={{ marginLeft: 6 }}>{high}</span>}
          </a>
        ))}
      </nav>
      <main>
        {note && <div className="card small">{note}</div>}
        <Page />
      </main>
    </div>
  );
}
