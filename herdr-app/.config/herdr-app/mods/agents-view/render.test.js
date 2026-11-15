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
    export const shared = (k) => (globalThis.__shared ??= {})[k], setShared = (k, v) => { (globalThis.__shared ??= {})[k] = v; }, exec = async (c, a) => (globalThis.__exec ? globalThis.__exec(c, a) : { code: 0, stdout: "", stderr: "" }), run = (...a) => { (globalThis.__runs ??= []).push(a); }, props = () => globalThis.__props ?? {}, panes = () => globalThis.__panes ?? [], focused = () => globalThis.__focused ?? null, spaces = () => globalThis.__spaces ?? [], agents = () => [], readTextFile = () => new Promise(() => {}), home = () => "/h", closeOverlay = () => {};
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
  v.init({}, { focus_handle: () => ({ focus() {} }), timer: { every: (ms, f) => ((globalThis.__every ??= {})[ms] = f) }, spawn() {}, notify() {} });
  v.files = { asks: asksText, events: "", usage: null, upNext: null, settings: null, closed: null, stuck: terminals.length ? stuck : null };
  v.showRun = showRun; v.width = width ?? 900;
  v.drawn = paint(v);
  return v;
};
const select = (v, key) => { v.sel = key; v.touched = true; return paint(v); };
const keyOf = (v, section, n = 0) => v.model().rows.filter((r) => r.section === (section === "batch" ? "epic" : section))[n].key; // a batch of old is an epic row now
const has = (drawn, x) => assert.ok(drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} to be drawn; got: ${drawn.filter((s) => s.length > 1 && !/^#|^Geist|^JetBrains/.test(s)).join(" | ").slice(0, 600)}`);
const lacks = (drawn, x) => assert.ok(!drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} not to be drawn`);

const ASK = (id, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "Q\n\n1. Q\n   a) A => a\n   b) B => b\n",
  today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1", options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const lines = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
// every row selected in turn: none may throw
const eachRow = (v, tag) => { for (const r of v.model().rows) { v.sel = r.key; v.touched = true; assert.doesNotThrow(() => v.render({ notify() {} }), `${tag} ${r.key}`); } };
const lanes = [
  ASK("a-1", { kind: "merge", epic: "o/r#1", batch_key: "merge:o/r#1", title: "Land the fix", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land", then: "m" }, { q: 1, key: "b", label: "Hold", then: "h" }] }),
  ASK("a-2", { kind: "look", epic: "o/r#2", batch_key: "look:o/r#1" }),
  ASK("a-3", { kind: "you", epic: "o/r#3", batch_key: "hands:o/r#1" }),
  ASK("a-4", { kind: "groom", epic: "o/r#4", batch_key: "groom:o/r#1", card: "o/r#1" }), { ts: iso(20), event: "groomed", id: "a-4", member: "o/r#21", ready: false, choices: ["Which store?", "Keep the API?"] },
];
const msg = (id, mid, ago, from, text) => ({ ts: iso(ago), event: "message", mid, thread: id, ...(id === "desk" ? {} : { id }), from, to: from === "owner" ? "lead-r-1" : "owner", text });

test("render: asks waiting with the lists hidden draws the inbox and one summary line, no running rows", () => {
  const v = draw({ asksText: asks, showRun: false }); eachRow(v, "hidden");
  for (const s of ["Running 2 · Stuck 1", "2 epics need you", "desk-r"]) has(v.drawn, s);
  for (const s of ["Running", "Stuck", "lead-r-1", "card-r-3", "Nothing needs you."]) lacks(v.drawn, s);
});
test("render: asks waiting with the lists shown also draws the running and stuck rows", () => {
  const v = draw({ asksText: asks, showRun: true }); eachRow(v, "shown");
  for (const s of ["Running", "Stuck", "lead-r-1", "card-r-3", "o/r#1", "working", /^blocked/, "Running 2 · Stuck 1"]) has(v.drawn, s);
});
test("render: no asks says nothing needs you and lists what runs", () => {
  const v = draw({ asksText: "", showRun: false }); eachRow(v, "no asks");
  for (const s of ["Nothing needs you", "Running", "lead-r-1", "desk-r"]) has(v.drawn, s);
});
test("render: empty, nothing running and no asks", () => {
  const v = draw({ asksText: null, showRun: false, terminals: [] }); eachRow(v, "empty");
  for (const s of ["Nothing running", "not started", "0 working · 0 stuck", "Nothing needs you"]) has(v.drawn, s);
  lacks(v.drawn, "lead-r-1");
});

for (const [name, showRun] of [["lists hidden", false], ["lists shown", true]]) test(`render: the four lanes with their counts and each batch's pane, ${name}`, () => {
  const v = draw({ asksText: lines(...lanes), showRun }); eachRow(v, "lanes");
  for (const s of ["Land the fix", "Title a-2", "Title a-3", "Title a-4", "4 epics need you"]) has(v.drawn, s); for (const s of ["One key", "Needs a look", "Your hands"]) lacks(v.drawn, s); // the epics, not the lanes
  assert.deepEqual(v.model().vm.lanes.map((l) => [l.label, l.count]), [["One key", 1], ["Needs a look", 1], ["Your hands", 1], ["Not ready", 1]]);
  has(select(v, keyOf(v, "batch", 0)), "Land the fix");
  has(select(v, keyOf(v, "batch", 1)), "Title a-2");
  has(select(v, keyOf(v, "batch", 2)), "Title a-3");
  const g = select(v, keyOf(v, "batch", 3)); has(g, "1 card not ready"); has(g, "Which store? · Keep the API?");
});

