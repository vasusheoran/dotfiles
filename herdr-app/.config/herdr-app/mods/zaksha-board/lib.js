// The board's logic, with no herdr or gpui imports so `node --test` can run it (lib.test.js).
// main.js draws what buildBoard returns.

const DEFAULTS = { priorities: ["P0", "P1", "P2"], columns: [], done: { status: "Done", limit: 5 }, pollSeconds: 60, showUnprioritized: false, otherColumn: null };
const STATUSES = new Set(["working", "blocked", "done", "idle"]);

// board.json text (null: no file) -> {missing} | {error} | {cfg}
export function parseConfig(text) {
  if (text === null || text === undefined) return { missing: true };
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { error: `board.json is not valid JSON: ${e.message}` }; }
  if (!raw || typeof raw !== "object") return { error: "board.json must be an object" };
  if (typeof raw.owner !== "string" || !raw.owner.trim()) return { error: "board.json needs \"owner\": the GitHub org or user that owns the project" };
  if (!Number.isInteger(raw.project) || raw.project < 1) return { error: "board.json needs \"project\": the project number (an integer)" };
  const cfg = { ...DEFAULTS, ...raw, done: { ...DEFAULTS.done, ...(raw.done ?? {}) } };
  if (!Array.isArray(cfg.columns)) return { error: "board.json \"columns\" must be a list of {name, statuses}" };
  cfg.pollSeconds = Math.max(15, Number(cfg.pollSeconds) || DEFAULTS.pollSeconds);
  return { cfg };
}

const QUERY = `query($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id type updatedAt
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content {
          ... on DraftIssue { title }
          ... on PullRequest { title number url repository { nameWithOwner } }
          ... on Issue { title number url state repository { nameWithOwner }
            closedByPullRequestsReferences(first: 10) { nodes { number url state } }
            parent { number title url }
            subIssuesSummary { total completed percentCompleted } }
        }
      }
    }
  } } }
}`;

const TYPES = { ISSUE: "Issue", PULL_REQUEST: "PullRequest", DRAFT_ISSUE: "DraftIssue" };

// https://github.com/<owner>/<repo>/issues/<n> -> <owner>/<repo>#<n>
const keyOf = (url) => { const m = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/.exec(url ?? ""); return m ? `${m[1]}#${m[2]}` : null; };

function toItem(n) {
  const c = n.content ?? {};
  const repo = c.repository?.nameWithOwner ?? null;
  const p = c.parent;
  const sub = c.subIssuesSummary ?? null;
  return {
    key: repo && c.number ? `${repo}#${c.number}` : `draft:${n.id}`,
    title: c.title ?? "(no title)", number: c.number ?? null, url: c.url ?? null, repo, state: c.state ?? null,
    status: n.status?.name ?? null, priority: n.priority?.name ?? null, updatedAt: n.updatedAt ?? null,
    type: TYPES[n.type] ?? n.type ?? null, prs: c.closedByPullRequestsReferences?.nodes ?? [],
    parent: p ? { key: keyOf(p.url) ?? `#${p.number}`, number: p.number, title: p.title, url: p.url } : null,
    subIssues: sub, epic: (sub?.total ?? 0) > 0,
  };
}

const lastLine = (s) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";

