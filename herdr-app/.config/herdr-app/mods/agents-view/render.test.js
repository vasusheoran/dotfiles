// Runs AgentsView.render under node with the host modules stubbed, and asserts what each state of the panel draws (a crash on reload came from a row
// that flatRows had left out). AV_MAIN names the file under test (default ./main.js). Terminals are the raw herdr shape. All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stub = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
// every string handed to a call of the stubbed UI (text, labels, children) lands in globalThis.__drawn, so a test can assert what was drawn
const chain = `const chain = () => new Proxy(function () {}, { get: (_t, k) => k === "when" ? (c, f) => (c ? f(chain()) : chain()) : k === Symbol.toPrimitive ? () => "" : (...a) => { if (k === "w" && typeof a[0] === "number") (globalThis.__drawn ??= []).push("@w:" + a[0]); for (const x of a) if (typeof x === "string") (globalThis.__drawn ??= []).push(x); return chain(); }, apply: () => chain() });`;
const mods = {
  "gpui-kit": `${chain} export class View {} export const div = () => chain();`,
  "gpui-base": `${chain} export const v_flex = () => chain(); export const h_flex = () => chain();`,
  herdr: `const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    export const exec = async (c, a) => (globalThis.__exec ? globalThis.__exec(c, a) : { code: 0, stdout: "", stderr: "" }), run = (...a) => { (globalThis.__runs ??= []).push(a); }, props = () => ({}), panes = () => globalThis.__panes ?? [], focused = () => globalThis.__focused ?? null, spaces = () => globalThis.__spaces ?? [], agents = () => [], readTextFile = () => new Promise(() => {}), home = () => "/h", closeOverlay = () => {};
    export const terminals = () => globalThis.__terms ?? [], theme = () => new Proxy({}, { get: () => "#000" });`,
};
const hooks = `export const resolve = (s, c, next) => ({ ${Object.keys(mods).map((k) => `"${k}": 1`).join(", ")} })[s] ? { url: "stub:" + s, shortCircuit: true } : next(s, c);
  const src = ${JSON.stringify(Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, v])))};
  export const load = (u, c, next) => u.startsWith("stub:") ? { format: "module", source: src[u.slice(5)], shortCircuit: true } : next(u, c);`;
register(stub(hooks));

const { default: AgentsView } = await import(process.env.AV_MAIN ?? "./main.js");

