import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { sessionStats, summarizeContainers, type PriceMap } from '../calc';
import {
  db,
  getOrCreateItem,
  type ContainerOpen,
  type Item,
  type Session,
  type SessionItem,
  type SessionType,
  type WaterType,
} from '../db';
import { formatMoney, parseMoney } from '../money';
import {
  CharacterSelect,
  charName,
  fmtDate,
  fmtHours,
  ItemField,
  Money,
  MoneyField,
  useCharacters,
  useItems,
  usePriceMap,
  EmptyState,
  Skeleton,
} from '../ui';

export function Sessions() {
  const sessionsQ = useLiveQuery(() => db.sessions.orderBy('start').reverse().toArray(), []);
  const sessions = sessionsQ ?? [];
  const sessionItems = useLiveQuery(() => db.sessionItems.toArray(), []) ?? [];
  const opens = useLiveQuery(() => db.containerOpens.toArray(), []) ?? [];
  const prices = usePriceMap();
  const items = useItems();
  const characters = useCharacters();

  const active = sessions.find((s) => s.end === undefined);
  const done = sessions.filter((s) => s.end !== undefined);

  return (
    <>
      <h2>Sessions</h2>
      {active ? (
        <ActiveSession
          session={active}
          sessionItems={sessionItems.filter((i) => i.sessionId === active.id)}
          opens={opens.filter((o) => o.sessionId === active.id)}
          prices={prices}
          items={items}
        />
      ) : (
        <StartForm />
      )}

      <div className="card">
        <h3>Finished sessions</h3>
        {done.length === 0 ? (
          sessionsQ === undefined ? (
          <Skeleton />
        ) : (
          <EmptyState>No finished sessions yet. Fishing sessions start by themselves on your first catch. For farming, type <code>/gt start farming</code> in game.</EmptyState>
        )
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Start</th>
                <th>Character</th>
                <th>Type / zone</th>
                <th className="num">Time</th>
                <th className="num">Gold change</th>
                <th className="num">Items value</th>
                <th className="num">Total</th>
                <th className="num">Per hour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {done.map((s) => {
                const st = sessionStats(s, sessionItems.filter((i) => i.sessionId === s.id), prices);
                return (
                  <tr key={s.id}>
                    <td className="small muted">{fmtDate(s.start)}</td>
                    <td>{charName(characters, s.characterId)}</td>
                    <td>
                      {s.type} · {s.zone}
                      {s.type === 'fishing' && (
                        <div className="small muted">
                          <select
                            className="small"
                            style={{ padding: '1px 4px' }}
                            value={s.water ?? ''}
                            title="Pools or open water (optional)"
                            onChange={(e) =>
                              void db.sessions.update(s.id!, { water: (e.target.value || undefined) as WaterType | undefined })
                            }
                          >
                            <option value="">water?</option>
                            <option value="pools">pools</option>
                            <option value="open water">open water</option>
                            <option value="mixed">mixed</option>
                          </select>{' '}
                          <label>
                            <input
                              type="checkbox"
                              checked={!!s.fishRackUsed}
                              onChange={(e) => void db.sessions.update(s.id!, { fishRackUsed: e.target.checked })}
                            />{' '}
                            rack
                          </label>
                          {s.lureUsed ? ' · lure' : ''}
                          {s.catches !== undefined ? ` · ${s.catches} catches` : ''}
                          {s.fishingSkillStart !== undefined && s.fishingSkillEnd !== undefined
                            ? ` · skill ${s.fishingSkillStart}→${s.fishingSkillEnd}`
                            : ''}
                        </div>
                      )}
                      {s.notes && <div className="small muted">{s.notes}</div>}
                    </td>
                    <td className="num">{fmtHours(st.hours)}</td>
                    <td className="num">
                      <Money copper={st.goldDelta} signed />
                    </td>
                    <td className="num">
                      <Money copper={st.itemValue.copper} />
                      {st.itemValue.unpriced > 0 && <div className="small warn">{st.itemValue.unpriced} unpriced</div>}
                    </td>
                    <td className="num">
                      <Money copper={st.total} />
                    </td>
                    <td className="num">
                      <Money copper={st.perHour === null ? null : Math.round(st.perHour)} />
                    </td>
                    <td className="num">
                      <button className="link" title="Delete session" onClick={() => void deleteSession(s.id!)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        <p className="hint">
          Items value uses the latest recorded prices, so it changes as prices change. Unpriced items count as zero.
        </p>
      </div>

      <FishingStats
        sessions={done.filter((s) => s.type === 'fishing')}
        sessionItems={sessionItems}
        opens={opens}
        prices={prices}
        items={items.byId}
      />
    </>
  );
}

async function deleteSession(id: number) {
  if (!confirm('Delete this session and everything recorded in it?')) return;
  await db.transaction('rw', db.sessions, db.sessionItems, db.containerOpens, async () => {
    await db.sessionItems.where({ sessionId: id }).delete();
    await db.containerOpens.where({ sessionId: id }).delete();
    await db.sessions.delete(id);
  });
}

async function latestGold(characterId: number): Promise<number | undefined> {
  const snaps = await db.goldSnapshots.where({ characterId }).sortBy('time');
  return snaps.at(-1)?.copper;
}

async function latestFishing(characterId: number): Promise<number | undefined> {
  const snaps = await db.professionSnapshots.where({ characterId }).sortBy('time');
  return snaps.filter((s) => s.profession === 'Fishing').at(-1)?.skill;
}

function StartForm() {
  const characters = useCharacters();
  const [characterId, setCharacterId] = useState<number | 'all'>(-1);
  const [type, setType] = useState<SessionType>('fishing');
  const [zone, setZone] = useState('');
  const [gold, setGold] = useState('');
  const [water, setWater] = useState<WaterType>('pools');
  const [rack, setRack] = useState(false);
  const [lure, setLure] = useState(true);
  const [fishSkill, setFishSkill] = useState('');

  // Prefill with the latest known values for the character.
  useEffect(() => {
    if (characterId === 'all') return;
    void latestGold(characterId).then((c) => setGold(c === undefined ? '' : formatMoney(c)));
    void latestFishing(characterId).then((s) => setFishSkill(s === undefined ? '' : String(s)));
  }, [characterId]);

  const parsedGold = gold.trim() ? parseMoney(gold) : undefined;
  const valid = characterId !== 'all' && zone.trim() !== '' && parsedGold !== null;

  async function start() {
    if (characterId === 'all' || !valid) return;
    await db.sessions.add({
      characterId,
      type,
      zone: zone.trim(),
      start: Date.now(),
      startCopper: parsedGold ?? undefined,
      notes: '',
      ...(type === 'fishing'
        ? {
            water,
            fishRackUsed: rack,
            lureUsed: lure,
            fishingSkillStart: fishSkill.trim() ? Number(fishSkill) : undefined,
          }
        : {}),
    });
  }

  return (
    <div className="card">
      <h3>Start a session</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <CharacterSelect value={characterId} onChange={setCharacterId} characters={characters} />
        <label className="field">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as SessionType)}>
            <option value="fishing">Fishing</option>
            <option value="farming">Farming</option>
          </select>
          <span className="small" style={{ minHeight: 16 }} />
        </label>
        <label className="field">
          Zone
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Lordamere Lake" />
          <span className="small" style={{ minHeight: 16 }} />
        </label>
        <MoneyField label="Gold at start" value={gold} onChange={setGold} />
        {type === 'fishing' && (
          <>
            <label className="field">
              Water
              <select value={water} onChange={(e) => setWater(e.target.value as WaterType)}>
                <option value="pools">Pools</option>
                <option value="open water">Open water</option>
                <option value="mixed">Mixed</option>
              </select>
              <span className="small" style={{ minHeight: 16 }} />
            </label>
            <label className="field">
              Fishing skill
              <input className="narrow" type="number" value={fishSkill} onChange={(e) => setFishSkill(e.target.value)} />
              <span className="small" style={{ minHeight: 16 }} />
            </label>
            <label className="field">
              <span>
                <input type="checkbox" checked={rack} onChange={(e) => setRack(e.target.checked)} /> Fish rack
              </span>
              <span>
                <input type="checkbox" checked={lure} onChange={(e) => setLure(e.target.checked)} /> Lure
              </span>
              <span className="small" style={{ minHeight: 16 }} />
            </label>
          </>
        )}
        <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
          Start
        </button>
      </form>
      <p className="hint">Gold at start is prefilled from the latest gold you recorded. Correct it if needed.</p>
    </div>
  );
}

function ActiveSession({
  session,
  sessionItems,
  opens,
  prices,
  items,
}: {
  session: Session;
  sessionItems: SessionItem[];
  opens: ContainerOpen[];
  prices: PriceMap;
  items: { list: Item[]; byId: Map<number, Item> };
}) {
  const characters = useCharacters();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Add loot
  const [lootName, setLootName] = useState('');
  const [lootCount, setLootCount] = useState('1');

  // Container open
  const [containerName, setContainerName] = useState('');
  const [coins, setCoins] = useState('');
  const [contents, setContents] = useState<{ name: string; count: string }[]>([{ name: '', count: '1' }]);

  // Stop
  const [endGold, setEndGold] = useState('');
  const [endSkill, setEndSkill] = useState('');
  const [notes, setNotes] = useState('');

  const stats = sessionStats(session, sessionItems, prices, now);

  async function addLoot() {
    const count = Number(lootCount);
    if (!lootName.trim() || !(count > 0)) return;
    await db.sessionItems.add({ sessionId: session.id!, itemId: await getOrCreateItem(lootName), count });
    setLootName('');
    setLootCount('1');
  }

  const coinValue = coins.trim() ? parseMoney(coins) : 0;
  const cleanContents = contents.filter((c) => c.name.trim() && Number(c.count) > 0);
  const containerValid = containerName.trim() !== '' && coinValue !== null;

  async function addContainer() {
    if (!containerValid) return;
    const containerItemId = await getOrCreateItem(containerName);
    const resolved: { itemId: number; count: number }[] = [];
    for (const c of cleanContents) resolved.push({ itemId: await getOrCreateItem(c.name), count: Number(c.count) });
    await db.transaction('rw', db.containerOpens, db.sessionItems, async () => {
      const openId = await db.containerOpens.add({
        sessionId: session.id!,
        containerItemId,
        time: Date.now(),
        copper: coinValue ?? 0,
      });
      await db.sessionItems.bulkAdd(resolved.map((r) => ({ ...r, sessionId: session.id!, containerOpenId: openId })));
    });
    setCoins('');
    setContents([{ name: '', count: '1' }]);
  }

  const endParsed = endGold.trim() ? parseMoney(endGold) : undefined;

  async function stop() {
    if (endParsed === null) return;
    const end = Date.now();
    await db.sessions.update(session.id!, {
      end,
      endCopper: endParsed,
      notes: notes.trim(),
      ...(session.type === 'fishing' && endSkill.trim() ? { fishingSkillEnd: Number(endSkill) } : {}),
    });
    if (endParsed !== undefined) {
      await db.goldSnapshots.add({ characterId: session.characterId, time: end, copper: endParsed, source: 'manual' });
    }
    if (session.type === 'fishing' && endSkill.trim()) {
      const prev = await db.professionSnapshots.where({ characterId: session.characterId }).sortBy('time');
      const maxSkill = prev.filter((p) => p.profession === 'Fishing').at(-1)?.maxSkill ?? Number(endSkill);
      await db.professionSnapshots.add({
        characterId: session.characterId,
        profession: 'Fishing',
        skill: Number(endSkill),
        maxSkill: Math.max(maxSkill, Number(endSkill)),
        time: end,
      });
    }
  }

  const looseItems = sessionItems.filter((i) => i.containerOpenId === undefined);

  return (
    <div className="card active-session">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3>
          Active: {session.type} · {session.zone} · {charName(characters, session.characterId)}
        </h3>
        <div>
          <span className="stat">{fmtHours(stats.hours)}</span>{' '}
          <span className="muted small">
            · items so far <Money copper={stats.itemValue.copper} />
          </span>
        </div>
      </div>

      <h3 style={{ marginTop: 12 }}>Items gained</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void addLoot();
        }}
      >
        <ItemField value={lootName} onChange={setLootName} items={items.list} />
        <label className="field">
          Count
          <input className="narrow" type="number" min={1} value={lootCount} onChange={(e) => setLootCount(e.target.value)} />
          <span className="small" style={{ minHeight: 16 }} />
        </label>
        <button type="submit" style={{ marginBottom: 20 }}>
          Add
        </button>
      </form>
      {looseItems.length > 0 && (
        <div className="table-wrap"><table style={{ marginBottom: 12 }}>
          <tbody>
            {looseItems.map((i) => (
              <tr key={i.id}>
                <td>{items.byId.get(i.itemId)?.name}</td>
                <td className="num">×{i.count}</td>
                <td className="num">
                  {prices.get(i.itemId) ? <Money copper={prices.get(i.itemId)!.copper * i.count} /> : <span className="muted small">no price</span>}
                </td>
                <td className="num">
                  <button className="link" onClick={() => db.sessionItems.delete(i.id!)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {session.type === 'fishing' && (
        <>
          <h3 style={{ marginTop: 12 }}>Container opened (trunk, bloated fish…)</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addContainer();
            }}
          >
            <div className="row">
              <ItemField label="Container" value={containerName} onChange={setContainerName} items={items.list} />
              <MoneyField label="Coins inside" value={coins} onChange={setCoins} />
            </div>
            {contents.map((c, i) => (
              <div className="row" key={i}>
                <ItemField
                  label={`Content ${i + 1}`}
                  value={c.name}
                  items={items.list}
                  onChange={(v) => setContents(contents.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                />
                <label className="field">
                  Count
                  <input
                    className="narrow"
                    type="number"
                    min={1}
                    value={c.count}
                    onChange={(e) =>
                      setContents(contents.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))
                    }
                  />
                  <span className="small" style={{ minHeight: 16 }} />
                </label>
              </div>
            ))}
            <div className="row">
              <button type="button" className="secondary" onClick={() => setContents([...contents, { name: '', count: '1' }])}>
                + Content
              </button>
              <button type="submit" disabled={!containerValid}>
                Save container
              </button>
            </div>
          </form>
          <p className="hint">
            Container contents count as items gained. Do not also add them above. The container name stays filled in
            for the next one.
          </p>
          {opens.length > 0 && (
            <div className="table-wrap"><table style={{ marginTop: 8 }}>
              <tbody>
                {opens.map((o) => (
                  <tr key={o.id}>
                    <td>{items.byId.get(o.containerItemId)?.name}</td>
                    <td className="small">
                      {o.copper > 0 && (
                        <>
                          <Money copper={o.copper} />
                          {', '}
                        </>
                      )}
                      {sessionItems
                        .filter((i) => i.containerOpenId === o.id)
                        .map((i) => `${i.count}× ${items.byId.get(i.itemId)?.name}`)
                        .join(', ') || <span className="muted">empty</span>}
                    </td>
                    <td className="num">
                      <button
                        className="link"
                        onClick={() =>
                          db.transaction('rw', db.containerOpens, db.sessionItems, async () => {
                            await db.sessionItems.where({ containerOpenId: o.id! }).delete();
                            await db.containerOpens.delete(o.id!);
                          })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}

      <h3 style={{ marginTop: 16 }}>Stop session</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void stop();
        }}
      >
        <MoneyField label="Gold at end" value={endGold} onChange={setEndGold} />
        {session.type === 'fishing' && (
          <label className="field">
            Fishing skill at end
            <input className="narrow" type="number" value={endSkill} onChange={(e) => setEndSkill(e.target.value)} />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
        )}
        <label className="field">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: 260 }} />
          <span className="small" style={{ minHeight: 16 }} />
        </label>
        <button type="submit" disabled={endParsed === null} style={{ marginBottom: 20 }}>
          Stop
        </button>
        <button type="button" className="danger" style={{ marginBottom: 20 }} onClick={() => void deleteSession(session.id!)}>
          Discard
        </button>
      </form>
      <p className="hint">Gold at end also updates the character's gold on the Overview.</p>
    </div>
  );
}

function FishingStats({
  sessions,
  sessionItems,
  opens,
  prices,
  items,
}: {
  sessions: Session[];
  sessionItems: SessionItem[];
  opens: ContainerOpen[];
  prices: PriceMap;
  items: Map<number, Item>;
}) {
  if (sessions.length === 0) return null;
  const ids = new Set(sessions.map((s) => s.id));

  function group(label: string, pick: (s: Session) => boolean) {
    const chosen = sessions.filter(pick);
    let hours = 0;
    let total = 0;
    for (const s of chosen) {
      const st = sessionStats(s, sessionItems.filter((i) => i.sessionId === s.id), prices);
      hours += st.hours;
      total += st.total;
    }
    return { label, count: chosen.length, hours, perHour: hours > 0.01 ? total / hours : null };
  }

  const groups = [
    group('Pools', (s) => s.water === 'pools'),
    group('Open water', (s) => s.water === 'open water'),
    group('Mixed', (s) => s.water === 'mixed'),
    group('With fish rack', (s) => !!s.fishRackUsed),
    group('Without fish rack', (s) => !s.fishRackUsed),
  ].filter((g) => g.count > 0);

  const containers = summarizeContainers(
    opens.filter((o) => ids.has(o.sessionId)),
    sessionItems,
    prices,
  ).sort((a, b) => b.avgValue - a.avgValue);

  return (
    <div className="card">
      <h3>Fishing results</h3>
      <div className="grid">
        <div>
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Sessions</th>
                <th className="num">Time</th>
                <th className="num">Value per hour</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td className="num">{g.count}</td>
                  <td className="num">{fmtHours(g.hours)}</td>
                  <td className="num">
                    <Money copper={g.perHour === null ? null : Math.round(g.perHour)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div>
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>Container</th>
                <th className="num">Opened</th>
                <th className="num">Avg value</th>
              </tr>
            </thead>
            <tbody>
              {containers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No containers recorded.
                  </td>
                </tr>
              ) : (
                containers.map((c) => (
                  <tr key={c.containerItemId}>
                    <td>{items.get(c.containerItemId)?.name}</td>
                    <td className="num">{c.opens}</td>
                    <td className="num">
                      <Money copper={Math.round(c.avgValue)} />
                      {c.unpricedStacks > 0 && <div className="small warn">{c.unpricedStacks} unpriced</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table></div>
        </div>
      </div>
      <p className="hint">Small samples are unreliable. Compare groups after several sessions each.</p>
    </div>
  );
}
