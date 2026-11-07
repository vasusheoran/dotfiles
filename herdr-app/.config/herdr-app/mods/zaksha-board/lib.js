// The board's logic, with no herdr or gpui imports so `node --test` can run it (lib.test.js).
// main.js draws what these return.

const POLL = 300;
const STATUSES = new Set(["working", "blocked", "done", "idle"]);
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"];
export const PIPELINE = ["Inbox", "Needs answer", "Ready", "Next", "In progress", "Blocked", "Done"];
const NEEDS = new Set(["Blocked", "Needs answer", "Inbox"]);
const DAY = 86400000;

// board.json text (null: no file) -> {missing} | {error} | {cfg}
export function parseConfig(text) {
  if (text === null || text === undefined) return { missing: true };
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { error: `board.json is not valid JSON: ${e.message}` }; }
  if (!raw || typeof raw !== "object") return { error: "board.json must be an object" };
  if (typeof raw.owner !== "string" || !raw.owner.trim()) return { error: "board.json needs \"owner\": the GitHub org or user that owns the project" };
  if (!Number.isInteger(raw.project) || raw.project < 1) return { error: "board.json needs \"project\": the project number (an integer)" };
  return { cfg: { ...raw, pollSeconds: Math.max(15, Number(raw.pollSeconds) || POLL) } };
}