const iso = (min) => new Date(Date.now() - min * 60_000).toISOString();
const asks = [1, 2].map((n) => JSON.stringify({ ts: iso(5), event: "ask", id: `a-${n}`, card: `o/r#${n + 2}`, epic: `o/r#${n * 10}`, from: "worker", question: "Which?", body: "Which?\n\n1. Which?\n   a) A => a\n   b) B => b\n", options: [{ q: 1, key: "a", label: "A", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], kind: "decide", title: "Pick one" })).join("\n");
const stuck = JSON.stringify([{ terminal: "card-r-3", card: "o/r#3", kind: "blocked", since: iso(60) }]);
// the raw shape herdr's terminals() returns: state "live", status.state, labels as "k=v" strings (viewModel normalizes it)
const term = (o) => ({ address: "t1", name: "card-r-3", state: "live", status: { state: "working" }, labels: ["card=o/r#3", "role=worker", "epic=o/r#1"], ...o });
const terms = [term({}), term({ address: "t2", name: "lead-r-1", labels: ["role=lead", "epic=o/r#1"] }), term({ address: "t3", name: "desk-r", status: { state: "idle" }, labels: ["role=desk"] })];

// render once; the drawn strings (text, labels) come back as an array
const timers = (globalThis.__timers = []);
const tcx = { notify() {}, timer: { after: (_ms, f) => timers.push(f), every() {} } };
const flush = () => { while (timers.length) timers.shift()(tcx); };
const paint = (v) => { globalThis.__drawn = []; assert.doesNotThrow(() => v.render(tcx)); return globalThis.__drawn.slice(); };
const draw = ({ asksText, showRun, width, terminals = terms }) => {
  globalThis.__terms = terminals;
  const v = new AgentsView();
  v.init({}, { focus_handle: () => ({ focus() {} }), timer: { every() {} }, notify() {} });
  v.files = { asks: asksText, events: "", usage: null, upNext: null, settings: null, closed: null, stuck: terminals.length ? stuck : null };
  v.showRun = showRun; v.width = width ?? 900;
  v.drawn = paint(v);
  return v;
};
const select = (v, key) => { v.sel = key; v.touched = true; return paint(v); };
const keyOf = (v, section, n = 0) => v.model().rows.filter((r) => r.section === section)[n].key;
const has = (drawn, x) => assert.ok(drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} to be drawn; got: ${drawn.filter((s) => s.length > 1 && !/^#|^Geist|^JetBrains/.test(s)).join(" | ").slice(0, 600)}`);
const lacks = (drawn, x) => assert.ok(!drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} not to be drawn`);

const ASK = (id, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "Q\n\n1. Q\n   a) A => a\n   b) B => b\n",
  today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1", options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const lines = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
// every row selected in turn: none may throw
const eachRow = (v, tag) => { for (const r of v.model().rows) { v.sel = r.key; v.touched = true; assert.doesNotThrow(() => v.render({ notify() {} }), `${tag} ${r.key}`); } };
const lanes = [
  ASK("a-1", { kind: "merge", batch_key: "merge:o/r#1", title: "Land the fix", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land", then: "m" }, { q: 1, key: "b", label: "Hold", then: "h" }] }),
  ASK("a-2", { kind: "look", batch_key: "look:o/r#1" }),
  ASK("a-3", { kind: "you", batch_key: "hands:o/r#1" }),
  ASK("a-4", { kind: "groom", batch_key: "groom:o/r#1", card: "o/r#1" }), { ts: iso(20), event: "groomed", id: "a-4", member: "o/r#21", ready: false, choices: ["Which store?", "Keep the API?"] },
];
const msg = (id, mid, ago, from, text) => ({ ts: iso(ago), event: "message", mid, thread: id, ...(id === "desk" ? {} : { id }), from, to: from === "owner" ? "lead-r-1" : "owner", text });

test("render: asks waiting with the lists hidden draws the inbox and one summary line, no running rows", () => {
  const v = draw({ asksText: asks, showRun: false }); eachRow(v, "hidden");
  for (const s of ["NEEDS A LOOK", "Pick one", "Running 2 · Stuck 1", "2 asks in 2 batches", "2 running · 1 stuck", "desk-r"]) has(v.drawn, s);
  for (const s of ["Running", "Stuck", "lead-r-1", "card-r-3", "Nothing needs you."]) lacks(v.drawn, s);
});
test("render: asks waiting with the lists shown also draws the running and stuck rows", () => {
  const v = draw({ asksText: asks, showRun: true }); eachRow(v, "shown");
  for (const s of ["Running", "Stuck", "lead-r-1", "card-r-3", "o/r#1", "working", /^blocked/, "Running 2 · Stuck 1"]) has(v.drawn, s);
});
test("render: no asks says nothing needs you and lists what runs", () => {
  const v = draw({ asksText: "", showRun: false }); eachRow(v, "no asks");
  for (const s of ["Nothing needs you.", "Type below to message the desk.", "0 asks", "Running", "lead-r-1", "desk-r"]) has(v.drawn, s);
});
test("render: empty, nothing running and no asks", () => {
  const v = draw({ asksText: null, showRun: false, terminals: [] }); eachRow(v, "empty");
  for (const s of ["Nothing running", "not started", "0 running · 0 stuck", "0 asks"]) has(v.drawn, s);
  lacks(v.drawn, "lead-r-1");
});

for (const [name, showRun] of [["lists hidden", false], ["lists shown", true]]) test(`render: the four lanes with their counts and each batch's pane, ${name}`, () => {
  const v = draw({ asksText: lines(...lanes), showRun }); eachRow(v, "lanes");
  for (const s of ["ONE KEY", "NEEDS A LOOK", "YOUR HANDS", "NOT READY", "4 asks in 4 batches"]) has(v.drawn, s);
  assert.deepEqual(v.model().vm.lanes.map((l) => [l.label, l.count]), [["ONE KEY", 1], ["NEEDS A LOOK", 1], ["YOUR HANDS", 1], ["NOT READY", 1]]);
  has(select(v, keyOf(v, "batch", 0)), "Land the fix");
  has(select(v, keyOf(v, "batch", 1)), "Title a-2");
  has(select(v, keyOf(v, "batch", 2)), "Title a-3");
  const g = select(v, keyOf(v, "batch", 3)); has(g, "1 card not ready"); has(g, "Which store? · Keep the API?");
});

test("render: the stepper offers the whole batch in order, and a landed PR is counted", () => {
  const t = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  const v = draw({ asksText: lines(ASK("m-1", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(1), after_landing: ["run install.sh"] }), ASK("m-2", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(2) }), { ts: iso(5), event: "landed", id: "m-1" }), showRun: true });
  eachRow(v, "stepper");
  has(v.drawn, "Merge all 2, in order (Recommended)"); has(v.drawn, "Pick which to merge"); has(v.drawn, "2 asks in 1 batch");
  assert.deepEqual(v.model().vm.batches[0].asks[0].targets.map((x) => x.landed), [true, false]);
});

