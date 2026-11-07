// Behavior tests for the board's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/zaksha-board/
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseConfig, fetchAll, cardAgents, excerpt, single, defaultUi, laneOf, todayView, epicsView, drillView, statusView,
  searchView, focusView, needsCount, flatten, rowButtons, primaryAction, keyAction, escapeStep, badgeName, renameStep,
  boardSpace, toggleBoard, ensureBoard, shouldRefreshOnShow, syncLabel, ageText, liveSummary, moveSel, resolveSel, afterPeek,
  scrollTop, clampTop, facets, startPlan, startArgv, repoFolder, deskFor, tabMarks, linkTerminals, nowFlat, pushHistory, startMode,
} from "./lib.js";
import { dialogKey, dialogTitle } from "../zaksha-board-start/lib.js";

const CFG = { owner: "acme", project: 7, pollSeconds: 300 };
const NOW = Date.parse("2026-03-01T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

// ---- fetch fixtures (GraphQL shape) ----

let seq = 0;
const node = (o = {}) => ({
  id: `PVTI_${++seq}`, type: "ISSUE", updatedAt: o.updatedAt ?? "2026-01-01T00:00:00Z",
  status: o.status === null ? null : { name: o.status ?? "Next" },
  priority: o.priority === null ? null : { name: o.priority ?? "P1" },
  area: o.area === undefined ? null : { name: o.area },
  content: {
    title: o.title ?? `Synthetic task ${seq}`, state: o.state ?? "OPEN", number: o.number ?? seq, url: `https://github.com/acme/widgets/issues/${o.number ?? seq}`,
    repository: { nameWithOwner: o.repo ?? "acme/widgets" },
    closedByPullRequestsReferences: { nodes: o.prs ?? [] },
    ...(o.parent !== undefined ? { parent: o.parent } : {}),
    ...(o.sub !== undefined ? { subIssuesSummary: o.sub } : {}),
  },
});
const page = (nodes, hasNextPage = false, endCursor = null) =>
  ({ code: 0, stdout: JSON.stringify({ data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage, endCursor }, nodes } } } } }), stderr: "" });

// ---- board fixtures (items as fetchAll returns them) ----

const it = (n, o = {}) => ({
  key: `${o.repo ?? "acme/widgets"}#${n}`, title: o.title ?? `Synthetic ${n}`, number: n, url: `https://github.com/${o.repo ?? "acme/widgets"}/issues/${n}`,
  repo: o.repo ?? "acme/widgets", state: o.state ?? "OPEN", status: o.status === undefined ? "Next" : o.status,
  priority: o.priority === undefined ? "P1" : o.priority, area: o.area ?? null, updatedAt: o.updatedAt ?? daysAgo(1),
  type: o.type ?? "Issue", prs: o.prs ?? [], parent: o.parent ?? null, subIssues: o.sub ?? null, epic: !!o.sub && o.sub.total > 0,
});
const epic = (n, o = {}) => it(n, { status: "In progress", sub: { total: 4, completed: 1, percentCompleted: 25 }, ...o });
const childOf = (e) => ({ key: e.key, number: e.number, title: e.title, url: e.url });
const term = (address, card, status = "working", extra = {}) => ({ address, state: "live", status, labels: card ? { card } : {}, ...extra });
const keys = (rows) => rows.map((r) => r.number);
const lane = (view, key) => view.lanes.find((l) => l.key === key);

// ---- config ----

test("a missing board.json is reported as missing, not as an error", () => {
  assert.deepEqual(parseConfig(null), { missing: true });
});

test("board.json needs only owner and project; pollSeconds defaults to 300 (5 minutes)", () => {
  const r = parseConfig(JSON.stringify({ owner: "acme", project: 7 }));
  assert.equal(r.error, undefined);
  assert.equal(r.cfg.pollSeconds, 300);
});

test("broken JSON or a missing owner/project is an error the person can read", () => {
  assert.match(parseConfig("{ nope").error, /board\.json/);
  assert.match(parseConfig(JSON.stringify({ project: 7 })).error, /owner/);
  assert.match(parseConfig(JSON.stringify({ owner: "acme" })).error, /project/);
});

test("pollSeconds below 15 is raised to 15 so the API isn't hammered", () => {
  assert.equal(parseConfig(JSON.stringify({ ...CFG, pollSeconds: 1 })).cfg.pollSeconds, 15);
});

// ---- fetching: one paginated query ----

test("fetchAll follows every page, 100 at a time, until GitHub says there are no more", async () => {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const after = args.find((a) => a.startsWith("after="));
    if (!after) return page([node(), node()], true, "C1");
    if (after === "after=C1") return page([node()], true, "C2");
    return page([node()], false, null);
  };
  const r = await fetchAll(gh, CFG);
  assert.equal(r.items.length, 4);
  assert.equal(r.truncated, null);
  assert.equal(calls.length, 3);
  for (const a of calls) {
    assert.equal(a[0], "api"); assert.equal(a[1], "graphql");
    assert.ok(a.some((x) => /first:\s*100/.test(x)), "asks for 100 per page");
    assert.ok(a.includes("owner=acme")); assert.ok(a.includes("number=7"));
  }
});

test("the query asks for Area, issue and PR state, parent and sub-issue summary", async () => {
  let q = "";
  await fetchAll(async (args) => { q = args.find((a) => a.startsWith("query=")); return page([]); }, CFG);
  assert.match(q, /area:\s*fieldValueByName\(name:\s*"Area"\)/);
  assert.match(q, /parent\s*\{\s*number\s+title\s+url\s*\}/);
  assert.match(q, /subIssuesSummary\s*\{\s*total\s+completed\s+percentCompleted\s*\}/);
  assert.match(q, /PullRequest\s*\{[^}]*state/);
  assert.match(q, /Issue\s*\{[^}]*state/);
});

test("an item carries key, title, number, url, repo, state, status, priority, area, updatedAt, type, PRs, parent and epic-ness", async () => {
  const pr = { number: 99, url: "https://github.com/acme/widgets/pull/99", state: "OPEN" };
  const r = await fetchAll(async () => page([node({ number: 5, title: "Fake thing", status: "Ready", priority: "P0", area: "backend", prs: [pr], updatedAt: "2026-02-02T00:00:00Z" })]), CFG);
  assert.deepEqual(r.items[0], {
    key: "acme/widgets#5", title: "Fake thing", number: 5, url: "https://github.com/acme/widgets/issues/5", repo: "acme/widgets",
    state: "OPEN", status: "Ready", priority: "P0", area: "backend", updatedAt: "2026-02-02T00:00:00Z", type: "Issue", prs: [pr],
    parent: null, subIssues: null, epic: false,
  });
});

test("an issue with sub-issues is an epic; an issue with a parent knows its epic", async () => {
  const r = await fetchAll(async () => page([
    node({ number: 1, title: "Synthetic epic", sub: { total: 3, completed: 1, percentCompleted: 33 }, parent: null }),
    node({ number: 2, parent: { number: 1, title: "Synthetic epic", url: "https://github.com/acme/widgets/issues/1" }, sub: { total: 0, completed: 0, percentCompleted: 0 } }),
  ]), CFG);
  assert.equal(r.items[0].epic, true);
  assert.equal(r.items[1].epic, false);
  assert.deepEqual(r.items[1].parent, { key: "acme/widgets#1", number: 1, title: "Synthetic epic", url: "https://github.com/acme/widgets/issues/1" });
});

test("draft issues and pull requests are typed and keep what they have", async () => {
  const d = { id: "PVTI_d", type: "DRAFT_ISSUE", updatedAt: "2026-01-01T00:00:00Z", status: { name: "Next" }, priority: { name: "P2" }, content: { title: "Draft idea" } };
  const pull = { ...node({ number: 12, state: "MERGED" }), type: "PULL_REQUEST" };
  delete pull.content.closedByPullRequestsReferences;
  const r = await fetchAll(async () => page([d, pull]), CFG);
  assert.equal(r.items[0].type, "DraftIssue");
  assert.equal(r.items[0].url, null);
  assert.equal(r.items[1].type, "PullRequest");
  assert.equal(r.items[1].state, "MERGED");
  assert.deepEqual(r.items[1].prs, []);
});

test("a failed later page keeps what was read and says the board is truncated", async () => {
  let n = 0;
  const gh = async () => (n++ === 0 ? page([node()], true, "C1") : { code: 1, stdout: "", stderr: "HTTP 502: bad gateway\n" });
  const r = await fetchAll(gh, CFG);
  assert.equal(r.items.length, 1);
  assert.match(r.truncated, /502/);
  assert.equal(r.error, null);
});

test("a failed first page is an error, not an empty board; GraphQL errors count too", async () => {
  assert.match((await fetchAll(async () => ({ code: 1, stdout: "", stderr: "gh: not logged in\n" }), CFG)).error, /not logged in/);
  assert.match((await fetchAll(async () => ({ code: 0, stdout: JSON.stringify({ errors: [{ message: "Could not resolve to a ProjectV2" }] }), stderr: "" }), CFG)).error, /Could not resolve/);
});

