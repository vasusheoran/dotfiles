// Behavior tests for the inbox: batches in four lanes, one ask at a time, other idea, messages with threads, the desk first.
// kuchbhi#1116. All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openAsks, viewModel, flatRows, inboxBatches, laneSummary, LANE_LABELS, stepAsk, askAt, isNarrow, askKeyAction, isAskKey, answerArgv,
  otherArgv, threadsOf, messageState, threadView, messageArgv, messageTarget, askView, footerHint,
  inputStep, paneFor, defaultKey, narrowLanes, speaker, deskNew, headerLine,
} from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const MIN = 60_000, HOUR = 60 * MIN;
const iso = (ago) => new Date(NOW - ago).toISOString();
const row = (id, ago, o = {}) => ({
  ts: iso(ago), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "",
  today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1", options: [{ q: 1, key: "a", label: "Yes (Recommended)", then: "builds" }, { q: 1, key: "b", label: "No", then: "parks" }], ...o,
});
const asksOf = (...rows) => openAsks(rows, NOW);

// ---- lanes and batches
const MIXED = () => asksOf(
  row("a-1", 5 * HOUR, { kind: "merge", batch_key: "merge:o/r#1", target: { repo: "o/r", pr: 5, head: "h".repeat(40) } }),
  row("a-2", 4 * HOUR, { kind: "look", batch_key: "look:o/r#2", epic: "o/r#2", card: "o/r#20" }),
  row("a-3", 3 * HOUR, { kind: "look", batch_key: "look:o/r#2", epic: "o/r#2", card: "o/r#21" }),
  row("a-4", 2 * HOUR, { kind: "you", batch_key: "hands:o/r#3", epic: "o/r#3", card: "o/r#30" }),
  row("a-5", HOUR, { kind: "groom", batch_key: "groom:o/r#4", epic: "o/r#4", card: "o/r#40" }),
  row("a-6", 30 * MIN, { kind: "decide", batch_key: "decide:o/r#2", epic: "o/r#2", card: "o/r#22" }),
);

test("inboxBatches: asks of one batch key are one batch, in the order of the lanes: one key, needs a look, your hands, not ready", () => {
  const b = inboxBatches(MIXED());
  assert.deepEqual(b.map((x) => x.key), ["merge:o/r#1", "look:o/r#2", "decide:o/r#2", "hands:o/r#3", "groom:o/r#4"]);
  assert.deepEqual(b.map((x) => x.lane), ["key", "look", "look", "hands", "groom"]);
  assert.deepEqual(b.find((x) => x.key === "look:o/r#2").asks.map((a) => a.id), ["a-2", "a-3"]); // oldest first
  assert.equal(b.find((x) => x.key === "look:o/r#2").count, 2);
});

test("inboxBatches: an ask from before batch keys still shows, in the batch of its lane and epic, with nothing invented", () => {
  const old = asksOf({ ts: iso(HOUR), event: "ask", id: "a-9", card: "o/r#9", epic: "o/r#7", from: "lead", kind: "plan", question: "Old Q", options: [] });
  const b = inboxBatches(old);
  assert.equal(b.length, 1);
  assert.equal(b[0].lane, "look");
  assert.equal(b[0].asks[0].today, null);
});

test("laneSummary: always the four lanes with counts, empty ones too", () => {
  const l = laneSummary(inboxBatches(MIXED()));
  assert.deepEqual(l.map((x) => x.lane), ["key", "look", "hands", "groom"]);
  assert.deepEqual(l.map((x) => x.label), ["One key", "Needs a look", "Your hands", "Not ready"]);
  assert.deepEqual(l.map((x) => x.count), [1, 3, 1, 1]);
  assert.deepEqual(laneSummary([]).map((x) => x.count), [0, 0, 0, 0]);
  assert.equal(LANE_LABELS.groom, "Not ready");
});

test("laneSummary: a batched merge ask counts one per PR", () => {
  const sha = "h".repeat(40);
  const m = asksOf(
    row("a-1", HOUR, { kind: "merge", batch_key: "merge:o/r#1", batch: "a-1", target: { repo: "o/r", pr: 5, head: sha } }),
    row("a-2", HOUR, { kind: "merge", batch_key: "merge:o/r#1", batch: "a-1", target: { repo: "o/r", pr: 6, head: sha }, card: "o/r#6" }),
  );
  assert.equal(laneSummary(inboxBatches(m))[0].count, 2);
});

// ---- the stepper keeps its place per batch
test("stepAsk: right and left step through the asks of a batch and stop at the ends", () => {
  const [look] = inboxBatches(MIXED()).filter((x) => x.key === "look:o/r#2");
  let pos = {};
  assert.equal(askAt(pos, look).id, "a-2");
  pos = stepAsk(pos, look, "left"); assert.equal(askAt(pos, look).id, "a-2");
  pos = stepAsk(pos, look, "right"); assert.equal(askAt(pos, look).id, "a-3");
  pos = stepAsk(pos, look, "right"); assert.equal(askAt(pos, look).id, "a-3");
});

