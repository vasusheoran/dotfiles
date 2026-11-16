// Behavior tests for the Inbox by epic (kuchbhi#1115): the epic rows, their groups by Area, the folded finished epics, the filter, the bundled question
// of a lead (parts), the lead's status line and the answer line. Run: node --test herdr-app/.config/herdr-app/mods/agents-view/*.test.js. All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsks, parseJsonl, viewModel, epicList, leadStatuses, answerLine, acceptRecommended, groupName, askView, boardStep, flatRows, paneFor, headerLine, footerHint, defaultKey, askAt, stepAsk, bottomPlan } from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000;
const iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const J = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
const ASK = (id, epic, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic, from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`,
  body: "Q\n\n1. Hero?\n   a) Ads line (Recommended) => matches\n   b) Keep => as is\n", today: "t", after: "a", checked: "c", why_you: "w", batch_key: `decide:${epic}`,
  options: [{ q: 1, key: "a", label: "Ads line (Recommended)", then: "matches" }, { q: 1, key: "b", label: "Keep", then: "as is" }], ...o });
const PART = (id, q, o = {}) => ({ ts: iso(20), event: "part", id, card: "o/r#99", q, question: `Part ${q}`, title: `Part ${q}`, today: "t2", after: "a2", checked: "c2", why_you: "w2",
  options: [{ q, key: "a", label: "Yes (Recommended)", then: "one strip" }, { q, key: "b", label: "No", then: "link only" }],
  body: `Part ${q}\n\n${q}. Show prices?\n   a) Yes (Recommended) => one strip\n   b) No => link only\n`, part_body: "Part\n\n1. Show prices?\n", ...o });
const term = (o) => ({ address: "t1", name: "lead-r-1", state: "live", status: { state: "working" }, labels: ["role=lead", "epic=o/r#1"], ...o });
const closedJson = (o) => JSON.stringify({ at: iso(1), closed: [], titles: {}, areas: {}, origin: {}, ...o });
const vm = (o) => viewModel({ terminals: [], asksText: "", eventsText: "", closedJson: closedJson(), nowMs: NOW, ...o });

test("a part joins the open ask: options, body, parts", () => {
  const [a] = openAsks(parseJsonl(J(ASK("a-1", "o/r#1"), PART("a-1", 2), PART("a-1", 3))), NOW);
  assert.deepEqual([...new Set(a.options.map((o) => o.q))], [1, 2, 3]);
  assert.match(a.body, /2\. Show prices\?/);
  assert.deepEqual(a.parts.map((p) => [p.q, p.card]), [[2, "o/r#99"], [3, "o/r#99"]]);
});
test("a part of an ask that is not open changes nothing", () => {
  assert.deepEqual(openAsks(parseJsonl(J(PART("gone", 2))), NOW), []);
});
test("the newest lead_status per epic wins; a missing text is ignored", () => {
  const s = leadStatuses(parseJsonl(J({ ts: iso(50), event: "lead_status", epic: "o/r#1", text: "old" }, { ts: iso(5), event: "lead_status", epic: "o/r#1", text: "new", terminal: "lead-r-1" }, { ts: iso(2), event: "lead_status", epic: "o/r#2" })));
  assert.deepEqual(s["o/r#1"], { text: "new", ts: iso(5), terminal: "lead-r-1" });
  assert.equal(s["o/r#2"], undefined);
});

test("one row per epic: its asks, its status, its age; area groups with friendly names, fallback the repo", () => {
  const m = vm({ asksText: J(ASK("a-1", "o/r#1"), ASK("a-2", "x/y#5")), closedJson: closedJson({ titles: { "o/r#1": "Epic 1: agents", "x/y#5": "Epic 5" }, areas: { "o/r#1": "agents" } }) });
  const l = epicList(m.epics, {});
  assert.deepEqual(l.groups.map((g) => g.name), ["Agent tooling", "y"]);
  const e = l.groups[0].epics[0];
  assert.equal(e.title, "Epic 1: agents"); assert.equal(e.state, "needs"); assert.equal(e.asks.length, 1); assert.equal(e.num, 1);
  assert.equal(groupName("gtm", "o/r#1"), "Marketing"); assert.equal(groupName(undefined, "o/r#1"), "r"); assert.equal(groupName("newthing", "o/r#1"), "Newthing");
});
test("a bundled ask is one row whose question has every part", () => {
  const m = vm({ asksText: J(ASK("a-1", "o/r#1"), PART("a-1", 2), PART("a-1", 3)) });
  assert.equal(m.epics.length, 1);
  assert.equal(m.epics[0].asks.length, 1);
  assert.equal(askView(m.epics[0].asks[0], {}, null).questions.length, 3);
});
test("inside a group: needs you, stuck, working; the finished fold into one row at the end", () => {
  const closed = closedJson({ closed: ["o/r#4"], titles: { "o/r#1": "A", "o/r#2": "B", "o/r#3": "C", "o/r#4": "D" }, areas: { "o/r#1": "agents", "o/r#2": "agents", "o/r#3": "agents", "o/r#4": "agents" } });
  const terms = [term({ labels: ["role=lead", "epic=o/r#1"] }), term({ address: "t2", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] }), term({ address: "t3", name: "lead-r-3", labels: ["role=lead", "epic=o/r#3"] }), term({ address: "t4", name: "lead-r-4", labels: ["role=lead", "epic=o/r#4"] })];
  terms[1].status = { state: "blocked" };
  const m = vm({ terminals: terms, closedJson: closed, asksText: J(ASK("a-3", "o/r#3")) });
  const l = epicList(m.epics, {});
  assert.deepEqual(l.groups[0].epics.map((e) => [e.num, e.state]), [[3, "needs"], [2, "stuck"], [1, "working"]]);
  assert.equal(l.finished.count, 1); assert.deepEqual(l.finished.epics.map((e) => e.num), [4]);
  assert.equal(l.rows.at(-1).kind, "fold"); assert.equal(l.rows.at(-1).label, "1 finished");
  assert.equal(epicList(m.epics, { unfolded: true }).rows.slice(-2).map((r) => r.kind).join(), "fold,epic");
});
test("the doing line: lead_status, then the open ask's title, then the last /work phase", () => {
  const closed = closedJson({ origin: { "o/r#1": { by: "agent", summary: "", trail: ["Validate", "Tests"] } } });
  const t = [term({}), term({ address: "t2", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] }), term({ address: "t3", name: "lead-r-3", labels: ["role=lead", "epic=o/r#3"] })];
  const m = vm({ terminals: t, closedJson: closed, asksText: J(ASK("a-2", "o/r#2"), { ts: iso(3), event: "lead_status", epic: "o/r#3", text: "Writing the tests" }) });
  const by = Object.fromEntries(m.epics.map((e) => [e.num, e.line]));
  assert.equal(by[3], "Writing the tests"); assert.equal(by[2], "Title a-2"); assert.equal(by[1], "Tests");
});
test("PR badges: a waiting merge is yellow, a landed one purple", () => {
  const merge = ASK("a-5", "o/r#1", { kind: "merge", batch_key: "merge:o/r#1", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land" }] });
  const m = vm({ asksText: J(merge, { ts: iso(1), event: "landed", id: "a-5" }) });
  assert.deepEqual(m.epics[0].prs, [{ pr: 5, state: "merged" }]);
  assert.deepEqual(vm({ asksText: J(merge) }).epics[0].prs, [{ pr: 5, state: "waiting" }]);
});
test("the lead and the workers of an epic; an epic without a lead uses its session", () => {
  const t = [term({}), term({ address: "t2", name: "card-r-3", labels: ["role=worker", "epic=o/r#1", "card=o/r#3"] }), term({ address: "t3", name: "sess", labels: ["epic=o/r#2"] })];
  const m = vm({ terminals: t });
  const e = Object.fromEntries(m.epics.map((x) => [x.num, x]));
  assert.equal(e[1].lead.name, "lead-r-1"); assert.deepEqual(e[1].workers.map((w) => w.name), ["card-r-3"]); assert.equal(e[2].lead.name, "sess");
});

test("the filter narrows epics by title, number or area; none match is empty", () => {
  const m = vm({ asksText: J(ASK("a-1", "o/r#1"), ASK("a-2", "o/r#22")), closedJson: closedJson({ titles: { "o/r#1": "Marketing site", "o/r#22": "Hooks" }, areas: { "o/r#1": "gtm", "o/r#22": "agents" } }) });
  const names = (f) => epicList(m.epics, { filter: f }).groups.flatMap((g) => g.epics.map((e) => e.num));
  assert.deepEqual(names("market"), [1]); assert.deepEqual(names("22"), [22]); assert.deepEqual(names("#22"), [22]); assert.deepEqual(names("agent"), [22]); assert.deepEqual(names("zzz"), []); assert.deepEqual(names(""), [22, 1], "Agent tooling before Marketing");
});

test("the answer line: picks over recommended; Enter sends every recommended option, a pick changes one", () => {
  const [a] = openAsks(parseJsonl(J(ASK("a-1", "o/r#1"), PART("a-1", 2), PART("a-1", 3))), NOW);
  assert.equal(answerLine(a, {}), "1 – · 2 – · 3 –");
  assert.equal(answerLine(a, { 3: "3b: No" }), "1 – · 2 – · 3b");
  assert.equal(acceptRecommended(a, null, NOW, {}).key, "1a,2a,3a");
  assert.equal(acceptRecommended(a, null, NOW, { 3: "3b: No" }).key, "1a,2a,3b");
  });

test("b: the board is selected where it is open; none open says so", () => {
  const spaces = [{ id: "s1", name: "Work", tabs: [{ id: "tab1", name: "Shell" }] }, { id: "s2", name: "Board", tabs: [{ id: "tab2", name: "Board" }] }];
  const panes = [{ pane: "p1", tab: "tab1", mod: "agents-view" }, { pane: "p2", tab: "tab2", mod: "zaksha-board" }];
  const r = boardStep({ spaces, panes, epic: "o/r#1" });
  assert.deepEqual(r.steps, [["space.select", { id: "s2" }], ["tab.select", { id: "tab2" }]]); assert.equal(r.share, "o/r#1"); assert.equal(r.receipt, "");
  const none = boardStep({ spaces, panes: [panes[0]], epic: "o/r#1" });
  assert.deepEqual(none.steps, []); assert.equal(none.receipt, "no board open · ctrl-b b opens it");
  assert.equal(boardStep({ spaces, panes, epic: null }).receipt, "no epic selected");
});

test("flatRows: the desk, one row per epic in the list's order, the fold row; no batch rows", () => {
  const closed = closedJson({ closed: ["o/r#4"], titles: { "o/r#4": "D" }, areas: { "o/r#1": "agents" } });
  const m = vm({ terminals: [term({}), term({ address: "t4", name: "lead-r-4", labels: ["role=lead", "epic=o/r#4"] })], closedJson: closed, asksText: J(ASK("a-1", "o/r#1")) });
  const rows = flatRows(m, {});
  assert.deepEqual(rows.map((r) => r.section), ["desk", "epic", "fold", "summary"]);
  assert.equal(rows[1].key, "epic:o/r#1"); assert.equal(rows[1].row.asks[0].id, "a-1");
  assert.deepEqual(flatRows(m, { unfolded: true }).map((r) => r.section), ["desk", "epic", "fold", "epic", "summary"]);
  assert.deepEqual(flatRows(m, { filter: "zzz" }).map((r) => r.section), ["desk", "summary"]);
});
test("paneFor: an epic with an ask shows the ask (the place kept in pos); one without shows its overview", () => {
  const m = vm({ terminals: [term({}), term({ address: "t2", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] })], asksText: J(ASK("a-1", "o/r#1"), ASK("a-2", "o/r#1", { kind: "merge", batch_key: "merge:o/r#1" })) });
  const rows = flatRows(m, {}), one = rows.find((r) => r.key === "epic:o/r#1"), two = rows.find((r) => r.key === "epic:o/r#2");
  const p = paneFor(one, m, {}); assert.equal(p.kind, "ask"); assert.equal(p.ask.id, "a-1"); assert.equal(p.thread, "a-1");
  assert.equal(paneFor(one, m, stepAsk({}, one.row, "right")).ask.id, "a-2");
  const q = paneFor(two, m, {}); assert.equal(q.kind, "epic"); assert.equal(q.epic.ref, "o/r#2"); assert.equal(q.thread, "epic:o/r#2");
  assert.equal(paneFor(rows.find((r) => r.section === "desk"), m, {}).kind, "desk");
});
test("the first epic is selected until the owner moves; the header counts epics", () => {
  const m = vm({ terminals: [term({})], asksText: J(ASK("a-1", "o/r#1")) });
  assert.equal(defaultKey(flatRows(m, {})), "epic:o/r#1");
  assert.deepEqual(headerLine(m), { inbox: "1 epic needs you", run: "0 working · 0 stuck" });
  assert.equal(headerLine(vm({})).inbox, "Nothing needs you");
  assert.match(footerHint("epic"), /f filter/); assert.match(footerHint("epic"), /B board/); assert.match(footerHint("fold"), /space/);
});

test("the agent pane follows the epic's lead, never the worker whose ask it is", () => {
  const terms = [term({}), term({ address: "t2", name: "card-r-3", labels: ["role=worker", "epic=o/r#1", "card=o/r#3"] })];
  const m = vm({ terminals: terms, asksText: J(ASK("a-3", "o/r#1", { from: "worker", terminal: "card-r-3" })) });
  const pane = paneFor(flatRows(m, {}).find((r) => r.section === "epic"), m, {});
  const p = bottomPlan({ pane, vm: m, pinned: null, last: null, shown: null, bottom: null, own: "p1", on: true });
  assert.equal(p.mode, "follow"); assert.equal(p.name, "lead-r-1"); assert.equal(p.address, "t1");
  const none = vm({ terminals: [], asksText: J(ASK("a-3", "o/r#1")) });
  assert.equal(bottomPlan({ pane: paneFor(flatRows(none, {}).find((r) => r.section === "epic"), none, {}), vm: none, pinned: null, last: null, shown: null, bottom: null, own: "p1", on: true }).mode, "none");
});

test("the board's request flag is the same string on both sides", async () => {
  const { BOARD_EPIC } = await import("./lib.js"), { EPIC_REQUEST } = await import("../zaksha-board/lib.js");
  assert.equal(BOARD_EPIC, EPIC_REQUEST);
});