const QUERY = `query($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id type updatedAt
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        area: fieldValueByName(name: "Area") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content {
          ... on DraftIssue { title }
          ... on PullRequest { title number url state repository { nameWithOwner } }
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
    status: n.status?.name ?? null, priority: n.priority?.name ?? null, area: n.area?.name ?? null, updatedAt: n.updatedAt ?? null,
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

// ---- live agents ----

const labelsOf = (t) => Array.isArray(t.labels)
  ? Object.fromEntries(t.labels.map((l) => { const i = String(l).indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }))
  : (t.labels ?? {});

// Unlabelled live claude terminals on this computer, matched read-only to an open issue: by a "#N" token in the
// terminal title, else by N as a whole number in its space's branch (the space's name must fit the repo when it names one).
// Returns the terminals, matched ones carrying matched: {key, by}. Never writes a label.
export function linkTerminals(terminals, items, spaces) {
  const open = (items ?? []).filter((it) => it.number && !it.epic && !isDone(it));
  const shorts = new Set(open.map((it) => it.repo?.split("/").pop().toLowerCase()));
  const byNumber = (n, space) => {
    const name = space?.name?.toLowerCase();
    const ok = (it) => !shorts.has(name) || it.repo.split("/").pop().toLowerCase() === name;
    return open.find((it) => it.number === n && ok(it));
  };
  return (terminals ?? []).map((t) => {
    if (t.state && t.state !== "live") return t;
    if (labelsOf(t).card || String(t.address).includes("/") || t.app !== "claude-code") return t;
    const space = (spaces ?? []).find((s) => s.id === labelsOf(t)["herdr.space"]);
    for (const m of String(t.title ?? "").matchAll(/(?<![\w#])#(\d+)(?!\d)/g)) {
      const it = byNumber(Number(m[1]), space);
      if (it) return { ...t, matched: { key: it.key, by: "title" } };
    }
    for (const m of String(space?.branch ?? "").matchAll(/(?<!\d)\d+(?!\d)/g)) {
      const it = byNumber(Number(m[0]), space);
      if (it) return { ...t, matched: { key: it.key, by: "branch" } };
    }
    return t;
  });
}

// live terminals labelled card=<owner/repo>#<N> (else matched by linkTerminals, only where nothing is labelled),
// by lowercased key -> [{address, status, card, matched?}]
export function cardAgents(terminals) {
  const out = new Map(), guess = new Map();
  const add = (map, key, a) => { if (!map.has(key)) map.set(key, []); map.get(key).push(a); };
  for (const t of terminals ?? []) {
    if (t.state && t.state !== "live") continue;
    const status = STATUSES.has(t.status) ? t.status : "idle";
    const card = labelsOf(t).card;
    if (card) add(out, card.toLowerCase(), { address: t.address, status, card });
    else if (t.matched) add(guess, t.matched.key.toLowerCase(), { address: t.address, status, card: t.matched.key, matched: t.matched.by, seq: t.seq ?? 0 });
  }
  for (const [k, a] of guess) {
    if (out.has(k)) continue;
    out.set(k, a.sort((x, y) => (x.matched === "title" ? 0 : 1) - (y.matched === "title" ? 0 : 1) || y.seq - x.seq));
  }
  return out;
}

// the last n non-empty lines of a screen, trimmed, each at most 120 chars
export function excerpt(text, n = 3) {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-n)
    .map((l) => (l.length > 120 ? l.slice(0, 119) + "…" : l));
}

export function liveSummary(terminals) {
  const all = [...cardAgents(terminals).values()].flat();
  const blocked = all.filter((a) => a.status === "blocked").length;
  return `${all.length} agent${all.length === 1 ? "" : "s"}${blocked ? ` · ${blocked} blocked` : ""}`;
}

// ---- lanes ----

const isDone = (it) => it.status === "Done" || it.state === "CLOSED" || it.state === "MERGED";
const agentsOf = (it, agents) => agents.get(String(it.key).toLowerCase()) ?? [];

// live beats stale: a blocked agent needs you, a working (or just finished) one is running, whatever GitHub says
export function laneOf(it, agents) {
  const a = agentsOf(it, agents);
  if (a.some((x) => x.status === "blocked")) return "needs";
  if (isDone(it)) return "done";
  if (a.some((x) => x.status === "working" || x.status === "done")) return "running";
  if (NEEDS.has(it.status)) return "needs";
  if (it.status === "In progress") return "running";
  return "next";
}

function toRow(it, agents) {
  const a = agentsOf(it, agents);
  return { ...it, agents: a, asking: a.find((x) => x.status === "blocked")?.address ?? null,
    noAgent: it.status === "In progress" && !a.length, notOnBoard: false };
}

// agents whose card is no fetched item: a dim row built from the label
function orphanRows(items, agents) {
  const known = new Set(items.map((it) => String(it.key).toLowerCase()));
  return [...agents.entries()].filter(([k]) => !known.has(k)).map(([, a]) => {
    const card = a[0].card;
    const m = /^(.+)#(\d+)$/.exec(card);
    return { key: card, title: card, number: m ? Number(m[2]) : null, url: m ? `https://github.com/${m[1]}/issues/${m[2]}` : null,
      repo: m?.[1] ?? null, state: null, status: null, priority: null, area: null, updatedAt: null, type: "Issue", prs: [], parent: null,
      subIssues: null, epic: false, agents: a, asking: a.find((x) => x.status === "blocked")?.address ?? null, noAgent: false, notOnBoard: true };
  });
}

const PRANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));
const prank = (p) => PRANK[p] ?? PRIORITIES.length;
const newestFirst = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
const byRow = (a, b) => (!!b.asking - !!a.asking) || prank(a.priority) - prank(b.priority) || newestFirst(a, b);
const NEXT_ORDER = { Next: 0, Ready: 1 };
const byNext = (a, b) => (NEXT_ORDER[a.status] ?? 2) - (NEXT_ORDER[b.status] ?? 2) || byRow(a, b);

const LANES = [
  { key: "needs", label: "Needs you", empty: "Nothing needs you.", sort: byRow },
  { key: "running", label: "Running", empty: "Nothing running.", sort: byRow },
  { key: "next", label: "Up next", empty: "Queue is empty.", sort: byNext },
];
const DONE_LANE = { key: "done", label: "Done (not archived)", empty: "—", sort: newestFirst };

const prioLabel = (p) => (PRANK[p] === undefined ? "unset" : p);