test("render: the stepper offers the whole batch in order, and a landed PR is counted", () => {
  const t = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  const v = draw({ asksText: lines(ASK("m-1", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(1), after_landing: ["run install.sh"] }), ASK("m-2", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(2) }), { ts: iso(5), event: "landed", id: "m-1" }), showRun: true });
  eachRow(v, "stepper");
  has(v.drawn, "Merge all 2, in order (Recommended)"); has(v.drawn, "Pick which to merge"); has(v.drawn, "1 epic needs you");
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
  has(d, "Title a-2"); lacks(d, "One key 1 · Look 1 · Hands 1 · Not ready 1"); lacks(d, "Needs a look");
});

test("render: a groom batch lists its cards that are not ready, with their open choices", () => {
  const v = draw({ asksText: lines(lanes[3], lanes[4], { ts: iso(10), event: "groomed", id: "a-4", member: "o/r#22", ready: false, choices: ["Which queue?"] }), showRun: false }); eachRow(v, "groom");
  const d = select(v, keyOf(v, "batch")); has(d, "2 cards not ready"); has(d, "Which store? · Keep the API?"); has(d, "Which queue?");
});

test("render: picture coming and open picture appear on the ask they belong to", () => {
  const v = draw({ asksText: lines(ASK("a-1"), ASK("a-2", { batch_key: "decide:o/r#2", epic: "o/r#2" }), { ts: iso(9), event: "visual_requested", id: "a-1" }, { ts: iso(8), event: "visual_requested", id: "a-2" }, { ts: iso(7), event: "visual_ready", id: "a-2", url: "http://127.0.0.1:7777/p/x" }), showRun: false }); eachRow(v, "pictures");
  const a1 = select(v, "epic:o/r#1"), a2 = select(v, "epic:o/r#2");
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
  const title = `${"long title ".repeat(20)}end`;
  for (const width of [900, 300]) { const v = draw({ asksText: lines(ASK("a-1", { title })), showRun: false, width }); has(v.drawn, title); } // one line: the row truncates it
});

test("render: an epic is named by its cached title, the ref when no title is cached", () => {
  const t = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  const batch = Array.from({ length: 3 }, (_, i) => ASK(`m-${i}`, { kind: "merge", batch_key: "merge:o/r#721", epic: "o/r#721", card: "o/r#72", target: t(i + 1) }));
  const v = draw({ asksText: lines(...batch), showRun: false });
  assert.equal(v.model().vm.epics[0].title, "r#721"); has(paint(v), "r#721");
  v.files.closed = JSON.stringify({ closed: [], titles: { "o/r#721": "Epic 05: Stalls and the parent-facing site" } });
  assert.equal(v.model().vm.epics[0].title, "Epic 05: Stalls and the parent-facing site");
  has(paint(v), "Epic 05: Stalls and the parent-facing site");
});