// One page through `gh api graphql` (gh(args) -> {code, stdout, stderr}). Returns {nodes, next} or throws.
async function readPage(gh, cfg, after) {
  const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${cfg.owner}`, "-F", `number=${cfg.project}`];
  if (after) args.push("-f", `after=${after}`);
  const r = await gh(args);
  let body = null;
  try { body = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (body?.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (r.code !== 0) throw new Error(lastLine(r.stderr) || `gh exited ${r.code}`);
  const items = body?.data?.repositoryOwner?.projectV2?.items;
  if (!items) throw new Error(`project ${cfg.owner}/${cfg.project} not found (or gh lacks the read:project scope)`);
  return { nodes: items.nodes ?? [], next: items.pageInfo?.hasNextPage ? (items.pageInfo.endCursor ?? false) : null };
}

// Every item, 100 per page, until GitHub says there are no more.
// -> {items, truncated: why it stopped early | null, error: why nothing was read | null}
export async function fetchAll(gh, cfg, { maxPages = 50 } = {}) {
  const items = [];
  let after = null;
  for (let pages = 0; ; pages++) {
    if (pages === maxPages) return { items, truncated: `stopped after ${maxPages} pages (${items.length} items)`, error: null };
    let got;
    try { got = await readPage(gh, cfg, after); } catch (e) {
      const msg = String(e.message ?? e);
      return pages === 0 ? { items: [], truncated: null, error: msg } : { items, truncated: `page ${pages + 1} failed: ${msg}`, error: null };
    }
    items.push(...got.nodes.filter(Boolean).map(toItem));
    if (got.next === null) return { items, truncated: null, error: null };
    if (got.next === false) return { items, truncated: `GitHub said there was more but gave no cursor (${items.length} items)`, error: null };
    after = got.next;
  }
}

const labelsOf = (t) => Array.isArray(t.labels)
  ? Object.fromEntries(t.labels.map((l) => { const i = String(l).indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }))
  : (t.labels ?? {});

// live terminals labelled card=<owner/repo>#<N>, by lowercased card key
export function cardAgents(terminals) {
  const out = new Map();
  for (const t of terminals ?? []) {
    if (t.state && t.state !== "live") continue;
    const card = labelsOf(t).card;
    if (!card) continue;
    const status = STATUSES.has(t.status) ? t.status : "idle";
    const key = card.toLowerCase();
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ address: t.address, status, label: status === "blocked" ? "Needs you" : status });
  }
  return out;
}

const newest = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));

const SORTS = ["priority", "updated"];
const VIEWS = ["columns", "epics"];
export const NO_EPIC = "no-epic";

// the board's UI state (saved by main.js), with anything missing or invalid set to its default
export function uiState(cfg, saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    sort: SORTS.includes(s.sort) ? s.sort : "priority",
    priorities: Array.isArray(s.priorities) ? cfg.priorities.filter((p) => s.priorities.includes(p)) : [...cfg.priorities],
    text: typeof s.text === "string" ? s.text : "",
    epic: typeof s.epic === "string" ? s.epic : null,
    view: VIEWS.includes(s.view) ? s.view : "columns",
    collapsed: Array.isArray(s.collapsed) ? s.collapsed.filter((k) => typeof k === "string") : [],
  };
}

// clicking an epic filters to it; clicking the active one (or null: "All") clears it
export const toggleEpic = (ui, key) => ({ ...ui, epic: key && key !== ui.epic ? key : null });

// the filter text as typed; save() (shared state, which redraws every mod) runs only on commit, and only for a change
export function draft(save, initial = "") {
  let value = initial, saved = initial;
  return { get: () => value, set: (v) => { value = v; }, commit: () => { if (value !== saved) { saved = value; save(value); } } };
}

const matches = (c, text) => !text || [c.title, c.number ? `#${c.number}` : "", c.repo ?? "", c.parent?.title ?? ""]
  .some((s) => s.toLowerCase().includes(text));

// items + config + terminals() + ui state ->
//   {columns: [{name, cards}], done, counts: {name: n, DONE: n}, total, hidden, epics, rows}
// columns/done/counts/rows are filtered by ui; total is the column cards before ui filters; epics (the bar) never are.
export function buildBoard(items, cfg, terminals, ui = uiState(cfg)) {
  const agents = cardAgents(terminals);
  const rank = new Map(cfg.priorities.map((p, i) => [p, i]));
  const card = (it) => {
    const a = agents.get(it.key.toLowerCase()) ?? [];
    return { ...it, agents: a, needsYou: a.some((x) => x.status === "blocked") };
  };
  const isDone = (it) => !!cfg.done?.status && it.status === cfg.done.status;
  const epics = items.filter((it) => it.epic && it.state === "OPEN").map(card)
    .map((e) => ({ ...e, total: e.subIssues.total, completed: e.subIssues.completed, percent: e.subIssues.percentCompleted ?? 0 }))
    .sort((a, b) => (b.total - b.completed) - (a.total - a.completed) || a.title.localeCompare(b.title));

  const chips = new Set(ui.priorities);
  const text = ui.text.trim().toLowerCase();
  const shows = (it) => matches(it, text) && (!ui.epic || it.parent?.key === ui.epic);
  const columns = cfg.columns.map((c) => ({ name: c.name, statuses: new Set(c.statuses ?? []), cards: [] }));
  const other = cfg.otherColumn ? { name: cfg.otherColumn, cards: [] } : null;
  const done = [];
  let hidden = 0, total = 0;
  for (const it of items) {
    if (it.epic) continue; // epics live in the bar
    if (isDone(it)) { if (shows(it)) done.push(card(it)); continue; }
    if (!rank.has(it.priority) && !cfg.showUnprioritized) { hidden++; continue; }
    const col = columns.find((c) => c.statuses.has(it.status)) ?? other;
    if (!col) { hidden++; continue; }
    total++;
    if (rank.has(it.priority) && !chips.has(it.priority)) continue;
    if (shows(it)) col.cards.push(card(it));
  }
  const prio = (c) => rank.get(c.priority) ?? cfg.priorities.length;
  const order = ui.sort === "updated" ? newest : (a, b) => prio(a) - prio(b) || newest(a, b);
  const limit = cfg.done?.limit ?? 5;
  const cols = [...columns, ...(other ? [other] : [])].map((c) => ({ name: c.name, cards: c.cards.sort(order) }));
  done.sort(newest);
  const counts = Object.fromEntries(cols.map((c) => [c.name, c.cards.length]));
  counts.DONE = done.length;

  // by epic: the bar's epics in order, then everything whose parent isn't one of them
  const known = new Set(epics.map((e) => e.key));
  const rowOf = (c) => (known.has(c.parent?.key) ? c.parent.key : NO_EPIC);
  const rows = [...epics.map((e) => ({ key: e.key, title: e.title, url: e.url, completed: e.completed, total: e.total, agents: e.agents })),
    { key: NO_EPIC, title: "No epic", url: null, completed: null, total: null, agents: [] }]
    .map((r) => ({ ...r,
      columns: cols.map((c) => ({ name: c.name, cards: c.cards.filter((x) => rowOf(x) === r.key) })),
      done: done.filter((x) => rowOf(x) === r.key).slice(0, limit) }))
    .filter((r) => r.done.length || r.columns.some((c) => c.cards.length));

  return { columns: cols, done: done.slice(0, limit), counts, total, hidden, epics, rows };
}

// the last n non-empty lines of a screen, trimmed, each at most 120 chars
export function excerpt(text, n = 3) {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-n)
    .map((l) => (l.length > 120 ? l.slice(0, 119) + "…" : l));
}

// what a card offers: {label, run: [command, args]} or {label, exec: [program, args]}. No merge, ever.
export function cardButtons(card) {
  const out = card.agents.map((a) => ({ label: card.agents.length > 1 ? `Open worker ${a.address}` : "Open worker", run: ["agent.focus", { terminal: a.address }] }));
  if (card.url) out.push({ label: "Open card", exec: ["open", [card.url]] });
  const prs = [...card.prs].sort((a, b) => (b.state === "OPEN") - (a.state === "OPEN") || b.number - a.number);
  if (prs[0]?.url) out.push({ label: "Open PR", exec: ["open", [prs[0].url]] });
  return out;
}

// wraps an async fn so only one call runs at a time; a call while busy returns null
export function single(fn) {
  let busy = false;
  return (...args) => {
    if (busy) return null;
    busy = true;
    let p;
    try { p = Promise.resolve(fn(...args)); } catch (e) { p = Promise.reject(e); }
    return p.finally(() => { busy = false; });
  };
}

// the tab already showing this mod as a pane (panes()), or null
export const boardTab = (panes, mod) => panes.find((p) => p.mod === mod)?.tab ?? null;
