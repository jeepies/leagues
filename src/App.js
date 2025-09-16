import './App.css';
import { useEffect, useMemo, useState } from 'react';
import leagues from './leagues.json';

const STORAGE_KEY = 'leaguesTaskDone:v1';
const QUERY_KEY = 'leaguesQuery:v1';

function splitConditions(input) {
  // Split by AND outside quotes
  const parts = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if ((ch === '"' || ch === "'") && !(i > 0 && input[i - 1] === '\\')) {
      quote = quote === ch ? null : quote || ch;
      buf += ch;
      continue;
    }
    if (!quote) {
      if (/^and\b/i.test(input.slice(i))) {
        const prev = input[i - 1];
        if (!prev || /\W/.test(prev)) {
          parts.push(buf.trim());
          buf = '';
          i += 2;
          continue;
        }
      }
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

function parseValue(raw) {
  const t = raw.trim();
  const m = t.match(/^(["'])(.*)\1$/);
  if (m) return m[2];
  const num = Number(t);
  if (!Number.isNaN(num)) return num;
  return t;
}

function parseQuery(query) {
  if (!query) return [];
  let q = query.trim();
  q = q.replace(/^select\s*\*\s*where\s*/i, '');
  q = q.replace(/^where\s*/i, '');
  const condStrs = splitConditions(q);
  const conds = [];
  for (const s of condStrs) {
    const flag = s.trim().toLowerCase();
    if (flag === 'completed' || flag === '!completed' || flag === 'done' || flag === '!done') {
      const positive = !flag.startsWith('!');
      conds.push({ type: 'flag', field: 'completed', value: positive });
      continue;
    }
    const m = s.match(/^([a-zA-Z0-9_.]+)\s*(==|=|!=|>=|<=|>|<)\s*(.+)$/);
    if (!m) continue;
    const [, field, op, valueRaw] = m;
    const value = parseValue(valueRaw);
    conds.push({ type: 'binary', field, op: op === '=' ? '==' : op, value });
  }
  return conds;
}

const FIELD_SYNONYMS = {
  pts: ['pts', 'points', 'ponts', 'point'],
  points: ['points', 'pts', 'ponts', 'point'],
  area: ['area', 'region', 'location'],
  level: ['level', 'lvl', 'tier'],
  lvl: ['lvl', 'level'],
  completed: ['completed', 'done'],
};

function resolveField(row, field) {
  const lc = field.toLowerCase();
  const candidates = FIELD_SYNONYMS[lc] || [lc];
  if (candidates.includes('area')) {
    if (typeof row?.area === 'string') return row.area;
    if (row?.area && typeof row.area.name === 'string') return row.area.name;
  }
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const k = keys.find((kk) => kk.toLowerCase() === cand);
    if (k) return row[k];
  }
  if (lc.includes('.')) {
    const segs = lc.split('.');
    let v = row;
    for (const seg of segs) {
      if (v && typeof v === 'object') {
        const key = Object.keys(v).find((kk) => kk.toLowerCase() === seg);
        v = key ? v[key] : undefined;
      } else {
        v = undefined;
      }
    }
    return v;
  }
  return undefined;
}

function compare(a, op, b) {
  const isNum = (x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)));
  if (op === '==' || op === '!=') {
    if (isNum(a) && isNum(b)) {
      const aa = Number(a);
      const bb = Number(b);
      return op === '==' ? aa === bb : aa !== bb;
    }
    const aa = String(a ?? '').toLowerCase();
    const bb = String(b ?? '').toLowerCase();
    return op === '==' ? aa === bb : aa !== bb;
  }
  const aa = Number(a);
  const bb = Number(b);
  if (Number.isNaN(aa) || Number.isNaN(bb)) return false;
  switch (op) {
    case '>':
      return aa > bb;
    case '<':
      return aa < bb;
    case '>=':
      return aa >= bb;
    case '<=':
      return aa <= bb;
    default:
      return false;
  }
}

function hashString(str) {
  // djb2 hash → hex string
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = (hash * 33) ^ str.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

function App() {
  const rows = Array.isArray(leagues)
    ? leagues
    : Array.isArray(leagues?.rows)
    ? leagues.rows
    : [];

  const getAreaTitle = (row) =>
    typeof row?.area === 'string' ? row.area : row?.area?.name || 'Untitled';

  const taskLabel = (row) => {
    if (typeof row?.task === 'string') return row.task;
    if (typeof row?.title === 'string') return row.title;
    if (typeof row?.name === 'string') return row.name;
    if (typeof row?.league === 'string') return row.league;
    return 'Task';
  };

  const normalized = useMemo(() => {
    return rows.map((row) => {
      const areaTitle = getAreaTitle(row);
      const label = taskLabel(row);
      const id = hashString(areaTitle + '|' + JSON.stringify(row));
      return { id, areaTitle, label, row };
    });
  }, [rows]);

  const [query, setQuery] = useState(() => {
    try {
      return localStorage.getItem(QUERY_KEY) || '';
    } catch {
      return '';
    }
  });

  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(QUERY_KEY, query);
    } catch {}
  }, [query]);

  const [done, setDone] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    } catch {
      // ignore storage errors
    }
  }, [done]);

  const toggleDone = (id) => {
    setDone((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const conditions = useMemo(() => parseQuery(query), [query]);

  const filteredByQuery = useMemo(() => {
    if (!conditions.length) return normalized;
    return normalized.filter((item) =>
      conditions.every((cond) => {
        if (cond.type === 'flag' && cond.field.toLowerCase() === 'completed') {
          return (!!done[item.id]) === cond.value;
        }
        if (cond.type === 'binary') {
          const fld = (cond.field || '').toLowerCase();
          const isCompletedField = ['completed', 'done'].includes(fld);
          const actual = isCompletedField ? !!done[item.id] : resolveField(item.row, cond.field);
          return compare(actual, cond.op, cond.value);
        }
        return true;
      })
    );
  }, [normalized, conditions, done]);

  const groupedByArea = useMemo(() => {
    const acc = {};
    for (const item of filteredByQuery) {
      if (!acc[item.areaTitle]) acc[item.areaTitle] = [];
      acc[item.areaTitle].push(item);
    }
    return acc;
  }, [filteredByQuery]);

  const sortedAreas = useMemo(
    () => Object.keys(groupedByArea).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    [groupedByArea]
  );

  

  return (
    <div className="App">
      <header className="header">
        <div className="wrap">
          <div className="topbar">
            <div className="brand">Leagues Tasks</div>
            <div className="controls" style={{ marginLeft: 'auto' }}>
              <button className="iconButton" onClick={() => setShowSearch((v) => !v)} aria-label="Toggle search">🔎</button>
            </div>
          </div>
          <div className="searchPanel" style={{ maxHeight: showSearch ? 200 : 0 }}>
            <div className="searchPanelInner">
              <input
                className="queryInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="select * where pts = 400 and area = 'Al Kharid'"
                spellCheck={false}
              />
            </div>
            <div className="hint">
              Use: select * where field op value [and ...]. Fields: pts/points, area, completed. Ops: =, !=, {'>'}, {'<'}, {'>='}, {'<='}. Also: completed / !completed.
            </div>
          </div>
        </div>
      </header>

      <main className="content wrap">
        {rows.length === 0 && (
          <div className="noResults">No data in leagues.json.</div>
        )}

        {rows.length > 0 && sortedAreas.length === 0 && (
          <div className="noResults">No results for this query.</div>
        )}

        {sortedAreas.map((area) => {
          const items = groupedByArea[area];
          const total = items.length;
          const doneCount = items.reduce((acc, it) => acc + (done[it.id] ? 1 : 0), 0);
          return (
            <details key={area} className="area">
              <summary>
                {area}
                <span className="summaryCount">{doneCount}/{total}</span>
              </summary>
              <div className="areaBody">
                <ul className="tasks">
                  {items.map((task) => {
                    const isDone = !!done[task.id];
                    const pts = resolveField(task.row, 'points');
                    const lvl = resolveField(task.row, 'level');
                    return (
                      <li key={task.id} className="task" style={{ opacity: isDone ? 0.65 : 1 }}>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggleDone(task.id)}
                        />
                        <span style={{ textDecoration: isDone ? 'line-through' : 'none' }}>{task.label}</span>
                        <span className="badges">
                          {typeof lvl !== 'undefined' && lvl !== null && lvl !== '' && (
                            <span className="badge level">Lv {lvl}</span>
                          )}
                          {typeof pts !== 'undefined' && pts !== null && pts !== '' && (
                            <span className="badge points">+{Number(pts)} pts</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}
      </main>
      <a className="sealBadge" href="https://youtu.be/I_NkBrDmGxM?si=DXEU5QqY6Ran7gUX" target="_blank" rel="noreferrer" title="seal of approval">🦭</a>
    </div>
  );
}

export default App;
