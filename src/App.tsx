import {
  Backpack,
  BookOpen,
  Coins,
  Ellipsis,
  Fish,
  GraduationCap,
  Hammer,
  Home,
  RefreshCw,
  Scale,
  Settings as SettingsIcon,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { GAME_VERSIONS, gameVersion, setGameVersion } from './db';
import { ErrorBoundary } from './ErrorBoundary';
import { Crafting } from './pages/Crafting';
import { Goals } from './pages/Goals';
import { Inventory } from './pages/Inventory';
import { Ledger } from './pages/Ledger';
import { Overview } from './pages/Overview';
import { Prices } from './pages/Prices';
import { Professions } from './pages/Professions';
import { SellList } from './pages/SellList';
import { Sessions } from './pages/Sessions';
import { SettingsPage } from './pages/Settings';
import { describeResult, Sync } from './pages/Sync';
import { autoSync } from './sync/folder';
import { ToastProvider, useToast } from './toast';
import { useSettings } from './ui';
import { useTodos } from './useTodos';
import { WowheadProvider } from './wowhead';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  group: string;
  component: ComponentType;
  mobile?: boolean; // shown in the phone bottom bar
}

const NAV: NavItem[] = [
  { path: 'overview', label: 'Overview', icon: Home, group: '', component: Overview, mobile: true },
  { path: 'ledger', label: 'Ledger', icon: BookOpen, group: 'Money', component: Ledger, mobile: true },
  { path: 'goals', label: 'Goals', icon: Target, group: 'Money', component: Goals },
  { path: 'sell', label: 'Sell list', icon: Coins, group: 'Market', component: SellList, mobile: true },
  { path: 'prices', label: 'Prices', icon: Scale, group: 'Market', component: Prices },
  { path: 'inventory', label: 'Inventory', icon: Backpack, group: 'Market', component: Inventory },
  { path: 'crafting', label: 'Crafting', icon: Hammer, group: 'Market', component: Crafting },
  { path: 'sessions', label: 'Sessions', icon: Fish, group: 'Play', component: Sessions, mobile: true },
  { path: 'professions', label: 'Professions', icon: GraduationCap, group: 'Play', component: Professions },
  { path: 'sync', label: 'Sync & to-do', icon: RefreshCw, group: 'Setup', component: Sync },
  { path: 'settings', label: 'Settings', icon: SettingsIcon, group: 'Setup', component: SettingsPage },
];
const GROUPS = [...new Set(NAV.map((n) => n.group))];

function currentPath(): string {
  const p = window.location.hash.replace(/^#\/?/, '');
  return NAV.some((x) => x.path === p) ? p : 'overview';
}

/** Syncs quietly whenever the tab gets focus, e.g. after alt-tabbing out of WoW. */
function useAutoSync() {
  const toast = useToast();
  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const r = await autoSync();
        if (r) {
          const warned = !!r.addon?.warnings.length;
          toast({ text: `Synced: ${describeResult(r)}`, tone: warned ? 'warn' : 'good', ms: warned ? 10000 : 5000 });
        }
      } catch (e) {
        toast({ text: `Sync failed: ${(e as Error).message}`, tone: 'bad', ms: 10000 });
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
  }, [toast]);
}

function VersionSelect() {
  return (
    <label className="version-select" title="Each game version keeps its own data">
      <span className="small muted">Game version</span>
      <select value={gameVersion} onChange={(e) => setGameVersion(e.target.value)}>
        {GAME_VERSIONS.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NavLinks({ path, high, onPick }: { path: string; high: number; onPick?: () => void }) {
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g || 'home'} role="group" aria-label={g || 'Home'}>
          {g && <div className="nav-group-label">{g}</div>}
          {NAV.filter((n) => n.group === g).map((n) => (
            <a
              key={n.path}
              href={`#/${n.path}`}
              className={`nav-link ${n.path === path ? 'active' : ''}`}
              aria-current={n.path === path ? 'page' : undefined}
              title={n.label}
              onClick={onPick}
            >
              <n.icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="label">{n.label}</span>
              {n.path === 'sync' && high > 0 && (
                <span className="badge count" aria-label={`${high} important to-dos`}>
                  {high}
                </span>
              )}
            </a>
          ))}
        </div>
      ))}
    </>
  );
}

/** Loads Wowhead tooltips unless switched off in Settings (on by default). */
function WowheadGate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  return <WowheadProvider enabled={settings.wowheadTooltips !== false}>{children}</WowheadProvider>;
}

function Shell() {
  const [path, setPath] = useState(currentPath);
  const [moreOpen, setMoreOpen] = useState(false);
  useAutoSync();
  const high = useTodos().filter((t) => t.value === 'High').length;

  useEffect(() => {
    const onHash = () => {
      setPath(currentPath());
      setMoreOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const page = NAV.find((p) => p.path === path)!;
  useEffect(() => {
    document.title = `${page.label} · Forever Gold`;
  }, [page]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const Page = page.component;
  const inMore = !page.mobile;

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>

      <nav className="side" aria-label="Main">
        <div className="brand">Forever Gold</div>
        <VersionSelect />
        <NavLinks path={path} high={high} />
        <div className="nav-footer">Fan-made tool. Not affiliated with Blizzard Entertainment or Wowhead.</div>
      </nav>

      <main id="main" tabIndex={-1}>
        <ErrorBoundary resetKey={path}>
          <Page />
        </ErrorBoundary>
      </main>

      <nav className="bottom-bar" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((n) => (
          <a
            key={n.path}
            href={`#/${n.path}`}
            className={n.path === path ? 'active' : ''}
            aria-current={n.path === path ? 'page' : undefined}
          >
            <n.icon size={20} strokeWidth={1.75} aria-hidden />
            {n.label}
          </a>
        ))}
        <button
          className={inMore ? 'active' : ''}
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          onClick={() => setMoreOpen(true)}
        >
          <Ellipsis size={20} strokeWidth={1.75} aria-hidden />
          More
          {high > 0 && <span className="badge count">{high}</span>}
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" id="more-sheet" role="dialog" aria-label="All pages">
            <div className="sheet-head">
              <span className="brand" style={{ margin: 0 }}>
                Forever Gold
              </span>
              <button className="link" aria-label="Close" onClick={() => setMoreOpen(false)}>
                <X size={22} />
              </button>
            </div>
            <NavLinks path={path} high={high} onPick={() => setMoreOpen(false)} />
            <VersionSelect />
            <div className="nav-footer">Fan-made tool. Not affiliated with Blizzard Entertainment or Wowhead.</div>
          </div>
        </>
      )}
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <WowheadGate>
        <Shell />
      </WowheadGate>
    </ToastProvider>
  );
}