test("pagination stops at a page cap, or on hasNextPage without a cursor, and says so", async () => {
  let n = 0;
  const capped = await fetchAll(async () => page([node()], true, `C${++n}`), CFG, { maxPages: 3 });
  assert.equal(capped.items.length, 3);
  assert.match(capped.truncated, /3 pages/);
  const nocursor = await fetchAll(async () => page([node()], true, null), CFG);
  assert.equal(nocursor.items.length, 1);
  assert.ok(nocursor.truncated);
});

test("single() runs one call at a time; calls while busy are dropped", async () => {
  let runs = 0, release;
  const f = single(() => { runs++; return new Promise((r) => { release = r; }); });
  const a = f(); const b = f();
  assert.equal(runs, 1);
  assert.equal(b, null);
  release("ok");
  assert.equal(await a, "ok");
  f();
  assert.equal(runs, 2);
});

// ---- live agents ----

test("terminals labelled card=<owner/repo>#<N> attach to that issue, several per issue; k=v arrays and any case work; finished ones don't", () => {
  const m = cardAgents([
    term("t1", "acme/widgets#4"), term("t2", "acme/widgets#4", "blocked"), term("t3", null),
    { address: "t5", state: "live", status: "idle", labels: ["herdr.tab=x", "card=Acme/Widgets#9"] },
    term("t6", "acme/widgets#9", "done", { state: "exited" }), term("t7", "acme/widgets#9", "weird"),
  ]);
  assert.deepEqual(m.get("acme/widgets#4").map((a) => [a.address, a.status]), [["t1", "working"], ["t2", "blocked"]]);
  assert.deepEqual(m.get("acme/widgets#9").map((a) => [a.address, a.status]), [["t5", "idle"], ["t7", "idle"]]);
});

test("excerpt keeps the last few non-empty lines, trimmed and shortened", () => {
  const ex = excerpt("first\n\n  second  \nthird\n\n" + "x".repeat(300) + "\n\n\n", 3);
  assert.deepEqual(ex.slice(0, 2), ["second", "third"]);
  assert.ok(ex[2].length <= 120 && ex[2].endsWith("…"));
  assert.deepEqual(excerpt(null, 3), []);
});

test("live summary: agents on issues and how many are blocked", () => {
  assert.equal(liveSummary([term("t1", "acme/widgets#1"), term("t2", "acme/widgets#2", "blocked"), term("t3", null)]), "2 agents · 1 blocked");
  assert.equal(liveSummary([term("t1", "acme/widgets#1")]), "1 agent");
  assert.equal(liveSummary([]), "0 agents");
});

// ---- lanes: live beats stale ----

test("lane by GitHub status: Blocked, Needs answer, Inbox need you; In progress runs; Next, Ready and the rest are up next; Done and closed are done", () => {
  const m = new Map();
  assert.equal(laneOf(it(1, { status: "Blocked" }), m), "needs");
  assert.equal(laneOf(it(2, { status: "Needs answer" }), m), "needs");
  assert.equal(laneOf(it(3, { status: "Inbox" }), m), "needs");
  assert.equal(laneOf(it(4, { status: "In progress" }), m), "running");
  assert.equal(laneOf(it(5, { status: "Next" }), m), "next");
  assert.equal(laneOf(it(6, { status: "Ready" }), m), "next");
  assert.equal(laneOf(it(7, { status: null }), m), "next");
  assert.equal(laneOf(it(8, { status: "Done" }), m), "done");
  assert.equal(laneOf(it(9, { status: "Ready", state: "CLOSED" }), m), "done");
});

test("live beats stale: a blocked agent makes an issue need you even if GitHub says In progress; a working agent makes a Next issue running", () => {
  const m = cardAgents([term("t1", "acme/widgets#1", "blocked"), term("t2", "acme/widgets#2", "working"), term("t3", "acme/widgets#3", "idle")]);
  assert.equal(laneOf(it(1, { status: "In progress" }), m), "needs");
  assert.equal(laneOf(it(2, { status: "Next" }), m), "running");
  assert.equal(laneOf(it(3, { status: "Next" }), m), "next", "an idle agent doesn't promote");
});

// ---- Today ----

test("Today: three lanes in reading order, no epics, no done or closed items", () => {
  const e = epic(100);
  const v = todayView([e, it(1, { status: "Ready" }), it(2, { status: "In progress" }), it(3, { status: "Inbox" }), it(4, { status: "Done" }), it(5, { state: "CLOSED" })], [], defaultUi());
  assert.deepEqual(v.lanes.map((l) => [l.key, l.label]), [["needs", "Needs you"], ["running", "Running"], ["next", "Up next"]]);
  assert.deepEqual(keys(lane(v, "needs").rows), [3]);
  assert.deepEqual(keys(lane(v, "running").rows), [2]);
  assert.deepEqual(keys(lane(v, "next").rows), [1]);
});

test("Today: blocked-agent issues sort first in Needs you and carry the asking terminal", () => {
  const v = todayView([it(1, { status: "Blocked", priority: "P0" }), it(2, { status: "In progress", priority: "P2" })], [term("t9", "acme/widgets#2", "blocked")], defaultUi());
  const rows = lane(v, "needs").rows;
  assert.deepEqual(keys(rows), [2, 1]);
  assert.equal(rows[0].asking, "t9");
  assert.equal(rows[1].asking, null);
});

test("Today: rows sort by priority (P0…P4, unset last), then most recently updated", () => {
  const v = todayView([
    it(1, { priority: "P2", updatedAt: daysAgo(1) }), it(2, { priority: "P0", updatedAt: daysAgo(5) }),
    it(3, { priority: "P2", updatedAt: daysAgo(0) }), it(4, { priority: null }), it(5, { priority: "P4" }),
  ], [], { ...defaultUi(), priorities: ["P0", "P1", "P2", "P3", "P4", ""] });
  assert.deepEqual(keys(lane(v, "next").rows), [2, 3, 1, 5, 4]);
});

test("Today: Up next lists Next before Ready, then by priority", () => {
  const v = todayView([it(1, { status: "Ready", priority: "P0" }), it(2, { status: "Next", priority: "P2" }), it(3, { status: "Next", priority: "P1" })], [], defaultUi());
  assert.deepEqual(keys(lane(v, "next").rows), [3, 2, 1]);
});

test("Today defaults to P0–P2; the rest is counted in a '+N more at …' line naming the hidden priorities", () => {
  const v = todayView([it(1, { priority: "P1" }), it(2, { priority: "P3" }), it(3, { priority: "P4" }), it(4, { priority: null })], [], defaultUi());
  const l = lane(v, "next");
  assert.deepEqual(keys(l.rows), [1]);
  assert.equal(l.total, 4);
  assert.deepEqual(l.more, { count: 3, label: "+3 more at P3 / P4 / unset · show" });
});

test("Today: the hidden line names only what it hides, and show expands that lane alone", () => {
  const items = [it(1, { priority: "P3" }), it(2, { status: "Inbox", priority: "P4" })];
  const v = todayView(items, [], defaultUi());
  assert.equal(lane(v, "next").more.label, "+1 more at P3 · show");
  const shown = todayView(items, [], { ...defaultUi(), showLow: { next: true } });
  assert.deepEqual(keys(lane(shown, "next").rows), [1]);
  assert.equal(lane(shown, "next").more, null);
  assert.equal(lane(shown, "needs").more.count, 1);
});

test("Today: an issue with a live agent shows whatever its priority (live is never hidden)", () => {
  const v = todayView([it(1, { status: "In progress", priority: "P4" })], [term("t1", "acme/widgets#1")], defaultUi());
  assert.deepEqual(keys(lane(v, "running").rows), [1]);
});

test("Today: an In-progress issue without an agent is marked as having no agent", () => {
  const v = todayView([it(1, { status: "In progress" }), it(2, { status: "In progress" })], [term("t1", "acme/widgets#2")], defaultUi());
  const rows = lane(v, "running").rows;
  assert.equal(rows.find((r) => r.number === 1).noAgent, true);
  assert.equal(rows.find((r) => r.number === 2).noAgent, false);
});

test("Today: an agent on an issue not in the fetch is a dim Running row built from its label, 'not on board'", () => {
  const v = todayView([it(1)], [term("t4", "other/repo#61", "idle")], defaultUi());
  const row = lane(v, "running").rows.find((r) => r.notOnBoard);
  assert.equal(row.key, "other/repo#61");
  assert.equal(row.title, "other/repo#61");
  assert.equal(row.number, 61);
  assert.deepEqual(row.agents.map((a) => a.address), ["t4"]);
});