// rows the priority chips leave out, counted: {count, label} | null. Rows with a live agent are never hidden.
function chipSplit(rows, ui, open) {
  if (open) return { shown: rows, more: null };
  const on = new Set(ui.priorities);
  const shown = [], hidden = [];
  for (const r of rows) (r.agents.length || on.has(PRANK[r.priority] === undefined ? "" : r.priority) ? shown : hidden).push(r);
  if (!hidden.length) return { shown, more: null };
  const names = [...PRIORITIES, "unset"].filter((n) => hidden.some((r) => prioLabel(r.priority) === n));
  return { shown, more: { count: hidden.length, label: `+${hidden.length} more at ${names.join(" / ")} · show` } };
}

function groupRows(rows, items) {
  const groups = new Map();
  for (const r of rows) {
    const k = r.parent?.key ?? null;
    if (!groups.has(k)) {
      const e = k && items.find((x) => x.key === k);
      groups.set(k, { epic: k ? { key: k, title: e?.title ?? r.parent.title, completed: e?.subIssues?.completed ?? null, total: e?.subIssues?.total ?? null } : null, rows: [] });
    }
    groups.get(k).rows.push(r);
  }
  const none = groups.get(null);
  groups.delete(null);
  return [...groups.values(), ...(none ? [none] : [])];
}

function laneSets(rows, agents) {
  const by = { needs: [], running: [], next: [], done: [] };
  for (const r of rows) by[r.notOnBoard ? (r.asking ? "needs" : "running") : laneOf(r, agents)].push(r);
  return by;
}

const filtered = (r, ui) => (!ui.area || r.area === ui.area) && (!ui.repo || r.repo === ui.repo) && (!ui.live || r.agents.length > 0);

// Today: three lanes over open, non-epic items (plus agents on issues not on the board), with the view's filters
export function todayView(items, terminals, ui) {
  const agents = cardAgents(terminals);
  const rows = [...items.filter((it) => !it.epic && !isDone(it)).map((it) => toRow(it, agents)), ...orphanRows(items, agents)]
    .filter((r) => filtered(r, ui));
  const by = laneSets(rows, agents);
  return {
    lanes: LANES.map((l) => {
      const all = by[l.key].sort(l.sort);
      const { shown, more } = chipSplit(all, ui, !!ui.showLow?.[l.key]);
      return { key: l.key, label: l.label, empty: l.empty, rows: shown, total: all.length, more, ...(ui.group ? { groups: groupRows(shown, items) } : {}) };
    }),
  };
}

// Focus: Needs you only, every priority and area, blocked agents first
export function focusView(items, terminals) {
  const needs = todayView(items, terminals, { ...defaultUi(), priorities: [...PRIORITIES, ""] }).lanes[0];
  return { lanes: [{ ...needs, more: null }] };
}

export function needsCount(items, terminals) {
  return focusView(items, terminals).lanes[0].total;
}

// Epics: one row per open epic with its health
export function epicsView(items, terminals, now) {
  const agents = cardAgents(terminals);
  const rows = items.filter((e) => e.epic && e.state === "OPEN").map((e) => {
    const kids = items.filter((it) => it.parent?.key === e.key);
    const counts = { needs: 0, running: 0, next: 0 };
    for (const k of kids) { const l = laneOf(k, agents); if (l in counts) counts[l]++; }
    const touched = kids.map((k) => k.updatedAt).filter(Boolean).sort().pop() ?? e.updatedAt;
    const stuckDays = touched ? Math.floor((now - Date.parse(touched)) / DAY) : 0;
    const { total = 0, completed = 0 } = e.subIssues ?? {};
    return { ...toRow(e, agents), total, completed, percent: e.subIssues?.percentCompleted ?? (total ? Math.round((100 * completed) / total) : 0),
      counts, touched, stuckDays, stuck: stuckDays > 14 };
  });
  rows.sort((a, b) => (b.counts.needs > 0) - (a.counts.needs > 0) || b.stuck - a.stuck || a.percent - b.percent);
  return { rows };
}

