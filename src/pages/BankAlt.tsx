import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { isSend, planBankAltMail, SEND_ACTIONS, type SendAction, type SenderPlan } from '../calc';
import { db, DEFAULT_ITEMS_PER_MAIL, DEFAULT_MAIL_POSTAGE, type Character, type Item, type Settings } from '../db';
import { useSort } from '../sort';
import { charName, EmptyState, fmtAge, Money, Skeleton, useCharacters, useItems, usePriceMap, useSettings } from '../ui';
import { ItemLink } from '../wowhead';

const BADGE: Record<SendAction, string> = {
  Send: 'good',
  'Send to sell': 'Sell',
  'Send, check AH there': 'Sell',
  'Vendor here': 'Vendor',
  'Keep here': '',
};

export const mailPostage = (s: Settings) => s.mailPostage ?? DEFAULT_MAIL_POSTAGE;
export const itemsPerMail = (s: Settings) => s.itemsPerMail ?? DEFAULT_ITEMS_PER_MAIL;

/** The mail plans for all characters except the bank alt. Undefined while loading. */
export function useBankAltPlans(): { plans: SenderPlan[]; bankAlt: Character | undefined } | undefined {
  const items = useItems();
  const prices = usePriceMap();
  const settings = useSettings();
  const characters = useCharacters();
  const inventory = useLiveQuery(() => db.inventory.toArray(), []);
  const recipes = useLiveQuery(() => db.recipes.toArray(), []);
  if (!inventory || !recipes) return undefined;
  const bankAlt = characters.find((c) => c.id === settings.bankAltCharacterId);
  if (!bankAlt) return { plans: [], bankAlt };
  const plans = planBankAltMail({
    bankAltId: bankAlt.id!,
    characters,
    inventory,
    items: items.byId,
    prices,
    fees: settings,
    recipes,
    staleDays: settings.staleDays,
    postage: mailPostage(settings),
    itemsPerMail: itemsPerMail(settings),
  });
  return { plans, bankAlt };
}