test("stepAsk: the place in a batch is kept while another batch is shown, and clamped when asks leave", () => {
  const b = inboxBatches(MIXED()), look = b[1], other = b[2];
  let pos = stepAsk({}, look, "right");
  pos = stepAsk(pos, other, "right"); // a one-ask batch stays at its only ask
  assert.equal(askAt(pos, look).id, "a-3");
  assert.equal(askAt(pos, other).id, "a-6");
  const shrunk = { ...look, asks: look.asks.slice(0, 1) }; // the second ask was answered
  assert.equal(askAt(pos, shrunk).id, "a-2");
});

test("isNarrow: under 640px the batch list sits above the ask", () => {
  assert.equal(isNarrow(360), true);
  assert.equal(isNarrow(639), true);
  assert.equal(isNarrow(640), false);
  assert.equal(isNarrow(null), false);
});

// ---- other idea
test("askKeyAction: o is the other-idea input on any ask but a merge ask; an option named o still wins", () => {
  const a = asksOf(row("a-1", HOUR))[0];
  assert.deepEqual(askKeyAction(a, "o", null, NOW), { type: "other" });
  assert.equal(isAskKey(a, "o", null), true);
  const m = asksOf(row("a-2", HOUR, { kind: "merge", batch_key: "merge:o/r#1", target: { repo: "o/r", pr: 5, head: "h".repeat(40) } }))[0];
  assert.equal(askKeyAction(m, "o", null, NOW), null);
  assert.equal(isAskKey(m, "o", null), false);
  const own = asksOf(row("a-3", HOUR, { options: [{ q: 1, key: "o", label: "Open it", then: "x" }] }))[0];
  assert.equal(askKeyAction(own, "o", null, NOW).type, "post");
});

test("otherArgv: the text is the answer with pick other, from the screen", () => {
  const a = asksOf(row("a-1", HOUR))[0];
  assert.deepEqual(otherArgv(a, "Redis, but only for sessions"), ["ask", "answer", "a-1", "--text", "Redis, but only for sessions", "--via", "screen", "--key", "other"]);
  assert.deepEqual(otherArgv(a, "x"), answerArgv(a, "x", { key: "other" }));
});

// ---- messages and threads
const LINES = [
  { ts: iso(30 * MIN), event: "message", mid: "m-1", thread: "a-1", id: "a-1", from: "owner", to: "lead-r-1", text: "does it need a release?" },
  { ts: iso(29 * MIN), event: "message_delivered", mid: "m-1", thread: "a-1", id: "a-1", terminal: "lead-r-1" },
  { ts: iso(20 * MIN), event: "message", mid: "m-2", thread: "a-1", id: "a-1", from: "agent", to: "owner", text: "yes, an Android build" },
  { ts: iso(10 * MIN), event: "message", mid: "m-3", thread: "a-1", id: "a-1", from: "owner", to: "lead-r-1", text: "and tablets?" },
  { ts: iso(9 * MIN), event: "message", mid: "m-4", thread: "desk", from: "owner", to: "desk-kuchbhi", text: "which epics are blocked?" },
  { ts: iso(8 * MIN), event: "ask", id: "a-1", card: "o/r#1" },
];

test("threadsOf: messages group by thread, oldest first, with sent and received; asks and other events are not messages", () => {
  const t = threadsOf(LINES);
  assert.deepEqual(Object.keys(t).sort(), ["a-1", "desk"]);
  assert.deepEqual(t["a-1"].map((m) => [m.mid, m.from, m.received]), [["m-1", "owner", true], ["m-2", "agent", true], ["m-3", "owner", false]]);
  assert.equal(t.desk[0].text, "which epics are blocked?");
  assert.deepEqual(threadsOf([]), {});
});

test("messageState: sent, received, or waiting when the terminal was busy or gone; an agent line is received", () => {
  const [m1, m2, m3] = threadsOf(LINES)["a-1"];
  assert.equal(messageState(m1), "sent · received");
  assert.equal(messageState(m3), "sent · waiting: terminal busy or gone");
  assert.equal(messageState(m2), "received");
});

test("threadView: the last messages with a count of the earlier ones", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ mid: `m-${i}`, from: "owner", text: `t${i}`, received: true }));
  const v = threadView(many, 6);
  assert.equal(v.hidden, 8);
  assert.deepEqual(v.shown.map((m) => m.mid), ["m-8", "m-9", "m-10", "m-11", "m-12", "m-13"]);
  assert.deepEqual(threadView(many.slice(0, 2), 6), { hidden: 0, newer: 0, shown: many.slice(0, 2) });
});

