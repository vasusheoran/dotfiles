// Behavior tests for the board's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/zaksha-board/
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, fetchAll, buildBoard, cardAgents, excerpt, cardButtons, single, boardTab } from "./lib.js";

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
    title: o.title ?? `Synthetic task ${seq}`, number: o.number ?? seq, url: `https://github.com/acme/widgets/issues/${o.number ?? seq}`,
    repository: { nameWithOwner: o.repo ?? "acme/widgets" },
    closedByPullRequestsReferences: { nodes: o.prs ?? [] },
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
