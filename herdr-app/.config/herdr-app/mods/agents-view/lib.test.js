// Behavior tests for the agents view's pure logic. Run: node --test herdr-app/.config/herdr-app/mods/agents-view/*.test.js
// All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonl, openAsks, usageText, normalize, stuckRows, epicGroups, otherSessions, ageText, shortCard, flatRows, viewModel, upNextLine,
  askKeyAction, answerArgv, rightPaneId, sideJobs, deskRow, selectTarget, perform, DOUBLE_PRESS_MS,
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
  assert.deepEqual(vm, { usage: "", usageWarn: false, upNext: null, asks: [], stuck: [], groups: [], sides: [], desk: { name: "desk", address: null, state: "not started" }, others: [] });
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
  assert.equal(rows[0].url, "https://example.test/acme/app#12");
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

test("askKeyAction: x posts Done., v opens the plan, an unknown key does nothing", () => {
  const [a] = openAsks([rich({ plan: "https://p.test/x" })], NOW);
  assert.deepEqual(askKeyAction(a, "x", null, NOW), { type: "post", text: "Done." });
  assert.deepEqual(askKeyAction(a, "v", null, NOW), { type: "open", target: "https://p.test/x" });
  assert.equal(askKeyAction(a, "z", null, NOW), null);
  const [noPlan] = openAsks([rich()], NOW);
  assert.equal(askKeyAction(noPlan, "v", null, NOW), null);
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

test("askKeyAction: x on a merge ask is also a second-key action", () => {
  const [a] = openAsks([rich({ kind: "merge" })], NOW);
  const first = askKeyAction(a, "x", null, NOW);
  assert.equal(first.type, "arm");
  assert.deepEqual(askKeyAction(a, "x", first.armed, NOW + 1000), { type: "post", text: "Done." });
});

test("answerArgv: work ask answer <card> --question <id from url> --text", () => {
  assert.deepEqual(answerArgv({ card: "acme/app#12", url: URL1 }, "1a: x"), ["ask", "answer", "acme/app#12", "--question", "555", "--text", "1a: x"]);
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

test("control-room layout: the agents-view mod at about 40% beside the active tab's terminal pane", async () => {
  const { readFileSync } = await import("node:fs");
  const l = JSON.parse(readFileSync(new URL("../../layouts/control-room.json", import.meta.url), "utf8"));
  const row = JSON.stringify(l).includes('"type":"row"') ? l : null;
  const find = (n, f) => (f(n) ? [n] : (n.children ?? []).flatMap((c) => find(c, f)));
  const [list] = find(l, (n) => n.content?.mod === "agents-view");
  const [pane] = find(l, (n) => n.content?.tab === "active");
  assert.ok(row && list && pane, "has the mod block and the active-tab block");
  assert.ok(!find(l, (n) => n.content?.terminal).length, "no fixed terminal block: terminal.show fails while one is focused");
  const parent = find(l, (n) => n.children?.includes(list))[0];
  assert.equal(parent.type, "row");
  assert.ok(parent.children.indexOf(list) < parent.children.indexOf(pane), "list on the left");
  const w = (n) => n.size?.weight ?? 1;
  assert.ok(Math.abs(w(list) / (w(list) + w(pane)) - 0.4) < 0.01, "about 40%");
});