test("messageArgv and messageTarget: an open ask's message goes to that ask's thread, none open goes to the desk", () => {
  const a = asksOf(row("a-1", HOUR))[0];
  assert.equal(messageTarget(a), "a-1");
  assert.equal(messageTarget(null), "desk");
  assert.deepEqual(messageArgv("a-1", "and tablets?"), ["ask", "message", "a-1", "--text", "and tablets?", "--by", "owner"]);
  assert.deepEqual(messageArgv("desk", "hi"), ["ask", "message", "desk", "--text", "hi", "--by", "owner"]);
});

// ---- the panel's rows: the desk first, never counted
test("flatRows: the desk is the first row, then the batches in lane order; the desk is not counted", () => {
  const vm = viewModel({
    terminals: [{ address: "tD", name: "desk-kuchbhi", status: "idle", labels: ["role=desk"] }, { address: "tW", name: "card-r-12", status: "working", labels: ["role=worker", "epic=o/r#1", "card=o/r#12"] }],
    asksText: "", eventsText: "", nowMs: NOW,
  });
  assert.equal(vm.batches.length, 0);
  assert.equal(flatRows(vm)[0].key, "desk");
  assert.equal(flatRows(vm).filter((r) => r.section === "desk").length, 1);
  assert.equal(vm.groups.flatMap((g) => g.rows).length, 1); // the worker only
});

test("flatRows: batches follow the desk; the place of running things is behind the summary while asks wait", () => {
  const text = [row("a-1", HOUR, { kind: "look", batch_key: "look:o/r#2" }), row("a-2", HOUR, { kind: "you", batch_key: "hands:o/r#3", epic: "o/r#3", card: "o/r#30" })].map((l) => JSON.stringify(l)).join("\n");
  const vm = viewModel({ terminals: [], asksText: text, eventsText: "", nowMs: NOW });
  assert.deepEqual(vm.lanes.map((l) => l.count), [0, 1, 1, 0]);
  const keys = flatRows(vm).map((r) => r.key);
  assert.deepEqual(keys.slice(0, 3), ["desk", "batch:look:o/r#2", "batch:hands:o/r#3"]);
  assert.equal(keys.filter((k) => k === "desk").length, 1);
  assert.ok(flatRows(vm).find((r) => r.key === "batch:look:o/r#2").section === "batch");
});

test("viewModel: threads come from the message events", () => {
  const vm = viewModel({ terminals: [], asksText: LINES.map((l) => JSON.stringify(l)).join("\n"), eventsText: "", nowMs: NOW });
  assert.equal(vm.threads["a-1"].length, 3);
  assert.equal(vm.threads.desk.length, 1);
});

test("footerHint: a batch row says what the stepper keys do", () => {
  assert.match(footerHint("batch"), /← → ask/);
  assert.match(footerHint("batch"), /o other idea/);
  assert.match(footerHint("desk"), /\/ message/);
});

test("askView: the then line rides on each option, and an old ask shows only what it has", () => {
  const a = asksOf(row("a-1", HOUR))[0];
  const v = askView(a, {}, null);
  assert.deepEqual(v.questions[0].options.map((o) => o.then), ["builds", "parks"]);
  assert.deepEqual(v.evidence.map(([k]) => k), ["Today", "After", "Checked", "Why you"]);
  const old = asksOf({ ts: iso(HOUR), event: "ask", id: "a-9", card: "o/r#9", from: "lead", kind: "plan", question: "Old Q", options: [] })[0];
  assert.deepEqual(askView(old, {}, null).evidence, []);
});

// ---- round 1 review
test("inputStep: in a message or other-idea box Tab neither sends nor keeps; Enter sends; only the note box keeps", () => {
  const msg = { mode: "message", thread: "desk", text: "half typed" };
  assert.deepEqual(inputStep(msg, "tab"), { input: msg });
  assert.deepEqual(inputStep(msg, "enter"), { type: "send", text: "half typed" });
  assert.deepEqual(inputStep(msg, "x"), { input: { ...msg, text: "half typedx" } });
  assert.deepEqual(inputStep(msg, "escape"), { type: "cancel" });
  const other = { mode: "other", id: "a-1", text: "idea" };
  assert.deepEqual(inputStep(other, "tab"), { input: other });
  const note = { mode: "note", id: "a-1", text: "n" };
  assert.deepEqual(inputStep(note, "tab"), { type: "keep", text: "n" });
  assert.deepEqual(inputStep({ ...msg, text: "" }, "enter"), { type: "cancel" });
});