test("render: a long thread shows the newest six, says how many are earlier, and PgUp-back shows newer ones", () => {
  const thread = Array.from({ length: 60 }, (_, i) => msg("a-2", `m-${i}`, 60 - i, i % 2 ? "agent" : "owner", `line ${i}`));
  const v = draw({ asksText: lines(ASK("a-2", { kind: "look", batch_key: "look:o/r#1" }), ...thread), showRun: false });
  let d = select(v, keyOf(v, "batch"));
  has(d, /^Thread · 60 messages · 54 earlier \(PgUp\)$/); has(d, /: line 59$/); lacks(d, /: line 10$/); lacks(d, /newer/);
  v.back = 40; d = paint(v); has(d, /newer \(PgDn\)/); lacks(d, /: line 59$/);
  v.width = 300; v.back = 0; d = paint(v); has(d, /^Thread · 60 messages/); eachRow(v, "narrow thread");
});
test("render: an ask with no messages draws no thread", () => {
  const v = draw({ asksText: lines(ASK("a-2", { kind: "look", batch_key: "look:o/r#1" })), showRun: false });
  lacks(select(v, keyOf(v, "batch")), /^Thread ·/);
});
test("render: the desk thread shows the desk's reply", () => {
  const v = draw({ asksText: lines(ASK("a-1"), msg("desk", "d-0", 4, "owner", "can you groom o/r#21?"), msg("desk", "d-1", 3, "agent", "grooming now")), showRun: false });
  const d = select(v, "desk"); has(d, /^Thread · 2 messages/); has(d, "Desk: grooming now"); has(d, "You: can you groom o/r#21?");
});

test("render: the narrow view is the phone: the four lanes on one line and the current batch under it", () => {
  const v = draw({ asksText: lines(...lanes), showRun: false, width: 300 }); eachRow(v, "narrow");
  const d = select(v, keyOf(v, "batch", 1));
  has(d, "ONE KEY 1 · LOOK 1 · HANDS 1 · NOT READY 1"); has(d, "Title a-2"); lacks(d, "NEEDS A LOOK"); lacks(d, "NOT READY");
});

test("render: a groom batch lists its cards that are not ready, with their open choices", () => {
  const v = draw({ asksText: lines(lanes[3], lanes[4], { ts: iso(10), event: "groomed", id: "a-4", member: "o/r#22", ready: false, choices: ["Which queue?"] }), showRun: false }); eachRow(v, "groom");
  const d = select(v, keyOf(v, "batch")); has(d, "NOT READY"); has(d, "2 cards not ready"); has(d, "Which store? · Keep the API?"); has(d, "Which queue?");
});

test("render: picture coming and open picture appear on the ask they belong to", () => {
  const v = draw({ asksText: lines(ASK("a-1"), ASK("a-2", { batch_key: "decide:o/r#2", epic: "o/r#2" }), { ts: iso(9), event: "visual_requested", id: "a-1" }, { ts: iso(8), event: "visual_requested", id: "a-2" }, { ts: iso(7), event: "visual_ready", id: "a-2", url: "http://127.0.0.1:7777/p/x" }), showRun: false }); eachRow(v, "pictures");
  const a1 = select(v, "batch:decide:o/r#1"), a2 = select(v, "batch:decide:o/r#2");
  has(a1, "picture coming"); lacks(a1, "open picture"); has(a2, "open picture"); lacks(a2, "picture coming");
});

test("render: an answered ask shows sent, received and done, and says not picked up once, with the asker's reply under it", () => {
  const ans = (id, ago) => ({ ts: iso(ago), event: "answered", id, card: `o/r#${id.replace(/\D/g, "")}`, text: "Redis", key: "other", by: "owner", via: "screen" });
  const v = draw({ asksText: lines(ASK("a-1"), ASK("a-5", { card: "o/r#5" }), ans("a-5", 40), ASK("a-6", { card: "o/r#6" }), ans("a-6", 2), { ts: iso(1), event: "delivered", id: "a-6", terminal: "lead-r-1" }, msg("a-6", "r-1", 1, "agent", "applied, thanks")), showRun: true });
  eachRow(v, "answered");
  const d = select(v, "answered:a-6");
  has(d, "sent ✓ · received – · done –"); has(d, "sent ✓ · received ✓ · done –"); has(d, "Answered, not applied yet"); has(d, "You answered: Redis"); has(d, "Agent: applied, thanks");
  assert.equal(d.filter((s) => s === "not picked up").length, 1);
});

// AV_ASKS=<asks.jsonl> node --test render.test.js: renders a real run file, every row selected, narrow and wide
test("render: the run file named by AV_ASKS", { skip: !process.env.AV_ASKS }, async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(process.env.AV_ASKS, "utf8");
  for (const width of [900, 300]) for (const showRun of [false, true]) eachRow(draw({ asksText: text, showRun, width }), `file ${width} ${showRun}`);
});

test("render: a long title is cut to one line in the batch row, wide and narrow", () => {
  const title = `${"long title ".repeat(20)}end`, cut = `${title.slice(0, 59).trimEnd()}…`;
  for (const width of [900, 300]) { const v = draw({ asksText: lines(ASK("a-1", { title })), showRun: false, width }); has(v.drawn, cut); assert.ok(cut.length <= 60); }
});