// one epic: every child, all priorities, no filters; Done collapsed unless opened
export function drillView(items, terminals, epicKey, ui) {
  const e = items.find((it) => it.key === epicKey);
  if (!e) return null;
  const agents = cardAgents(terminals);
  const by = laneSets(items.filter((it) => it.parent?.key === epicKey).map((it) => toRow(it, agents)), agents);
  const lanes = [...LANES, DONE_LANE].map((l) => {
    const all = by[l.key].sort(l.sort);
    const collapsed = l.key === "done" && !ui.doneOpen;
    return { key: l.key, label: l.label, empty: l.empty, rows: collapsed ? [] : all, total: all.length, more: null, ...(l.key === "done" ? { collapsed } : {}) };
  });
  const archived = Math.max(0, (e.subIssues?.completed ?? 0) - by.done.length);
  return { epic: toRow(e, agents), lanes, archived, footer: `${archived} done sub-issues archived, not listed (progress counts them).` };
}

const DONE_LIMIT = 8;

// Status: one column per GitHub Status in pipeline order, epics excluded
export function statusView(items, terminals, ui) {
  const agents = cardAgents(terminals);
  const rows = items.filter((it) => !it.epic).map((it) => toRow(it, agents)).filter((r) => filtered(r, ui));
  const col = (status, all) => {
    if (status === "Done") {
      all.sort(newestFirst);
      const open = !!ui.showLow?.Done || all.length <= DONE_LIMIT;
      return { status, rows: open ? all : all.slice(0, DONE_LIMIT), total: all.length, empty: "—",
        more: open ? null : { count: all.length - DONE_LIMIT, label: `+${all.length - DONE_LIMIT} more done · show` } };
    }
    const { shown, more } = chipSplit(all.sort(byRow), ui, !!ui.showLow?.[status]);
    return { status, rows: shown, total: all.length, empty: "—", more };
  };
  const columns = PIPELINE.map((s) => col(s, rows.filter((r) => (s === "Done" ? isDone(r) : !isDone(r) && r.status === s))));
  const other = rows.filter((r) => !isDone(r) && !PIPELINE.includes(r.status));
  if (other.length) columns.push(col("No status", other));
  return { columns };
}

// Search: every fetched item, tokens ANDed over title, #number, area, repo and parent epic title
export function searchView(items, terminals, query) {
  const agents = cardAgents(terminals);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = items.filter((it) => {
    const hay = [it.title, it.number ? `#${it.number}` : "", it.area ?? "", it.repo ?? "", it.parent?.title ?? ""].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  }).map((it) => toRow(it, agents)).sort((a, b) => prank(a.priority) - prank(b.priority) || newestFirst(a, b));
  const groups = [
    { key: "epics", label: "Epics", rows: hits.filter((r) => r.epic) },
    { key: "open", label: "Open", rows: hits.filter((r) => !r.epic && !isDone(r)) },
    { key: "closed", label: "Closed / Done", rows: hits.filter((r) => !r.epic && isDone(r)) },
  ].filter((g) => g.rows.length);
  return { groups, count: `${hits.length} of ${items.length}`, empty: hits.length ? null : `No match in ${items.length} items.` };
}

// a view's lanes as the list main.js draws and moves through; only "row"s are selectable
export function flatten(view) {
  const out = [];
  for (const l of view.lanes) {
    out.push({ kind: "lane", key: `lane:${l.key}`, lane: l });
    if (l.collapsed) continue;
    const groups = l.groups ?? [{ epic: undefined, rows: l.rows }];
    for (const g of groups) {
      if (g.epic !== undefined) out.push({ kind: "group", key: `group:${l.key}:${g.epic?.key ?? "none"}`, group: g });
      for (const r of g.rows) out.push({ kind: "row", key: r.key, row: r, lane: l.key });
    }
    if (l.more) out.push({ kind: "more", key: `more:${l.key}`, lane: l.key, more: l.more });
    else if (!l.rows.length) out.push({ kind: "empty", key: `empty:${l.key}`, text: l.empty });
  }
  return out;
}

