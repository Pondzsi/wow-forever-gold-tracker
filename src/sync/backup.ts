// Daily backups into <chosen folder>\backups (normally Documents\ForeverGoldTracker\backups).
// Needs write access to that folder, which the user grants once with a click in Settings.
import { db, exportAll, gameVersion } from '../db';
import { getFolder } from './folder';

const DAY = 86_400_000;
export const KEEP_BACKUPS = 14;

interface WritableDir {
  name: string;
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<WritableDir>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

const prefix = () => `forever-gold-${gameVersion.replace(/^_|_$/g, '')}-`;

/** File name for a day, e.g. forever-gold-forever-2026-10-29.json. */
export function backupFileName(time: number, version = gameVersion): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `forever-gold-${version.replace(/^_|_$/g, '')}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** The oldest names beyond `keep`, for one version prefix (names sort by date). */
export function backupsToDelete(names: string[], namePrefix: string, keep = KEEP_BACKUPS): string[] {
  const mine = names.filter((n) => n.startsWith(namePrefix) && n.endsWith('.json')).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

export async function backupStatus(): Promise<{ enabled: boolean; permission: PermissionState | 'none'; last: number | null }> {
  const enabled = !!(await db.meta.get('autoBackup'))?.value;
  const last = ((await db.meta.get('lastBackup'))?.value as number | undefined) ?? null;
  const dir = (await getFolder()) as unknown as WritableDir | undefined;
  const permission = dir ? await dir.queryPermission({ mode: 'readwrite' }) : 'none';
  return { enabled, permission, last };
}

/** Must be called from a click: asks for write access and switches daily backups on. */
export async function enableAutoBackup(): Promise<boolean> {
  const dir = (await getFolder()) as unknown as WritableDir | undefined;
  if (!dir) throw new Error('Connect the folder on Sync & to-do first.');
  if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  await db.meta.put({ key: 'autoBackup', value: true });
  await writeBackup(dir);
  return true;
}

export async function disableAutoBackup(): Promise<void> {
  await db.meta.put({ key: 'autoBackup', value: false });
}

async function writeBackup(dir: WritableDir): Promise<string> {
  const folder = await dir.getDirectoryHandle('backups', { create: true });
  const now = Date.now();
  const name = backupFileName(now);
  const file = await folder.getFileHandle(name, { create: true });
  const out = await file.createWritable();
  await out.write(JSON.stringify(await exportAll()));
  await out.close();
  const names: string[] = [];
  for await (const n of folder.keys()) names.push(n);
  for (const old of backupsToDelete(names, prefix())) await folder.removeEntry(old);
  await db.meta.put({ key: 'lastBackup', value: now });
  return name;
}

/** Called after each sync: writes today's backup if it is due and allowed. Never asks for permission. */
export async function backupIfDue(): Promise<string | null> {
  if (!(await db.meta.get('autoBackup'))?.value) return null;
  const last = ((await db.meta.get('lastBackup'))?.value as number | undefined) ?? 0;
  if (Date.now() - last < DAY) return null;
  const dir = (await getFolder()) as unknown as WritableDir | undefined;
  if (!dir || (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
  return writeBackup(dir);
}