test("render: a batch is named by its epic's cached title, 'to land' for the first lane, the ref when no title is cached", () => {
  const t = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  const batch = Array.from({ length: 3 }, (_, i) => ASK(`m-${i}`, { kind: "merge", batch_key: "merge:o/r#721", epic: "o/r#721", card: "o/r#72", target: t(i + 1) }));
  const v = draw({ asksText: lines(...batch), showRun: false });
  assert.equal(v.model().vm.batches[0].name, "r#721 · 3 to land");
  v.files.closed = JSON.stringify({ closed: [], titles: { "o/r#721": "Epic 05: Stalls and the parent-facing site" } });
  assert.equal(v.model().vm.batches[0].name, "Epic 05: Stalls and the parent-facing site · 3 to land");
  has(paint(v), "Epic 05: Stalls and the parent-facing site · 3 to land");
  v.files.closed = JSON.stringify({ closed: [], titles: { "o/r#721": "E".repeat(100) } });
  assert.equal(v.model().vm.batches[0].name, `${"E".repeat(59)}… · 3 to land`);
});

test("render: the side panel is stacked: the lanes, then the open ask with its thread, then the message box; the phone reads ask, box, lanes", () => {
  const thread = [msg("a-2", "s-1", 5, "owner", "does it need a release?"), msg("a-2", "s-2", 4, "agent", "yes, a build")];
  tabEnv(false);
  const v = draw({ asksText: lines(...lanes, ...thread), showRun: false, width: 900 });
  const d = select(v, keyOf(v, "batch", 1)), at = (x) => d.findIndex((s) => (x instanceof RegExp ? x.test(s) : s === x));
  const [lane, batch, ask, opt, thr, box] = ["NEEDS A LOOK", "Title a-2", "ask 1 of 1 ‹ ›", "A (Recommended)", /^Thread · 2 messages/, "To: agent behind this ask"].map(at);
  for (const [name, i] of [["lane", lane], ["batch", batch], ["ask", ask], ["options", opt], ["thread", thr], ["box", box]]) assert.ok(i >= 0, `${name} drawn`);
  assert.ok(lane < batch && batch < ask && ask < opt && opt < thr && thr < box, `order: ${[lane, batch, ask, opt, thr, box]}`);
  lacks(d, "@w:260"); // no fixed-width side column
  for (const l of ["ONE KEY", "YOUR HANDS", "NOT READY"]) assert.ok(at(l) >= 0 && at(l) < ask, `${l} listed above the ask`);
  const p = draw({ asksText: lines(...lanes, ...thread), showRun: false, width: 300 }), e = select(p, keyOf(p, "batch", 1));
  order(e, "ask 1 of 1 ‹ ›", "A (Recommended)", /^Thread · 2 messages/, "To: agent behind this ask", "ONE KEY 1 · LOOK 1 · HANDS 1 · NOT READY 1", "Picture");
});