/** Which items the other characters should mail to the bank alt. */
export function BankAlt() {
  const characters = useCharacters();
  const settings = useSettings();
  const data = useBankAltPlans();
  const [onlySend, setOnlySend] = useState(false);

  if (characters.length < 2) {
    return (
      <>
        <h2>Send to bank alt</h2>
        <div className="card">
          <EmptyState>
            This page needs two characters: one that gathers and a bank alt that stores, sells and crafts. Your
            characters appear after the next sync. See <a href="#/sync">Sync &amp; to-do</a>.
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Send to bank alt</h2>
      <BankAltSettings />

      {!data ? (
        <div className="card">
          <Skeleton />
        </div>
      ) : !data.bankAlt ? (
        <div className="card">
          <EmptyState>Choose your bank alt above. The list then shows what your other characters should mail to it.</EmptyState>
        </div>
      ) : data.plans.length === 0 ? (
        <div className="card">
          <EmptyState>
            Nothing to send. Your other characters hold no items that can be mailed. Bags and banks arrive with the next
            sync. See <a href="#/sync">Sync &amp; to-do</a>.
          </EmptyState>
        </div>
      ) : (
        <>
          <label className="row" style={{ alignItems: 'center', marginBottom: 'var(--s3)' }}>
            <input type="checkbox" checked={onlySend} onChange={(e) => setOnlySend(e.target.checked)} />
            Show only stacks to send
          </label>
          {data.plans.map((p) => (
            <SenderCard
              key={p.characterId}
              plan={p}
              sender={charName(characters, p.characterId)}
              bankAlt={data.bankAlt!.name}
              onlySend={onlySend}
            />
          ))}
        </>
      )}

      <p className="hint">
        Values are for the whole stack: the AH price after a {settings.ahCutPercent}% cut, or the vendor price. Soulbound,
        quest and warbound items can't be mailed and are left out. Each item type counts as one mail slot; an item that
        fills several stacks needs more slots. After you mail the items and sync, they move to {data?.bankAlt?.name ?? 'the bank alt'}{' '}
        and leave this list.
      </p>
    </>
  );
}

function SenderCard({ plan, sender, bankAlt, onlySend }: { plan: SenderPlan; sender: string; bankAlt: string; onlySend: boolean }) {
  const items = useItems();
  const prices = usePriceMap();
  const rows = onlySend ? plan.rows.filter((r) => isSend(r.action)) : plan.rows;
  const { sorted, Th } = useSort(
    rows,
    {
      item: (r) => items.byId.get(r.itemId)?.name ?? '',
      count: (r) => r.count,
      action: (r) => SEND_ACTIONS.indexOf(r.action),
      value: (r) => r.value,
    },
    { key: 'action' },
  );
  const { stacks, mails, postage, value, unpriced } = plan.plan;

  return (
    <div className="card">
      <h3>
        From {sender} to {bankAlt}
      </h3>
      <div className="grid" style={{ marginBottom: 'var(--s3)' }}>
        <Stat label="Stacks to send" value={stacks} />
        <Stat label="Mails" value={mails} />
        <Stat label="Postage" value={<Money copper={postage} />} />
        <Stat
          label="Value sent"
          value={<Money copper={value} />}
          note={unpriced ? `${unpriced} stack(s) without a price` : undefined}
        />
      </div>
      {sorted.length === 0 ? (
        <EmptyState>Nothing to send from {sender}.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <Th k="item" label="Item" />
                <Th k="count" label="Count" num />
                <Th k="action" label="Do" />
                <Th k="value" label="Value" num />
                <th>Why</th>
                <th>Never send</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const item = items.byId.get(r.itemId);
                const price = prices.get(r.itemId);
                return (
                  <tr key={r.itemId}>
                    <td>
                      <ItemLink item={item} />
                    </td>
                    <td className="num">
                      {r.count}
                      {r.locations.includes('bank') && (
                        <span className="small muted" title="Take it out of the bank first">
                          {' '}
                          {r.locations.length > 1 ? 'bags + bank' : 'bank'}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${BADGE[r.action]}`}>{r.action}</span>
                    </td>
                    <td className="num">
                      <Money copper={r.value} />
                    </td>
                    <td className={`small ${r.stale ? 'warn' : 'muted'}`}>
                      {r.reason}
                      {r.stale && price ? ` (price ${fmtAge(price.time)})` : ''}
                    </td>
                    <td>
                      <NeverSendToggle item={item} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div>
      <div className="muted small">{label}</div>
      <div className="stat">{value}</div>
      {note && <div className="small warn">{note}</div>}
    </div>
  );
}

function NeverSendToggle({ item }: { item: Item | undefined }) {
  if (item?.id === undefined) return null;
  return (
    <label className="row small" style={{ alignItems: 'center', gap: 'var(--s1)' }}>
      <input
        type="checkbox"
        checked={!!item.keepOnCharacter}
        aria-label={`Never send ${item.name}`}
        onChange={(e) => void db.items.update(item.id!, { keepOnCharacter: e.target.checked || undefined })}
      />
      keep
    </label>
  );
}

/** Bank alt, postage and mail size. Shown on this page and in Settings. */
export function BankAltSettings() {
  const settings = useSettings();
  const characters = useCharacters();
  const valid = characters.some((c) => c.id === settings.bankAltCharacterId);
  const save = (patch: Partial<Settings>) => void db.settings.put({ ...settings, ...patch });
  return (
    <div className="card">
      <h3>Bank alt and mail</h3>
      <div className="row">
        <label className="field">
          Bank alt
          <select
            value={valid ? String(settings.bankAltCharacterId) : ''}
            onChange={(e) => save({ bankAltCharacterId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Choose a character…</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Postage per mail (copper)
          <input
            className="narrow"
            type="number"
            min={0}
            value={mailPostage(settings)}
            onChange={(e) => save({ mailPostage: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="field">
          Items per mail
          <input
            className="narrow"
            type="number"
            min={1}
            value={itemsPerMail(settings)}
            onChange={(e) => save({ itemsPerMail: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
          />
        </label>
      </div>
      <p className="hint">
        30 copper per mail is the Classic value and 12 items per mail the retail value. Verify both in Forever and
        correct them here.
      </p>
    </div>
  );
}
