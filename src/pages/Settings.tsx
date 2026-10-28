import { useRef, useState } from 'react';
import {
  clearVersionData,
  db,
  exportAll,
  GAME_VERSIONS,
  gameVersion,
  importAll,
  type BackupFile,
  type Character,
} from '../db';

const versionLabel = GAME_VERSIONS.find((v) => v.id === gameVersion)?.label ?? gameVersion;
import { useCharacters, useSettings } from '../ui';

export function SettingsPage() {
  const settings = useSettings();
  const characters = useCharacters();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  async function download() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `forever-gold-backup${gameVersion.replace(/_/g, "-")}${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage('Backup downloaded.');
  }

  async function restore(file: File) {
    try {
      const data = JSON.parse(await file.text()) as BackupFile;
      if (!confirm(`Replace ALL current data with the backup from ${data.exportedAt}?`)) return;
      await importAll(data);
      setMessage('Backup restored.');
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <h2>Settings &amp; backup</h2>

      <div className="card">
        <h3>Auction House fees</h3>
        <div className="row">
          <label className="field">
            AH cut on sale (%)
            <input
              className="narrow"
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={settings.ahCutPercent}
              onChange={(e) => void db.settings.put({ ...settings, ahCutPercent: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Deposit
            <select
              value={settings.depositRefundedOnSale === false ? 'lost' : 'refunded'}
              onChange={(e) => void db.settings.put({ ...settings, depositRefundedOnSale: e.target.value === 'refunded' })}
            >
              <option value="refunded">Refunded when the item sells</option>
              <option value="lost">Not refunded: subtract it from profit</option>
            </select>
          </label>
          <label className="field">
            Price is stale after (days)
            <input
              className="narrow"
              type="number"
              min={1}
              value={settings.staleDays}
              onChange={(e) => void db.settings.put({ ...settings, staleDays: Math.max(1, Number(e.target.value)) })}
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          Fee notes
          <input
            style={{ maxWidth: 520 }}
            value={settings.depositNote}
            placeholder="What you observe about the AH cut and deposits in Forever"
            onChange={(e) => void db.settings.put({ ...settings, depositNote: e.target.value })}
          />
        </label>
        {settings.observedSales ? (
          <div className="row" style={{ marginTop: 10 }}>
            <span>
              Observed from {settings.observedSales} AH sale mail(s): <b>{settings.observedCutPercent}%</b> cut, deposit{' '}
              <b>{settings.observedDepositRefunded === false ? 'not refunded' : 'refunded'}</b>.
            </span>
            <button
              className="secondary"
              onClick={() =>
                void db.settings.put({
                  ...settings,
                  ahCutPercent: settings.observedCutPercent ?? settings.ahCutPercent,
                  depositRefundedOnSale: settings.observedDepositRefunded ?? settings.depositRefundedOnSale,
                })
              }
            >
              Use observed fees
            </button>
          </div>
        ) : (
          <p className="hint">
            5% cut and a refunded deposit are the Classic rules, not verified for Forever. The addon reads the real
            values from your first AH sale mail.
          </p>
        )}
        <AuctionatorRealm />
      </div>

      <div className="card">
        <h3>Characters</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Class</th>
              <th>Professions (comma separated)</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <CharacterRow key={c.id} character={c} />
            ))}
          </tbody>
        </table>
        <AddCharacter />
        <p className="hint">The addon sync adds your characters by itself. Add them here only if you don't use it.</p>
      </div>

      <div className="card">
        <h3>Backup</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Your data is stored in this browser only. Clearing browser data deletes it. Download a backup regularly and keep
          it in a synced folder (OneDrive, Google Drive…).
        </p>
        <div className="row">
          <button onClick={() => void download()}>Download backup (JSON)</button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>
            Restore from backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = '';
            }}
          />
        </div>
        {message && <p className="hint">{message}</p>}
      </div>

      <div className="card">
        <h3>Clear {versionLabel} data</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Deletes everything for <b>{versionLabel}</b> on this browser: characters, gold history, prices, sessions,
          recipes and goals. Other game versions, fee settings and the folder connection stay. The next sync re-imports
          what the addon and Auctionator still have saved; manual entries are lost.
        </p>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Delete all ${versionLabel} data in this browser? This can't be undone.`)) return;
            await clearVersionData();
            setMessage(`${versionLabel} data cleared.`);
          }}
        >
          Clear {versionLabel} data
        </button>
      </div>
    </>
  );
}

/** Lets you pick the realm when Auctionator.lua has prices for several. */
function AuctionatorRealm() {
  const settings = useSettings();
  const [realms, setRealms] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <label className="field">
        Auctionator realm
        <input
          value={settings.auctionatorRealm ?? ''}
          placeholder="newest realm in the file"
          list="atr-realms"
          onChange={(e) => void db.settings.put({ ...settings, auctionatorRealm: e.target.value || undefined })}
        />
        <datalist id="atr-realms">{realms?.map((r) => <option key={r} value={r} />)}</datalist>
      </label>
      <button className="link" style={{ color: 'var(--accent)' }} onClick={() => fileRef.current?.click()}>
        list realms from Auctionator.lua…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".lua"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const { parseSavedVariablesBytes } = await import('../sync/luaParse');
          const { listAuctionatorRealms } = await import('../sync/importAuctionator');
          setRealms(listAuctionatorRealms(parseSavedVariablesBytes(await f.arrayBuffer())).map((r) => r.name));
          e.target.value = '';
        }}
      />
      {realms && <span className="small muted">{realms.length ? realms.join(', ') : 'no realms in file'}</span>}
    </div>
  );
}

function AddCharacter() {
  const [name, setName] = useState('');
  const [className, setClassName] = useState('');
  async function add() {
    if (!name.trim()) return;
    await db.characters.add({ name: name.trim(), className: className.trim(), professions: [] });
    setName('');
    setClassName('');
  }
  return (
    <form
      className="row"
      style={{ marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input placeholder="Character name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Class" value={className} onChange={(e) => setClassName(e.target.value)} />
      <button type="submit" disabled={!name.trim()}>
        Add character
      </button>
    </form>
  );
}

function CharacterRow({ character }: { character: Character }) {
  const save = (patch: Partial<Character>) => db.characters.update(character.id!, patch);
  return (
    <tr>
      <td>
        <input defaultValue={character.name} onBlur={(e) => void save({ name: e.target.value.trim() || character.name })} />
      </td>
      <td>
        <input defaultValue={character.className} onBlur={(e) => void save({ className: e.target.value.trim() })} />
      </td>
      <td>
        <input
          style={{ width: '100%' }}
          defaultValue={character.professions.join(', ')}
          onBlur={(e) =>
            void save({
              professions: e.target.value
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
            })
          }
        />
      </td>
    </tr>
  );
}