// ---- every key says at once that it was taken (kuchbhi#1115): pressed, then confirmed or failed, in the open ask, with the call's exit code and stderr kept
const kcx = { notify() {}, stop_propagation() {}, timer: tcx.timer };
const calls = [];
const execWith = (fn) => { calls.length = 0; globalThis.__exec = async (c, a) => { calls.push([c, ...a]); return fn(c, a); }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const press = (v, k) => v.key({ keystroke: k }, kcx);
const typed = (v, text) => { for (const ch of text) press(v, ch); };
const NEVER = () => new Promise(() => {});
const OLD = { code: 2, stdout: "", stderr: "usage: ask.sh ask <card> --file <question.md> ..." };

const answered = (id, ago) => ({ ts: iso(ago), event: "answered", id, card: `o/r#${id.replace(/\D/g, "")}`, text: "Redis", key: "other", by: "owner", via: "screen" });
const KEYS = [
  { name: "a letter", asks: [ASK("a-1")], keys: ["a"], pressed: /^sending your pick: a…$/, ok: /^picked a: sent to the agent$/, argv: ["ask", "answer", "a-1"] },
  { name: "Enter", asks: [ASK("a-1")], keys: ["enter"], pressed: /^sending your pick: a…$/, ok: /^picked a: sent to the agent$/, argv: ["ask", "answer", "a-1"] },
  { name: "o, your own idea", asks: [ASK("a-1")], keys: ["o", ..."Valkey".split(""), "enter"], pressed: /^sending your idea…$/, ok: /^your idea sent: the agent applies it or replies below$/, argv: ["ask", "answer", "a-1"] },
  { name: "v, a picture", asks: [ASK("a-1")], keys: ["v"], pressed: /^asking the agent for a picture…$/, ok: /^picture requested: /, argv: ["ask", "visual", "a-1"] },
  { name: "/, a message", asks: [ASK("a-1")], keys: ["/", "h", "i", "enter"], pressed: /^sending your message…$/, ok: /^message sent: delivered when the terminal is free$/, argv: ["ask", "message", "a-1"] },
  { name: "x, do it yourself", asks: [ASK("a-9", { kind: "you", batch_key: "hands:o/r#1", options: [], body: "Do it.\n" })], keys: ["x"], pressed: /^marking it done…$/, ok: /^marked done$/, argv: ["ask", "answer", "a-9"] },
  { name: "r, a replacement", asks: [ASK("a-8", { terminal: "card-gone" }), { ts: iso(9), event: "visual_requested", id: "a-8" }], keys: ["r"], pressed: /^starting a replacement…$/, ok: /^replacement started$/, argv: ["ask", "replace", "a-8"] },
  { name: ". a nudge", asks: [ASK("a-5", { card: "o/r#5" }), answered("a-5", 40)], answeredRow: "answered:a-5", keys: ["."], pressed: /^nudging the asker…$/, ok: /^reminder sent · next in 10m$/, argv: ["ask", "nudge", "a-5"] },
];
const start = (c) => { const v = draw({ asksText: lines(...c.asks), showRun: true }); select(v, c.answeredRow ?? keyOf(v, "batch")); return v; };
const drive = (v, c) => { for (const k of c.keys) press(v, k); return v; };

for (const c of KEYS) {
  test(`key ${c.name}: the line says it was taken in the same redraw`, () => {
    execWith(NEVER); const v = drive(start(c), c);
    has(paint(v), c.pressed);
    assert.deepEqual(calls[0]?.slice(1, 1 + c.argv.length), c.argv);
  });
  test(`key ${c.name}: the confirmed line when the call exits 0`, async () => {
    execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = drive(start(c), c); await tick();
    const d = paint(v); has(d, c.ok); lacks(d, c.pressed); assert.equal(v.last.code, 0);
  });
  test(`key ${c.name}: an older plugin is named, with the way out; the exit code and stderr are kept`, async () => {
    execWith(async () => OLD); const v = drive(start(c), c); await tick();
    has(paint(v), /your plugin is older than this panel .*run \/plugin update/);
    assert.equal(v.last.code, 2); assert.match(v.last.stderr, /^usage: ask\.sh/); assert.equal(v.last.argv[0], "ask");
  });
  test(`key ${c.name}: a work that cannot run is said, never silent`, async () => {
    execWith(async () => { throw new Error("work: no such script"); }); const v = drive(start(c), c); await tick();
    has(paint(v), /did not run \(work: no such script\): is the work plugin installed\? run \/plugin update/);
    assert.equal(v.last.code, null); assert.match(v.last.stderr, /no such script/);
  });
  test(`key ${c.name}: a busy or gone agent is said, with what to do`, async () => {
    execWith(async () => ({ code: 1, stdout: "", stderr: "send: card-r-1 did not take it (busy or gone)" })); const v = drive(start(c), c); await tick();
    has(paint(v), /the agent is busy or gone; try again in a moment, or press r to start a replacement/); assert.equal(v.last.code, 1);
  });
}

test("key .: an answer that is not overdue says so and runs nothing", async () => {
  execWith(async () => ({ code: 0, stdout: "", stderr: "" }));
  const v = draw({ asksText: lines(ASK("a-6", { card: "o/r#6" }), answered("a-6", 2)), showRun: true }); select(v, "answered:a-6"); press(v, "."); await tick();
  has(paint(v), /^that answer is not overdue yet: a reminder works once it has waited 10 minutes$/); assert.equal(calls.length, 0);
});
test("key .: the nudge refused by the script (too soon) says so in words", async () => {
  execWith(async () => ({ code: 2, stdout: "", stderr: "ask: a-5 was answered less than 10 minutes ago: nudge in 3 minute(s)" }));
  const v = draw({ asksText: lines(ASK("a-5", { card: "o/r#5" }), answered("a-5", 40)), showRun: true }); select(v, "answered:a-5"); press(v, "."); await tick();
  has(paint(v), /^too soon to nudge: a-5 was answered less than 10 minutes ago: nudge in 3 minute\(s\)$/);
});
test("key: the status shows under the answered row's states and on the desk thread", async () => {
  execWith(async () => ({ code: 0, stdout: "", stderr: "" }));
  const v = draw({ asksText: lines(ASK("a-5", { card: "o/r#5" }), answered("a-5", 40)), showRun: true });
  select(v, "answered:a-5"); press(v, "."); await tick(); const a = paint(v); has(a, /^reminder sent · next in 10m$/); has(a, /^sent ✓ · received – · done –$/);
  select(v, "desk"); press(v, "/"); typed(v, "hello"); press(v, "enter"); await tick(); has(paint(v), /^message sent: /);
});

// ---- the Inbox as a main tab (kuchbhi#1115, inbox-tab-spec.md): the stack, the pane below, origin, the receipt, the phone ----
const runs = () => (globalThis.__runs ??= []);
function tabEnv(on = true, { split = true } = {}) {
  globalThis.__runs = []; timers.length = 0;
  globalThis.__spaces = on ? [{ id: "s1", tabs: [{ id: "tab-i", name: "Inbox", panes: 2 }] }] : [];
  globalThis.__panes = on ? [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, ...(split ? [{ pane: "p2", tab: "tab-i", terminal: "t1" }] : [])] : [];
  globalThis.__focused = on ? { space: "s1", tab: "tab-i" } : null;
};
const ran = (name) => runs().filter((r) => r[0] === name);
const W = (id, o = {}) => ASK(id, { terminal: "card-r-3", ...o });
const closedWith = (origin, titles = { "o/r#1": "Epic 14: Agent tooling" }) => JSON.stringify({ at: iso(0), closed: [], titles, origin });
function atIn(d) { return (x) => d.findIndex((s) => (x instanceof RegExp ? x.test(s) : s === x)); }
function order(d, ...xs) { const i = xs.map(atIn(d)); xs.forEach((x, n) => assert.ok(i[n] >= 0, `${x} drawn`)); i.forEach((p, n) => n && assert.ok(i[n - 1] < p, `${xs[n - 1]} before ${xs[n]}: ${i}`)); }
const ONE_PR = { kind: "merge", batch_key: "merge:o/r#1", card: "o/r#1", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land", then: "m" }, { q: 1, key: "b", label: "Hold", then: "h" }] };

test("tab: the top pane reads header, the open ask with its options and thread, the message box, the lanes, the key hints, then the header of the pane below", () => {
  tabEnv();
  const thread = [msg("a-2", "s-1", 5, "owner", "does it need a release?"), msg("a-2", "s-2", 4, "agent", "yes, a build")];
  const v = draw({ asksText: lines(W("a-2", { kind: "look", batch_key: "look:o/r#1" }), ...thread), showRun: false });
  const d = select(v, keyOf(v, "batch"));
  order(d, "ask 1 of 1 ‹ ›", "Title a-2", "A (Recommended)", /^Thread · 2 messages/, "To: card-r-3 · agent behind this ask", "NEEDS A LOOK", /^↑ ↓ batch/, "card-r-3 · working", "type here to talk to it · s switch · g open its tab");
  has(d, "1 ask in 1 batch"); has(d, "Inbox");
});
test("tab: the message box names the desk when the desk is highlighted", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-2")), showRun: false });
  has(select(v, "desk"), "To: desk-r");
});
test("panel (not the tab): the lanes stay above the ask, no pane below, and the key to open the tab is named", () => {
  tabEnv(false); const v = draw({ asksText: lines(...lanes), showRun: false }); const d = select(v, keyOf(v, "batch", 1));
  order(d, "NEEDS A LOOK", "ask 1 of 1 ‹ ›"); has(d, "i opens the tab"); lacks(d, /· working$/); flush(); assert.deepEqual(runs(), []);
});
test("tab: a pane is split below the mod once, then it shows the agent behind the highlighted ask", () => {
  tabEnv(true, { split: false }); const v = draw({ asksText: lines(W("a-2")), showRun: false }); flush(); paint(v); flush();
  assert.deepEqual(ran("pane.split"), [["pane.split", { pane: "p1", direction: "down" }]]);
});
test("tab: the pane below follows the highlight: one terminal.show per change, none while the same agent stays", () => {
  tabEnv(); const asksText = lines(W("a-1", { batch_key: "k1" }), W("a-2", { terminal: "lead-r-1", card: "o/r#4", batch_key: "k2" }));
  const v = draw({ asksText, showRun: false }); flush(); paint(v); flush();
  assert.deepEqual(ran("terminal.show"), [["terminal.show", { terminal: "t1", pane: "p2" }]]);
  press(v, "down"); flush(); paint(v); flush();
  assert.deepEqual(ran("terminal.show").slice(1), [["terminal.show", { terminal: "t2", pane: "p2" }]]);
  has(paint(v), "lead-r-1 · working");
});
test("tab: s opens the agent picker; a pick shows that agent and pins it, the highlight moving does not change it; esc follows again", () => {
  tabEnv(); const asksText = lines(W("a-1", { batch_key: "k1" }), W("a-2", { terminal: "lead-r-1", card: "o/r#4", batch_key: "k2" }));
  const v = draw({ asksText, showRun: false }); flush();
  press(v, "s"); let d = paint(v); order(d, "Switch to", "desk-r", "lead-r-1", "card-r-3");
  press(v, "down"); press(v, "enter"); flush(); d = paint(v); flush();
  assert.deepEqual(ran("terminal.show").at(-1), ["terminal.show", { terminal: "t2", pane: "p2" }]);
  has(d, "lead-r-1 · working · pinned"); has(d, "esc follow the highlight · s switch"); lacks(d, "Switch to");
  const n = ran("terminal.show").length; press(v, "down"); press(v, "up"); flush(); paint(v); flush();
  assert.equal(ran("terminal.show").length, n, "pinned: moving the highlight shows nothing else");
  press(v, "escape"); flush(); d = paint(v); flush();
  assert.equal(v.pinned, null); has(d, "card-r-3 · working"); assert.deepEqual(ran("terminal.show").at(-1), ["terminal.show", { terminal: "t1", pane: "p2" }]);
});
test("tab: the picker cancels with esc and shows nothing", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1")), showRun: false }); flush(); const n = ran("terminal.show").length;
  press(v, "s"); press(v, "escape"); flush(); lacks(paint(v), "Switch to"); assert.equal(ran("terminal.show").length, n);
});
test("tab: an ask with no agent behind it keeps the last terminal and says why; a gone agent says r replaces it", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1", { batch_key: "k1" }), W("a-3", { kind: "you", terminal: undefined, batch_key: "hands:o/r#1" }), W("a-5", { terminal: "card-r-9", card: "o/r#9", batch_key: "k9" })), showRun: false }); flush();
  const n = ran("terminal.show").length;
  select(v, keyOf(v, "batch", 2)); flush(); has(paint(v), "no agent behind this ask · showing card-r-3");
  select(v, keyOf(v, "batch", 1)); flush(); has(paint(v), "card-r-9 is gone · r replace");
  assert.equal(ran("terminal.show").length, n, "the last terminal stays");
});
test("tab: g goes to the agent's own tab (agent.focus); on the phone g peeks it (terminal.peek)", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1")), showRun: false }); select(v, keyOf(v, "batch")); press(v, "g");
  assert.deepEqual(ran("agent.focus"), [["agent.focus", { terminal: "t1" }]]);
  tabEnv(false); const p = draw({ asksText: lines(W("a-1")), showRun: false, width: 300 }); select(p, keyOf(p, "batch")); press(p, "g");
  assert.deepEqual(ran("terminal.peek"), [["terminal.peek", { terminal: "t1" }]]); assert.deepEqual(ran("agent.focus"), []);
});
test("tab: g with no agent behind the ask runs nothing; an option lettered g keeps it", async () => {
  tabEnv(); execWith(async () => ({ code: 0, stdout: "", stderr: "" }));
  const v = draw({ asksText: lines(W("a-3", { kind: "you", terminal: undefined, batch_key: "hands:o/r#1" })), showRun: false }); select(v, keyOf(v, "batch")); press(v, "g"); assert.deepEqual(runs(), []);
  const o = draw({ asksText: lines(W("a-1", { options: [{ q: 1, key: "g", label: "Go (Recommended)", then: "x" }] })), showRun: false }); select(o, keyOf(o, "batch")); press(o, "g"); await tick();
  assert.deepEqual(ran("agent.focus"), []); assert.deepEqual(calls[0]?.slice(1, 3), ["ask", "answer"]);
});
test("panel: i opens the Inbox tab (tab.new), or selects it when it exists", () => {
  tabEnv(false); globalThis.__spaces = [{ id: "s1", tabs: [{ id: "tab-a", name: "work", panes: 1 }] }]; globalThis.__focused = { space: "s1", tab: "tab-a" };
  const v = draw({ asksText: lines(W("a-1")), showRun: false }); press(v, "i");
  assert.deepEqual(runs(), [["tab.new", { space: "s1", name: "Inbox", mod: "agents-view" }]]);
  tabEnv(); globalThis.__focused = { space: "s1", tab: "tab-a" }; globalThis.__spaces[0].tabs.push({ id: "tab-a", name: "work", panes: 1 });
  const w = draw({ asksText: lines(W("a-1")), showRun: false }); press(w, "i"); assert.deepEqual(runs(), [["tab.select", { id: "tab-i" }]]);
});

