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
          ... on Issue { title number url repository { nameWithOwner }
            closedByPullRequestsReferences(first: 10) { nodes { number url state } } }
        }
      }
    }
  } } }
}`;

const TYPES = { ISSUE: "Issue", PULL_REQUEST: "PullRequest", DRAFT_ISSUE: "DraftIssue" };

function toItem(n) {
  const c = n.content ?? {};
  const repo = c.repository?.nameWithOwner ?? null;
  return {
    key: repo && c.number ? `${repo}#${c.number}` : `draft:${n.id}`,
    title: c.title ?? "(no title)", number: c.number ?? null, url: c.url ?? null, repo,
    status: n.status?.name ?? null, priority: n.priority?.name ?? null, updatedAt: n.updatedAt ?? null,
    type: TYPES[n.type] ?? n.type ?? null, prs: c.closedByPullRequestsReferences?.nodes ?? [],
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

// items + config + terminals() -> {columns: [{name, cards}], done: [cards], counts: {name: n, DONE: n}, hidden}
export function buildBoard(items, cfg, terminals) {
  const agents = cardAgents(terminals);
  const rank = new Map(cfg.priorities.map((p, i) => [p, i]));
  const card = (it) => {
    const a = agents.get(it.key.toLowerCase()) ?? [];
    return { ...it, agents: a, needsYou: a.some((x) => x.status === "blocked") };
  };
  const columns = cfg.columns.map((c) => ({ name: c.name, statuses: new Set(c.statuses ?? []), cards: [] }));
  const other = cfg.otherColumn ? { name: cfg.otherColumn, cards: [] } : null;
  const done = [];
  let hidden = 0;
  for (const it of items) {
    if (cfg.done?.status && it.status === cfg.done.status) { done.push(card(it)); continue; }
    if (!rank.has(it.priority) && !cfg.showUnprioritized) { hidden++; continue; }
    const col = columns.find((c) => c.statuses.has(it.status)) ?? other;
    if (!col) { hidden++; continue; }
    col.cards.push(card(it));
  }
  const prio = (c) => rank.get(c.priority) ?? cfg.priorities.length;
  const out = [...columns, ...(other ? [other] : [])].map((c) => ({ name: c.name, cards: c.cards.sort((a, b) => prio(a) - prio(b) || newest(a, b)) }));
  const counts = Object.fromEntries(out.map((c) => [c.name, c.cards.length]));
  counts.DONE = done.length;
  return { columns: out, done: done.sort(newest).slice(0, cfg.done?.limit ?? 5), counts, hidden };
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