test("Today: area and repo filters narrow rows; live-only keeps rows with agents", () => {
  const items = [it(1, { area: "pwa" }), it(2, { area: "ios" }), it(3, { area: "pwa", repo: "acme/site" })];
  assert.deepEqual(keys(lane(todayView(items, [], { ...defaultUi(), area: "pwa" }), "next").rows).sort(), [1, 3]);
  assert.deepEqual(keys(lane(todayView(items, [], { ...defaultUi(), repo: "acme/site" }), "next").rows), [3]);
  const live = todayView(items, [term("t1", "acme/widgets#2")], { ...defaultUi(), live: true });
  assert.deepEqual(v2keys(live), [2]);
});
const v2keys = (v) => v.lanes.flatMap((l) => keys(l.rows));

test("Today: empty lanes say so", () => {
  const v = todayView([], [], defaultUi());
  assert.deepEqual(v.lanes.map((l) => l.empty), ["Nothing needs you.", "Nothing running.", "Queue is empty."]);
});

test("Today grouped by epic: each lane's rows sit under epic headers with progress, then No epic", () => {
  const e = epic(100, { title: "Synthetic epic", sub: { total: 5, completed: 2, percentCompleted: 40 } });
  const v = todayView([e, it(1, { parent: childOf(e) }), it(2), it(3, { parent: childOf(e) })], [], { ...defaultUi(), group: true });
  const groups = lane(v, "next").groups;
  assert.deepEqual(groups.map((g) => g.epic ? [g.epic.title, g.epic.completed, g.epic.total] : null), [["Synthetic epic", 2, 5], null]);
  assert.deepEqual(groups.map((g) => keys(g.rows)), [[1, 3], [2]]);
});

test("needsCount: Needs-you issues across the whole board, whatever the view's filters", () => {
  const items = [it(1, { status: "Inbox", priority: "P4" }), it(2, { status: "Blocked" }), it(3, { status: "In progress" }), epic(100, { status: "Blocked" })];
  assert.equal(needsCount(items, [term("t1", "acme/widgets#3", "blocked")]), 3);
});

// ---- Epics ----

test("Epics: one row per open epic with progress, needs · run · next counts, area and last-touched age (newest child)", () => {
  const e = epic(100, { title: "Synthetic epic", area: "pwa", sub: { total: 6, completed: 2, percentCompleted: 33 }, updatedAt: daysAgo(30) });
  const closed = epic(101, { state: "CLOSED" });
  const items = [e, closed,
    it(1, { parent: childOf(e), status: "Blocked", updatedAt: daysAgo(9) }), it(2, { parent: childOf(e), status: "In progress", updatedAt: daysAgo(3) }),
    it(3, { parent: childOf(e), status: "Next", priority: "P4", updatedAt: daysAgo(6) }), it(4, { parent: childOf(e), status: "Done", updatedAt: daysAgo(1) })];
  const v = epicsView(items, [], NOW);
  assert.equal(v.rows.length, 1);
  const r = v.rows[0];
  assert.equal(r.key, e.key);
  assert.deepEqual([r.completed, r.total, r.percent], [2, 6, 33]);
  assert.deepEqual(r.counts, { needs: 1, running: 1, next: 1 });
  assert.equal(r.area, "pwa");
  assert.equal(r.touched, daysAgo(1));
  assert.equal(r.stuck, false);
});

test("Epics: no child update in more than 14 days is stuck; sorted needs-you first, then stuck, then least complete", () => {
  const a = epic(100, { sub: { total: 4, completed: 3, percentCompleted: 75 } });
  const b = epic(101, { sub: { total: 4, completed: 1, percentCompleted: 25 } });
  const c = epic(102, { sub: { total: 4, completed: 2, percentCompleted: 50 } });
  const d = epic(103, { sub: { total: 4, completed: 0, percentCompleted: 0 } });
  const items = [a, b, c, d,
    it(1, { parent: childOf(a), status: "Inbox", updatedAt: daysAgo(1) }),
    it(2, { parent: childOf(b), updatedAt: daysAgo(2) }),
    it(3, { parent: childOf(c), updatedAt: daysAgo(15) }),
    it(4, { parent: childOf(d), updatedAt: daysAgo(3) })];
  const v = epicsView(items, [], NOW);
  assert.deepEqual(v.rows.map((r) => r.number), [100, 102, 103, 101]);
  assert.equal(v.rows[1].stuck, true);
  assert.equal(v.rows[1].stuckDays, 15);
});

test("Epics: an epic with no fetched children falls back to its own update time", () => {
  const e = epic(100, { updatedAt: daysAgo(20) });
  const r = epicsView([e], [], NOW).rows[0];
  assert.equal(r.touched, daysAgo(20));
  assert.equal(r.stuck, true);
});

// ---- drill-down ----

test("Drill-down shows every child whatever the priority filter, plus a collapsed Done (not archived) lane", () => {
  const e = epic(100, { title: "Synthetic epic", sub: { total: 9, completed: 4, percentCompleted: 44 } });
  const items = [e, it(1, { parent: childOf(e), priority: "P4" }), it(2, { parent: childOf(e), priority: null, status: "Inbox" }),
    it(3, { parent: childOf(e), status: "Done" }), it(4, { parent: childOf(e), state: "CLOSED" }), it(5)];
  const ui = { ...defaultUi(), priorities: ["P0"], area: "nope", live: true };
  const v = drillView(items, [], e.key, ui);
  assert.deepEqual(v.lanes.map((l) => l.key), ["needs", "running", "next", "done"]);
  assert.deepEqual(keys(lane(v, "needs").rows), [2]);
  assert.deepEqual(keys(lane(v, "next").rows), [1]);
  assert.ok(v.lanes.every((l) => !l.more));
  const done = lane(v, "done");
  assert.equal(done.label, "Done (not archived)");
  assert.equal(done.collapsed, true);
  assert.equal(done.total, 2);
  assert.deepEqual(done.rows, []);
  assert.deepEqual(keys(lane(drillView(items, [], e.key, { ...ui, doneOpen: true }), "done").rows).sort(), [3, 4]);
  assert.equal(v.epic.key, e.key);
  assert.equal(v.archived, 2);
  assert.equal(v.footer, "2 done sub-issues archived, not listed (progress counts them).");
});

test("Drill-down into an epic that isn't fetched (gone) says so instead of crashing", () => {
  assert.equal(drillView([it(1)], [], "acme/widgets#999", defaultUi()), null);
});

// ---- Status ----

test("Status: one column per GitHub Status in pipeline order; epics excluded", () => {
  const v = statusView([it(1, { status: "Ready" }), it(2, { status: "Blocked" }), epic(100, { status: "Ready" }), it(3, { status: "Inbox" })], [], defaultUi());
  assert.deepEqual(v.columns.map((c) => c.status), ["Inbox", "Needs answer", "Ready", "Next", "In progress", "Blocked", "Done"]);
  assert.deepEqual(keys(v.columns[2].rows), [1]);
  assert.deepEqual(keys(v.columns[5].rows), [2]);
  assert.deepEqual(keys(v.columns[0].rows), [3]);
});

