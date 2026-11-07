// Pure state for the session-search popup. No herdr/gpui imports, so node --test can run it.

const has = (s, q) => String(s).toLowerCase().includes(q);

// Title/folder matches plus content hits, deduplicated, newest first.
export function visibleRows(rows, query, hits) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const out = new Map();
  for (const r of rows) if (has(r.title, q) || has(r.cwd, q)) out.set(r.id, r);
  for (const r of hits) if (!out.has(r.id)) out.set(r.id, r);
  return [...out.values()].sort((a, b) => b.mtime - a.mtime);
}

export const moveSel = (sel, len, dir) => Math.max(0, Math.min(sel + dir, len - 1));

// Each begin() supersedes the previous one; accept() drops results from a superseded query.
export function createSearch() {
  let n = 0, hits = [];
  return {
    begin(q) {
      hits = [];
      return q.trim() ? ++n : (++n, 0);
    },
    accept(token, rows) {
      if (token !== n || !token) return false;
      hits = rows;
      return true;
    },
    current: (token) => token === n,
    hits: () => hits,
  };
}

export const shortPath = (p, home) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);

export function age(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "now";
  for (const [secs, u] of [[604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]]) if (s >= secs) return Math.floor(s / secs) + u;
}

// session id -> terminal address, for live terminals running that session.
export function liveSessions(terminals) {
  const m = new Map();
  for (const t of terminals) {
    if (t.state !== "live") continue;
    const id = t.labels?.["claude.session"] ?? t.argv?.[t.argv.indexOf("--resume") + 1];
    if (id && (t.labels?.["claude.session"] || t.argv?.[0] === "claude")) m.set(id, t.address);
  }
  return m;
}

// What Enter does: focus the live terminal, else resume in a new tab (or a new space off this computer).
export function actionFor(row, live, localSpaceId) {
  if (live.has(row.id)) return { name: "agent.focus", args: { terminal: live.get(row.id) } };
  const args = { folder: row.cwd, argv: ["claude", "--resume", row.id], name: row.title.slice(0, 30) };
  return localSpaceId ? { name: "tab.new", args: { space: localSpaceId, ...args } } : { name: "space.new", args };
}

// Telescope keys: Up/Down plus ctrl-p/ctrl-n.
export const keyDir = (keystroke) => (keystroke === "down" || keystroke === "ctrl-n" ? 1 : keystroke === "up" || keystroke === "ctrl-p" ? -1 : 0);

// Hover selects a row; an index outside the list leaves the selection alone.
export const hoverSel = (cur, i, len) => (Number.isInteger(i) && i >= 0 && i < len ? i : cur);

export const DEBOUNCE_MS = 200;
export const debounceFor = (q) => (q.trim() ? DEBOUNCE_MS : null);

// Split text into plain/matched runs from [start, end) ranges (any order, may overlap or overrun).
export function segments(text, ranges) {
  const marks = ranges
    .map(([a, b]) => [Math.max(0, a), Math.min(text.length, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([...m]);
  }
  const out = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

// Per-session peek cache. need() is true once per id: the caller then loads and calls set() (or fail() to allow a retry).
export function createPreviews() {
  const done = new Map(), pending = new Set();
  return {
    need(id) {
      if (done.has(id) || pending.has(id)) return false;
      pending.add(id);
      return true;
    },
    set(id, data) { pending.delete(id); done.set(id, data); },
    fail(id) { pending.delete(id); },
    get: (id) => done.get(id),
  };
}

// What the right pane shows: content hits if the search found any, else the peek (null while loading).
export function previewState(row, hitRows, previews) {
  if (!row) return null;
  const h = hitRows.find((r) => r.id === row.id)?.hits;
  if (h?.length) return { kind: "hits", hits: h };
  return { kind: "peek", peek: previews.get(row.id) ?? null };
}

// A snippet as lines of word tokens ("word " with its trailing space), each flagged if inside a match, so a view can wrap and highlight.
export function wordLines(text, ranges) {
  const lines = [[]];
  for (const seg of segments(text, ranges)) {
    seg.text.split("\n").forEach((part, i) => {
      if (i) lines.push([]);
      for (const w of part.match(/\S+\s*|\s+/g) ?? []) lines[lines.length - 1].push({ text: w, hit: seg.hit });
    });
  }
  return lines;
}