test("paneFor: the right pane follows the selected row: desk thread, the batch's ask, an answered ask with its thread, or nothing", () => {
  const vm = viewModel({ terminals: [], asksText: [row("a-1", HOUR), row("a-2", 2 * HOUR, { batch_key: "look:o/r#9", kind: "look", epic: "o/r#9", card: "o/r#90" }), { ts: iso(5 * MIN), event: "answered", id: "a-3", text: "Redis, only for sessions", key: "other", by: "owner", via: "screen" }, row("a-3", 3 * HOUR)].map((l) => JSON.stringify(l)).join("\n"), eventsText: "", nowMs: NOW });
  const rows = flatRows(vm);
  const at = (sec) => rows.find((r) => r.section === sec);
  assert.deepEqual(paneFor(at("desk"), vm, {}), { kind: "desk", thread: "desk" });
  const b = paneFor(at("batch"), vm, {});
  assert.equal(b.kind, "ask"); assert.equal(b.thread, b.ask.id);
  const a = paneFor(at("answered"), vm, {});
  assert.equal(a.kind, "answered"); assert.equal(a.thread, "a-3"); assert.equal(a.answered.id, "a-3");
  assert.deepEqual(paneFor(undefined, vm, {}), { kind: "empty" });
  assert.deepEqual(paneFor({ section: "summary" }, { batches: [] }, {}), { kind: "empty" });
});

test("defaultKey: the first batch; with no batches, not the desk when anything else is there", () => {
  const withBatch = [{ key: "desk", section: "desk" }, { key: "batch:x", section: "batch" }];
  assert.equal(defaultKey(withBatch), "batch:x");
  assert.equal(defaultKey([{ key: "desk", section: "desk" }, { key: "group:t1", section: "group" }]), "group:t1");
  assert.equal(defaultKey([{ key: "desk", section: "desk" }]), "desk");
  assert.equal(defaultKey([]), null);
});

test("narrowLanes: only the current batch's lane, the other lanes with asks as one line", () => {
  const lanes = [{ lane: "key", label: "One key", count: 3, batches: [] }, { lane: "look", label: "Needs a look", count: 3, batches: [] }, { lane: "hands", label: "Your hands", count: 2, batches: [] }, { lane: "groom", label: "Not ready", count: 0, batches: [] }];
  assert.deepEqual(narrowLanes(lanes, "look"), { current: lanes[1], others: "One key 3 · Your hands 2" });
  assert.deepEqual(narrowLanes(lanes, null), { current: null, others: "One key 3 · Needs a look 3 · Your hands 2" });
});

test("threadView: PgUp scrolls back through older messages", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ mid: `m-${i}` }));
  const v = threadView(many, 6, 6);
  assert.deepEqual(v.shown.map((m) => m.mid), ["m-2", "m-3", "m-4", "m-5", "m-6", "m-7"]);
  assert.equal(v.hidden, 2); assert.equal(v.newer, 6);
  assert.equal(threadView(many, 6, 99).hidden, 0); // never past the oldest
  assert.equal(threadView(many, 6).newer, 0);
});

test("speaker: You, Desk for an agent in the desk thread, Agent elsewhere", () => {
  assert.equal(speaker({ from: "owner" }, "desk"), "You");
  assert.equal(speaker({ from: "agent" }, "desk"), "Desk");
  assert.equal(speaker({ from: "agent" }, "a-1"), "Agent");
});

test("deskNew: desk replies after your last desk message", () => {
  const t = threadsOf([
    { ts: iso(50 * MIN), event: "message", mid: "m-1", thread: "desk", from: "owner", text: "a" },
    { ts: iso(40 * MIN), event: "message", mid: "m-2", thread: "desk", from: "agent", text: "b" },
    { ts: iso(30 * MIN), event: "message", mid: "m-3", thread: "desk", from: "agent", text: "c" },
  ]);
  assert.equal(deskNew(t), 2);
  assert.equal(deskNew({}), 0);
});

test("headerLine: asks in batches, running and stuck counts; the desk is not counted", () => {
  const vm = viewModel({ terminals: [{ address: "tD", name: "desk-r", status: "idle", labels: ["role=desk"] }, { address: "tW", name: "card-r-12", status: "working", labels: ["role=worker", "epic=o/r#1", "card=o/r#12"] }, { address: "tL", name: "lead-r-1", status: "working", labels: ["role=lead", "epic=o/r#1"] }],
    asksText: [row("a-1", HOUR), row("a-2", HOUR, { kind: "you", batch_key: "hands:o/r#3", epic: "o/r#3", card: "o/r#30" })].map((l) => JSON.stringify(l)).join("\n"), eventsText: "", nowMs: NOW });
  assert.deepEqual(headerLine(vm), { inbox: "2 asks in 2 batches", run: "2 running · 0 stuck" });
  assert.equal(headerLine(viewModel({ terminals: [], nowMs: NOW })).inbox, "0 asks");
});