// ---- acting on a row ----

const pickAgent = (row) => row.asking ?? row.agents.find((a) => a.status === "working")?.address ?? row.agents[0]?.address ?? null;
const pickPr = (row) => [...(row.prs ?? [])].sort((a, b) => (b.state === "OPEN") - (a.state === "OPEN") || b.number - a.number)[0] ?? null;

// Agent / Issue / PR; one without a target has no run/exec (drawn disabled). Never a merge.
export function rowButtons(row) {
  const agent = pickAgent(row), pr = pickPr(row);
  return [
    { key: "a", label: "Agent", ...(agent ? { run: ["agent.focus", { terminal: agent }] } : {}) },
    { key: "i", label: "Issue", ...(row.url ? { exec: ["open", [row.url]] } : {}) },
    { key: "p", label: "PR", ...(pr?.url ? { exec: ["open", [pr.url]] } : {}) },
  ];
}

// Enter: the live agent (peeked in Focus, focused otherwise), else the issue
export function primaryAction(row, { focus }) {
  const agent = pickAgent(row);
  if (agent) return { run: [focus ? "terminal.peek" : "agent.focus", { terminal: agent }] };
  return row.url ? { exec: ["open", [row.url]] } : null;
}

// ---- starting /work on an issue that has no agent ----

// board.json "repoPaths" ({"<owner/repo>": "<path>"}, ~ expanded), else ~/workspace/vasu/<repo name>
export function repoFolder(repo, cfg, home) {
  const p = cfg?.repoPaths?.[repo] ?? `~/workspace/vasu/${repo.split("/").pop()}`;
  return p === "~" || p.startsWith("~/") ? home + p.slice(1) : p;
}

// ~/handoffs/areas.txt lines "<repo-name> <desk>" -> the desk of a repo, or null
export function deskFor(repo, areasText) {
  const name = repo.split("/").pop();
  for (const line of String(areasText ?? "").split("\n")) {
    const [n, desk] = line.trim().split(/\s+/);
    if (n && !n.startsWith("#") && n === name && desk) return desk;
  }
  return null;
}

const NOTES_MAX = 2000;

// Labels the terminal card=<key> before claude starts, so the board shows the agent at once.
// The prompt is a positional arg ($2), never interpolated into the script.
const LABEL_THEN_CLAUDE = 'hc label "$HC_TERMINAL_ID" "card=$1" >/dev/null 2>&1; exec claude "$2"';
const QUICK_RULES = "Do only what is asked (for example close it, mark it a duplicate, comment, or edit it with gh). No worktree, no branch, no PR.";

const BRIEF_RULES = (n) => `Read-only: change nothing on GitHub or in code. Cover, in short sections:
1. What it is: the problem in plain words and its acceptance criteria.
2. Where it stands: status, priority, epic, linked PRs (state, checks, review), any branch or worktree for it.
3. Previous work: the issue's comments (including /work phase comments), commits mentioning it, and past Claude sessions that discussed it (rg -l -F '#${n}' ~/.claude/projects, then read the relevant ones).
4. Validation: for each acceptance criterion, met on main / not met / can't tell, with the file or test that shows it.
5. Next step: one recommendation (/work it, close, mark duplicate, ask someone) with the exact command.
Then wait for my instruction.`;

// argv for the agent. mode "work" (default): /work <key> plus notes; "quick": no /work, just the issue and the notes;
// "brief": a read-only catch-up report.
export function startArgv(key, notes, { mode = "work", title = "", url = "" } = {}) {
  const n = String(notes ?? "").trim().slice(0, NOTES_MAX);
  const prompt = mode === "brief"
    ? `Brief me on ${key}: ${title}\n${url}\n\n${n ? `Focus on: ${n}\n\n` : ""}${BRIEF_RULES(key.split("#").pop())}`
    : mode === "quick"
    ? `Issue ${key}: ${title}\n${url}\n\n${n ? `Do this: ${n}` : "Read it and ask me what to do."}\n\n${QUICK_RULES}`
    : n ? `/work ${key}\n\nNotes from Vasu: ${n}` : `/work ${key}`;
  return ["sh", "-c", LABEL_THEN_CLAUDE, "sh", key, prompt];
}