test("Status: priority chips hide rows behind a counted line per column; Done ignores priority, shows 8 newest and counts the rest", () => {
  const done = Array.from({ length: 11 }, (_, i) => it(10 + i, { status: "Done", priority: "P4", updatedAt: daysAgo(i) }));
  const v = statusView([it(1, { status: "Ready", priority: "P3" }), it(2, { status: "Ready" }), ...done], [], defaultUi());
  const ready = v.columns.find((c) => c.status === "Ready");
  assert.deepEqual(keys(ready.rows), [2]);
  assert.equal(ready.more.label, "+1 more at P3 · show");
  const d = v.columns.find((c) => c.status === "Done");
  assert.deepEqual(keys(d.rows), [10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(d.more, { count: 3, label: "+3 more done · show" });
  const all = statusView([...done], [], { ...defaultUi(), showLow: { Done: true } });
  assert.equal(all.columns.at(-1).rows.length, 11);
});

test("Status: items with a status outside the pipeline get a No status column rather than vanishing", () => {
  const v = statusView([it(1, { status: null }), it(2, { status: "Someday" })], [], defaultUi());
  assert.equal(v.columns.at(-1).status, "No status");
  assert.deepEqual(keys(v.columns.at(-1).rows).sort(), [1, 2]);
  assert.equal(statusView([it(3)], [], defaultUi()).columns.length, 7);
});

// ---- Search ----

test("Search is global, sorted by priority then newest: every fetched item (done, low priority, epics, PRs, other repos), ignoring the view's filters", () => {
  const e = epic(100, { title: "Offline sync epic" });
  const items = [e, it(1, { title: "Sync queue", priority: "P4" }), it(2, { title: "Sync done thing", status: "Done", state: "CLOSED" }),
    it(3, { title: "Pricing sync", type: "PullRequest", repo: "acme/site" }), it(4, { title: "Unrelated" })];
  const v = searchView(items, [], "SYNC");
  assert.deepEqual(v.groups.map((g) => [g.label, keys(g.rows)]), [["Epics", [100]], ["Open", [3, 1]], ["Closed / Done", [2]]]);
  assert.equal(v.count, "4 of 5");
});

test("Search tokens are ANDed over title, #number, area, repo and parent epic title", () => {
  const e = epic(100, { title: "Billing epic" });
  const items = [e, it(7, { title: "Invoice PDF", area: "billing", parent: childOf(e) }), it(8, { title: "Invoice email", repo: "acme/site" })];
  assert.deepEqual(searchView(items, [], "invoice billing").groups.flatMap((g) => keys(g.rows)), [7]);
  assert.deepEqual(searchView(items, [], "#8").groups.flatMap((g) => keys(g.rows)), [8]);
  assert.deepEqual(searchView(items, [], "invoice site").groups.flatMap((g) => keys(g.rows)), [8]);
  assert.deepEqual(searchView(items, [], "billing epic").groups.flatMap((g) => keys(g.rows)), [100, 7]);
});

test("Search with no hit says so with the item count", () => {
  const v = searchView([it(1), it(2)], [], "zzz");
  assert.deepEqual(v.groups, []);
  assert.equal(v.empty, "No match in 2 items.");
});

// ---- Focus ----

test("Focus: only Needs you, every priority, blocked agents first", () => {
  const v = focusView([it(1, { status: "Inbox", priority: "P0" }), it(2, { status: "Blocked", priority: "P4" }), it(3, { status: "In progress" }), it(4, { status: "Ready" })],
    [term("t3", "acme/widgets#3", "blocked")]);
  assert.deepEqual(v.lanes.map((l) => l.key), ["needs"]);
  assert.deepEqual(keys(v.lanes[0].rows), [3, 1, 2]);
  assert.equal(v.lanes[0].more, null);
});

test("Focus: Enter on an issue with a live agent peeks that agent's terminal (the blocked one first); without one it opens the issue", () => {
  const v = todayView([it(1, { status: "Blocked" }), it(2, { status: "Inbox" })], [term("t1", "acme/widgets#1", "working"), term("t2", "acme/widgets#1", "blocked")], defaultUi());
  const [withAgent, without] = lane(v, "needs").rows;
  assert.deepEqual(primaryAction(withAgent, { focus: true }), { run: ["terminal.peek", { terminal: "t2" }] });
  assert.deepEqual(primaryAction(withAgent, { focus: false }), { run: ["agent.focus", { terminal: "t2" }] });
  assert.deepEqual(primaryAction(without, { focus: true }), { exec: ["open", ["https://github.com/acme/widgets/issues/2"]] });
});

test("Focus: after a peek, selection moves to the next Needs-you issue", () => {
  assert.equal(afterPeek(["a", "b", "c"], "a"), "b");
  assert.equal(afterPeek(["a", "b", "c"], "c"), "c");
  assert.equal(afterPeek([], "a"), null);
});

// ---- the flat list: what's drawn and moved through ----

test("flatten: lane headers, rows, '+N more' lines and empty lines, in order; only rows are selectable", () => {
  const v = todayView([it(1, { status: "Inbox" }), it(2, { priority: "P4" })], [], defaultUi());
  const flat = flatten(v);
  assert.deepEqual(flat.map((x) => x.kind), ["lane", "row", "lane", "empty", "lane", "more"]);
  assert.deepEqual(flat.filter((x) => x.kind === "row").map((x) => x.row.number), [1]);
  assert.equal(flat[5].lane, "next");
});

test("flatten: grouped lanes put an epic header before its rows; a collapsed lane has only its header", () => {
  const e = epic(100);
  const g = flatten(todayView([e, it(1, { parent: childOf(e) })], [], { ...defaultUi(), group: true }));
  assert.deepEqual(g.slice(4, 7).map((x) => x.kind), ["lane", "group", "row"]);
  const d = flatten(drillView([e, it(1, { parent: childOf(e), status: "Done" })], [], e.key, defaultUi()));
  assert.equal(d.at(-1).kind, "lane");
  assert.equal(d.at(-1).lane.key, "done");
});

// ---- selection and scrolling ----

test("moveSel: j/k move by one, J/K by five, clamped to the list", () => {
  const ks = ["a", "b", "c", "d", "e", "f", "g"];
  assert.equal(moveSel(ks, "a", 1), "b");
  assert.equal(moveSel(ks, "a", -1), "a");
  assert.equal(moveSel(ks, "b", 5), "g");
  assert.equal(moveSel(ks, "g", 5), "g");
  assert.equal(moveSel(ks, null, 1), "a");
  assert.equal(moveSel([], "a", 1), null);
});

test("resolveSel: selection follows its issue when the list reorders; if it's gone, the row now at its place is selected", () => {
  assert.equal(resolveSel(["c", "a", "b"], "a", 0), "a");
  assert.equal(resolveSel(["a", "c"], "b", 1), "c");
  assert.equal(resolveSel(["a"], "z", 5), "a");
  assert.equal(resolveSel([], "z", 0), null);
});

test("scrollTop keeps the selected row fully in view; clampTop keeps the wheel inside the list", () => {
  const h = [28, 28, 28, 28, 46, 28];
  assert.equal(scrollTop(h, 0, 2, 100), 0);
  assert.equal(scrollTop(h, 0, 4, 100), 3);
  assert.equal(scrollTop(h, 4, 1, 100), 1);
  assert.equal(clampTop(h, 99, 100), 4, "the last rows show in full");
  assert.equal(clampTop(h, -2, 100), 0);
  assert.equal(clampTop(h, 2, 1000), 0);
});

// ---- row actions ----

test("row actions: Agent, Issue, PR (open PRs first, newest); disabled when missing; never merge", () => {
  const pr = { number: 99, url: "https://github.com/acme/widgets/pull/99", state: "OPEN" };
  const row = lane(todayView([it(4, { status: "In progress", prs: [{ number: 100, url: "https://x/pull/100", state: "CLOSED" }, pr] })], [term("t1", "acme/widgets#4")], defaultUi()), "running").rows[0];
  assert.deepEqual(rowButtons(row), [
    { key: "a", label: "Agent", run: ["agent.focus", { terminal: "t1" }] },
    { key: "i", label: "Issue", exec: ["open", ["https://github.com/acme/widgets/issues/4"]] },
    { key: "p", label: "PR", exec: ["open", [pr.url]] },
  ]);
  const bare = lane(todayView([it(5)], [], defaultUi()), "next").rows[0];
  assert.deepEqual(rowButtons(bare).map((b) => [b.label, !!(b.run || b.exec)]), [["Agent", false], ["Issue", true], ["PR", false]]);
  assert.ok(!JSON.stringify(rowButtons(row)).match(/merge|card/i));
});

// ---- keyboard ----

test("keyboard dispatch table", () => {
  const table = {
    "/": "search", escape: "escape", j: "down", down: "down", k: "up", up: "up", "shift-j": "down5", "shift-k": "up5",
    enter: "primary", a: "agent", i: "issue", p: "pr", t: "today", e: "epics", s: "status", left: "back",
    "0": "prio:P0", "1": "prio:P1", "4": "prio:P4", "5": "allprio", g: "group", l: "live", "shift-r": "refresh", n: "needs", "shift-f": "focus",
  };
  for (const [k, a] of Object.entries(table)) assert.equal(keyAction(k), a, k);
  assert.equal(keyAction("r"), null, "r stays unbound (refresh is Shift-R)");
  assert.equal(keyAction("x"), null);
});

test("Esc steps back one thing at a time: search, then Focus, then drill-down, then out of the board", () => {
  const ui = defaultUi();
  assert.deepEqual(escapeStep({ ...ui, query: "abc", focus: true }), { ui: { ...ui, query: "", focus: true } });
  assert.deepEqual(escapeStep({ ...ui, focus: true, view: "epic", epic: "k" }), { ui: { ...ui, focus: false, view: "epic", epic: "k" } });
  assert.deepEqual(escapeStep({ ...ui, view: "epic", epic: "k" }), { ui: { ...ui, view: "epics", epic: null } });
  assert.deepEqual(escapeStep(ui), { leave: true });
  assert.deepEqual(escapeStep({ ...ui, view: "status" }), { leave: true });
});

// ---- the Board space: badge, rename, toggle ----

test("badge text: 'Board · N' with N needing you, plain 'Board' at zero", () => {
  assert.equal(badgeName(3), "Board · 3");
  assert.equal(badgeName(0), "Board");
});

test("renameStep renames the Board space only when the count changed", () => {
  assert.deepEqual(renameStep({ id: "s1", name: "Board" }, 2), ["space.rename", { id: "s1", name: "Board · 2" }]);
  assert.equal(renameStep({ id: "s1", name: "Board · 2" }, 2), null);
  assert.deepEqual(renameStep({ id: "s1", name: "Board · 2" }, 0), ["space.rename", { id: "s1", name: "Board" }]);
  assert.equal(renameStep(null, 2), null);
});

const MOD = "zaksha-board";
const sp = (id, index, name, tabs, o = {}) => ({ id, index, name, active: false, tabs: tabs.map((t) => (typeof t === "string" ? { id: t } : t)), ...o });

test("boardSpace: the space named Board / Board · N; an old board tab in another space doesn't make that space the board", () => {
  const spaces = [sp("s1", 1, "product", ["a"]), sp("s2", 2, "Board · 4", ["b"]), sp("s3", 3, "x", ["c"])];
  assert.equal(boardSpace(spaces).id, "s2");
  assert.equal(boardSpace([sp("s1", 1, "Boardroom", ["a"]), sp("s3", 3, "x", ["c"])]), null);
});

test("toggle from elsewhere: remember where you were, show the Board space and its tab", () => {
  const spaces = [sp("s1", 1, "Board", ["b1"]), sp("s2", 2, "product", ["t1", "t2"], { active: true })];
  const r = toggleBoard({ spaces, panes: [{ pane: "p", mod: MOD, tab: "b1" }], focused: { space: "s2", tab: "t2" }, from: null, mod: MOD });
  assert.deepEqual(r.from, { space: "s2", tab: "t2" });
  assert.deepEqual(r.steps, [["space.select", { id: "s1" }], ["tab.select", { id: "b1" }]]);
});

test("toggle on the board: back to the space and tab you came from", () => {
  const spaces = [sp("s1", 1, "Board", ["b1"], { active: true }), sp("s2", 2, "product", ["t1", "t2"])];
  const r = toggleBoard({ spaces, panes: [{ pane: "p", mod: MOD, tab: "b1" }], focused: { space: "s1", tab: "b1" }, from: { space: "s2", tab: "t2" }, mod: MOD });
  assert.deepEqual(r.steps, [["space.select", { id: "s2" }], ["tab.select", { id: "t2" }]]);
});

test("toggle back when the tab you came from is gone selects its space; when the space is gone, stays put", () => {
  const spaces = [sp("s1", 1, "Board", ["b1"], { active: true }), sp("s2", 2, "product", ["t1"])];
  const panes = [{ pane: "p", mod: MOD, tab: "b1" }];
  assert.deepEqual(toggleBoard({ spaces, panes, focused: { space: "s1", tab: "b1" }, from: { space: "s2", tab: "gone" }, mod: MOD }).steps, [["space.select", { id: "s2" }]]);
  assert.deepEqual(toggleBoard({ spaces, panes, focused: { space: "s1", tab: "b1" }, from: { space: "gone", tab: "x" }, mod: MOD }).steps, []);
  assert.deepEqual(toggleBoard({ spaces, panes, focused: { space: "s1", tab: "b1" }, from: null, mod: MOD }).steps, []);
});

test("toggle with no Board space makes one; a Board space without the board gets its tab; the Board space is moved first", () => {
  const spaces = [sp("s2", 1, "product", ["t1"], { active: true })];
  assert.deepEqual(toggleBoard({ spaces, panes: [], focused: { space: "s2", tab: "t1" }, from: null, mod: MOD }).steps, [["space.new", { name: "Board" }]]);
  const later = [sp("s2", 1, "product", ["t1"]), sp("s9", 2, "Board", ["shell"], { active: true })];
  const r = toggleBoard({ spaces: later, panes: [], focused: { space: "s2", tab: "t1" }, from: null, mod: MOD });
  assert.deepEqual(r.steps, [["space.select", { id: "s9" }], ["tab.new", { space: "s9", name: "Board", mod: MOD }], ["space.move", { id: "s9", index: 1 }]]);
});

test("toggle closes the shell tab a just-made Board space came with, once the board's tab is there", () => {
  const spaces = [sp("s9", 1, "Board", ["shell", "b1"], { active: true })];
  const r = toggleBoard({ spaces, panes: [{ pane: "p", mod: MOD, tab: "b1" }], focused: { space: "s2", tab: "t1" }, from: null, mod: MOD, shellTabs: ["shell"] });
  assert.deepEqual(r.steps, [["space.select", { id: "s9" }], ["tab.select", { id: "b1" }], ["tab.close", { id: "shell", confirmed: true }]]);
});

test("ensureBoard after making the space: add the board's tab, then close the shell tab it came with", () => {
  const made = [sp("s9", 1, "Board", ["shell"], { active: true })];
  assert.deepEqual(ensureBoard({ spaces: made, panes: [], mod: MOD, shellTabs: ["shell"] }), [["tab.new", { space: "s9", name: "Board", mod: MOD }]]);
  const withTab = [sp("s9", 1, "Board", ["shell", "b1"], { active: true })];
  assert.deepEqual(ensureBoard({ spaces: withTab, panes: [{ pane: "p", mod: MOD, tab: "b1" }], mod: MOD, shellTabs: ["shell"] }),
    [["tab.select", { id: "b1" }], ["tab.close", { id: "shell", confirmed: true }]]);
  assert.deepEqual(ensureBoard({ spaces: [sp("s1", 1, "x", ["a"])], panes: [], mod: MOD }), []);
});

test("ensureBoard closes a board-only tab left in another space (the old Board tab), never a tab with other panes", () => {
  const spaces = [sp("s9", 1, "Board", ["b1"]), sp("s2", 2, "product", [{ id: "old", panes: 1 }, { id: "mixed", panes: 2 }])];
  const panes = [{ pane: "p1", mod: MOD, tab: "b1" }, { pane: "p2", mod: MOD, tab: "old" }, { pane: "p3", mod: MOD, tab: "mixed" }, { pane: "p4", terminal: "t1", tab: "mixed" }];
  assert.deepEqual(ensureBoard({ spaces, panes, mod: MOD }), [["tab.select", { id: "b1" }], ["tab.close", { id: "old", confirmed: true }]]);
});

// ---- refresh and sync label ----

test("refresh when the board becomes visible, at most once a minute", () => {
  assert.equal(shouldRefreshOnShow(false, true, NOW - 120000, NOW), true);
  assert.equal(shouldRefreshOnShow(false, true, NOW - 10000, NOW), false);
  assert.equal(shouldRefreshOnShow(true, true, NOW - 999999, NOW), false);
  assert.equal(shouldRefreshOnShow(false, false, NOW - 999999, NOW), false);
  assert.equal(shouldRefreshOnShow(false, true, null, NOW), true);
});

test("sync label: fetching, synced Nm ago, amber stale after 10 minutes, and the error banner keeps the old data's age", () => {
  assert.deepEqual(syncLabel({ now: NOW, read: null, fetching: true, count: 0 }), { label: "fetching items…", stale: false, banner: null });
  assert.deepEqual(syncLabel({ now: NOW, read: NOW - 120000, fetching: true, count: 325 }), { label: "fetching 325 items…", stale: false, banner: null });
  assert.deepEqual(syncLabel({ now: NOW, read: NOW - 120000, fetching: false, count: 325 }), { label: "synced 2m ago", stale: false, banner: null });
  assert.deepEqual(syncLabel({ now: NOW, read: NOW - 10000, fetching: false, count: 3 }), { label: "synced just now", stale: false, banner: null });
  assert.deepEqual(syncLabel({ now: NOW, read: NOW - 14 * 60000, fetching: false, count: 3 }), { label: "stale 14m", stale: true, banner: null });
  assert.deepEqual(syncLabel({ now: NOW, read: NOW - 12 * 60000, fetching: false, count: 3, error: "HTTP 502" }),
    { label: "last ok 12m ago", stale: true, banner: "GitHub fetch failed (HTTP 502) · showing data from 12 min ago · retry (Shift-R)" });
});

test("age text: now, minutes, hours, days", () => {
  assert.equal(ageText(NOW, new Date(NOW - 20000).toISOString()), "now");
  assert.equal(ageText(NOW, new Date(NOW - 5 * 60000).toISOString()), "5m");
  assert.equal(ageText(NOW, new Date(NOW - 3 * 3600000).toISOString()), "3h");
  assert.equal(ageText(NOW, daysAgo(4)), "4d");
  assert.equal(ageText(NOW, null), "");
});

test("facets: the areas and repos the filter menus offer, sorted", () => {
  assert.deepEqual(facets([it(1, { area: "pwa" }), it(2, { area: "ios", repo: "acme/site" }), it(3)]), { areas: ["ios", "pwa"], repos: ["acme/site", "acme/widgets"] });
});

test("defaults: Today, P0–P2, all areas and repos, not grouped, not live-only, no Focus, no search", () => {
  assert.deepEqual(defaultUi(), { view: "today", epic: null, priorities: ["P0", "P1", "P2"], area: null, repo: null, group: false, live: false, focus: false, query: "", showLow: {}, doneOpen: false });
});

// ---- starting /work on an issue with no agent ----

const HOME = "/home/syn";
const AREAS = "# project -> area\nwidgets build\ngadgets ship\n";
const issue = (n = 12, o = {}) => ({ ...it(n, o), epic: o.epic ?? false });
const DESK = { address: "t9", state: "live", status: "idle", labels: ["desk=build", "herdr.space=s3"] };

test("repoFolder: repoPaths wins (~ expanded), else ~/workspace/vasu/<repo name>", () => {
  assert.equal(repoFolder("acme/widgets", {}, HOME), "/home/syn/workspace/vasu/widgets");
  assert.equal(repoFolder("acme/widgets", { repoPaths: { "acme/widgets": "~/code/w" } }, HOME), "/home/syn/code/w");
  assert.equal(repoFolder("acme/widgets", { repoPaths: { "acme/widgets": "/srv/w" } }, HOME), "/srv/w");
  assert.equal(repoFolder("acme/gadgets", { repoPaths: { "acme/widgets": "/srv/w" } }, HOME), "/home/syn/workspace/vasu/gadgets");
});

test("deskFor: reads '<repo-name> <desk>' lines, skips comments, null when unmapped", () => {
  assert.equal(deskFor("acme/widgets", AREAS), "build");
  assert.equal(deskFor("acme/gadgets", AREAS), "ship");
  assert.equal(deskFor("acme/other", AREAS), null);
  assert.equal(deskFor("acme/project", AREAS), null, "comment lines are not mappings");
  assert.equal(deskFor("acme/widgets", null), null);
});

test("startPlan: a live agent is not this function's case, but any card terminal (even not live) is focused, never a second start", () => {
  const dead = { address: "t4", state: "starting", labels: ["card=Acme/Widgets#12"] };
  assert.deepEqual(startPlan(issue(), [dead], AREAS, CFG, HOME), { action: "focus", terminal: "t4" });
  assert.deepEqual(startPlan(issue(), [term("t2", "acme/widgets#12")], AREAS, CFG, HOME), { action: "focus", terminal: "t2" });
});

test("startPlan: no agent -> confirm once, with the title; epics and pending starts do nothing", () => {
  assert.deepEqual(startPlan(issue(12, { title: "Fix thing" }), [], AREAS, CFG, HOME),
    { action: "confirm", title: "Start /work on acme/widgets#12?", detail: "Fix thing" });
  assert.deepEqual(startPlan(issue(12, { epic: true }), [], AREAS, CFG, HOME), { action: "none" });
  assert.deepEqual(startPlan(issue(), [], AREAS, CFG, HOME, { pending: new Set(["acme/widgets#12"]) }), { action: "none" });
  assert.deepEqual(startPlan(issue(), [term("t2", "acme/widgets#12")], AREAS, CFG, HOME, { pending: new Set(["acme/widgets#12"]) }), { action: "focus", terminal: "t2" });
  assert.deepEqual(startPlan({ ...issue(), number: null, repo: null }, [], AREAS, CFG, HOME), { action: "none" }, "drafts have no repo to start in");
});

test("startPlan confirmed: a desk space exists -> tab.new in it", () => {
  const p = startPlan(issue(12, { title: "Fix thing" }), [DESK], AREAS, CFG, HOME, { confirmed: true });
  assert.deepEqual(p, { action: "start", step: ["tab.new", { space: "s3", folder: "/home/syn/workspace/vasu/widgets",
    name: "#12 Fix thing", argv: wrap("/work acme/widgets#12") }] });
});

test("startPlan confirmed: no desk terminal -> space.new named for the desk, else the repo", () => {
  const argv = wrap("/work acme/widgets#12");
  const folder = "/home/syn/workspace/vasu/widgets";
  assert.deepEqual(startPlan(issue(), [], AREAS, CFG, HOME, { confirmed: true }).step,
    ["space.new", { name: "build", folder, tab: "#12 Synthetic 12", argv }]);
  assert.deepEqual(startPlan(issue(12, { repo: "acme/other" }), [], AREAS, CFG, HOME, { confirmed: true }).step[1].name, "other");
  const other = { address: "t8", state: "live", labels: ["desk=ship", "herdr.space=s7"] };
  assert.equal(startPlan(issue(), [other], AREAS, CFG, HOME, { confirmed: true }).step[0], "space.new", "another desk's space is not ours");
  const objLabels = { address: "t9", state: "live", labels: { desk: "build", "herdr.space": "s3" } };
  assert.equal(startPlan(issue(), [objLabels], AREAS, CFG, HOME, { confirmed: true }).step[1].space, "s3");
});

test("startPlan confirmed: the tab name is short; a missing folder is an error, not a start", () => {
  const long = startPlan(issue(12, { title: "A very long synthetic title that keeps going and going" }), [DESK], AREAS, CFG, HOME, { confirmed: true });
  assert.ok(long.step[1].name.startsWith("#12 A very long") && long.step[1].name.length <= 32, long.step[1].name);
  const gone = startPlan(issue(), [DESK], AREAS, CFG, HOME, { confirmed: true, exists: () => false });
  assert.deepEqual(gone, { action: "error", message: "Folder /home/syn/workspace/vasu/widgets does not exist (set repoPaths in board.json)" });
});

test("keyboard: footer says what a does", () => {
  assert.equal(keyAction("a"), "agent");
});

const LABEL = 'hc label "$HC_TERMINAL_ID" "card=$1" >/dev/null 2>&1; exec claude "$2"';
const wrap = (prompt) => ["sh", "-c", LABEL, "sh", "acme/widgets#12", prompt];
const INFO = { title: "Fix thing", url: "https://github.com/acme/widgets/issues/12" };
const QUICK_TAIL = "\n\nDo only what is asked (for example close it, mark it a duplicate, comment, or edit it with gh). No worktree, no branch, no PR.";
const quick = (ask) => `Issue acme/widgets#12: Fix thing\nhttps://github.com/acme/widgets/issues/12\n\n${ask}${QUICK_TAIL}`;

test("startArgv work: labels the terminal first; the prompt is its own positional argv element", () => {
  const plain = wrap("/work acme/widgets#12");
  assert.deepEqual(startArgv("acme/widgets#12", "", INFO), plain);
  assert.deepEqual(startArgv("acme/widgets#12", "  \n\t ", { mode: "work", ...INFO }), plain, "whitespace-only is empty");
  assert.deepEqual(startArgv("acme/widgets#12", null, INFO), plain);
  assert.deepEqual(startArgv("acme/widgets#12"), plain, "mode defaults to work");
});

test("startArgv work: notes are trimmed and ride in the same single prompt element", () => {
  assert.deepEqual(startArgv("acme/widgets#12", "  use the v2 API \n", INFO), wrap("/work acme/widgets#12\n\nNotes from Vasu: use the v2 API"));
  const nasty = "line one\nline two; $(rm -rf /) 'quoted'";
  const argv = startArgv("acme/widgets#12", nasty, INFO);
  assert.equal(argv.length, 6, "never split");
  assert.equal(argv[2], LABEL, "the script never contains the prompt");
  assert.equal(argv[5], `/work acme/widgets#12\n\nNotes from Vasu: ${nasty}`);
});

test("startArgv: notes are capped at 2000 characters, trim first", () => {
  assert.equal(startArgv("acme/widgets#12", "x".repeat(2500), INFO)[5], `/work acme/widgets#12\n\nNotes from Vasu: ${"x".repeat(2000)}`);
  assert.equal(startArgv("acme/widgets#12", ` ${"z".repeat(2000)} `, INFO)[5].endsWith("z".repeat(2000)), true);
  assert.equal(startArgv("acme/widgets#12", "y".repeat(2500), { mode: "quick", ...INFO })[5], quick(`Do this: ${"y".repeat(2000)}`));
});

test("startArgv quick: no notes -> read it and ask; notes -> do this; no /work anywhere", () => {
  assert.deepEqual(startArgv("acme/widgets#12", "", { mode: "quick", ...INFO }), wrap(quick("Read it and ask me what to do.")));
  assert.deepEqual(startArgv("acme/widgets#12", " close as duplicate of #9 ", { mode: "quick", ...INFO }), wrap(quick("Do this: close as duplicate of #9")));
  assert.equal(startArgv("acme/widgets#12", "x", { mode: "quick", ...INFO })[5].includes("/work"), false);
});

const BRIEF_BODY = "Read-only: change nothing on GitHub or in code. Cover, in short sections:\n1. What it is: the problem in plain words and its acceptance criteria.\n2. Where it stands: status, priority, epic, linked PRs (state, checks, review), any branch or worktree for it.\n3. Previous work: the issue's comments (including /work phase comments), commits mentioning it, and past Claude sessions that discussed it (rg -l -F '#12' ~/.claude/projects, then read the relevant ones).\n4. Validation: for each acceptance criterion, met on main / not met / can't tell, with the file or test that shows it.\n5. Next step: one recommendation (/work it, close, mark duplicate, ask someone) with the exact command.\nThen wait for my instruction.";
const brief = (focus) => `Brief me on acme/widgets#12: Fix thing\nhttps://github.com/acme/widgets/issues/12\n\n${focus ? `Focus on: ${focus}\n\n` : ""}${BRIEF_BODY}`;

test("startArgv brief: read-only catch-up prompt, notes become Focus on, same label wrapper", () => {
  assert.deepEqual(startArgv("acme/widgets#12", "", { mode: "brief", ...INFO }), wrap(brief("")));
  assert.deepEqual(startArgv("acme/widgets#12", "  the auth part ", { mode: "brief", ...INFO }), wrap(brief("the auth part")));
  assert.equal(startArgv("acme/widgets#12", "", { mode: "brief", ...INFO })[5].startsWith("/work"), false);
});

test("startPlan confirmed: brief mode names the tab '#N brief'", () => {
  const p = startPlan(issue(12, { title: "Fix thing" }), [DESK], AREAS, CFG, HOME, { confirmed: true, mode: "brief" });
  assert.equal(p.step[1].name, "#12 brief");
  assert.deepEqual(p.step[1].argv, wrap(brief("")));
});

test("dialogKey: b picks Brief; w and q leave it; typing keeps b for the input", () => {
  assert.deepEqual(dialogKey({ mode: "work", typing: false }, "b"), { state: { mode: "brief", typing: false }, action: null });
  assert.deepEqual(dialogKey({ mode: "brief", typing: false }, "q").state.mode, "quick");
  assert.deepEqual(dialogKey({ mode: "brief", typing: false }, "w").state.mode, "work");
  assert.deepEqual(dialogKey({ mode: "work", typing: true }, "b"), { state: { mode: "work", typing: true }, action: null });
});

test("startPlan confirmed: mode and notes flow into the argv and tab name of either start step", () => {
  const want = wrap("/work acme/widgets#12\n\nNotes from Vasu: mind the schema");
  const tab = startPlan(issue(12, { title: "Fix thing" }), [DESK], AREAS, CFG, HOME, { confirmed: true, notes: " mind the schema " });
  assert.deepEqual(tab.step[1].argv, want);
  const space = startPlan(issue(12, { title: "Fix thing" }), [], AREAS, CFG, HOME, { confirmed: true, notes: "mind the schema" });
  assert.deepEqual(space.step[1].argv, want);
  const q = startPlan(issue(12, { title: "Fix thing" }), [DESK], AREAS, CFG, HOME, { confirmed: true, mode: "quick", notes: "close it" });
  assert.equal(q.step[1].name, "#12 quick");
  assert.deepEqual(q.step[1].argv, wrap(quick("Do this: close it")));
  const qs = startPlan(issue(12, { title: "Fix thing" }), [], AREAS, CFG, HOME, { confirmed: true, mode: "quick" });
  assert.equal(qs.step[1].tab, "#12 quick");
  assert.deepEqual(qs.step[1].argv, wrap(quick("Read it and ask me what to do.")));
});

test("dialogKey: opens on the dialog in work mode; n focuses notes; w/q pick the mode; Enter starts; Esc cancels", () => {
  const s0 = { mode: "work", typing: false };
  assert.deepEqual(dialogKey(s0, "n"), { state: { mode: "work", typing: true }, action: "focus-notes" });
  assert.deepEqual(dialogKey(s0, "q"), { state: { mode: "quick", typing: false }, action: null });
  assert.deepEqual(dialogKey({ mode: "quick", typing: false }, "w"), { state: { mode: "work", typing: false }, action: null });
  assert.deepEqual(dialogKey({ mode: "quick", typing: false }, "enter"), { state: { mode: "quick", typing: false }, action: "start" });
  assert.deepEqual(dialogKey(s0, "escape"), { state: s0, action: "cancel" });
  assert.deepEqual(dialogKey(s0, "x"), { state: s0, action: null }, "other keys do nothing");
});

test("dialogKey while typing: letters belong to the input; Enter starts; Esc leaves the input, a second Esc cancels", () => {
  const typing = { mode: "quick", typing: true };
  for (const k of ["n", "w", "q"]) assert.deepEqual(dialogKey(typing, k), { state: typing, action: null }, k);
  assert.deepEqual(dialogKey(typing, "enter"), { state: typing, action: "start" });
  const left = dialogKey(typing, "escape");
  assert.deepEqual(left, { state: { mode: "quick", typing: false }, action: "blur-notes" });
  assert.deepEqual(dialogKey(left.state, "escape"), { state: left.state, action: "cancel" });
});

test("dialogTitle follows the mode", () => {
  assert.equal(dialogTitle("work", "acme/widgets#12"), "Start /work on acme/widgets#12?");
  assert.equal(dialogTitle("quick", "acme/widgets#12"), "Quick action on acme/widgets#12?");
  assert.equal(dialogTitle("brief", "acme/widgets#12"), "Brief me on acme/widgets#12?");
});

// ---- tab marks: a dot on tabs whose terminal is linked to a card ----

const mt = (address, tab, card, o = {}) => ({ address, state: "live", labels: [...(card ? [`card=${card}`] : []), ...(tab ? [`herdr.tab=${tab}`] : [])], ...o });
const MITEMS = [{ repo: "acme/widgets", number: 12, title: "Fix the flaky checkout test" }, { repo: "acme/widgets", number: 7, title: "Short" }];

test("tabMarks: a linked terminal's tab gets the dot, number and a trimmed title", () => {
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#12")], tabs: [{ id: "tab1", name: "claude", named: false }], records: {}, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "● #12 Fix the flaky checkout…" }]);
  assert.deepEqual(r.records, { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "claude" } });
});

test("tabMarks: a short title is kept whole", () => {
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#7")], tabs: [{ id: "tab1", name: "1", named: false }], records: {}, items: MITEMS });
  assert.equal(r.renames[0].name, "● #7 Short");
});

test("tabMarks: an issue missing from the cache is just the dot and number", () => {
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#99")], tabs: [{ id: "tab1", name: "x", named: true }], records: {}, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "● #99" }]);
  assert.deepEqual(r.records.tab1, { card: "acme/widgets#99", prevNamed: true, prevName: "x" });
});

test("tabMarks: unlinking restores a named tab's old name", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: true, prevName: "my tab" } };
  const r = tabMarks({ terminals: [mt("t1", "tab1", null)], tabs: [{ id: "tab1", name: "● #12 Fix the flaky checkout…", named: true }], records, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "my tab" }]);
  assert.deepEqual(r.records, {});
});

