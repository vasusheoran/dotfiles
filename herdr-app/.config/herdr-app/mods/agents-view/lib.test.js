// Behavior tests for the agents view's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/agents-view/*.test.js
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonl, openAsks, usageText, normalize, stuckRows, epicGroups, otherSessions, ageText, shortCard, flatRows, viewModel, upNextLine,
  askKeyAction, answerArgv, rightPaneId, sideJobs, deskRow, selectTarget, perform, DOUBLE_PRESS_MS, isAskKey, composeAnswer, picksText,
  runFiles, askView, questionTitles, firstLine, planRef, runnerLine,
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
const resumed = (card, agoMs, o = {}) => ({ ts: iso(agoMs), event: "resumed", card, url: `https://example.test/${card}`, ...o });
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

test("openAsks: duplicate ask lines for one url give one row, the first", () => {
  const r = openAsks([ask("acme/app#12", 3 * HOUR, { question: "first" }), ask("acme/app#12", HOUR, { question: "again" })], NOW);
  assert.deepEqual(r.map((a) => a.question), ["first"]);
});

test("openAsks: two open asks on one card give two rows, oldest first", () => {
  const r = openAsks([ask("acme/app#12", HOUR, { url: "u2", from: "lead" }), ask("acme/app#12", 2 * HOUR, { url: "u1", from: "worker" })], NOW);
  assert.deepEqual(r.map((a) => [a.url, a.from]), [["u1", "worker"], ["u2", "lead"]]);
});

test("openAsks: resumed closes only the ask with its url", () => {
  const r = openAsks([ask("acme/app#12", 3 * HOUR, { url: "u1", from: "worker" }), ask("acme/app#12", 2 * HOUR, { url: "u2", from: "lead" }), resumed("acme/app#12", HOUR, { url: "u1" })], NOW);
  assert.deepEqual(r.map((a) => a.url), ["u2"]);
});

test("openAsks: a resumed whose url matches nothing closes nothing", () => {
  const r = openAsks([ask("acme/app#12", 2 * HOUR), resumed("acme/app#12", HOUR, { url: "other" })], NOW);
  assert.equal(r.length, 1);
});

