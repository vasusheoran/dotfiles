// The leads side list, drawn (kuchbhi#1115, 16 Nov direction): groups, rows, selection following into the lead's tab, enter, B. All data is synthetic.
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
const lead = (n, o = {}) => ({ address: `t${n}`, name: `lead-r-${n}`, state: "live", status: { state: "working" }, status_ms: Date.now() - 5 * 60_000, labels: ["role=lead", `epic=o/r#${n}`], title: `✳ title ${n}`, ...o });
const TERMS = [lead(1, { status: { state: "blocked" } }), lead(2), lead(3, { status: { state: "idle" } }), lead(4, { status: null, agent: "zsh" })];
const closed = JSON.stringify({ at: iso(1), closed: [], titles: { "o/r#1": "Epic 1: One", "o/r#2": "Epic 2: Two", "o/r#3": "Epic 3: Three", "o/r#4": "Epic 4: Four" }, areas: {}, origin: {} });
const status = JSON.stringify({ ts: iso(2), event: "lead_status", epic: "o/r#2", text: "Reviewing the hook tests" });
const timers = [];
const tcx = { notify() {}, stop_propagation() {}, timer: { after: (_ms, f) => timers.push(f), every() {} } };
const paint = (v) => { globalThis.__drawn = []; assert.doesNotThrow(() => v.render(tcx)); return globalThis.__drawn.slice(); };
const has = (d, x) => assert.ok(d.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected ${x}; got: ${d.filter((s) => s.length > 1).join(" | ").slice(0, 500)}`);
const lacks = (d, x) => assert.ok(!d.some((s) => (x instanceof RegExp ? x.test(s) : s === x)), `expected no ${x}`);
const draw = (terminals = TERMS, o = {}) => {
  globalThis.__terms = terminals; globalThis.__runs = []; globalThis.__panes = o.panes ?? terminals.map((t, i) => ({ pane: `p${i + 1}`, tab: `tb${i + 1}`, terminal: t.address })); globalThis.__spaces = o.spaces ?? [];
  const v = new AgentsView();
  v.init({}, { focus_handle: () => ({ focus() {} }), timer: { every() {} }, spawn() {}, notify() {} });
  v.files = { asks: o.asks ?? status, events: "", usage: null, upNext: null, settings: null, closed, stuck: null };
  v.waits = o.waits ?? {}; v.lastLines = o.lastLines ?? {};
  v.drawn = paint(v); return v;
};
const press = (v, k) => v.key({ keystroke: k }, tcx);
const runs = () => globalThis.__runs;

test("draws the groups, each lead's short title, last line and meta, and the folded rest", () => {
  const v = draw(TERMS, { lastLines: { t1: "Needs a vault token" } });
  for (const x of ["Waiting on you", "Working", "Epic 1: One", "Epic 2: Two", "Reviewing the hook tests", "Needs a vault token", "lead-r-2", /2 idle or done · Epics 3, 4/]) has(v.drawn, x);
  lacks(v.drawn, "Epic 3: Three"); // folded
});
test("a lead Herdr shows as zsh with no status is still counted, by its name", () => {
  has(draw().drawn, /Epics 3, 4/);
});
test("↓ moves the selection and the main area follows: agent.focus on that lead's terminal", () => {
  const v = draw(); press(v, "down");
  assert.deepEqual(runs().at(-1), ["agent.focus", { terminal: "t2" }]);
  press(v, "up"); assert.deepEqual(runs().at(-1), ["agent.focus", { terminal: "t1" }]);
});
test("↵ moves the keyboard into the lead's tab: pane.focus on its pane", () => {
  const v = draw(); press(v, "down"); press(v, "enter");
  assert.deepEqual(runs().at(-1), ["pane.focus", { pane: "p2" }]);
});
test("B opens the board at the lead's epic; with no board open it says so", () => {
  let v = draw(); press(v, "B"); has(paint(v), "no board open · ctrl-b b opens it"); assert.equal(runs().filter((r) => r[0] === "space.select").length, 0);
  v = draw(TERMS, { panes: [{ pane: "pb", tab: "tbb", mod: "zaksha-board" }], spaces: [{ id: "spb", tabs: [{ id: "tbb" }] }] }); press(v, "B");
  assert.deepEqual(runs().slice(-2), [["space.select", { id: "spb" }], ["tab.select", { id: "tbb" }]]);
  assert.equal(globalThis.__shared["zaksha-board.epic"], "o/r#1");
});
test("the list never answers: no answer key does anything", () => {
  const v = draw(); for (const k of ["a", "b", "1", "n", "p"]) press(v, k);
  assert.deepEqual(runs(), []);
});