test("render: one order at every width and in the panel: the open ask with its thread, the message box, then the epics", () => {
  const thread = [msg("a-2", "s-1", 5, "owner", "does it need a release?"), msg("a-2", "s-2", 4, "agent", "yes, a build")];
  tabEnv(false);
  const v = draw({ asksText: lines(...lanes, ...thread), showRun: false, width: 900 });
  const d = select(v, keyOf(v, "batch", 1)), at = (x) => d.findIndex((s) => (x instanceof RegExp ? x.test(s) : s === x));
  const [opt, thr, box] = ["A (Recommended)", /^Thread · 2 messages/, "To: no lead running"].map(at);
  for (const [name, i] of [["options", opt], ["thread", thr], ["box", box]]) assert.ok(i >= 0, `${name} drawn`);
  assert.ok(opt < thr && thr < box, `order: ${[opt, thr, box]}`);
  assert.ok(d.lastIndexOf("Title a-2") > box, "the epic rows are under the box");
  lacks(d, "@w:260"); // no fixed-width side column
  const p = draw({ asksText: lines(...lanes, ...thread), showRun: false, width: 300 }), e = select(p, keyOf(p, "batch", 1));
  order(e, "A (Recommended)", /^Thread · 2 messages/, "To: no lead running", "Picture");
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
  { name: "n, a note with no pick is the answer", asks: [ASK("a-1")], keys: ["n", ..."Valkey".split(""), "enter"], pressed: /^sending your idea…$/, ok: /^your idea sent: the agent applies it or replies below$/, argv: ["ask", "answer", "a-1"] },
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
function tabEnv(on = true, { split = true, open = true } = {}) {
  globalThis.__shared = open ? { "agents-view.pane": true } : {}; globalThis.__runs = []; timers.length = 0;
  globalThis.__props = on ? { inbox: true } : {};
  globalThis.__panes = on ? [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, ...(split ? [{ pane: "p2", tab: "tab-i", terminal: "t1" }] : [])] : [];
  globalThis.__focused = on ? { space: "s1", tab: "tab-i" } : null;
}
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
  order(d, "Title a-2", "A (Recommended)", /^Thread · 2 messages/, "To: lead-r-1 · the epic's lead", /^↑ ↓ epic/, "lead-r-1 · working", "cmd-shift-t closes · g open its tab");
  has(d, "1 epic needs you"); has(d, "Inbox");
});
test("tab: the message box names the desk when the desk is highlighted", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-2")), showRun: false });
  has(select(v, "desk"), "To: desk-r");
});
test("panel (not the tab): the same order, no pane below, and the key to open the tab is named", () => {
  tabEnv(false); const v = draw({ asksText: lines(...lanes), showRun: false }); const d = select(v, keyOf(v, "batch", 1));
  has(d, "· i opens the tab"); lacks(d, "cmd-shift-t closes · g open its tab"); lacks(d, /· working$/); flush(); assert.deepEqual(runs(), []);
});
const FILE = "/tmp/herdr-agents-view-p1.addr";
const LOOP = ["sh", "-c", `f=${FILE}; while a=$(cat "$f" 2>/dev/null); [ -n "$a" ]; do hc attach "$a" || sleep 1; done`];
const SPLIT = ["pane.split", { pane: "p1", direction: "right", argv: LOOP }];
const written = () => calls.filter((c) => c[0] === "sh" && /printf %s/.test(c[2] ?? "")).map((c) => c[2]);
const detached = () => calls.filter((c) => c[0] === "hc" && c[1] === "keys").map((c) => c.slice(2));
const upAll = (v) => { flush(); globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p2", tab: "tab-i", terminal: "t9" }]; paint(v); flush(); runs().length = 0; calls.length = 0; };
test("tab: the first attach writes the address and splits one pane below the mod running the loop; no second split once it has appeared", async () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-2")), showRun: false }); flush(); paint(v); flush(); await tick(); await tick();
  assert.deepEqual(ran("pane.split"), [SPLIT]); assert.deepEqual(written(), ["printf %s 't2' > " + FILE]);
  globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p2", tab: "tab-i", terminal: "t9" }]; runs().length = 0; calls.length = 0; paint(v); flush();
  assert.deepEqual(runs(), []); assert.deepEqual(calls, []);
});
test("tab: the first split gives the keyboard back to the Inbox pane (opening the tab or switching to it never lands in the agent pane)", () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-2")), showRun: false });
  return (async () => { flush(); await tick(); await tick(); assert.deepEqual(runs().at(-1), ["pane.focus", { pane: "p1" }]); assert.ok(runs().findIndex((r) => r[0] === "pane.split") < runs().findIndex((r) => r[0] === "pane.focus")); })();
});
test("tab: moving to another ask keeps the pane (no close, no split, no resize): the address is written and the attach in it is detached", async () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const asksText = lines(W("a-1", { batch_key: "k1" }), W("a-2", { epic: "o/r#2", card: "o/r#4", batch_key: "k2" }));
  const v = draw({ asksText, showRun: false, terminals: [...terms, term({ address: "t7", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] })] }); await (async () => { flush(); await tick(); await tick(); })(); upAll(v);
  press(v, "down"); paint(v); flush(); await tick(); await tick();
  assert.deepEqual(runs(), [], "the pane is not touched");
  assert.deepEqual(written(), ["printf %s 't7' > " + FILE]); assert.deepEqual(detached(), [["t9", "ctrl+\\"]]);
  has(paint(v), "lead-r-2 · working");
  calls.length = 0; paint(v); flush(); await tick(); assert.deepEqual(calls, [], "the same agent: nothing more");
});
test("tab: the lower pane gone for good (closed by hand, or its program ended) is split again, but a blink of panes() is not", async () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-1")), showRun: false }); flush(); await tick(); upAll(v);
  const gone = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }], back = [...gone, { pane: "p2", tab: "tab-i", terminal: "t9" }];
  globalThis.__panes = gone; paint(v); flush(); await tick(); await tick(); assert.deepEqual(ran("pane.split"), [], "one render without it: nothing");
  globalThis.__panes = back; paint(v); flush(); assert.equal(v.missingSince, null, "it came back");
  globalThis.__panes = gone; paint(v); v.missingSince = Date.now() - 4000; paint(v); flush(); await tick(); await tick();
  assert.deepEqual(ran("pane.split"), [SPLIT], "gone for more than 3s: split again, once");
});
test("tab: this copy is the Inbox because its props say so: still true while another tab has the focus, and false for the side panel", () => {
  tabEnv(); globalThis.__focused = { space: "s1", tab: "tab-other" };
  const v = draw({ asksText: lines(W("a-1")), showRun: false }); has(v.drawn, "lead-r-1 · working"); has(v.drawn, "cmd-shift-t closes · g open its tab");
  tabEnv(); globalThis.__props = {}; const p = draw({ asksText: lines(W("a-1")), showRun: false }); lacks(p.drawn, "lead-r-1 · working"); flush(); assert.deepEqual(runs(), []);
});
test("tab: s opens the agent picker; a pick shows that agent and pins it, the highlight moving does not change it; esc follows again", async () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const asksText = lines(W("a-1", { batch_key: "k1" }), W("a-2", { terminal: "lead-r-1", card: "o/r#4", batch_key: "k2" }));
  const v = draw({ asksText, showRun: false }); flush(); await tick(); upAll(v);
  press(v, "s"); let d = paint(v); order(d, "Switch to", "desk-r", "lead-r-1", "card-r-3");
  press(v, "down"); press(v, "down"); press(v, "enter"); d = paint(v); flush(); await tick(); await tick();
  assert.deepEqual(written(), ["printf %s 't1' > " + FILE]); assert.deepEqual(runs(), [], "the pane is kept");
  has(d, "card-r-3 · working · pinned"); has(d, "cmd-shift-t closes · esc follow the highlight · s switch"); lacks(d, "Switch to");
  calls.length = 0; press(v, "down"); press(v, "up"); paint(v); flush(); await tick(); assert.deepEqual(calls, [], "pinned: moving the highlight shows nothing else");
  press(v, "escape"); d = paint(v); flush(); await tick(); await tick();
  assert.equal(v.pinned, null); has(d, "lead-r-1 · working"); assert.deepEqual(written(), ["printf %s 't2' > " + FILE]);
});
test("tab: the picker cancels with esc and shows nothing", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1")), showRun: false }); flush(); const n = runs().length;
  press(v, "s"); press(v, "escape"); flush(); lacks(paint(v), "Switch to"); assert.equal(runs().length, n);
});
test("tab: an epic with no lead keeps the last terminal and says why", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1", { batch_key: "k1" }), W("a-5", { terminal: "card-r-9", card: "o/r#9", epic: "o/r#9", batch_key: "k9" })), showRun: false }); flush();
  const n = runs().length;
  select(v, "epic:o/r#9"); flush(); has(paint(v), "no lead running · showing lead-r-1");
  assert.equal(runs().length, n, "the last terminal stays");
});
test("tab: g goes to the agent's own tab (agent.focus); on the phone g peeks it (terminal.peek)", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1")), showRun: false }); select(v, keyOf(v, "batch")); press(v, "g");
  assert.deepEqual(ran("agent.focus"), [["agent.focus", { terminal: "t2" }]]);
  tabEnv(false); const p = draw({ asksText: lines(W("a-1")), showRun: false, width: 300 }); select(p, keyOf(p, "batch")); press(p, "g");
  assert.deepEqual(ran("terminal.peek"), [["terminal.peek", { terminal: "t2" }]]); assert.deepEqual(ran("agent.focus"), []);
});
test("tab: g with no agent behind the ask runs nothing; an option lettered g keeps it", async () => {
  tabEnv(); execWith(async () => ({ code: 0, stdout: "", stderr: "" }));
  const v = draw({ asksText: lines(W("a-3", { kind: "you", terminal: undefined, epic: "o/r#9", batch_key: "hands:o/r#9" })), showRun: false }); select(v, keyOf(v, "batch")); press(v, "g"); assert.deepEqual(runs(), []);
  const o = draw({ asksText: lines(W("a-1", { options: [{ q: 1, key: "g", label: "Go (Recommended)", then: "x" }] })), showRun: false }); select(o, keyOf(o, "batch")); press(o, "g"); await tick();
  assert.deepEqual(ran("agent.focus"), []); assert.deepEqual(calls[0]?.slice(1, 3), ["ask", "answer"]);
});
test("panel: i opens the Inbox, which lives in its own space: tabs-agents.toggle does the space.new, the tab and the later selects", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-1")), showRun: false }); press(v, "i");
  assert.deepEqual(runs(), [["tabs-agents.toggle"]]);
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
  has(d, "Epic 14: Agent tooling"); order(d, "Title a-2", "Why", "your card", "· inbox slice B, filed by you", "What", "Validate → Plan → Mockup", "How", "Today");
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
  order(d, "Land", "Hold", /press a again within 10s/, "To: lead-r-1 · the epic's lead");
});
test("receipt: the pressed option flashes for 300ms and the line sits under the options", () => {
  execWith(NEVER); tabEnv(); const v = draw({ asksText: lines(W("a-1", ONE_PR)), showRun: false }); select(v, keyOf(v, "batch")); timers.length = 0; press(v, "1"); press(v, "b");
  const d = paint(v); order(d, "Land", "Hold", /press b again within 10s/);
  assert.deepEqual(v.flash, { id: "a-1", key: "b" }); assert.ok(timers.length > 0, "a timer clears it"); flush(); assert.equal(v.flash, null);
});
test("receipt: a picture asked for and a picture ready each read in the receipt", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-1"), W("a-2", { batch_key: "decide:o/r#2", epic: "o/r#2" }), { ts: iso(9), event: "visual_requested", id: "a-1" }, { ts: iso(8), event: "visual_requested", id: "a-2" }, { ts: iso(7), event: "visual_ready", id: "a-2", url: "http://x/p" }), showRun: false });
  has(select(v, "epic:o/r#1"), /^picture requested: /); has(select(v, "epic:o/r#2"), /^picture ready · ↵ opens it$/);
});