test("tabMarks: unlinking an unnamed tab hands naming back to Herdr", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "claude" } };
  const r = tabMarks({ terminals: [], tabs: [{ id: "tab1", name: "● #12 Fix the flaky checkout…", named: true }], records, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "" }]);
  assert.deepEqual(r.records, {});
});

test("tabMarks: a dead terminal counts as unlinked", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "c" } };
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#12", { state: "exited" })], tabs: [{ id: "tab1", name: "● #12 Fix the flaky checkout…", named: true }], records, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "" }]);
});

test("tabMarks: a tab renamed by hand is released and never overwritten", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "claude" } };
  const still = mt("t1", "tab1", "acme/widgets#12");
  const r = tabMarks({ terminals: [still], tabs: [{ id: "tab1", name: "my own name", named: true }], records, items: MITEMS });
  assert.deepEqual(r.renames, []);
  assert.deepEqual(r.records, {});
  const r2 = tabMarks({ terminals: [mt("t1", "tab1", null)], tabs: [{ id: "tab1", name: "my own name", named: true }], records, items: MITEMS });
  assert.deepEqual(r2.renames, []);
});

test("tabMarks: nothing to do when the name is already right", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "claude" } };
  const args = { terminals: [mt("t1", "tab1", "acme/widgets#12")], tabs: [{ id: "tab1", name: "● #12 Fix the flaky checkout…", named: true }], records, items: MITEMS };
  const r = tabMarks(args);
  assert.deepEqual(r.renames, []);
  assert.deepEqual(r.records, records);
});

