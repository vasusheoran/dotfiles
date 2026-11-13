// Behavior tests for the agents view's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/agents-view/*.test.js
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonl, openAsks, usageText, normalize, stuckRows, epicGroups, otherSessions, ageText, shortCard, flatRows, viewModel,
} from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const iso = (agoMs) => new Date(NOW - agoMs).toISOString();

// a normalised terminal
const T = (o) => ({ address: "t1", name: null, live: true, labels: {}, state: null, kind: null, msg: null, statusMs: null, where: null, ...o });
const EPIC = "acme/app#10";
const lead = (o = {}) => T({ address: "tL", name: "lead-app-10", labels: { role: "lead", epic: EPIC }, state: "working", ...o });
const worker = (o = {}) => T({ address: "tW", name: "card-app-12", labels: { role: "worker", epic: EPIC, card: "acme/app#12", model: "sonnet" }, state: "working", ...o });
const ask = (card, agoMs, o = {}) => ({ ts: iso(agoMs), event: "ask", card, epic: EPIC, url: `https://example.test/${card}`, question: `q ${card}`, ...o });
const resumed = (card, agoMs) => ({ ts: iso(agoMs), event: "resumed", card });
const start = (name, agoMs, o = {}) => ({ ts: iso(agoMs), event: "start", name, address: "tX", role: "worker", epic: EPIC, card: "acme/app#12", model: "sonnet", ...o });
const stop = (name, agoMs, reason) => ({ ts: iso(agoMs), event: "stop", name, reason });

