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
