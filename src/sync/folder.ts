// Reads GoldTracker.lua and Auctionator.lua from the WoW folder through the
// browser's File System Access API (Chrome and Edge). Read-only.
import { db } from '../db';
import { importAuctionator, type AuctionatorReport } from './importAuctionator';
import { importGoldTracker, type ImportReport } from './importAddon';
import { parseSavedVariables } from './luaParse';

const SKIP_DIRS = new Set(['data', 'cache', 'logs', 'errors', 'screenshots', 'interface', 'utils', 'fonts']);
const FILES = ['GoldTracker.lua', 'Auctionator.lua'] as const;
type FileName = (typeof FILES)[number];

interface DirHandle {
  name: string;
  kind: 'directory';
  values(): AsyncIterable<DirHandle | FileHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
}
interface FileHandle {
  name: string;
  kind: 'file';
  getFile(): Promise<File>;
}

export function folderAccessSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function chooseWowFolder(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  const dir = await picker({ id: 'wow-folder', mode: 'read' });
  await db.meta.put({ key: 'wowFolder', value: dir });
  await db.meta.delete('filePaths');
}

export async function getFolder(): Promise<DirHandle | undefined> {
  return (await db.meta.get('wowFolder'))?.value as DirHandle | undefined;
}

/** 'granted' | 'prompt' | 'denied' | 'none' (no folder chosen yet). */
export async function folderPermission(): Promise<PermissionState | 'none'> {
  const dir = await getFolder();
  if (!dir) return 'none';
  return dir.queryPermission({ mode: 'read' });
}

/** Must be called from a click. */
export async function requestFolderPermission(): Promise<boolean> {
  const dir = await getFolder();
  return !!dir && (await dir.requestPermission({ mode: 'read' })) === 'granted';
}

/** Finds .../WTF/Account/<ACCOUNT>/SavedVariables/<file>. Picks the newest if there are several. */
async function findFiles(root: DirHandle): Promise<Partial<Record<FileName, FileHandle>>> {
  const found: Partial<Record<FileName, { handle: FileHandle; modified: number }>> = {};
  const queue: { dir: DirHandle; depth: number; inSavedVars: boolean }[] = [{ dir: root, depth: 0, inSavedVars: false }];
  while (queue.length) {
    const { dir, depth, inSavedVars } = queue.shift()!;
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        if (inSavedVars && (FILES as readonly string[]).includes(entry.name)) {
          const modified = (await entry.getFile()).lastModified;
          const name = entry.name as FileName;
          if (!found[name] || found[name]!.modified < modified) found[name] = { handle: entry, modified };
        }
      } else if (depth < 7 && !SKIP_DIRS.has(entry.name.toLowerCase())) {
        // Per-character SavedVariables folders are deeper; GoldTracker and Auctionator use the account-wide one.
        queue.push({ dir: entry, depth: depth + 1, inSavedVars: entry.name === 'SavedVariables' });
      }
    }
  }
  const out: Partial<Record<FileName, FileHandle>> = {};
  for (const f of FILES) if (found[f]) out[f] = found[f]!.handle;
  return out;
}

export interface SyncResult {
  addon?: ImportReport;
  auctionator?: AuctionatorReport;
  skipped: string[]; // files unchanged since the last sync
  missing: string[];
}

async function lastModifiedSeen(name: string): Promise<number> {
  return ((await db.meta.get(`modified:${name}`))?.value as number) ?? 0;
}

/** Imports a file's contents. Used by folder sync and by manual file upload. */
export async function importFile(name: string, text: string): Promise<Partial<SyncResult>> {
  const saved = parseSavedVariables(text);
  if (saved.GoldTrackerDB) return { addon: await importGoldTracker(saved) };
  if (saved.AUCTIONATOR_PRICE_DATABASE) {
    const settings = await db.settings.get('main');
    return { auctionator: await importAuctionator(saved, settings?.auctionatorRealm) };
  }
  throw new Error(`${name} has no GoldTrackerDB or AUCTIONATOR_PRICE_DATABASE.`);
}

/**
 * Reads both files from the chosen folder and imports what changed.
 * GoldTracker goes first so new items exist before Auctionator prices are matched.
 */
export async function syncFromFolder(force = false): Promise<SyncResult> {
  const dir = await getFolder();
  if (!dir) throw new Error('No WoW folder chosen yet.');
  if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') throw new Error('Folder access needs to be allowed again.');

  const files = await findFiles(dir);
  const result: SyncResult = { skipped: [], missing: [] };
  for (const name of FILES) {
    const handle = files[name];
    if (!handle) {
      result.missing.push(name);
      continue;
    }
    const file = await handle.getFile();
    const addonChanged = name === 'Auctionator.lua' && result.addon && result.addon.newEvents > 0;
    if (!force && !addonChanged && file.lastModified <= (await lastModifiedSeen(name))) {
      result.skipped.push(name);
      continue;
    }
    Object.assign(result, await importFile(name, await file.text()));
    await db.meta.put({ key: `modified:${name}`, value: file.lastModified });
  }
  await db.meta.put({ key: 'lastSync', value: Date.now() });
  return result;
}

/** Quiet sync for when the dashboard tab gets focus. Does nothing without permission. */
export async function autoSync(): Promise<SyncResult | null> {
  if ((await folderPermission()) !== 'granted') return null;
  const result = await syncFromFolder(false);
  return result.addon || result.auctionator ? result : null;
}