test("parseJsonl: empty, blank lines and a broken line", () => {
  assert.deepEqual(parseJsonl(""), []);
  assert.deepEqual(parseJsonl(null), []);
  assert.deepEqual(parseJsonl('{"a":1}\n\n   \n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseJsonl('{"a":1}\n{oops\n{"c":3}'), [{ a: 1 }, { c: 3 }]);
  assert.deepEqual(parseJsonl("[1]\n42\n{\"a\":1}"), [{ a: 1 }]);
});

test("openAsks: resumed closes the card's ask", () => {
  assert.deepEqual(openAsks([ask("acme/app#12", 2 * HOUR), resumed("acme/app#12", HOUR)], NOW), []);
});

test("openAsks: a second ask after a resume stays open, alone", () => {
  const r = openAsks([ask("acme/app#12", 3 * HOUR), resumed("acme/app#12", 2 * HOUR), ask("acme/app#12", HOUR, { question: "again" })], NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].question, "again");
});

test("openAsks: two asks on one card with no resume give one row, the last", () => {
  const r = openAsks([ask("acme/app#12", 3 * HOUR, { question: "first" }), ask("acme/app#12", HOUR, { question: "last" })], NOW);
  assert.deepEqual(r.map((a) => a.question), ["last"]);
});

test("openAsks: asks from two epics, oldest first, with age from ts", () => {
  const r = openAsks([
    ask("acme/app#12", 5 * MIN),
    ask("acme/web#7", 3 * HOUR, { epic: "acme/web#2" }),
  ], NOW);
  assert.deepEqual(r.map((a) => a.card), ["acme/web#7", "acme/app#12"]);
  assert.equal(r[0].ageMs, 3 * HOUR);
  assert.equal(r[0].epic, "acme/web#2");
  assert.equal(r[1].url, "https://example.test/acme/app#12");
});

test("openAsks: nothing in, nothing out", () => {
  assert.deepEqual(openAsks([], NOW), []);
});

test("usageText", () => {
  const both = { limits: [{ kind: "weekly_all", percent: 69 }, { kind: "weekly_scoped", percent: 85, scope: { model: { display_name: "Fable" } } }] };
  assert.equal(usageText(both), "week 69% · Fable 85%");
  assert.equal(usageText({ limits: [{ kind: "weekly_all", percent: 69 }] }), "week 69%");
  assert.equal(usageText(null), "");
  assert.equal(usageText({}), "");
  assert.equal(usageText({ limits: [{ kind: "session", percent: 3 }] }), "");
});

test("normalize: the terminals() shape", () => {
  const n = normalize({ address: "t9", name: "x", state: "live", labels: ["role=worker", "epic=acme/app#10"], status: "blocked", report: { kind: "permission", msg: "run rm?", status_ms: 123 }, where: "w" });
  assert.deepEqual(n, { address: "t9", name: "x", live: true, labels: { role: "worker", epic: "acme/app#10" }, state: "blocked", kind: "permission", msg: "run rm?", statusMs: 123, where: "w" });
});

test("normalize: object status, null labels, finished, where from labels", () => {
  const n = normalize({ address: "t9", state: "exited", labels: null, status: { state: "error", kind: "auth", msg: "m" }, status_ms: 5 });
  assert.equal(n.live, false);
  assert.deepEqual(n.labels, {});
  assert.deepEqual([n.state, n.kind, n.msg, n.statusMs, n.name, n.where], ["error", "auth", "m", 5, null, null]);
  assert.equal(normalize({ address: "t9", labels: { where: "home" } }).where, "home");
  assert.equal(normalize({ address: "t9" }).live, true);
  assert.equal(normalize({ address: "t9" }).state, null);
});

test("stuckRows: blocked, with kind, msg and age", () => {
  const r = stuckRows([lead(), worker({ state: "blocked", kind: "permission", msg: "run rm?", statusMs: NOW - 5 * MIN })], [], [], NOW);
  assert.deepEqual(r, [{ kind: "blocked", name: "card-app-12", text: "permission prompt: run rm?", ageMs: 5 * MIN, address: "tW" }]);
});

test("stuckRows: blocked kinds and no age without a status time", () => {
  const text = (kind, msg) => stuckRows([lead(), T({ address: "tB", name: "b", state: "blocked", kind, msg })], [], [], NOW)[0];
  assert.equal(text("question", null).text, "question");
  assert.equal(text("auth", null).text, "sign-in needed");
  assert.equal(text(null, null).text, "blocked");
  assert.equal(text(null, null).ageMs, null);
});

test("stuckRows: error, named by address when unnamed", () => {
  const r = stuckRows([T({ address: "t7", state: "error", statusMs: NOW - HOUR })], [], [], NOW);
  assert.deepEqual(r, [{ kind: "error", name: "t7", text: "error", ageMs: HOUR, address: "t7" }]);
});

test("stuckRows: gone worker, aged from its latest event", () => {
  const r = stuckRows([lead()], [start("card-app-12", 2 * HOUR), stop("card-app-12", HOUR, "lost")], [], NOW);
  assert.deepEqual(r, [{ kind: "gone", name: "card-app-12", text: "terminal gone, no question", ageMs: HOUR, address: null }]);
});

test("stuckRows: gone worker with a live terminal of that name is fine", () => {
  assert.deepEqual(stuckRows([lead(), worker()], [start("card-app-12", HOUR)], [], NOW), []);
});

test("stuckRows: gone worker with an open ask is not stuck", () => {
  const a = openAsks([ask("acme/app#12", HOUR)], NOW);
  assert.deepEqual(stuckRows([lead()], [start("card-app-12", 2 * HOUR), stop("card-app-12", HOUR, "exit")], a, NOW), []);
});

test("stuckRows: gone worker whose latest stop is retired is not stuck", () => {
  assert.deepEqual(stuckRows([lead()], [start("card-app-12", 3 * HOUR), stop("card-app-12", HOUR, "retired")], [], NOW), []);
});

test("stuckRows: a retired stop before a newer start does not hide it", () => {
  const r = stuckRows([lead()], [start("card-app-12", 5 * HOUR), stop("card-app-12", 4 * HOUR, "retired"), start("card-app-12", 3 * HOUR)], [], NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "gone");
});

test("stuckRows: gone leads are not listed, and gone rows older than 7 days drop", () => {
  assert.deepEqual(stuckRows([], [start("lead-app-10", HOUR, { role: "lead" })], [], NOW), []);
  assert.deepEqual(stuckRows([lead()], [start("card-app-12", 8 * DAY)], [], NOW), []);
  assert.equal(stuckRows([lead()], [start("card-app-12", 6 * DAY)], [], NOW).length, 1);
});

test("stuckRows: a not-live terminal of that name still counts as gone", () => {
  const r = stuckRows([lead(), worker({ live: false })], [start("card-app-12", HOUR)], [], NOW);
  assert.deepEqual(r.map((x) => x.kind), ["gone"]);
});

test("stuckRows: worker with no lead", () => {
  const r = stuckRows([worker()], [], [], NOW);
  assert.deepEqual(r, [{ kind: "no-lead", name: "card-app-12", text: "no lead running", ageMs: null, address: "tW" }]);
  assert.deepEqual(stuckRows([worker(), lead()], [], [], NOW), []);
  assert.equal(stuckRows([worker(), lead({ live: false })], [], [], NOW).length, 1);
  assert.deepEqual(stuckRows([worker({ labels: { role: "worker" } })], [], [], NOW), []);
});

test("stuckRows: blocked worker with no lead appears once, as blocked", () => {
  const r = stuckRows([worker({ state: "blocked", kind: "question" })], [], [], NOW);
  assert.deepEqual(r.map((x) => x.kind), ["blocked"]);
});

test("stuckRows: finished terminals are ignored by the live rules; order is blocked, error, gone, no-lead", () => {
  const dead = [worker({ live: false, state: "blocked" }), T({ address: "tD", live: false, state: "error" })];
  assert.deepEqual(stuckRows([lead(), ...dead], [], [], NOW), []);
  const r = stuckRows([
    worker({ address: "tN", name: "card-app-13", labels: { role: "worker", epic: "acme/app#99" } }),
    T({ address: "tE", name: "e", state: "error" }),
    T({ address: "tB", name: "b", state: "blocked" }),
    lead(),
  ], [start("card-app-14", HOUR)], [], NOW);
  assert.deepEqual(r.map((x) => x.kind), ["blocked", "error", "gone", "no-lead"]);
});

test("epicGroups: lead first, workers sorted, comma card uses the first, state or starting", () => {
  const w2 = worker({ address: "tW2", name: "card-app-9", labels: { role: "worker", epic: EPIC, card: "acme/app#9,acme/app#8" }, state: null });
  const g = epicGroups([worker(), w2, lead(), T({ address: "tS", name: "side", labels: { role: "side", epic: EPIC }, state: "idle" })]);
  assert.equal(g.length, 1);
  assert.equal(g[0].epic, EPIC);
  assert.deepEqual(g[0].rows.map((r) => r.name), ["lead-app-10", "card-app-12", "card-app-9", "side"]);
  assert.deepEqual(g[0].rows[2], { name: "card-app-9", address: "tW2", role: "worker", card: "acme/app#9", model: null, state: "starting" });
  assert.equal(g[0].rows[1].model, "sonnet");
});

test("epicGroups: groups ordered by epic; unlabelled, null-labelled and finished terminals skipped", () => {
  const g = epicGroups([
    T({ address: "t2", name: "b", labels: { epic: "acme/web#2" } }),
    T({ address: "t1", name: "a", labels: { epic: "acme/app#10" } }),
    T({ address: "t3", labels: {} }), normalize({ address: "t4", labels: null }),T({ address: "t5", labels: { epic: "acme/app#10" }, live: false }),
  ]);
  assert.deepEqual(g.map((x) => x.epic), ["acme/app#10", "acme/web#2"]);
  assert.equal(g[0].rows.length, 1);
});

test("otherSessions: agents without an epic; status-less, epic and finished terminals excluded", () => {
  const r = otherSessions([
    T({ address: "t1", name: "me", state: "working", where: "home" }),
    T({ address: "t2", state: "idle" }),
    T({ address: "t3" }),
    T({ address: "t4", state: "working", labels: { epic: EPIC } }),
    T({ address: "t5", state: "working", live: false }),
  ]);
  assert.deepEqual(r, [{ name: "me", address: "t1", where: "home", state: "working" }, { name: "t2", address: "t2", where: null, state: "idle" }]);
});

test("ageText boundaries", () => {
  assert.equal(ageText(0), "<1m");
  assert.equal(ageText(59_999), "<1m");
  assert.equal(ageText(MIN), "1m");
  assert.equal(ageText(59 * MIN), "59m");
  assert.equal(ageText(HOUR), "1h");
  assert.equal(ageText(23 * HOUR + 59 * MIN), "23h");
  assert.equal(ageText(DAY), "1d");
  assert.equal(ageText(-5), "<1m");
});

test("shortCard", () => {
  assert.equal(shortCard("acme/app#12"), "app#12");
  assert.equal(shortCard("app#12"), "app#12");
  assert.equal(shortCard(null), "");
});

test("viewModel: every input missing", () => {
  const vm = viewModel({ terminals: [], asksText: null, eventsText: null, usageJson: null, nowMs: NOW });
  assert.deepEqual(vm, { usage: "", asks: [], stuck: [], groups: [], others: [] });
  assert.equal(viewModel({ terminals: [], usageJson: "{broken", nowMs: NOW }).usage, "");
});

test("viewModel: raw terminals and file text in", () => {
  const vm = viewModel({
    terminals: [{ address: "tL", name: "lead-app-10", state: "live", labels: ["role=lead", `epic=${EPIC}`], status: "working" }, { address: "tS", state: "live", labels: null, status: null }],
    asksText: JSON.stringify(ask("acme/app#12", HOUR)) + "\n",
    eventsText: "",
    usageJson: JSON.stringify({ limits: [{ kind: "weekly_all", percent: 69 }] }),
    nowMs: NOW,
  });
  assert.equal(vm.usage, "week 69%");
  assert.equal(vm.asks.length, 1);
  assert.equal(vm.groups[0].rows[0].name, "lead-app-10");
  assert.deepEqual(vm.others, []);
});

test("flatRows: asks, stuck, each group, others, in display order; stuck terminal selectable twice", () => {
  const vm = viewModel({
    terminals: [{ address: "tL", name: "lead-app-10", labels: { role: "lead", epic: EPIC }, status: "blocked" }, { address: "tO", name: "me", status: "idle" }],
    asksText: JSON.stringify(ask("acme/app#12", HOUR)),
    eventsText: "", usageJson: null, nowMs: NOW,
  });
  const rows = flatRows(vm);
  assert.deepEqual(rows.map((r) => r.section), ["asks", "stuck", "group", "others"]);
  assert.equal(rows[0].url, "https://example.test/acme/app#12");
  assert.equal(rows[1].address, "tL");
  assert.equal(rows[2].address, "tL");
  assert.equal(new Set(rows.map((r) => r.key)).size, 4);
  assert.deepEqual(flatRows({ asks: [], stuck: [], groups: [], others: [] }), []);
});