// ---- 6. phone
test("phone: one column: header, the ask, the box, the lanes on one line, the bottom bar; no split, no pane below", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-1")), showRun: false, width: 390 }); const d = select(v, keyOf(v, "batch"));
  order(d, "A (Recommended)", "To: lead-r-1 · the epic's lead", "Picture", "Note", "Open"); has(d, "Inbox");
  flush(); assert.deepEqual(runs(), []); lacks(d, "cmd-shift-t closes · g open its tab");
});
test("phone: the bar buttons run the keys: Open peeks the terminal", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-1")), showRun: false, width: 390 }); select(v, keyOf(v, "batch"));
  v.phoneKey("g", kcx); assert.deepEqual(ran("terminal.peek"), [["terminal.peek", { terminal: "t2" }]]);
});
test("phone: Open is not offered when no agent is behind the ask", () => {
  tabEnv(false); const v = draw({ asksText: lines(W("a-3", { kind: "you", terminal: undefined, epic: "o/r#9", batch_key: "hands:o/r#9" })), showRun: false, width: 390 }); const d = select(v, keyOf(v, "batch"));
  has(d, "Picture"); has(d, "Note"); lacks(d, "Open");
});
test("phone: an empty inbox says nothing needs you and where to type; the box names the desk", () => {
  tabEnv(false); const v = draw({ asksText: "", showRun: false, width: 390, terminals: [terms[2]] }); v.files.stuck = null; const d = paint(v);
  has(d, "Nothing needs you"); has(d, "To: desk-r");
});
test("tab: renders before the new pane appears do not split a second one", async () => {
  tabEnv(true, { split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-1")), showRun: false }); paint(v); paint(v); flush(); await tick(); await tick(); paint(v); flush(); await tick();
  assert.deepEqual(ran("pane.split"), [SPLIT]);
});

test("toggle: no pane until t; t writes the address, splits one pane and gives it the keyboard; t again closes it", async () => {
  tabEnv(true, { open: false, split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-1")), showRun: false }); flush(); paint(v); flush(); await tick();
  assert.deepEqual(runs(), [], "nothing is split before t"); assert.deepEqual(calls, []); has(v.drawn, "agent pane closed");
  press(v, "t"); let d = paint(v); flush(); await tick(); await tick(); assert.deepEqual(ran("pane.split"), [SPLIT]); has(d, "lead-r-1 · working"); has(d, "cmd-shift-t closes · g open its tab");
  assert.ok(!ran("pane.focus").some((r) => r[1].pane === "p1"), "opened by the toggle: the keyboard is not given back to the Inbox pane");
  runs().length = 0; globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p3", tab: "tab-i", terminal: "t9" }]; paint(v); flush();
  assert.deepEqual(runs(), [["pane.focus", { pane: "p3" }]], "the new pane has the keyboard");
  runs().length = 0; press(v, "t"); paint(v); flush(); assert.deepEqual(runs(), [["pane.close", { pane: "p3" }]]);
  runs().length = 0; globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }]; paint(v); flush(); assert.deepEqual(runs(), [], "stays closed");
});
test("toggle: cmd-shift-t (tabs-agents flips the shared flag) opens and closes it from any focus; moving to another ask swaps what is attached and takes no keyboard", async () => {
  tabEnv(true, { open: false, split: false }); execWith(async () => ({ code: 0, stdout: "", stderr: "" })); const v = draw({ asksText: lines(W("a-1", { batch_key: "k1" }), W("a-2", { epic: "o/r#2", card: "o/r#4", batch_key: "k2" })), showRun: false, terminals: [...terms, term({ address: "t7", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] })] }); flush();
  globalThis.__shared["agents-view.pane"] = true; paint(v); flush(); await tick(); await tick(); assert.deepEqual(ran("pane.split"), [SPLIT]);
  globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p3", tab: "tab-i", terminal: "t9" }]; paint(v); flush(); runs().length = 0; calls.length = 0;
  press(v, "down"); paint(v); flush(); await tick(); await tick();
  assert.deepEqual(runs(), [], "no close, no split, no pane.focus"); assert.deepEqual(written(), ["printf %s 't7' > " + FILE]); assert.deepEqual(detached(), [["t9", "ctrl+\\"]]);
  globalThis.__shared["agents-view.pane"] = false; paint(v); flush(); assert.deepEqual(runs(), [["pane.close", { pane: "p3" }]]);
});
test("toggle: t does nothing in the side panel, and an option lettered t keeps it", () => {
  tabEnv(false, { open: false }); const p = draw({ asksText: lines(W("a-1")), showRun: false }); select(p, keyOf(p, "batch")); press(p, "t"); assert.equal(p.paneOn, false);
  tabEnv(true, { open: false, split: false }); const o = draw({ asksText: lines(W("a-1", { options: [{ q: 1, key: "t", label: "Take (Recommended)", then: "x" }] })), showRun: false }); flush(); press(o, "t"); assert.equal(o.paneOn, false);
});
test("toggle: the 500ms watch redraws only when the shared flag changed", () => {
  tabEnv(true, { open: false }); let n = 0; draw({ asksText: lines(W("a-1")), showRun: false }); const watch = globalThis.__every[500];
  watch({ notify: () => n++ }); assert.equal(n, 0);
  globalThis.__shared["agents-view.pane"] = true; watch({ notify: () => n++ }); assert.equal(n, 1); watch({ notify: () => n++ }); assert.equal(n, 1);
});
test("no mirror loop anywhere in the Inbox code", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["./main.js", "./lib.js"]) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), "utf8"), /hc read|mirror/i);
});

test("tab: the open ask sits in its own scroll box, before the message box and the lanes, so a long ask never moves them", () => {
  tabEnv(); const v = draw({ asksText: lines(W("a-2", { body: `Q\n\n${"a long line of context ".repeat(80)}` })), showRun: false }); const d = select(v, keyOf(v, "batch"));
  order(d, "ask-scroll", "To: lead-r-1 · the epic's lead");
});