test("tabMarks: the title refreshes when the cache learns it, keeping the original previous name", () => {
  const records = { tab1: { card: "acme/widgets#12", prevNamed: false, prevName: "claude" } };
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#12")], tabs: [{ id: "tab1", name: "● #12", named: true }], records, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "● #12 Fix the flaky checkout…" }]);
  assert.deepEqual(r.records, records);
});

test("tabMarks: a tab that is already marked but has no record never saves the marker as its previous name", () => {
  const r = tabMarks({ terminals: [mt("t1", "tab1", "acme/widgets#12")], tabs: [{ id: "tab1", name: "● #12", named: true }], records: {}, items: MITEMS });
  assert.deepEqual(r.records.tab1, { card: "acme/widgets#12", prevNamed: false, prevName: "" });
});

test("tabMarks: terminals sharing a tab use the lowest address", () => {
  const r = tabMarks({ terminals: [mt("t9", "tab1", "acme/widgets#7"), mt("t2", "tab1", "acme/widgets#12")], tabs: [{ id: "tab1", name: "1", named: false }], records: {}, items: MITEMS });
  assert.deepEqual(r.renames, [{ tab: "tab1", name: "● #12 Fix the flaky checkout…" }]);
});

test("tabMarks: remote terminals and terminals without a tab label are ignored", () => {
  const r = tabMarks({ terminals: [mt("box/t1", "tab1", "acme/widgets#12"), mt("t2", null, "acme/widgets#12")], tabs: [{ id: "tab1", name: "1", named: false }], records: {}, items: MITEMS });
  assert.deepEqual(r.renames, []);
  assert.deepEqual(r.records, {});
});

