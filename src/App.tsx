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

const PAGES: { path: string; label: string; component: ComponentType }[] = [
  { path: 'overview', label: 'Overview', component: Overview },
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

export function App() {
  const [path, setPath] = useState(currentPath);
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
          </a>
        ))}
      </nav>
      <main>
        <Page />
      </main>
    </div>
  );
}
