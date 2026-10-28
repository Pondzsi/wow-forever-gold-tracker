// Wowhead's official tooltip script for fan sites (https://www.wowhead.com/tooltips).
// It adds item icons to links and shows the in-game tooltip on hover/tap.
// Loaded from Wowhead's servers; we never store or copy their data or icons.
// Links work as plain links when the script is off, blocked or offline.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { gameVersion, type Item } from './db';

const SCRIPT_URL = 'https://wow.zamimg.com/js/tooltips.js';

type Status = 'off' | 'loading' | 'ready' | 'failed';
let status: Status = 'off';
const listeners = new Set<(s: Status) => void>();
const setStatus = (s: Status) => {
  status = s;
  listeners.forEach((l) => l(s));
};

interface WowheadGlobal {
  WH?: { Tooltips?: { refreshLinks?: () => void } };
  $WowheadPower?: { refreshLinks?: () => void };
  whTooltips?: Record<string, unknown>;
}
const w = () => window as unknown as WowheadGlobal;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
/** Asks the script to add icons to links rendered since the last call. */
export function refreshWowhead() {
  if (status !== 'ready') return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const api = w().WH?.Tooltips ?? w().$WowheadPower;
    api?.refreshLinks?.();
  }, 150);
}

function loadScript() {
  if (status !== 'off') return;
  setStatus('loading');
  // Options from Wowhead's install snippet. Names stay ours (renameLinks off).
  w().whTooltips = { colorLinks: true, iconizeLinks: true, renameLinks: false, iconSize: 'small' };
  const s = document.createElement('script');
  s.src = SCRIPT_URL;
  s.async = true;
  s.onload = () => {
    setStatus('ready');
    refreshWowhead();
  };
  s.onerror = () => setStatus('failed');
  document.head.appendChild(s);
}

export function useWowheadStatus(): Status {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}

const WowheadContext = createContext(false);

/** Loads the script once when enabled. Turning it off takes effect on the next page load. */
export function WowheadProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  useEffect(() => {
    if (enabled) loadScript();
  }, [enabled]);
  return <WowheadContext.Provider value={enabled}>{children}</WowheadContext.Provider>;
}

/** Wowhead path for the selected game version. */
function wowheadPrefix(): string {
  if (gameVersion === '_forever_') return 'forever/';
  if (gameVersion === '_retail_') return '';
  return 'classic/';
}

export function itemUrl(gameItemId: number): string {
  return `https://www.wowhead.com/${wowheadPrefix()}item=${gameItemId}`;
}

export function qualityClass(item: Item | undefined): string {
  return item?.quality !== undefined && item.quality >= 0 && item.quality <= 7 ? `q${Math.min(item.quality, 5)}` : '';
}

/**
 * An item name, colored by quality. With a game item id it links to Wowhead
 * (icon and tooltip when the script is on). Items typed in by hand stay plain text.
 */
export function ItemLink({
  item,
  name,
  size = 'small',
  children,
}: {
  item: Item | undefined;
  name?: string;
  size?: 'small' | 'medium' | 'large';
  children?: ReactNode;
}) {
  const enabled = useContext(WowheadContext);
  const label = children ?? name ?? item?.name ?? '?';
  useEffect(() => {
    if (enabled) refreshWowhead();
  });
  const cls = `item-link ${qualityClass(item)}`;
  if (!item?.gameItemId) return <span className={cls}>{label}</span>;
  return (
    <a
      // A new element when the target changes, so React never edits the icon Wowhead inserted.
      key={`${item.gameItemId}-${size}`}
      className={cls}
      href={itemUrl(item.gameItemId)}
      target="_blank"
      rel="noopener noreferrer"
      data-wh-icon-size={size}
      data-wh-rename-link="false"
    >
      {label}
    </a>
  );
}