test("tabMarks: records of tabs that no longer exist are dropped", () => {
  const r = tabMarks({ terminals: [], tabs: [], records: { gone: { card: "acme/widgets#12", prevNamed: false, prevName: "" } }, items: MITEMS });
  assert.deepEqual(r.records, {});
  assert.deepEqual(r.renames, []);
});

// ---- matching unlabelled agents, the Now strip, space history ----

const ITEM = (n, o = {}) => ({ key: `acme/widgets#${n}`, repo: "acme/widgets", number: n, title: `Issue ${n}`, status: "In progress", state: "OPEN", epic: false, priority: "P1", prs: [], ...o });
const MI = [ITEM(717), ITEM(8), ITEM(5, { repo: "acme/other", key: "acme/other#5" })];
// terminals() is the `hc ls --json` shape plus labels: agent, cwd, state, status, turn, where; no title, app or seq.
// Those live on agents() (AgentInfo in herdr.d.ts), joined by address.
const cc = (address, o = {}) => ({ address, agent: "claude-code", cwd: "/home/syn/work/repo", state: "live", status: "working", turn: 1, where: "widgets / 1", labels: [], ...o });
const PROGRAM = { key: "claude", name: "Claude Code", icon: null, tint: false, tile: null, color: null, shell: false, agent: true };
const ag = (address, o = {}) => ({ address, pane: `p${address}`, space: "sp1", space_name: "widgets", tab: `tb${address}`, tab_index: 0, tab_name: "1",
  status: "working", app: "claude-code", program: PROGRAM, title: "claude", seq: 1, pinned: false, focused: false, ...o });