// ---- 4. v on a dead agent
test("v on a dead agent: the panel says at once it is gone and what r does, runs no ask visual; r then starts the replacement", async () => {
  execWith(async () => ({ code: 0, stdout: "", stderr: "" })); tabEnv(false);
  const v = draw({ asksText: lines(W("a-8", { terminal: "card-gone" })), showRun: false }); select(v, keyOf(v, "batch"));
  press(v, "v");
  has(paint(v), "card-gone is gone, so no picture yet · r starts a replacement with this ask as its brief, and it draws the picture");
  assert.equal(calls.length, 0, "no request that cannot be delivered");
  press(v, "r"); has(paint(v), /^starting a replacement…$/); assert.deepEqual(calls[0]?.slice(1, 4), ["ask", "replace", "a-8"]);
});

// ---- 5. origin
test("origin: Why, What and How on the ask, from the stored card data", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-2", { plan: "https://x.test/m.html" })), showRun: false });
  v.files.closed = closedWith({ "o/r#2": { by: "you", summary: "inbox slice B, filed by you", trail: ["Validate", "Plan", "Mockup"] } });
  const d = select(v, keyOf(v, "batch"));
  order(d, "Title a-2", "Why", "your card", "Epic 14: Agent tooling", "· inbox slice B, filed by you", "What", "Validate → Plan → Mockup", "How", "Today");
  for (const x of ["open plan", "open card", "go to agent"]) has(d, x); lacks(d, "diff");
});
test("origin: an agent-filed card is marked and a PR ask offers the diff", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1", ONE_PR)), showRun: false });
  v.files.closed = closedWith({ "o/r#1": { by: "agent", summary: "three refusal hints print a failing command", trail: ["Validate", "Tests", "PR #1109"] } });
  const d = select(v, keyOf(v, "batch")); has(d, "agent-filed"); has(d, "diff"); has(d, "Validate → Tests → PR #1109");
});
test("origin: an old card with no stored data shows only Why: the epic title, no What and no How", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-2")), showRun: false }); v.files.closed = closedWith({});
  const d = select(v, keyOf(v, "batch")); has(d, "Why"); has(d, "Epic 14: Agent tooling"); lacks(d, "What"); lacks(d, "How"); lacks(d, "your card"); lacks(d, "agent-filed");
});
test("origin: c opens the card in the browser, d the PR's files", async () => {
  execWith(async () => ({ code: 0, stdout: "", stderr: "" })); tabEnv();
  const v = draw({ asksText: lines(W("a-1", ONE_PR)), showRun: false });
  v.files.closed = closedWith({ "o/r#1": { by: "you", summary: "s", trail: [] } }); select(v, keyOf(v, "batch")); press(v, "c"); press(v, "d"); await tick();
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [["open", "https://github.com/o/r/issues/1"], ["open", "https://github.com/o/r/pull/5/files"]]);
});

