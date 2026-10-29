import { describe, expect, it } from 'vitest';
import { backupFileName, backupsToDelete } from './backup';

describe('backups', () => {
  it('names files by game version and day', () => {
    expect(backupFileName(new Date(2026, 9, 29, 23, 0).getTime(), '_forever_')).toBe('forever-gold-forever-2026-10-29.json');
    expect(backupFileName(new Date(2026, 0, 5).getTime(), '_retail_')).toBe('forever-gold-retail-2026-01-05.json');
  });

  it('deletes only the oldest files of the same version beyond the limit', () => {
    const names = [
      ...Array.from({ length: 16 }, (_, i) => `forever-gold-forever-2026-10-${String(i + 1).padStart(2, '0')}.json`),
      'forever-gold-retail-2026-10-01.json',
      'notes.txt',
    ];
    expect(backupsToDelete(names, 'forever-gold-forever-', 14)).toEqual([
      'forever-gold-forever-2026-10-01.json',
      'forever-gold-forever-2026-10-02.json',
    ]);
  });
});