test("openAsks: from defaults to worker when absent", () => {
  assert.equal(openAsks([ask("acme/app#12", HOUR)], NOW)[0].from, "worker");
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

test("stuckRows: gone worker with only an open lead ask on its card is stuck", () => {
  const a = openAsks([ask("acme/app#12", HOUR, { from: "lead" })], NOW);
  const r = stuckRows([lead()], [start("card-app-12", 2 * HOUR), stop("card-app-12", HOUR, "exit")], a, NOW);
  assert.deepEqual(r.map((x) => x.kind), ["gone"]);
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
  assert.deepEqual(vm, { usage: "", usageWarn: false, upNext: null, runnerLine: null, asks: [], stuck: [], groups: [], sides: [], desk: { name: "desk", address: null, state: "not started" }, others: [], asksOld: false, othersLine: "" });
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

test("flatRows: asks, each group, the desk, stuck, others, in display order; stuck terminal selectable twice", () => {
  const vm = viewModel({
    terminals: [{ address: "tL", name: "lead-app-10", labels: { role: "lead", epic: EPIC }, status: "blocked" }, { address: "tO", name: "me", status: "idle" }],
    asksText: JSON.stringify(ask("acme/app#12", HOUR)),
    eventsText: "", usageJson: null, nowMs: NOW,
  });
  const rows = flatRows(vm);
  assert.deepEqual(rows.map((r) => r.section), ["asks", "group", "desk", "stuck", "others"]);
  assert.equal(rows[0].id, "https://example.test/acme/app#12"); // a legacy row without an id keys on its url
  assert.equal(rows[1].address, "tL");
  assert.equal(rows[3].address, "tL");
  assert.equal(new Set(rows.map((r) => r.key)).size, 5);
  assert.equal(rows[0].key, "ask:https://example.test/acme/app#12");
  assert.deepEqual(flatRows({ asks: [], stuck: [], groups: [], sides: [], desk: { address: null }, others: [] }).map((r) => r.section), ["desk"]);
});

// the runner's up-next.json
const up = (o = {}) => ({ at: iso(2 * MIN), runner: "off", epic: "acme/app#823", card: "acme/app#901", state: "would-start", reason: "", usage: { read: "ok", warn: "" }, screen_locked: false, ...o });
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

test("upNextLine: each state of the runner's pick", () => {
  assert.equal(upNextLine(up(), NOW), "Up next: #823 → card #901 · runner off, would start · checked 2m ago");
  assert.equal(upNextLine(up({ state: "none", epic: null, card: null, at: iso(MIN) }), NOW), "Up next: nothing to start · checked 1m ago");
  assert.equal(upNextLine(up({ runner: "on", state: "started" }), NOW), `Up next: #823 → card #901 · runner on, lead started ${hhmm(NOW - 2 * MIN)}`);
  assert.equal(upNextLine(up({ runner: "on", state: "not-started", reason: "4 of 4 workers running" }), NOW), "Up next: #823 → card #901 · not started: 4 of 4 workers running");
  assert.equal(upNextLine(up({ at: iso(30 * 1000) }), NOW), "Up next: #823 → card #901 · runner off, would start · checked <1m ago");
});

test("upNextLine: a runner silent for more than 12 minutes", () => {
  assert.equal(upNextLine(up({ at: iso(17 * MIN) }), NOW), "Runner has not checked for 17m");
  assert.equal(upNextLine(up({ at: iso(12 * MIN) }), NOW), "Up next: #823 → card #901 · runner off, would start · checked 12m ago");
  assert.equal(upNextLine(up({ state: "none", at: iso(3 * HOUR) }), NOW), "Runner has not checked for 3h");
});

test("upNextLine: no file or a broken one shows no line", () => {
  assert.equal(upNextLine(null, NOW), null);
  assert.equal(upNextLine({}, NOW), null);
  assert.equal(upNextLine([1], NOW), null);
  assert.equal(upNextLine(up({ at: "not a time" }), NOW), null);
  assert.equal(upNextLine(up({ state: "bogus" }), NOW), null);
  assert.equal(upNextLine(up({ epic: null }), NOW), null);
});

test("viewModel: Up next from the file, and the header warns when the usage read is not ok", () => {
  const usageJson = JSON.stringify({ limits: [{ kind: "weekly_all", percent: 75 }] });
  const base = { terminals: [], asksText: null, eventsText: null, usageJson, nowMs: NOW };
  let vm = viewModel({ ...base, upNextJson: JSON.stringify(up()) });
  assert.equal(vm.upNext, "Up next: #823 → card #901 · runner off, would start · checked 2m ago");
  assert.equal(vm.usage, "week 75%");
  assert.equal(vm.usageWarn, false);

  const warn = "usage read failed, last good read 20 min ago, not blocking";
  vm = viewModel({ ...base, upNextJson: JSON.stringify(up({ usage: { read: "stale", warn } })) });
  assert.equal(vm.usage, `${warn} · week 75%`);
  assert.equal(vm.usageWarn, true);
  vm = viewModel({ ...base, usageJson: null, upNextJson: JSON.stringify(up({ usage: { read: "failed", warn: "usage fetch failed" } })) });
  assert.equal(vm.usage, "usage fetch failed");
  assert.equal(vm.usageWarn, true);

  vm = viewModel({ ...base, upNextJson: "{broken" });
  assert.equal(vm.upNext, null);
  assert.equal(vm.usage, "week 75%");
  assert.equal(vm.usageWarn, false);
});

// ---- control room: answering asks, side jobs, the desk, the right-hand pane ----
const URL1 = "https://github.com/acme/app/issues/12#issuecomment-555";
const opts = [{ q: 1, key: "a", label: "merge (Recommended)" }, { q: 1, key: "b", label: "hold off" }];
const rich = (o = {}) => ({ ...ask("acme/app#12", HOUR, { url: URL1 }), options: opts, kind: "decide", plan: null, body: "included: PR 9", ...o });

test("openAsks: an answered line closes the ask, and options, kind, plan and body ride along", () => {
  assert.deepEqual(openAsks([rich(), { ts: iso(0), event: "answered", card: "acme/app#12", url: URL1 }], NOW), []);
  const [r] = openAsks([rich({ kind: "merge", plan: "https://p.test/x" })], NOW);
  assert.deepEqual([r.options, r.kind, r.plan, r.body], [opts, "merge", "https://p.test/x", "included: PR 9"]);
  const [old] = openAsks([ask("acme/app#12", HOUR)], NOW);
  assert.deepEqual([old.options, old.kind, old.plan], [[], "decide", null]);
});

test("askKeyAction: an option key on a decide ask posts '<q><key>: <label>' at once", () => {
  const [a] = openAsks([rich()], NOW);
  assert.deepEqual(askKeyAction(a, "b", null, NOW), { type: "post", text: "1b: hold off" });
});

test("askKeyAction: x posts Done. on a you ask, v opens the plan, an unknown key does nothing", () => {
  const [a] = openAsks([rich({ kind: "you", options: [], plan: "https://p.test/x" })], NOW);
  assert.deepEqual(askKeyAction(a, "x", null, NOW), { type: "post", text: "Done." });
  assert.deepEqual(askKeyAction(a, "v", null, NOW), { type: "open", target: "https://p.test/x" });
  assert.equal(askKeyAction(a, "z", null, NOW), null);
  const [noPlan] = openAsks([rich()], NOW);
  assert.equal(askKeyAction(noPlan, "v", null, NOW), null);
});

test("askKeyAction: on a decide ask x is an option key when the ask has one, else nothing", () => {
  const withX = [...opts, { q: 1, key: "x", label: "Merge it" }];
  const [a] = openAsks([rich({ options: withX })], NOW);
  assert.deepEqual(askKeyAction(a, "x", null, NOW), { type: "post", text: "1x: Merge it" });
  const [b] = openAsks([rich()], NOW);
  assert.equal(askKeyAction(b, "x", null, NOW), null);
  assert.equal(isAskKey(b, "x", null), false);
  assert.equal(isAskKey(a, "x", null), true);
});

for (const kind of ["merge", "roll", "money"]) {
  test(`askKeyAction: a ${kind} ask needs the same key twice within ${DOUBLE_PRESS_MS / 1000}s`, () => {
    const [a] = openAsks([rich({ kind })], NOW);
    const first = askKeyAction(a, "a", null, NOW);
    assert.equal(first.type, "arm");
    assert.equal(first.body, "included: PR 9");
    assert.deepEqual(askKeyAction(a, "a", first.armed, NOW + 9_000), { type: "post", text: "1a: merge (Recommended)" });
    assert.equal(askKeyAction(a, "a", first.armed, NOW + 11_000).type, "arm"); // too late: arms again
    assert.deepEqual(askKeyAction(a, "b", first.armed, NOW + 1_000).type, "arm"); // a different option arms that one
    assert.deepEqual(askKeyAction(a, "z", first.armed, NOW + 1_000), { type: "cancel" }); // any other key cancels
  });
}

test("askKeyAction: x on a merge ask is its option key, a second-key action, never Done.", () => {
  const [a] = openAsks([rich({ kind: "merge", options: [{ q: 1, key: "x", label: "Merge it" }, { q: 1, key: "b", label: "Hold" }] })], NOW);
  const first = askKeyAction(a, "x", null, NOW);
  assert.equal(first.type, "arm");
  assert.deepEqual(askKeyAction(a, "x", first.armed, NOW + 1000), { type: "post", text: "1x: Merge it" });
  const [none] = openAsks([rich({ kind: "merge" })], NOW);
  assert.equal(askKeyAction(none, "x", null, NOW), null);
});

test("answerArgv: work ask answer <id> --text <text> --via screen", () => {
  assert.deepEqual(answerArgv({ id: "a-20261114080000-1a2b3c" }, "1a: x"), ["ask", "answer", "a-20261114080000-1a2b3c", "--text", "1a: x", "--via", "screen"]);
});

test("answerArgv: a legacy row without an id answers as legacy-<comment id>", () => {
  const [a] = openAsks([rich()], NOW);
  assert.deepEqual(answerArgv(a, "x"), ["ask", "answer", "legacy-555", "--text", "x", "--via", "screen"]);
});

// ---- asks keyed by id (the local asks file; no issue comments) ----
const idAsk = (id, agoMs, o = {}) => ({ ts: iso(agoMs), event: "ask", id, card: "acme/app#12", epic: EPIC, from: "worker", terminal: "card-app-12", url: null, question: `q ${id}`, options: [], kind: "decide", plan: null, body: "", ...o });
const ev = (event, id, o = {}) => ({ ts: iso(0), event, id, ...o });

test("openAsks: a row keys on its id, and its url may be null", () => {
  const [r] = openAsks([idAsk("a-1", HOUR)], NOW);
  assert.deepEqual([r.id, r.url], ["a-1", null]);
});

test("openAsks: answered closes the ask with its id only", () => {
  const r = openAsks([idAsk("a-1", 3 * HOUR), idAsk("a-2", 2 * HOUR), ev("answered", "a-1", { text: "x", by: "owner", via: "screen" })], NOW);
  assert.deepEqual(r.map((a) => a.id), ["a-2"]);
});

test("openAsks: applied closes an ask, delivered does not", () => {
  assert.deepEqual(openAsks([idAsk("a-1", HOUR), ev("delivered", "a-1", { terminal: "t" })], NOW).map((a) => a.id), ["a-1"]);
  assert.deepEqual(openAsks([idAsk("a-1", HOUR), ev("applied", "a-1", { terminal: "t" })], NOW), []);
});

test("openAsks: a legacy resumed line by url closes a legacy row, and an id event never closes by url", () => {
  assert.deepEqual(openAsks([ask("acme/app#12", 2 * HOUR), resumed("acme/app#12", HOUR)], NOW), []);
  assert.deepEqual(openAsks([idAsk("a-1", HOUR, { url: "u" }), { ts: iso(0), event: "resumed", url: "u" }], NOW).map((a) => a.id), ["a-1"]);
});

test("openAsks: a migrated row keeps its legacy id and is answered by it", () => {
  const rows = openAsks([idAsk("legacy-555", HOUR, { url: URL1 })], NOW);
  assert.deepEqual(answerArgv(rows[0], "ok"), ["ask", "answer", "legacy-555", "--text", "ok", "--via", "screen"]);
});

test("sideJobs and deskRow: role=side rows by themselves, one desk row", () => {
  const side = T({ address: "tS", name: "card-app-9", labels: { role: "side", card: "acme/app#9", model: "sonnet" }, state: "working" });
  assert.deepEqual(sideJobs([side, lead(), worker()]).map((s) => [s.name, s.address, s.card]), [["card-app-9", "tS", "acme/app#9"]]);
  assert.deepEqual(sideJobs([T({ labels: { role: "side" }, live: false })]), []);
  const desk = T({ address: "tD", name: "desk", labels: { role: "desk" }, state: "idle" });
  assert.deepEqual(deskRow([desk, lead()]), { name: "desk", address: "tD", state: "idle" });
  assert.deepEqual(deskRow([lead()]), { name: "desk", address: null, state: "not started" });
});

test("viewModel: side jobs are not in the epic groups or other sessions; desk is its own row", () => {
  const side = { address: "tS", name: "card-app-9", status: "working", labels: ["role=side", "card=acme/app#9"] };
  const desk = { address: "tD", name: "desk", status: "idle", labels: ["role=desk"] };
  const vm = viewModel({ terminals: [side, desk, { address: "tL", name: "lead-app-10", status: "working", labels: ["role=lead", `epic=${EPIC}`] }], asksText: "", eventsText: "", nowMs: NOW });
  assert.equal(vm.sides.length, 1);
  assert.equal(vm.desk.address, "tD");
  assert.deepEqual(vm.others, []);
  assert.deepEqual(vm.groups.map((g) => g.epic), [EPIC]);
  assert.deepEqual(flatRows(vm).map((r) => r.section), ["group", "side", "desk"]);
});

test("flatRows: sections in order asks, running (epics then side jobs), desk, stuck, others", () => {
  const side = { address: "tS", name: "card-app-9", status: "working", labels: ["role=side"] };
  const blocked = { address: "tB", name: "x", status: { state: "blocked", kind: "permission" }, labels: [] };
  const vm = viewModel({ terminals: [side, blocked, { address: "tL", name: "lead-app-10", status: "working", labels: ["role=lead", `epic=${EPIC}`] }], asksText: JSON.stringify(rich()), eventsText: "", nowMs: NOW });
  assert.deepEqual([...new Set(flatRows(vm).map((r) => r.section))], ["asks", "group", "side", "desk", "stuck", "others"]);
});

test("selectTarget: a terminal row shows its terminal; the desk row starts one when none is live", () => {
  assert.deepEqual(selectTarget({ section: "group", address: "tL" }), { show: "tL" });
  assert.deepEqual(selectTarget({ section: "side", address: "tS" }), { show: "tS" });
  assert.deepEqual(selectTarget({ section: "desk", address: "tD" }), { show: "tD" });
  const t = selectTarget({ section: "desk", address: null }, "/home/x");
  assert.deepEqual(t.start, ["run", "--bg", "--json", "--name", "desk", "--no-parent", "--label", "role=desk", "--cwd", "/home/x", "--", "claude"]);
  assert.equal(selectTarget({ section: "asks", address: null }), null);
});

test("rightPaneId: the one terminal pane of the focused tab, never a mod pane", () => {
  const panes = [{ pane: "p1", terminal: "tA", tab: "t1", focused: true }, { pane: "pm", terminal: null, mod: "x", tab: "t1" }, { pane: "p2", terminal: "tB", tab: "t2" }];
  assert.equal(rightPaneId(panes, "t1"), "p1");
  assert.equal(rightPaneId(panes, "t2"), "p2");
  assert.equal(rightPaneId(panes, "t9"), null);
  assert.equal(rightPaneId([], "t1"), null);
});

test("perform: show calls terminal.show with the terminal and the right-hand pane; work calls go through `work`", async () => {
  const calls = [];
  const io = { run: (n, a) => calls.push(["run", n, a]), exec: async (c, a) => { calls.push(["exec", c, a]); return { code: 0, stdout: JSON.stringify({ address: "tNew" }) }; } };
  await perform({ type: "show", terminal: "tL" }, { ...io, pane: "p1" });
  assert.deepEqual(calls.pop(), ["run", "terminal.show", { terminal: "tL", pane: "p1" }]);
  await perform({ type: "post", argv: ["ask", "answer", "acme/app#12", "--question", "555", "--text", "1a: x"] }, { ...io, pane: "p1" });
  assert.deepEqual(calls.pop(), ["exec", "work", ["ask", "answer", "acme/app#12", "--question", "555", "--text", "1a: x"]]);
  await perform({ type: "open", target: "https://p.test/x" }, { ...io, pane: "p1" });
  assert.deepEqual(calls.pop(), ["exec", "open", ["https://p.test/x"]]);
  await perform({ type: "start-desk", argv: ["run", "--bg"] }, { ...io, pane: "p1" });
  assert.deepEqual(calls, [["exec", "hc", ["run", "--bg"]], ["run", "terminal.show", { terminal: "tNew", pane: "p1" }]]);
  const none = []; await perform({ type: "show", terminal: "tL" }, { run: (...a) => none.push(a), exec: io.exec, pane: null });
  assert.deepEqual(none, [], "no right-hand pane: nothing is called");
});

test("main-agents layout: agents-view is a child of the panel-body stack, the tab bar is tabs-agents, control-room is gone", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const l = JSON.parse(readFileSync(new URL("../../layouts/main-agents.json", import.meta.url), "utf8"));
  const find = (n, f) => (f(n) ? [n] : (n.children ?? []).flatMap((c) => find(c, f)));
  const [stack] = find(l, (n) => n.id === "panel-body");
  assert.deepEqual(stack.children.map((c) => c.id).slice(0, 2), ["files", "changes"]);
  assert.ok(stack.children.some((c) => c.id === "agents-view" && c.content.mod === "agents-view"), "the panel block id matches the tab-bar button");
  assert.equal(find(l, (n) => n.id === "tabs")[0].content.mod, "tabs-agents");
  const ids = find(l, () => true).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "block ids are unique (a clash drew the view in the sidebar)");
  assert.equal(existsSync(new URL("../../layouts/control-room.json", import.meta.url)), false);
});

const two = [{ q: 1, key: "a", label: "yes" }, { q: 1, key: "b", label: "no" }, { q: 2, key: "a", label: "now" }, { q: 2, key: "b", label: "later" }];

test("askKeyAction: in a 2-question ask the letter picks within the selected question", () => {
  const [a] = openAsks([rich({ kind: "you", options: two })], NOW);
  assert.deepEqual(askKeyAction(a, "a", null, NOW), { type: "pick", q: 1, text: "1a: yes" });
  assert.deepEqual(askKeyAction(a, "a", null, NOW, 2), { type: "pick", q: 2, text: "2a: now" });
  assert.deepEqual(askKeyAction(a, "b", null, NOW, 2), { type: "pick", q: 2, text: "2b: later" });
  assert.deepEqual(askKeyAction(a, "x", null, NOW), { type: "post", text: "Done." });
  assert.equal(askKeyAction(a, "c", null, NOW, 2), null);
});

test("askKeyAction: a second press arms per question", () => {
  const [a] = openAsks([rich({ options: two, kind: "merge" })], NOW);
  const first = askKeyAction(a, "a", null, NOW, 2);
  assert.deepEqual(askKeyAction(a, "a", first.armed, NOW + 1000, 2), { type: "pick", q: 2, text: "2a: now" });
  assert.equal(askKeyAction(a, "a", first.armed, NOW + 1000, 1).type, "arm");
});

test("isAskKey: option letters, x, v and question digits; navigation keys never, even while armed", () => {
  const [a] = openAsks([rich({ kind: "you", options: two })], NOW);
  for (const k of ["a", "b", "x", "v", "1", "2"]) assert.equal(isAskKey(a, k, null), true, k);
  for (const k of ["j", "k", "up", "down", "enter", "escape"]) assert.equal(isAskKey(a, k, { id: a.id, key: "a", at: NOW }), false, k);
  assert.equal(isAskKey(a, "3", null), false);
  assert.equal(isAskKey(a, "z", { id: a.id, key: "a", at: NOW }), true); // armed: any other key cancels
  assert.equal(isAskKey(a, "z", null), false);
});

test("viewModel: hidden ids leave Needs you", () => {
  const vm = viewModel({ terminals: [], asksText: JSON.stringify(rich()), eventsText: "", nowMs: NOW, hiddenIds: new Set([URL1]) });
  assert.deepEqual(vm.asks, []);
});

test("composeAnswer: nothing until every question has a pick, then one line per question", () => {
  const [a] = openAsks([rich({ options: two })], NOW);
  assert.equal(composeAnswer(a, {}), null);
  assert.equal(composeAnswer(a, { 1: "1a: yes" }), null);
  assert.equal(composeAnswer(a, { 2: "2b: later" }), null);
  assert.equal(composeAnswer(a, { 1: "1a: yes", 2: "2b: later" }), "1a: yes\n2b: later");
  const [one] = openAsks([rich()], NOW);
  assert.equal(composeAnswer(one, { 1: "1a: x" }), "1a: x");
});

test("picksText: shows each question's pick or a question mark", () => {
  const [a] = openAsks([rich({ options: two })], NOW);
  assert.equal(picksText(a, { 1: "1a: yes" }), "1a ✓ · 2 ?");
  assert.equal(picksText(a, {}), "1 ? · 2 ?");
});

// ---- side panel (kuchbhi#1058) ----

test("runFiles: live files by default, the fixture folder's five files when it is in use", () => {
  assert.deepEqual(runFiles("/h", false), { asks: "/h/handoffs/run/asks.jsonl", events: "/h/handoffs/run/events.jsonl", usage: "/h/.claude/.usage-cache.json", upNext: "/h/handoffs/run/up-next.json", settings: "/h/handoffs/run/settings.json" });
  assert.deepEqual(runFiles("/h", true), { asks: "/h/.config/herdr-app/agents-view-fixture/asks.jsonl", events: "/h/.config/herdr-app/agents-view-fixture/events.jsonl", usage: "/h/.config/herdr-app/agents-view-fixture/usage.json", upNext: "/h/.config/herdr-app/agents-view-fixture/up-next.json", settings: "/h/.config/herdr-app/agents-view-fixture/settings.json" });
});

test("firstLine: the first non-empty line, cut with an ellipsis past the width", () => {
  assert.equal(firstLine("\n  Approve the plan?\nmore", 40), "Approve the plan?");
  assert.equal(firstLine("abcdefghij", 6), "abcde…");
  assert.equal(firstLine("abcdef", 6), "abcdef");
  assert.equal(firstLine(null, 6), "");
});

test("questionTitles: the numbered question lines of an ask body", () => {
  const body = "1. Which branch?\n   a) x\n2. Keep the log?\n   a) y";
  assert.deepEqual(questionTitles(body), { 1: "Which branch?", 2: "Keep the log?" });
  assert.deepEqual(questionTitles("included: PR 9"), {});
});

test("askView: the collapsed row is a card, kind and age over one question line, red never on the row", () => {
  const [a] = openAsks([rich({ question: "Approve this plan?\nsecond line", kind: "plan", ts: iso(90 * MIN) })], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.card, "app#12");
  assert.equal(v.kind, "plan");
  assert.equal(v.age, "1h");
  assert.equal(v.title, "Approve this plan?");
  assert.equal(v.old, true);
});

test("askView: an ask under an hour is not old", () => {
  const [a] = openAsks([rich({ ts: iso(59 * MIN) })], NOW);
  assert.equal(askView(a, {}, null).old, false);
});

test("askView: options of one question become buttons with their keys", () => {
  const [a] = openAsks([rich()], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.questions.length, 1);
  assert.deepEqual(v.questions[0].options.map((o) => o.key), opts.map((o) => o.key));
  assert.ok(v.questions[0].options.every((o) => !o.picked && !o.armed));
});

test("askView: a multi-question ask has one block per question with titles and its picks", () => {
  const [a] = openAsks([rich({ options: two, body: "1. Which?\n2. Keep?" })], NOW);
  const v = askView(a, { 1: "1a: yes" }, null);
  assert.deepEqual(v.questions.map((q) => [q.q, q.title]), [[1, "Which?"], [2, "Keep?"]]);
  assert.deepEqual(v.questions[0].options.map((o) => o.picked), [true, false]);
  assert.deepEqual(v.questions[1].options.map((o) => o.picked), [false, false]);
  assert.equal(v.status, "1 of 2 picked");
});

test("askView: an armed merge button says to press again", () => {
  const [a] = openAsks([rich({ kind: "merge" })], NOW);
  const v = askView(a, {}, { id: a.id, key: opts[0].key, q: 1, at: NOW });
  const o = v.questions[0].options[0];
  assert.equal(o.armed, true);
  assert.equal(v.questions[0].options[1].armed, false);
});

test("viewModel: Needs you is red only when an ask is older than an hour", () => {
  const mk = (ago) => viewModel({ terminals: [], asksText: JSON.stringify(ask("acme/app#1", ago)), eventsText: "", usageJson: null, upNextJson: null, nowMs: NOW });
  assert.equal(mk(2 * HOUR).asksOld, true);
  assert.equal(mk(59 * MIN).asksOld, false);
  assert.equal(mk(2 * HOUR).others.length, 0);
});

test("viewModel: other sessions collapse to one count line", () => {
  const vm = viewModel({ terminals: [{ address: "a", name: "x", status: "working" }, { address: "b", name: "y", status: "idle" }], asksText: "", eventsText: "", usageJson: null, upNextJson: null, nowMs: NOW });
  assert.equal(vm.othersLine, "+2 other sessions");
  const one = viewModel({ terminals: [{ address: "a", name: "x", status: "working" }], asksText: "", eventsText: "", usageJson: null, upNextJson: null, nowMs: NOW });
  assert.equal(one.othersLine, "+1 other session");
  assert.equal(viewModel({ terminals: [], asksText: "", eventsText: "", usageJson: null, upNextJson: null, nowMs: NOW }).othersLine, "");
});

// ---- plan and PR context in an ask (kuchbhi#1058, owner note) ----

test("planRef: a file plan shows its file name and full path; v opens it", () => {
  assert.deepEqual(planRef("/Users/me/canvas/1058/plan.html"), { kind: "plan", line: "Plan: plan.html", full: "/Users/me/canvas/1058/plan.html" });
  assert.deepEqual(planRef("https://example.test/p/plan.html"), { kind: "plan", line: "Plan: https://example.test/p/plan.html", full: "https://example.test/p/plan.html" });
});

test("planRef: a PR URL shows owner/repo#n", () => {
  assert.deepEqual(planRef("https://github.com/acme/app/pull/15"), { kind: "pr", line: "PR: acme/app#15", full: "https://github.com/acme/app/pull/15" });
});

test("planRef: no plan is null", () => {
  assert.equal(planRef(null), null);
  assert.equal(planRef(""), null);
});

test("askView: an ask with a file plan has a plan line, a plan marker and the full path", () => {
  const [a] = openAsks([rich({ plan: "/h/canvas/plan.html" })], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.marker, "plan");
  assert.equal(v.plan.line, "Plan: plan.html");
  assert.equal(v.plan.full, "/h/canvas/plan.html");
});

test("askView: a merge ask with a PR URL has a PR line and a PR marker", () => {
  const [a] = openAsks([rich({ kind: "merge", plan: "https://github.com/acme/app/pull/15" })], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.marker, "PR");
  assert.equal(v.plan.line, "PR: acme/app#15");
});

test("askView: an ask with no plan has no marker and no plan line", () => {
  const [a] = openAsks([rich({ plan: null })], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.marker, "");
  assert.equal(v.plan, null);
});

test("askView: the expanded body is the rest of the question and the whole body, not only the first line", () => {
  const [a] = openAsks([rich({ question: "Approve?\nincluded: PR 9\nchecks: green", body: "what changes: one file" })], NOW);
  const v = askView(a, {}, null);
  assert.equal(v.title, "Approve?");
  assert.equal(v.body, "included: PR 9\nchecks: green\nwhat changes: one file");
});

test("askKeyAction: v opens the plan of a file ask and of a PR ask", () => {
  const [f] = openAsks([rich({ plan: "/h/plan.html" })], NOW);
  assert.deepEqual(askKeyAction(f, "v", null, NOW), { type: "open", target: "/h/plan.html" });
  const [p] = openAsks([rich({ kind: "merge", plan: "https://github.com/acme/app/pull/15" })], NOW);
  assert.deepEqual(askKeyAction(p, "v", null, NOW), { type: "open", target: "https://github.com/acme/app/pull/15" });
});

test("runnerLine: runner state, worker limit and the reviewers that are on", () => {
  const line = (o) => runnerLine(JSON.stringify(o));
  assert.equal(line({ runner: true, worker_limit: 3, reviewers: { verifier: true, codex: false, agy: false } }), "Runner setting: on · 3 workers · reviewers: verifier");
  assert.equal(line({ runner: false, worker_limit: 4, reviewers: { verifier: true, codex: true } }), "Runner setting: off · 4 workers · reviewers: verifier, codex");
  assert.equal(line({ runner: false, worker_limit: 1, reviewers: { verifier: false, codex: false, agy: true } }), "Runner setting: off · 1 worker · reviewers: agy");
  assert.equal(line({ reviewers: { verifier: false, codex: false, agy: false } }), "Runner setting: off · 4 workers · reviewers: none");
});

test("runnerLine: keys the file lacks read as the settings defaults; projects and epics are ignored", () => {
  assert.equal(runnerLine("{}"), "Runner setting: off · 4 workers · reviewers: verifier, codex");
  assert.equal(runnerLine(JSON.stringify({ version: 1, projects: { "a/b": {} }, epics: ["a/b#1"], reviewers: { codex: false } })), "Runner setting: off · 4 workers · reviewers: verifier");
});

test("runnerLine: no file or a broken one shows no line", () => {
  assert.equal(runnerLine(null), null);
  assert.equal(runnerLine("{broken"), null);
  assert.equal(runnerLine("[1]"), null);
});

test("viewModel: the runner line comes from the settings file", () => {
  const vm = viewModel({ terminals: [], nowMs: NOW, settingsJson: JSON.stringify({ runner: true, worker_limit: 2 }) });
  assert.equal(vm.runnerLine, "Runner setting: on · 2 workers · reviewers: verifier, codex");
  assert.equal(viewModel({ terminals: [], nowMs: NOW }).runnerLine, null);
});