// What `a` does on an issue with no live agent: focus a card terminal that exists (even not live),
// else ask once (confirm), then {action: "start", step} or {action: "error"}. opts: {confirmed, pending, exists, notes, mode}.
export function startPlan(issue, terminals, areasText, cfg, home, { confirmed = false, pending = new Set(), exists = () => true, notes = "", mode = "work" } = {}) {
  if (issue.epic || !issue.repo || !issue.number) return { action: "none" };
  const key = issue.key.toLowerCase();
  const held = (terminals ?? []).find((t) => labelsOf(t).card?.toLowerCase() === key);
  if (held) return { action: "focus", terminal: held.address };
  const matched = cardAgents(terminals).get(key)?.[0];
  if (matched) return { action: "focus", terminal: matched.address };
  if (pending.has(issue.key)) return { action: "none" };
  if (!confirmed) return { action: "confirm", title: `Start /work on ${issue.key}?`, detail: issue.title };
  const folder = repoFolder(issue.repo, cfg, home);
  if (!exists(folder)) return { action: "error", message: `Folder ${folder} does not exist (set repoPaths in board.json)` };
  const desk = deskFor(issue.repo, areasText);
  const space = desk && (terminals ?? []).map((t) => labelsOf(t)).find((l) => l.desk === desk && l["herdr.space"])?.["herdr.space"];
  const short = issue.title.length > 24 ? `${issue.title.slice(0, 23)}…` : issue.title;
  const name = mode === "quick" || mode === "brief" ? `#${issue.number} ${mode}` : `#${issue.number} ${short}`;
  const argv = startArgv(issue.key, notes, { mode, title: issue.title, url: issue.url });
  return { action: "start", step: space ? ["tab.new", { space, folder, name, argv }]
    : ["space.new", { name: desk ?? issue.repo.split("/").pop(), folder, tab: name, argv }] };
}

// ---- keyboard ----

const KEYS = {
  "/": "search", escape: "escape", j: "down", down: "down", k: "up", up: "up", "shift-j": "down5", "shift-k": "up5",
  enter: "primary", a: "agent", i: "issue", p: "pr", t: "today", e: "epics", s: "status", left: "back", backspace: "back",
  0: "prio:P0", 1: "prio:P1", 2: "prio:P2", 3: "prio:P3", 4: "prio:P4", 5: "allprio",
  g: "group", l: "live", "shift-r": "refresh", n: "needs", "shift-f": "focus",
};
export const keyAction = (keystroke) => KEYS[keystroke] ?? null;

// Esc closes one thing: the search, then Focus, then the drill-down; with nothing left it leaves the board
export function escapeStep(ui) {
  if (ui.query) return { ui: { ...ui, query: "" } };
  if (ui.focus) return { ui: { ...ui, focus: false } };
  if (ui.view === "epic") return { ui: { ...ui, view: "epics", epic: null } };
  return { leave: true };
}

export const defaultUi = () => ({ view: "today", epic: null, priorities: ["P0", "P1", "P2"], area: null, repo: null, group: false, live: false, focus: false, query: "", showLow: {}, doneOpen: false });

export function moveSel(keys, sel, delta) {
  if (!keys.length) return null;
  const i = keys.indexOf(sel);
  if (i < 0) return keys[0];
  return keys[Math.min(keys.length - 1, Math.max(0, i + delta))];
}

// the selected key if still listed, else whatever now sits at its old index
export function resolveSel(keys, sel, lastIndex) {
  if (keys.includes(sel)) return sel;
  return keys.length ? keys[Math.min(Math.max(0, lastIndex), keys.length - 1)] : null;
}

