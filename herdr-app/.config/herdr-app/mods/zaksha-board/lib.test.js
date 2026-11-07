// Behavior tests for the board's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/zaksha-board/
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, fetchAll, buildBoard, cardAgents, excerpt, cardButtons, single, boardTab, uiState, toggleEpic, draft } from "./lib.js";

const CFG = {
  owner: "acme", project: 7, priorities: ["P0", "P1", "P2"],
  columns: [
    { name: "NEEDS YOU", statuses: ["Needs answer", "Blocked"] },
    { name: "WORKING", statuses: ["In progress"] },
    { name: "UP NEXT", statuses: ["Next", "Ready"] },
  ],
  done: { status: "Done", limit: 2 }, pollSeconds: 60,
};

let seq = 0;
const issue = (o = {}) => ({
  id: `PVTI_${++seq}`, type: "ISSUE", updatedAt: o.updatedAt ?? "2026-01-01T00:00:00Z",
  status: o.status === null ? null : { name: o.status ?? "Next" },
  priority: o.priority === null ? null : { name: o.priority ?? "P1" },
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

// ---- config ----

test("a missing board.json is reported as missing, not as an error", () => {
  assert.deepEqual(parseConfig(null), { missing: true });
});

test("a valid board.json gets defaults for what it leaves out", () => {
  const r = parseConfig(JSON.stringify({ owner: "acme", project: 7, columns: CFG.columns }));
  assert.equal(r.error, undefined);
  assert.equal(r.cfg.pollSeconds, 60);
  assert.deepEqual(r.cfg.priorities, ["P0", "P1", "P2"]);
  assert.deepEqual(r.cfg.done, { status: "Done", limit: 5 });
  assert.equal(r.cfg.showUnprioritized, false);
  assert.equal(r.cfg.otherColumn, null);
});

test("broken JSON or a missing owner/project is an error the person can read", () => {
  assert.match(parseConfig("{ nope").error, /board\.json/);
  assert.match(parseConfig(JSON.stringify({ project: 7, columns: [] })).error, /owner/);
  assert.match(parseConfig(JSON.stringify({ owner: "acme", columns: [] })).error, /project/);
});

test("pollSeconds below 15 is raised to 15 so the API isn't hammered", () => {
  assert.equal(parseConfig(JSON.stringify({ ...CFG, pollSeconds: 1 })).cfg.pollSeconds, 15);
});

// ---- fetching ----

test("fetchAll follows every page, 100 at a time, until GitHub says there are no more", async () => {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const after = args.find((a) => a.startsWith("after="));
    if (!after) return page([issue(), issue()], true, "C1");
    if (after === "after=C1") return page([issue()], true, "C2");
    return page([issue()], false, null);
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

test("an item carries title, number, url, repo, status, priority, updatedAt, type and linked PRs", async () => {
  const pr = { number: 99, url: "https://github.com/acme/widgets/pull/99", state: "OPEN" };
  const r = await fetchAll(async () => page([issue({ number: 5, title: "Fake thing", status: "Ready", priority: "P0", prs: [pr], updatedAt: "2026-02-02T00:00:00Z" })]), CFG);
  assert.deepEqual(r.items[0], {
    key: "acme/widgets#5", title: "Fake thing", number: 5, url: "https://github.com/acme/widgets/issues/5", repo: "acme/widgets",
    status: "Ready", priority: "P0", updatedAt: "2026-02-02T00:00:00Z", type: "Issue", prs: [pr],
    state: "OPEN", parent: null, subIssues: null, epic: false,
  });
});

test("draft issues and pull requests are typed and keep what they have", async () => {
  const draft = { id: "PVTI_d", type: "DRAFT_ISSUE", updatedAt: "2026-01-01T00:00:00Z", status: { name: "Next" }, priority: { name: "P2" }, content: { title: "Draft idea" } };
  const pull = { ...issue({ number: 12 }), type: "PULL_REQUEST" };
  delete pull.content.closedByPullRequestsReferences;
  const r = await fetchAll(async () => page([draft, pull]), CFG);
  assert.equal(r.items[0].type, "DraftIssue");
  assert.equal(r.items[0].url, null);
  assert.equal(r.items[0].title, "Draft idea");
  assert.equal(r.items[1].type, "PullRequest");
  assert.equal(r.items[1].key, "acme/widgets#12");
  assert.deepEqual(r.items[1].prs, []);
});

test("a failed later page keeps what was read and says the board is truncated", async () => {
  let n = 0;
  const gh = async () => (n++ === 0 ? page([issue()], true, "C1") : { code: 1, stdout: "", stderr: "HTTP 502: bad gateway\n" });
  const r = await fetchAll(gh, CFG);
  assert.equal(r.items.length, 1);
  assert.match(r.truncated, /502/);
  assert.equal(r.error, null);
});

test("a failed first page is an error, not an empty board", async () => {
  const r = await fetchAll(async () => ({ code: 1, stdout: "", stderr: "gh: not logged in\n" }), CFG);
  assert.match(r.error, /not logged in/);
});

test("GraphQL errors in the body are errors too", async () => {
  const r = await fetchAll(async () => ({ code: 0, stdout: JSON.stringify({ errors: [{ message: "Could not resolve to a ProjectV2" }] }), stderr: "" }), CFG);
  assert.match(r.error, /Could not resolve/);
});

test("pagination stops at a page cap and says so", async () => {
  let n = 0;
  const r = await fetchAll(async () => page([issue()], true, `C${++n}`), CFG, { maxPages: 3 });
  assert.equal(r.items.length, 3);
  assert.match(r.truncated, /3 pages/);
});

test("hasNextPage without a cursor stops and says so instead of looping", async () => {
  const r = await fetchAll(async () => page([issue()], true, null), CFG);
  assert.equal(r.items.length, 1);
  assert.ok(r.truncated);
});

// ---- the board ----

const items = (list) => list.map((o) => ({
  key: `acme/widgets#${o.number}`, title: o.title ?? "t", number: o.number, url: `https://x/${o.number}`, repo: "acme/widgets",
  status: o.status, priority: "priority" in o ? o.priority : "P1", updatedAt: o.updatedAt ?? "2026-01-01T00:00:00Z", type: "Issue", prs: o.prs ?? [],
}));

test("items land in the column whose statuses list theirs, columns in config order", () => {
  const b = buildBoard(items([
    { number: 1, status: "Blocked" }, { number: 2, status: "In progress" }, { number: 3, status: "Ready" }, { number: 4, status: "Needs answer" },
  ]), CFG, []);
  assert.deepEqual(b.columns.map((c) => c.name), ["NEEDS YOU", "WORKING", "UP NEXT"]);
  assert.deepEqual(b.columns.map((c) => c.cards.map((x) => x.number).sort()), [[1, 4], [2], [3]]);
  assert.deepEqual(b.counts, { "NEEDS YOU": 2, WORKING: 1, "UP NEXT": 1, DONE: 0 });
});

test("cards sort by priority order, then most recently updated", () => {
  const b = buildBoard(items([
    { number: 1, status: "Next", priority: "P2", updatedAt: "2026-03-01T00:00:00Z" },
    { number: 2, status: "Next", priority: "P0", updatedAt: "2026-01-01T00:00:00Z" },
    { number: 3, status: "Next", priority: "P0", updatedAt: "2026-02-01T00:00:00Z" },
  ]), CFG, []);
  assert.deepEqual(b.columns[2].cards.map((c) => c.number), [3, 2, 1]);
});

test("items outside the priorities or outside every column are hidden and counted", () => {
  const b = buildBoard(items([
    { number: 1, status: "Next", priority: "P3" }, { number: 2, status: "Icebox" }, { number: 3, status: "Next", priority: null }, { number: 4, status: "Next" },
  ]), CFG, []);
  assert.deepEqual(b.columns.flatMap((c) => c.cards.map((x) => x.number)), [4]);
  assert.equal(b.hidden, 3);
});

test("showUnprioritized and otherColumn let hidden items through", () => {
  const cfg = { ...CFG, showUnprioritized: true, otherColumn: "OTHER" };
  const b = buildBoard(items([{ number: 1, status: "Next", priority: null }, { number: 2, status: "Icebox" }, { number: 3, status: "Next", priority: "P9" }]), cfg, []);
  assert.deepEqual(b.columns.map((c) => c.name), ["NEEDS YOU", "WORKING", "UP NEXT", "OTHER"]);
  assert.deepEqual(b.columns[2].cards.map((c) => c.number).sort(), [1, 3]);
  assert.deepEqual(b.columns[3].cards.map((c) => c.number), [2]);
  assert.equal(b.hidden, 0);
});

test("done shows only the latest `limit` items, newest first, whatever their priority", () => {
  const b = buildBoard(items([
    { number: 1, status: "Done", updatedAt: "2026-01-01T00:00:00Z" },
    { number: 2, status: "Done", updatedAt: "2026-03-01T00:00:00Z", priority: null },
    { number: 3, status: "Done", updatedAt: "2026-02-01T00:00:00Z" },
  ]), CFG, []);
  assert.deepEqual(b.done.map((c) => c.number), [2, 3]);
  assert.equal(b.counts.DONE, 3);
});

// ---- live agents ----

const term = (address, card, status = "working", extra = {}) => ({ address, state: "live", status, labels: card ? { card } : {}, ...extra });

test("terminals labelled card=<owner/repo>#<N> attach to that card, several per card", () => {
  const m = cardAgents([term("t1", "acme/widgets#4"), term("t2", "acme/widgets#4", "blocked"), term("t3", null), term("t4", "acme/other#4")]);
  assert.deepEqual(m.get("acme/widgets#4").map((a) => a.address), ["t1", "t2"]);
  assert.equal(m.get("acme/other#4").length, 1);
  assert.equal(m.size, 2);
});

test("labels as a k=v array work too, matching is case-insensitive, finished terminals are ignored", () => {
  const m = cardAgents([
    { address: "t5", state: "live", status: "idle", labels: ["herdr.tab=x", "card=Acme/Widgets#9"] },
    term("t6", "acme/widgets#9", "done", { state: "exited" }),
  ]);
  assert.deepEqual(m.get("acme/widgets#9").map((a) => a.address), ["t5"]);
});

test("a card shows its agents' status, and a blocked one reads Needs you", () => {
  const b = buildBoard(items([{ number: 4, status: "In progress" }]), CFG, [term("t1", "acme/widgets#4", "blocked"), term("t2", "acme/widgets#4", "working")]);
  const card = b.columns[1].cards[0];
  assert.deepEqual(card.agents.map((a) => [a.address, a.status, a.label]), [["t1", "blocked", "Needs you"], ["t2", "working", "working"]]);
  assert.equal(card.needsYou, true);
});

test("an unknown agent status shows as idle", () => {
  const b = buildBoard(items([{ number: 4, status: "In progress" }]), CFG, [term("t1", "acme/widgets#4", null)]);
  assert.equal(b.columns[1].cards[0].agents[0].status, "idle");
});

test("excerpt keeps the last few non-empty lines, trimmed and shortened", () => {
  const screen = "first\n\n  second  \nthird\n\n" + "x".repeat(300) + "\n\n\n";
  const ex = excerpt(screen, 3);
  assert.deepEqual(ex.slice(0, 2), ["second", "third"]);
  assert.ok(ex[2].length <= 120 && ex[2].endsWith("…"));
  assert.deepEqual(excerpt("", 3), []);
  assert.deepEqual(excerpt(null, 3), []);
});

// ---- buttons ----

test("buttons: Open worker per agent, Open card, Open PR for the linked PR; never merge", () => {
  const pr = { number: 99, url: "https://github.com/acme/widgets/pull/99", state: "OPEN" };
  const b = buildBoard(items([{ number: 4, status: "In progress", prs: [{ number: 90, url: "https://x/pull/90", state: "CLOSED" }, pr] }]), CFG, [term("t1", "acme/widgets#4", "blocked")]);
  const btns = cardButtons(b.columns[1].cards[0]);
  assert.deepEqual(btns.map((x) => x.label), ["Open worker", "Open card", "Open PR"]);
  assert.deepEqual(btns[0], { label: "Open worker", run: ["agent.focus", { terminal: "t1" }] });
  assert.deepEqual(btns[1], { label: "Open card", exec: ["open", ["https://x/4"]] });
  assert.deepEqual(btns[2], { label: "Open PR", exec: ["open", [pr.url]] });
  assert.ok(!btns.some((x) => /merge/i.test(JSON.stringify(x))));
});

test("no URL, no PR, no agent → no such buttons", () => {
  const b = buildBoard([{ key: "draft:PVTI_d", title: "Draft", number: null, url: null, repo: null, status: "Next", priority: "P1", updatedAt: "2026-01-01T00:00:00Z", type: "DraftIssue", prs: [] }], CFG, []);
  assert.deepEqual(cardButtons(b.columns[2].cards[0]), []);
});

test("with only closed or merged PRs, Open PR opens the newest one", () => {
  const b = buildBoard(items([{ number: 4, status: "Next", prs: [{ number: 1, url: "https://x/pull/1", state: "MERGED" }, { number: 2, url: "https://x/pull/2", state: "CLOSED" }] }]), CFG, []);
  assert.deepEqual(cardButtons(b.columns[2].cards[0]).at(-1), { label: "Open PR", exec: ["open", ["https://x/pull/2"]] });
});

// ---- one fetch at a time ----

test("single() runs one call at a time; calls while busy are dropped", async () => {
  let runs = 0, release;
  const f = single(() => { runs++; return new Promise((r) => { release = r; }); });
  const a = f(); const b = f();
  assert.equal(runs, 1);
  assert.equal(b, null);
  release("ok");
  assert.equal(await a, "ok");
  const c = f();
  assert.equal(runs, 2);
  release("again");
  assert.equal(await c, "again");
});

// ---- opening ----

test("boardTab finds a tab already showing the board, else null (so the opener makes one)", () => {
  const panes = [
    { pane: "p1", terminal: "t1", tab: "tabA" },
    { pane: "p2", terminal: null, mod: "files", tab: "tabB" },
    { pane: "p3", terminal: null, mod: "zaksha-board", tab: "tabC" },
  ];
  assert.equal(boardTab(panes, "zaksha-board"), "tabC");
  assert.equal(boardTab(panes.slice(0, 2), "zaksha-board"), null);
  assert.equal(boardTab([], "zaksha-board"), null);
});

// ---- epics, filters and sort ----

test("the item query asks for each issue's parent and sub-issue summary", async () => {
  let q = "";
  await fetchAll(async (args) => { q = args.find((a) => a.startsWith("query=")); return page([]); }, CFG);
  assert.match(q, /parent\s*\{\s*number\s+title\s+url\s*\}/);
  assert.match(q, /subIssuesSummary\s*\{\s*total\s+completed\s+percentCompleted\s*\}/);
});

test("an issue with sub-issues is an epic; an issue with a parent knows its epic", async () => {
  const r = await fetchAll(async () => page([
    issue({ number: 1, title: "Synthetic epic", sub: { total: 3, completed: 1, percentCompleted: 33 }, parent: null }),
    issue({ number: 2, parent: { number: 1, title: "Synthetic epic", url: "https://github.com/acme/widgets/issues/1" }, sub: { total: 0, completed: 0, percentCompleted: 0 } }),
  ]), CFG);
  assert.equal(r.items[0].epic, true);
  assert.deepEqual(r.items[0].subIssues, { total: 3, completed: 1, percentCompleted: 33 });
  assert.equal(r.items[0].parent, null);
  assert.equal(r.items[1].epic, false);
  assert.deepEqual(r.items[1].parent, { key: "acme/widgets#1", number: 1, title: "Synthetic epic", url: "https://github.com/acme/widgets/issues/1" });
});

const EPIC_A = { key: "acme/widgets#100", number: 100, title: "Alpha epic", url: "https://github.com/acme/widgets/issues/100" };
const EPIC_B = { key: "acme/gadgets#200", number: 200, title: "Beta epic", url: "https://github.com/acme/gadgets/issues/200" };
const card = (o) => ({
  key: `${o.repo ?? "acme/widgets"}#${o.number}`, title: o.title ?? `Task ${o.number}`, number: o.number, url: `https://x/${o.number}`, repo: o.repo ?? "acme/widgets",
  status: o.status ?? "Next", priority: "priority" in o ? o.priority : "P1", updatedAt: o.updatedAt ?? "2026-01-01T00:00:00Z", type: "Issue", prs: [],
  state: o.state ?? "OPEN", parent: o.parent ?? null, subIssues: o.sub ?? null, epic: !!o.sub && o.sub.total > 0,
});
const epic = (e, o = {}) => card({ number: e.number, repo: e.key.split("#")[0], title: e.title, status: o.status ?? "In progress", priority: o.priority ?? "P1", state: o.state, sub: o.sub ?? { total: 4, completed: 1, percentCompleted: 25 } });
const nums = (cards) => cards.map((c) => c.number);
const allCards = (b) => b.columns.flatMap((c) => nums(c.cards));

test("ui state defaults: priority sort, every configured priority on, no text, no epic, columns view", () => {
  assert.deepEqual(uiState(CFG), { sort: "priority", priorities: ["P0", "P1", "P2"], text: "", epic: null, view: "columns", collapsed: [] });
});

test("saved ui state is restored; junk in it falls back to defaults", () => {
  const saved = { sort: "updated", priorities: ["P0", "P9"], text: "abc", epic: "acme/widgets#100", view: "epics", collapsed: ["no-epic"] };
  assert.deepEqual(uiState(CFG, saved), { sort: "updated", priorities: ["P0"], text: "abc", epic: "acme/widgets#100", view: "epics", collapsed: ["no-epic"] });
  assert.deepEqual(uiState(CFG, { sort: "sideways", priorities: "P0", text: 5, view: "grid", collapsed: null }), uiState(CFG));
  assert.deepEqual(uiState(CFG, "garbage"), uiState(CFG));
});

test("priority sort (default): P0, P1, P2, then no priority, each newest first", () => {
  const cfg = { ...CFG, showUnprioritized: true };
  const b = buildBoard([
    card({ number: 1, priority: null, updatedAt: "2026-05-01T00:00:00Z" }),
    card({ number: 2, priority: "P2", updatedAt: "2026-04-01T00:00:00Z" }),
    card({ number: 3, priority: "P0", updatedAt: "2026-01-01T00:00:00Z" }),
    card({ number: 4, priority: "P1", updatedAt: "2026-02-01T00:00:00Z" }),
    card({ number: 5, priority: "P0", updatedAt: "2026-03-01T00:00:00Z" }),
  ], cfg, []);
  assert.deepEqual(nums(b.columns[2].cards), [5, 3, 4, 2, 1]);
});

test("updated sort ignores priority: newest first", () => {
  const cfg = { ...CFG, showUnprioritized: true };
  const b = buildBoard([
    card({ number: 1, priority: null, updatedAt: "2026-05-01T00:00:00Z" }),
    card({ number: 2, priority: "P2", updatedAt: "2026-04-01T00:00:00Z" }),
    card({ number: 3, priority: "P0", updatedAt: "2026-01-01T00:00:00Z" }),
  ], cfg, [], { ...uiState(cfg), sort: "updated" });
  assert.deepEqual(nums(b.columns[2].cards), [1, 2, 3]);
});

test("priority chips: only the switched-on priorities show", () => {
  const list = [card({ number: 1, priority: "P0" }), card({ number: 2, priority: "P1" }), card({ number: 3, priority: "P2" })];
  const b = buildBoard(list, CFG, [], { ...uiState(CFG), priorities: ["P0", "P2"] });
  assert.deepEqual(allCards(b).sort(), [1, 3]);
});

test("text filter: case-insensitive over title, #number, repo name and the parent epic's title", () => {
  const list = [
    card({ number: 11, title: "Fix the Login page" }),
    card({ number: 12, repo: "acme/gadgets", title: "x" }),
    card({ number: 13, title: "y", parent: EPIC_A }),
    card({ number: 14, title: "z" }),
  ];
  const f = (text) => allCards(buildBoard(list, CFG, [], { ...uiState(CFG), text })).sort((a, b) => a - b);
  assert.deepEqual(f("login"), [11]);
  assert.deepEqual(f("#14"), [14]);
  assert.deepEqual(f("GADGETS"), [12]);
  assert.deepEqual(f("alpha"), [13]);
  assert.deepEqual(f(""), [11, 12, 13, 14]);
  assert.deepEqual(f("nothing-matches"), []);
});

test("epic filter: only that epic's sub-issues show, in every column and in done", () => {
  const list = [
    card({ number: 1, status: "Blocked", parent: EPIC_A }), card({ number: 2, status: "In progress", parent: EPIC_A }),
    card({ number: 3, status: "Next", parent: EPIC_B }), card({ number: 4, status: "Next" }),
    card({ number: 5, status: "Done", parent: EPIC_A }), card({ number: 6, status: "Done" }),
  ];
  const b = buildBoard(list, CFG, [], { ...uiState(CFG), epic: EPIC_A.key });
  assert.deepEqual(b.columns.map((c) => nums(c.cards)), [[1], [2], []]);
  assert.deepEqual(nums(b.done), [5]);
});

test("epics leave the columns and show in the epic bar: open ones, most open sub-issues first", () => {
  const list = [
    epic(EPIC_A, { sub: { total: 5, completed: 4, percentCompleted: 80 } }),
    epic(EPIC_B, { sub: { total: 6, completed: 2, percentCompleted: 33 } }),
    epic({ key: "acme/widgets#300", number: 300, title: "Closed epic" }, { state: "CLOSED" }),
    card({ number: 1, parent: EPIC_A }),
  ];
  const b = buildBoard(list, CFG, [term("t9", "acme/widgets#100", "working")]);
  assert.deepEqual(allCards(b), [1]);
  assert.deepEqual(nums(b.done), []);
  assert.equal(b.hidden, 0);
  assert.deepEqual(b.epics.map((e) => [e.key, e.title, e.completed, e.total]), [[EPIC_B.key, "Beta epic", 2, 6], [EPIC_A.key, "Alpha epic", 4, 5]]);
  assert.deepEqual(b.epics[1].agents.map((a) => a.address), ["t9"]);
});

test("the epic bar ignores the priority chips, the text and the epic filter", () => {
  const list = [epic(EPIC_A, { priority: "P2" }), epic(EPIC_B, { priority: "P0" })];
  const b = buildBoard(list, CFG, [], { ...uiState(CFG), priorities: ["P0"], text: "zzz", epic: EPIC_B.key });
  assert.equal(b.epics.length, 2);
});

test("toggleEpic sets the epic filter, and the same epic again clears it", () => {
  const u = toggleEpic(uiState(CFG), EPIC_A.key);
  assert.equal(u.epic, EPIC_A.key);
  assert.equal(toggleEpic(u, EPIC_B.key).epic, EPIC_B.key);
  assert.equal(toggleEpic(u, EPIC_A.key).epic, null);
  assert.equal(toggleEpic(u, null).epic, null);
});

test("by epic: one row per open epic in bar order, then No epic; rows with no visible cards are hidden", () => {
  const list = [
    epic(EPIC_A, { sub: { total: 2, completed: 1, percentCompleted: 50 } }),
    epic(EPIC_B, { sub: { total: 9, completed: 1, percentCompleted: 11 } }),
    epic({ key: "acme/widgets#300", number: 300, title: "Empty epic" }, { sub: { total: 1, completed: 0, percentCompleted: 0 } }),
    card({ number: 1, status: "Blocked", parent: EPIC_A }), card({ number: 2, status: "Next", parent: EPIC_A }),
    card({ number: 3, status: "In progress", parent: EPIC_B }),
    card({ number: 4, status: "Next" }),
    card({ number: 5, status: "Done", parent: EPIC_B }),
  ];
  const b = buildBoard(list, CFG, []);
  assert.deepEqual(b.rows.map((r) => [r.key, r.title, r.completed, r.total]), [
    [EPIC_B.key, "Beta epic", 1, 9], [EPIC_A.key, "Alpha epic", 1, 2], ["no-epic", "No epic", null, null],
  ]);
  assert.deepEqual(b.rows[0].columns.map((c) => nums(c.cards)), [[], [3], []]);
  assert.deepEqual(nums(b.rows[0].done), [5]);
  assert.deepEqual(b.rows[1].columns.map((c) => nums(c.cards)), [[1], [], [2]]);
  assert.deepEqual(b.rows[2].columns.map((c) => nums(c.cards)), [[], [], [4]]);
});

test("by epic: filters apply, and a row emptied by them is hidden", () => {
  const list = [epic(EPIC_A), epic(EPIC_B), card({ number: 1, parent: EPIC_A, title: "keep me" }), card({ number: 2, parent: EPIC_B }), card({ number: 3 })];
  assert.deepEqual(buildBoard(list, CFG, [], { ...uiState(CFG), text: "keep" }).rows.map((r) => r.key), [EPIC_A.key]);
  assert.deepEqual(buildBoard(list, CFG, [], { ...uiState(CFG), epic: EPIC_B.key }).rows.map((r) => r.key), [EPIC_B.key]);
});

test("counts reflect the filtered view, with the unfiltered total of column cards", () => {
  const list = [
    epic(EPIC_A),
    card({ number: 1, status: "Blocked", parent: EPIC_A }), card({ number: 2, status: "In progress" }),
    card({ number: 3, status: "Next", parent: EPIC_A }), card({ number: 4, status: "Next", priority: "P2" }),
    card({ number: 5, status: "Done", parent: EPIC_A }), card({ number: 6, status: "Done" }),
  ];
  const all = buildBoard(list, CFG, []);
  assert.deepEqual(all.counts, { "NEEDS YOU": 1, WORKING: 1, "UP NEXT": 2, DONE: 2 });
  assert.equal(all.total, 4);
  const f = buildBoard(list, CFG, [], { ...uiState(CFG), epic: EPIC_A.key });
  assert.deepEqual(f.counts, { "NEEDS YOU": 1, WORKING: 0, "UP NEXT": 1, DONE: 1 });
  assert.equal(f.total, 4);
});

test("the item query asks for each issue's GitHub state", async () => {
  let q = "";
  await fetchAll(async (args) => { q = args.find((a) => a.startsWith("query=")); return page([]); }, CFG);
  assert.match(q, /\.\.\. on Issue \{ title number url state\b/);
});

test("an open epic is one whose GitHub state is OPEN, whatever its board Status", () => {
  const list = [
    epic(EPIC_A, { status: "Done", state: "OPEN" }),
    epic(EPIC_B, { status: "In progress", state: "CLOSED" }),
  ];
  const b = buildBoard(list, CFG, []);
  assert.deepEqual(b.epics.map((e) => e.key), [EPIC_A.key]);
});

test("draft: typing changes the text without saving; commit saves once, and only a change", () => {
  const saves = [];
  const d = draft((v) => saves.push(v), "abc");
  assert.equal(d.get(), "abc");
  d.set("abcd"); d.set("abcde");
  assert.equal(d.get(), "abcde");
  assert.deepEqual(saves, []);
  d.commit(); d.commit();
  assert.deepEqual(saves, ["abcde"]);
  d.set("x"); d.set("abcde"); d.commit();
  assert.deepEqual(saves, ["abcde"]);
});
