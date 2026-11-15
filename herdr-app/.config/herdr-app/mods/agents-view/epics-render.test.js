// The Inbox by epic, drawn (kuchbhi#1115): groups by Area, the folded finished epics, the filter, a bundled question with its answer line, b to the open board,
// the message box going to the epic's lead. The harness is render.test.js's. All data is synthetic.
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
const keyOf = (v, section, n = 0) => v.model().rows.filter((r) => r.section === section)[n].key;
const has = (drawn, x) => assert.ok(drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} to be drawn; got: ${drawn.filter((s) => s.length > 1 && !/^#|^Geist|^JetBrains/.test(s)).join(" | ").slice(0, 600)}`);
const lacks = (drawn, x) => assert.ok(!drawn.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x} not to be drawn`);

const ASK = (id, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "Q\n\n1. Q\n   a) A => a\n   b) B => b\n",
  today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1", options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const lines = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
// every row selected in turn: none may throw
const eachRow = (v, tag) => { for (const r of v.model().rows) { v.sel = r.key; v.touched = true; assert.doesNotThrow(() => v.render({ notify() {} }), `${tag} ${r.key}`); } };
// ---- every key says at once that it was taken (kuchbhi#1115): pressed, then confirmed or failed, in the open ask, with the call's exit code and stderr kept
const kcx = { notify() {}, stop_propagation() {}, timer: tcx.timer };
const calls = [];
const execWith = (fn) => { calls.length = 0; globalThis.__exec = async (c, a) => { calls.push([c, ...a]); return fn(c, a); }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const press = (v, k) => v.key({ keystroke: k }, kcx);
const typed = (v, text) => { for (const ch of text) press(v, ch); };

const closedJson = (o) => JSON.stringify({ at: iso(1), closed: [], titles: {}, areas: {}, origin: {}, ...o });
const PART = (id, q, title, o = {}) => ({ ts: iso(20), event: "part", id, card: "o/r#99", q, question: title, title, today: "t2", after: "a2", checked: "c2", why_you: `why ${q}`,
  options: [{ q, key: "a", label: `Yes ${q} (Recommended)`, then: `then ${q}a` }, { q, key: "b", label: `No ${q}`, then: `then ${q}b` }], body: `${title}\n\n${q}. ${title}\n   a) Yes ${q} (Recommended) => then ${q}a\n   b) No ${q} => then ${q}b\n`, part_body: "x", ...o });
const twoEpics = { closed: ["o/r#4"], titles: { "o/r#1": "Marketing site", "o/r#2": "Hooks and security", "o/r#4": "Finished epic" }, areas: { "o/r#1": "gtm", "o/r#2": "agents", "o/r#4": "agents" } };
const EPIC_TERMS = [...terms, term({ address: "t5", name: "lead-r-2", labels: ["role=lead", "epic=o/r#2"] }), term({ address: "t6", name: "lead-r-4", labels: ["role=lead", "epic=o/r#4"] })];
const drawE = (asksText, closed = twoEpics, terminals = EPIC_TERMS) => { const v = draw({ asksText, terminals }); v.files.closed = closedJson(closed); v.drawn = paint(v); return v; };
const epicKey = (v, n) => v.model().rows.find((r) => r.section === "epic" && r.row.num === n).key;

test("groups by the board's Area with friendly names, one row per epic with its status line", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }), { ts: iso(2), event: "lead_status", epic: "o/r#2", text: "Writing the hook tests" }));
  has(v.drawn, "Marketing"); has(v.drawn, "Agent tooling"); has(v.drawn, "Marketing site"); has(v.drawn, "Hooks and security"); has(v.drawn, "Writing the hook tests");
  lacks(v.drawn, "One key"); lacks(v.drawn, "Needs a look");
});
test("the finished epics fold into one row; space unfolds it", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })));
  has(v.drawn, "1 finished"); lacks(v.drawn, "Finished epic");
  select(v, "fold"); press(v, "space"); has(paint(v), "Finished epic");
  press(v, "space"); lacks(paint(v), "Finished epic");
});
test("f opens the filter: typing narrows by title, number or area, esc clears it", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })));
  press(v, "f"); typed(v, "hook"); const d = paint(v);
  has(d, "Hooks and security"); lacks(d, "Marketing site"); has(d, /^Filter: hook/);
  press(v, "backspace"); press(v, "backspace"); press(v, "backspace"); press(v, "backspace"); typed(v, "gtm"); has(paint(v), "Marketing site"); lacks(paint(v), "Hooks and security");
  press(v, "escape"); const e = paint(v); has(e, "Marketing site"); has(e, "Hooks and security"); assert.equal(v.filter, null);
});
test("a bundled question: each part with its title, why and options, and the answer line", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1", body: "Q\n\n1. Hero line?\n   a) A (Recommended) => a\n   b) B => b\n" }), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?")));
  select(v, epicKey(v, 1)); const d = paint(v);
  has(d, "1 · Hero line?"); has(d, "2 · Show prices?"); has(d, "3 · Hindi now?"); has(d, "why 2"); has(d, "→ then 3b");
  has(d, /Your answer/); has(d, "1a · 2a · 3a");
});
test("1 then b changes one part; Enter sends every part", async () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1", body: "Q\n\n1. Hero line?\n   a) A (Recommended) => a\n   b) B => b\n" }), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?")));
  select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "3"); press(v, "b"); has(paint(v), "1a · 2a · 3b"); assert.equal(calls.length, 0, "a pick sends nothing");
  press(v, "enter"); await tick();
  assert.deepEqual(calls[0].slice(0, 3), ["work", "ask", "answer"]); assert.equal(calls[0][calls[0].indexOf("--key") + 1], "1a,2a,3b");
});
test("b alone goes to the board: with none open the receipt says so and nothing runs", () => {
  globalThis.__runs = []; globalThis.__panes = []; globalThis.__spaces = [];
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); select(v, epicKey(v, 1)); press(v, "b");
  has(paint(v), "no board open · ctrl-b b opens it"); assert.equal(globalThis.__runs.length, 0);
});
test("b with the board open: its space and tab are selected and the epic is handed over", () => {
  globalThis.__runs = []; globalThis.__panes = [{ pane: "pb", tab: "tb", mod: "zaksha-board" }]; globalThis.__spaces = [{ id: "sb", name: "Board", tabs: [{ id: "tb" }] }];
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); select(v, epicKey(v, 1)); press(v, "b");
  assert.deepEqual(globalThis.__runs, [["space.select", { id: "sb" }], ["tab.select", { id: "tb" }]]); assert.equal(globalThis.__shared["zaksha-board.epic"], "o/r#1");
  globalThis.__panes = []; globalThis.__spaces = [];
});
test("the message box and / go to the epic's lead, never the worker whose ask it is", async () => {
  const v = drawE(lines(ASK("a-3", { epic: "o/r#1", from: "worker", terminal: "card-r-3", card: "o/r#3" })));
  select(v, epicKey(v, 1)); has(paint(v), /To: lead-r-1/); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "/"); typed(v, "hi"); press(v, "enter"); await tick();
  assert.deepEqual(calls[0].slice(0, 4), ["work", "ask", "message", "a-3"]); assert.equal(calls[0][calls[0].indexOf("--to") + 1], "lead-r-1");
});
test("an epic with no ask: its overview, and a message goes to the epic thread", async () => {
  const v = drawE(lines({ ts: iso(2), event: "lead_status", epic: "o/r#2", text: "Waiting on CI" }), twoEpics);
  select(v, epicKey(v, 2)); const d = paint(v); has(d, "Waiting on CI"); has(d, /To: lead-r-2/);
  execWith(() => ({ code: 0, stdout: "", stderr: "" })); press(v, "/"); typed(v, "go"); press(v, "enter"); await tick();
  assert.deepEqual(calls[0].slice(0, 4), ["work", "ask", "message", "epic:o/r#2"]); assert.equal(calls[0][calls[0].indexOf("--to") + 1], "lead-r-2");
});
test("every row selected in turn draws without throwing", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }), PART("a-1", 2, "Show prices?"), { ts: iso(2), event: "lead_status", epic: "o/r#2", text: "x" })); v.unfolded = true; eachRow(v, "epics");
});
