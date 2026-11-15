// Runs AgentsView.render under node with the host modules stubbed, for the four states of the panel (a crash on reload came from a row
// that flatRows had left out). AV_MAIN names the file under test (default ./main.js). All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const stub = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const chain = `const chain = () => new Proxy(function () {}, { get: (_t, k) => k === "when" ? (c, f) => (c ? f(chain()) : chain()) : k === Symbol.toPrimitive ? () => "" : chain(), apply: () => chain() });`;
const mods = {
  "gpui-kit": `${chain} export class View {} export const div = () => chain();`,
  "gpui-base": `${chain} export const v_flex = () => chain(); export const h_flex = () => chain();`,
  herdr: `const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
    export const exec = async () => ({ stdout: "" }), run = () => {}, props = () => ({}), panes = () => [], focused = () => null, readTextFile = () => new Promise(() => {}), home = () => "/h", closeOverlay = () => {};
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
const term = (o) => ({ address: "t1", name: "card-r-3", live: true, labels: { card: "o/r#3", role: "worker" }, state: "working", kind: null, msg: null, statusMs: null, where: null, ...o });
const terms = [term({}), term({ address: "t2", name: "lead-r-1", labels: { role: "lead", epic: "o/r#1" } }), term({ address: "t3", name: "desk", labels: { role: "desk" } })];

const draw = ({ asksText, showRun, terminals = terms }) => {
  globalThis.__terms = terminals;
  const v = new AgentsView();
  v.init({}, { focus_handle: () => ({ focus() {} }), timer: { every() {} }, notify() {} });
  v.files = { asks: asksText, events: "", usage: null, upNext: null, settings: null, closed: null, stuck: terminals.length ? stuck : null };
  v.showRun = showRun;
  assert.doesNotThrow(() => v.render({ notify() {} }));
  return v;
};

test("render: asks waiting with the lists hidden", () => draw({ asksText: asks, showRun: false }));
test("render: asks waiting with the lists shown", () => draw({ asksText: asks, showRun: true }));
test("render: no asks", () => draw({ asksText: "", showRun: false }));
test("render: empty, nothing running and no asks", () => draw({ asksText: null, showRun: false, terminals: [] }));

// ---- the inbox states (kuchbhi#1115-1119): every state renders, and renders with each of its rows selected
const ASK = (id, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "Q\n\n1. Q\n   a) A => a\n   b) B => b\n",
  today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1", options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const lines = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
const eachRow = (v, tag) => { for (const r of v.model().rows) { v.sel = r.key; v.touched = true; assert.doesNotThrow(() => v.render({ notify() {} }), `${tag} ${r.key}`); } };
const drawEach = (opts) => { const v = draw(opts); eachRow(v, "row"); return v; };
const lanes = [
  ASK("a-1", { kind: "merge", batch_key: "merge:o/r#1", title: "Land the fix", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land", then: "m" }, { q: 1, key: "b", label: "Hold", then: "h" }] }),
  ASK("a-2", { kind: "look", batch_key: "look:o/r#1" }),
  ASK("a-3", { kind: "you", batch_key: "hands:o/r#1" }),
  ASK("a-4", { kind: "groom", batch_key: "groom:o/r#1", card: "o/r#1" }), { ts: iso(20), event: "groomed", id: "a-4", member: "o/r#21", ready: false, choices: ["Which store?", "Keep the API?"] },
];

for (const [name, showRun] of [["lists hidden", false], ["lists shown", true]]) test(`render: each of the four lanes, ${name}`, () => { const v = drawEach({ asksText: lines(...lanes), showRun }); assert.deepEqual(v.model().vm.lanes.map((l) => l.lane), ["key", "look", "hands", "groom"]); assert.equal(v.model().vm.batches.length, 4); });

test("render: a batch of two landing asks with a step done (the stepper)", () => {
  const t = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  const v = drawEach({ asksText: lines(ASK("m-1", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(1), after_landing: ["run install.sh"] }), ASK("m-2", { kind: "merge", batch_key: "merge:o/r#1", batch: "m-1", target: t(2) }), { ts: iso(5), event: "landed", id: "m-1" }), showRun: true });
  assert.deepEqual(v.model().vm.batches[0].asks[0].targets.map((x) => x.landed), [true, false]);
});

test("render: a long thread, the narrow width, a groom batch", () => {
  const thread = Array.from({ length: 60 }, (_, i) => ({ ts: iso(60 - i), event: "message", mid: `m-${i}`, thread: "a-2", id: "a-2", from: i % 2 ? "agent" : "owner", to: i % 2 ? "owner" : "lead-r-1", text: `line ${i} ${"word ".repeat(i % 7 * 10)}` }));
  drawEach({ asksText: lines(...lanes, ...thread, { ts: iso(1), event: "message_delivered", mid: "m-0", thread: "a-2", id: "a-2", terminal: "lead-r-1" }), showRun: false });
  const v = draw({ asksText: lines(...lanes, ...thread), showRun: false }); v.width = 300; v.back = 40; eachRow(v, "narrow");
  drawEach({ asksText: lines(lanes[3], lanes[4], { ts: iso(10), event: "groomed", id: "a-4", member: "o/r#22", ready: false, choices: [] }), showRun: false });
});

test("render: a desk thread, picture coming, open picture", () => {
  const msg = { ts: iso(3), event: "message", mid: "d-1", thread: "desk", from: "agent", to: "owner", text: "grooming now" };
  drawEach({ asksText: lines(ASK("a-1"), ASK("a-2", { batch_key: "decide:o/r#2", epic: "o/r#2" }), msg, { ts: iso(9), event: "visual_requested", id: "a-1" }, { ts: iso(8), event: "visual_requested", id: "a-2" }, { ts: iso(7), event: "visual_ready", id: "a-2", url: "http://127.0.0.1:7777/p/x" }), showRun: false });
});

test("render: an answered ask shows sent, received, done and not picked up", () => {
  const ans = (id, ago) => ({ ts: iso(ago), event: "answered", id, card: `o/r#${id.replace(/\D/g, "")}`, text: "Redis", key: "other", by: "owner", via: "screen" });
  const v = drawEach({ asksText: lines(ASK("a-1"), ASK("a-5", { card: "o/r#5" }), ans("a-5", 40), ASK("a-6", { card: "o/r#6" }), ans("a-6", 2), { ts: iso(1), event: "delivered", id: "a-6", terminal: "lead-r-1" },
    { ts: iso(1), event: "message", mid: "r-1", thread: "a-6", id: "a-6", from: "agent", to: "owner", text: "applied, thanks" }), showRun: true });
  assert.equal(v.model().vm.answered.length, 2);
  assert.deepEqual(v.model().vm.answered.map((a) => [a.id, a.sent, a.received, a.done, a.notPickedUp]), [["a-5", true, false, false, true], ["a-6", true, true, false, false]]);
});

// AV_ASKS=<asks.jsonl> node --test render.test.js: renders a real run file, every row selected, narrow and wide
test("render: the run file named by AV_ASKS", { skip: !process.env.AV_ASKS }, async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(process.env.AV_ASKS, "utf8");
  for (const width of [null, 300]) for (const showRun of [false, true]) { const v = draw({ asksText: text, showRun }); v.width = width; eachRow(v, `file ${width} ${showRun}`); }
});