export function afterPeek(keys, key) {
  if (!keys.length) return null;
  const i = keys.indexOf(key);
  return i < 0 ? keys[0] : keys[Math.min(i + 1, keys.length - 1)];
}

const sum = (h, from, to) => { let s = 0; for (let i = from; i <= to; i++) s += h[i]; return s; };

// first drawn item so item `sel` is fully in a viewport of `vp` px
export function scrollTop(h, top, sel, vp) {
  if (sel < top) return sel;
  let t = top;
  while (t < sel && sum(h, t, sel) > vp) t++;
  return t;
}

// keep a wheel-moved top inside the list: never past where the last items fill the viewport
export function clampTop(h, top, vp) {
  let max = h.length;
  while (max > 0 && sum(h, max - 1, h.length - 1) <= vp) max--;
  return Math.max(0, Math.min(top, max));
}

// ---- the Board space ----

export const badgeName = (n) => (n ? `Board · ${n}` : "Board");

export function renameStep(space, n) {
  if (!space) return null;
  const name = badgeName(n);
  return space.name === name ? null : ["space.rename", { id: space.id, name }];
}

export const boardSpace = (spaces) => spaces.find((s) => /^Board( · \d+)?$/.test(s.name)) ?? null;

const boardTabIn = (space, panes, mod) => space.tabs.find((t) => panes.some((p) => p.mod === mod && p.tab === t.id)) ?? null;

// the board's tab in the Board space (made if missing), the space's starting shell tab closed, stray board-only tabs elsewhere closed, the space first
export function ensureBoard({ spaces, panes, mod, shellTabs = [] }) {
  const board = boardSpace(spaces);
  if (!board) return [];
  const tab = boardTabIn(board, panes, mod);
  if (!tab) return [["tab.new", { space: board.id, name: "Board", mod }], ...(board.index !== 1 ? [["space.move", { id: board.id, index: 1 }]] : [])];
  const steps = [["tab.select", { id: tab.id }]];
  for (const id of shellTabs) if (id !== tab.id && board.tabs.some((t) => t.id === id)) steps.push(["tab.close", { id, confirmed: true }]);
  for (const s of spaces) if (s.id !== board.id) for (const t of s.tabs) {
    if (t.panes === 1 && panes.some((p) => p.mod === mod && p.tab === t.id)) steps.push(["tab.close", { id: t.id, confirmed: true }]);
  }
  if (board.index !== 1) steps.push(["space.move", { id: board.id, index: 1 }]);
  return steps;
}

// cmd-shift-b: to the board (remembering where you were), or back from it -> {steps, from}
export function toggleBoard({ spaces, panes, focused, from, mod, shellTabs = [] }) {
  const board = boardSpace(spaces);
  if (board && focused?.space === board.id) {
    const back = from && spaces.find((s) => s.id === from.space && s.id !== board.id);
    if (!back) return { steps: [], from };
    return { steps: [["space.select", { id: back.id }], ...(back.tabs.some((t) => t.id === from.tab) ? [["tab.select", { id: from.tab }]] : [])], from };
  }
  const here = focused ? { space: focused.space, tab: focused.tab } : from;
  if (!board) return { steps: [["space.new", { name: "Board" }]], from: here };
  return { steps: [["space.select", { id: board.id }], ...ensureBoard({ spaces, panes, mod, shellTabs })], from: here };
}

// ---- freshness ----

export const shouldRefreshOnShow = (was, is, lastRead, now) => !was && is && (lastRead == null || now - lastRead >= 60000);

export function syncLabel({ now, read, fetching, count, error }) {
  if (fetching) return { label: count ? `fetching ${count} items…` : "fetching items…", stale: false, banner: null };
  const m = read == null ? null : Math.floor((now - read) / 60000);
  if (error) return { label: m == null ? "not synced" : `last ok ${m}m ago`, stale: true,
    banner: `GitHub fetch failed (${error}) · ${m == null ? "no data yet" : `showing data from ${m} min ago`} · retry (Shift-R)` };
  if (m == null) return { label: "", stale: false, banner: null };
  if (m > 10) return { label: `stale ${m}m`, stale: true, banner: null };
  return { label: m < 1 ? "synced just now" : `synced ${m}m ago`, stale: false, banner: null };
}