// [terminal, agent] pairs -> linkTerminals(terminals, items, spaces, agents)
const two = (address, a = {}, t = {}) => [cc(address, t), ag(address, a)];
const link = (pairs, items = MI, sp = SP) => linkTerminals(pairs.map((p) => p[0]), items, sp, pairs.map((p) => p[1]).filter(Boolean));
const SP = [{ id: "sp1", index: 0, name: "widgets", named: true, folder: "/home/syn/work", machine: null, branch: "main", active: false, status: null, tabs: [] }];
const space = (o) => [{ ...SP[0], ...o }];

test("linkTerminals: a real hc-ls terminal with no card label matches by its agents() title", () => {
  const t = { address: "t1d", agent: "claude-code", cwd: "/home/syn/work/repo", state: "live", status: "done", turn: 23, where: "design review / prompts only", labels: [] };
  const [m] = linkTerminals([t], MI, SP, [ag("t1d", { title: "#717 Windows agent efficacy", status: "done" })]);
  assert.deepEqual(m.matched, { key: "acme/widgets#717", by: "title" });
});

test("linkTerminals: an unlabelled claude terminal whose title has #N token matches that issue", () => {
  assert.deepEqual(link([two("t1", { title: "#717 Windows agent efficacy" })])[0].matched, { key: "acme/widgets#717", by: "title" });
  assert.equal(link([two("t1", { title: "#7170 nope" })])[0].matched, undefined);
});

test("linkTerminals: the space's branch number matches when it is a whole token", () => {
  assert.deepEqual(link([two("t1")], MI, space({ branch: "feat/717-tamper" }))[0].matched, { key: "acme/widgets#717", by: "branch" });
  assert.equal(link([two("t1")], MI, space({ branch: "feat/7171-x" }))[0].matched, undefined);
});

test("linkTerminals: the branch comes from the agent's own space", () => {
  const sp = [...space({ branch: "main" }), { ...SP[0], id: "sp2", branch: "feat/717-x" }];
  assert.deepEqual(link([two("t1", { space: "sp2" })], MI, sp)[0].matched, { key: "acme/widgets#717", by: "branch" });
});

test("linkTerminals: a space named for another repo does not match", () => {
  assert.equal(link([two("t1")], MI, space({ name: "other", branch: "feat/717-tamper" }))[0].matched, undefined);
  assert.deepEqual(link([two("t1")], MI, space({ name: "other", branch: "fix/5" }))[0].matched, { key: "acme/other#5", by: "branch" });
});

test("linkTerminals: labelled, remote, dead, non-claude and non-agent terminals are left alone", () => {
  const ts = [two("t1", { title: "#717 x" }, { labels: ["card=acme/widgets#8"] }), two("box/t2", { title: "#717 x" }),
    two("t3", { title: "#717 x" }, { state: "exited" }), two("t4", { title: "#717 x", app: "codex" }, { agent: "codex" }),
    [cc("t5", { agent: "zsh", status: undefined })]];
  assert.ok(link(ts, MI, space({ branch: "feat/717-x" })).every((t) => t.matched === undefined));
});

test("linkTerminals: never changes labels", () => {
  const [t, a] = two("t1", { title: "#717 x" }, { labels: ["herdr.tab=tb1"] });
  assert.deepEqual(link([[t, a]])[0].labels, t.labels);
});

test("cardAgents: a matched agent is flagged, and a labelled one beats it", () => {
  assert.equal(cardAgents(link([two("t1", { title: "#717 x" })])).get("acme/widgets#717")[0].matched, "title");
  const both = link([two("t1", { title: "#717 x" }), two("t2", {}, { labels: ["card=acme/widgets#717"] })]);
  const a = cardAgents(both).get("acme/widgets#717");
  assert.deepEqual(a.map((x) => x.address), ["t2"]);
  assert.equal(a[0].matched, undefined);
});

test("cardAgents: several matches order title before branch, then newest agents() seq", () => {
  const ts = link([two("b1", { seq: 9 }), two("t1", { title: "#717 a", seq: 1 }), two("t2", { title: "#717 b", seq: 5 })], MI, space({ branch: "feat/717-x" }));
  assert.deepEqual(cardAgents(ts).get("acme/widgets#717").map((x) => x.address), ["t2", "t1", "b1"]);
});

test("startPlan: a matched agent is focused instead of offering to start", () => {
  const ts = link([two("t1", { title: "#717 x" })]);
  assert.deepEqual(startPlan({ ...MI[0] }, ts, null, CFG, "/h"), { action: "focus", terminal: "t1" });
});

test("nowFlat: every issue with a live agent, blocked then working then the rest, hidden when none", () => {
  assert.deepEqual(nowFlat(MI, []), []);
  const ts = link([two("t1", { title: "#717 x" }, { status: "idle" }), two("t2", {}, { status: "blocked", labels: ["card=acme/widgets#8"] }),
    two("t3", {}, { status: "working", labels: ["card=acme/widgets#99"] })]);
  const f = nowFlat(MI, ts);
  assert.equal(f[0].kind, "lane");
  const rows = f.filter((x) => x.kind === "row");
  assert.deepEqual(rows.map((x) => x.row.number), [8, 99, 717]);
  assert.ok(rows.every((x) => x.key.startsWith("now:")));
  assert.equal(rows[0].row.asking, "t2");
});

test("pushHistory: most recent first, deduped, capped at 10, local only", () => {
  let h = [];
  h = pushHistory(h, { space: "a", tab: "1" });
  h = pushHistory(h, { space: "b", tab: "2" });
  h = pushHistory(h, { space: "a", tab: "1" });
  assert.deepEqual(h, [{ space: "a", tab: "1" }, { space: "b", tab: "2" }]);
  assert.equal(pushHistory(h, { space: "a", tab: "1" }), h);
  assert.equal(pushHistory(h, null), h);
  assert.equal(pushHistory(h, { space: "m/x", tab: "m/y" }), h);
  for (let i = 0; i < 15; i++) h = pushHistory(h, { space: `s${i}`, tab: "t" });
  assert.equal(h.length, 10);
  assert.equal(h[0].space, "s14");
});

test("linkTerminals: only the first number in the branch counts", () => {
  const sp = space({ branch: "feat/717-tamper-w11-v4" });
  assert.deepEqual(link([two("t1")], [ITEM(717), ITEM(11), ITEM(4)], sp)[0].matched, { key: "acme/widgets#717", by: "branch" });
  assert.equal(link([two("t1")], [ITEM(11), ITEM(4)], sp)[0].matched, undefined);
});

test("cardAgents: a title match beats a branch match even when the branch one is newer", () => {
  const ts = link([two("b1", { seq: 99 }), two("t1", { title: "#717 a", seq: 1 })], MI, space({ branch: "feat/717-x" }));
  assert.deepEqual(cardAgents(ts).get("acme/widgets#717").map((x) => [x.address, x.matched]), [["t1", "title"], ["b1", "branch"]]);
});

test("startMode: uses the dialog's mode as given, work only when missing or unknown", () => {
  assert.equal(startMode("work"), "work");
  assert.equal(startMode("quick"), "quick");
  assert.equal(startMode("brief"), "brief");
  for (const bad of [undefined, null, "", "BRIEF", "other", 3]) assert.equal(startMode(bad), "work");
});