// ---- 3. the receipt line
test("receipt: one line under the options, never two: armed shows once, above the message box", () => {
  execWith(NEVER); tabEnv();
  const v = draw({ asksText: lines(W("a-1", ONE_PR)), showRun: false });
  select(v, keyOf(v, "batch")); press(v, "a"); const d = paint(v);
  assert.equal(d.filter((s) => /press a again within 10s/.test(s)).length, 1, "one armed line");
  order(d, "Land", "Hold", /press a again within 10s/, "To: card-r-3 · agent behind this ask");
});
test("receipt: the pressed option flashes for 300ms and the line sits under the options", () => {
  execWith(NEVER); tabEnv(); const v = draw({ asksText: lines(W("a-1", ONE_PR)), showRun: false }); select(v, keyOf(v, "batch")); timers.length = 0; press(v, "b");
  const d = paint(v); order(d, "Land", "Hold", /press b again within 10s/);
  assert.deepEqual(v.flash, { id: "a-1", key: "b" }); assert.ok(timers.length > 0, "a timer clears it"); flush(); assert.equal(v.flash, null);
});
test("receipt: a picture asked for and a picture ready each read in the receipt", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1"), W("a-2", { batch_key: "decide:o/r#2", epic: "o/r#2" }), { ts: iso(9), event: "visual_requested", id: "a-1" }, { ts: iso(8), event: "visual_requested", id: "a-2" }, { ts: iso(7), event: "visual_ready", id: "a-2", url: "http://x/p" }), showRun: false });
  has(select(v, "batch:decide:o/r#1"), /^picture requested: /); has(select(v, "batch:decide:o/r#2"), /^picture ready · ↵ opens it$/);
});

