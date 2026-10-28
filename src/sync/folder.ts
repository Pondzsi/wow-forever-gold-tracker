// Reads GoldTracker.lua and Auctionator.lua from the WoW folder through the
// browser's File System Access API (Chrome and Edge). Read-only.
import { db, gameVersion, sharedDb } from '../db';
import { importAuctionator, type AuctionatorReport } from './importAuctionator';
import { importGoldTracker, type ImportReport } from './importAddon';
import { parseSavedVariables, parseSavedVariablesBytes, utf8Strings } from './luaParse';

/** Raise when the importers change, so existing users re-read their files once. */
const IMPORT_VERSION = 2;

const SKIP_DIRS =new Set(['data', 'cache', 'logs', 'errors', 'screenshots', 'interface', 'utils', 'fonts']);
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
  // Opens in Documents, where setup.bat puts the ForeverGoldTracker folder.
  const dir = await picker({ id: 'wow-folder', mode: 'read', startIn: 'documents' });
  await sharedDb.meta.put({ key: 'wowFolder', value: dir });
  await db.meta.delete('filePaths');
}

/** Per-file sync state, for the setup checklist. */
export interface FileStatus {
  found: boolean; // seen in the chosen folder on the last sync
  imported: number | null; // when its data was last imported
  hasData: boolean; // the last import contained real data (events or prices)
}

export async function fileStatus(name: 'GoldTracker.lua' | 'Auctionator.lua'): Promise<FileStatus> {
  const [missing, imported, modified, hasData] = await Promise.all([
    db.meta.get('lastMissing'),
    db.meta.get(`imported:${name}`),
    db.meta.get(`modified:${name}`), // set by earlier versions too
    db.meta.get(`hasData:${name}`),
  ]);
  const missingList = (missing?.value as string[] | undefined) ?? null;
  const when = ((imported?.value ?? modified?.value) as number | undefined) ?? null;
  let data = !!hasData?.value;
  if (!data && when !== null) {
    // Data imported before this flag existed.
    data =
      name === 'GoldTracker.lua'
        ? (await db.characters.count()) > 0
        : (await db.prices.filter((p) => p.source === 'import').count()) > 0;
  }
  return {
    found: when !== null || (missingList !== null && !missingList.includes(name)),
    imported: when,
    hasData: data,
  };
}

export async function getFolder(): Promise<DirHandle | undefined> {
  return (await sharedDb.meta.get('wowFolder'))?.value as DirHandle | undefined;
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

/**
 * Finds .../WTF/Account/<ACCOUNT>/SavedVariables/<file> inside the selected game
 * version's folder (e.g. _forever_). Picks the newest if there are several.
 */
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
      } else if (/^_.+_$/.test(entry.name) && entry.name !== gameVersion) {
        // Another game version's folder (_retail_, _forever_, ...): not the one this page shows.
        continue;
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
export async function importFile(name: string, data: string | ArrayBuffer): Promise<Partial<SyncResult>> {
  // Raw bytes keep Auctionator's binary price data intact; text is converted to UTF-8 where needed.
  const fromBytes = typeof data !== 'string';
  const saved = fromBytes ? parseSavedVariablesBytes(data) : parseSavedVariables(data);
  if (saved.GoldTrackerDB) {
    if (fromBytes) saved.GoldTrackerDB = utf8Strings(saved.GoldTrackerDB);
    const addon = await importGoldTracker(saved);
    await db.meta.put({ key: 'imported:GoldTracker.lua', value: Date.now() });
    if (addon.characters.length) await db.meta.put({ key: 'hasData:GoldTracker.lua', value: true });
    return { addon };
  }
  if (saved.AUCTIONATOR_PRICE_DATABASE) {
    const settings = await db.settings.get('main');
    const auctionator = await importAuctionator(saved, settings?.auctionatorRealm);
    await db.meta.put({ key: 'imported:Auctionator.lua', value: Date.now() });
    if (auctionator.realm) await db.meta.put({ key: 'hasData:Auctionator.lua', value: true });
    return { auctionator };
  }
  throw new Error(`${name} has no GoldTrackerDB or AUCTIONATOR_PRICE_DATABASE.`);
}

/**
 * Reads both files from the chosen folder and imports what changed.
 * GoldTracker goes first so new items exist before Auctionator prices are matched.
 */
export async function syncFromFolder(force = false): Promise<SyncResult> {
  // Re-read all files once after the import code changes (events and prices are still never duplicated).
  if (((await db.meta.get('importVersion'))?.value as number | undefined) !== IMPORT_VERSION) force = true;
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
    Object.assign(result, await importFile(name, await file.arrayBuffer()));
    await db.meta.put({ key: `modified:${name}`, value: file.lastModified });
  }
  await db.meta.put({ key: 'lastSync', value: Date.now() });
  await db.meta.put({ key: 'lastMissing', value: result.missing });
  await db.meta.put({ key: 'importVersion', value: IMPORT_VERSION });
  return result;
}

/** Quiet sync for when the dashboard tab gets focus. Does nothing without permission. */
export async function autoSync(): Promise<SyncResult | null> {
  if ((await folderPermission()) !== 'granted') return null;
  const result = await syncFromFolder(false);
  return result.addon || result.auctionator ? result : null;
}