export function ageText(now, iso) {
  if (!iso) return "";
  const s = (now - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function facets(items) {
  const uniq = (f) => [...new Set(items.map(f).filter(Boolean))].sort();
  return { areas: uniq((it) => it.area), repos: uniq((it) => it.repo) };
}

// ---- tab marks: "● #N title" on tabs whose terminal is labelled card=<owner/repo>#<N> ----

const MARK = "● #";
const markName = (card, items) => {
  const m = /^(.+)#(\d+)$/.exec(card);
  const it = (items ?? []).find((i) => i.repo?.toLowerCase() === m[1].toLowerCase() && String(i.number) === m[2]);
  const t = it?.title ?? "";
  return `${MARK}${m[2]}${t ? ` ${t.length > 22 ? t.slice(0, 22) + "…" : t}` : ""}`;
};

// terminals + tabs + remembered previous names -> the renames to make and the records to keep
export function tabMarks({ terminals, tabs, records, items }) {
  const linked = new Map(); // tab id -> card, from the lowest-addressed live local terminal
  for (const t of [...(terminals ?? [])].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))) {
    if (t.state && t.state !== "live") continue;
    if (String(t.address).includes("/")) continue;
    const l = labelsOf(t);
    if (!l["herdr.tab"] || !/^.+#\d+$/.test(l.card ?? "") || linked.has(l["herdr.tab"])) continue;
    linked.set(l["herdr.tab"], l.card);
  }
  const renames = [], out = {};
  for (const tab of tabs ?? []) {
    const rec = records?.[tab.id], card = linked.get(tab.id);
    if (rec && !tab.name.startsWith(`${MARK}${/#(\d+)$/.exec(rec.card)[1]}`)) continue; // renamed by hand: let go
    if (!card) {
      if (rec) renames.push({ tab: tab.id, name: rec.prevNamed ? rec.prevName : "" });
      continue;
    }
    const name = markName(card, items);
    out[tab.id] = rec ? { ...rec, card } : tab.name.startsWith(MARK)
      ? { card, prevNamed: false, prevName: "" }
      : { card, prevNamed: !!tab.named, prevName: tab.name };
    if (tab.name !== name) renames.push({ tab: tab.id, name });
  }
  return { renames, records: out };
}

// ---- Now: the issues with a live agent, on top of every view ----

// flat entries (a lane, then rows keyed "now:<key>"): blocked first, then working, then done/idle; [] when none
export function nowFlat(items, terminals) {
  const agents = cardAgents(terminals);
  const rank = (r) => (r.asking ? 0 : r.agents.some((a) => a.status === "working") ? 1 : 2);
  const rows = [...items.filter((it) => !it.epic).map((it) => toRow(it, agents)), ...orphanRows(items, agents)]
    .filter((r) => r.agents.length).sort((a, b) => rank(a) - rank(b) || byRow(a, b));
  if (!rows.length) return [];
  return flatten({ lanes: [{ key: "now", label: "Now", rows, total: rows.length }] })
    .map((x) => (x.kind === "row" ? { ...x, key: `now:${x.key}`, row: { ...x.row, key: `now:${x.row.key}` } } : x));
}

// ---- where you have been, for the space toggle ----

export function pushHistory(history, focused) {
  if (!focused?.space || !focused.tab || String(focused.space).includes("/") || String(focused.tab).includes("/")) return history;
  const here = { space: focused.space, tab: focused.tab };
  if (history[0]?.space === here.space && history[0]?.tab === here.tab) return history;
  return [here, ...history.filter((h) => h.space !== here.space || h.tab !== here.tab)].slice(0, 10);
}