// ---- 6. phone
test("phone: one column: header, the ask, the box, the lanes on one line, the bottom bar; no split, no pane below", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-1")), showRun: false, width: 390 }); const d = select(v, keyOf(v, "batch"));
  order(d, "ask 1 of 1 ‹ ›", "A (Recommended)", "To: card-r-3 · agent behind this ask", "ONE KEY 0 · LOOK 1 · HANDS 0 · NOT READY 0", "Picture", "Own idea", "Go to agent"); has(d, "Inbox");
  flush(); assert.deepEqual(runs(), []); lacks(d, "type here to talk to it · s switch · g open its tab");
});
test("phone: the bar buttons run the keys: Go to agent peeks the terminal", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-1")), showRun: false, width: 390 }); select(v, keyOf(v, "batch"));
  v.phoneKey("g", kcx); assert.deepEqual(ran("terminal.peek"), [["terminal.peek", { terminal: "t1" }]]);
});
test("phone: Go to agent is not offered when no agent is behind the ask", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-3", { kind: "you", terminal: undefined, batch_key: "hands:o/r#1" })), showRun: false, width: 390 }); const d = select(v, keyOf(v, "batch"));
  has(d, "Picture"); has(d, "Own idea"); lacks(d, "Go to agent");
});
test("phone: an empty inbox says nothing needs you and where to type; the box names the desk", () => {
  tabEnv(false); const v = draw({ asksText: "", showRun: false, width: 390 }); const d = paint(v);
  order(d, "Nothing needs you.", "Type below to message the desk.", "To: desk-r", "ONE KEY 0 · LOOK 0 · HANDS 0 · NOT READY 0");
});
