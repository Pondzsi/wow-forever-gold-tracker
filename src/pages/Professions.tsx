import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db, type ProfessionSnapshot } from '../db';
import { CharacterSelect, charName, fmtAge, fmtDate, useCharacters } from '../ui';

const SECONDARY = ['Fishing', 'Cooking', 'First Aid'];

export function Professions() {
  const characters = useCharacters();
  const snaps = useLiveQuery(() => db.professionSnapshots.orderBy('time').toArray(), []) ?? [];

  const [characterId, setCharacterId] = useState<number | 'all'>(-1);
  const [profession, setProfession] = useState('');
  const [skill, setSkill] = useState('');
  const [maxSkill, setMaxSkill] = useState('');
  const [chartKey, setChartKey] = useState<string | null>(null);

  const char = characters.find((c) => c.id === characterId);
  const options = [...new Set([...(char?.professions ?? []), ...SECONDARY])];
  const prof = profession || options[0] || '';
  const valid = characterId !== 'all' && prof !== '' && Number(skill) >= 0 && skill !== '' && Number(maxSkill) >= Number(skill);

  async function add() {
    if (characterId === 'all' || !valid) return;
    await db.professionSnapshots.add({
      characterId,
      profession: prof,
      skill: Number(skill),
      maxSkill: Number(maxSkill),
      time: Date.now(),
    });
    setSkill('');
  }

  // Latest per character + profession.
  const latest = new Map<string, ProfessionSnapshot>();
  for (const s of snaps) latest.set(`${s.characterId}|${s.profession}`, s);
  const rows = [...latest.entries()].sort();
  const chartData =
    chartKey === null
      ? []
      : snaps.filter((s) => `${s.characterId}|${s.profession}` === chartKey).map((s) => ({ time: s.time, skill: s.skill }));

  return (
    <>
      <h2>Professions</h2>
      <div className="card">
        <h3>Record skill level</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <CharacterSelect
            value={characterId}
            onChange={(v) => {
              setCharacterId(v);
              setProfession('');
            }}
            characters={characters}
          />
          <label className="field">
            Profession
            <select value={prof} onChange={(e) => setProfession(e.target.value)}>
              {options.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Skill
            <input className="narrow" type="number" min={0} value={skill} onChange={(e) => setSkill(e.target.value)} />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <label className="field">
            Max
            <input
              className="narrow"
              type="number"
              min={0}
              value={maxSkill}
              onChange={(e) => setMaxSkill(e.target.value)}
            />
            <span className="small" style={{ minHeight: 16 }} />
          </label>
          <button type="submit" disabled={!valid} style={{ marginBottom: 20 }}>
            Save
          </button>
        </form>
        <p className="hint">Max is the current cap from your training rank. Forever's skill brackets are not verified yet.</p>
      </div>

      <div className="card">
        <h3>Current levels</h3>
        {rows.length === 0 ? (
          <p className="muted">No skill levels recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th>Profession</th>
                <th className="num">Skill</th>
                <th style={{ width: '30%' }}>Progress to cap</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, s]) => (
                <tr
                  key={key}
                  className={`clickable ${chartKey === key ? 'selected' : ''}`}
                  onClick={() => setChartKey(key)}
                >
                  <td>{charName(characters, s.characterId)}</td>
                  <td>{s.profession}</td>
                  <td className="num">
                    {s.skill} / {s.maxSkill}
                  </td>
                  <td>
                    <div className="bar">
                      <div style={{ width: `${s.maxSkill ? (100 * s.skill) / s.maxSkill : 0}%` }} />
                    </div>
                  </td>
                  <td className="small muted">{fmtAge(s.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">Click a row to see its history.</p>
      </div>

      {chartKey !== null && (
        <div className="card">
          <h3>History: {chartKey.split('|')[1]}</h3>
          {chartData.length < 2 ? (
            <p className="muted">Record the skill at least twice to see a chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#30343e" strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t: number) => new Date(t).toLocaleDateString()}
                  stroke="#9a9ca6"
                  fontSize={12}
                />
                <YAxis stroke="#9a9ca6" fontSize={12} width={40} />
                <Tooltip
                  contentStyle={{ background: '#1b1d23', border: '1px solid #30343e' }}
                  labelFormatter={(t) => fmtDate(Number(t))}
                />
                <Line type="stepAfter" dataKey="skill" stroke="#6aa5ff" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </>
  );
}
