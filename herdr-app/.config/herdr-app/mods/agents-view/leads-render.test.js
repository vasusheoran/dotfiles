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
    export const shared = (k) => (globalThis.__shared ??= {})[k], setShared = (k, v) => { (globalThis.__shared ??= {})[k] = v; }, exec = async (c, a) => (globalThis.__exec ? globalThis.__exec(c, a) : { code: 0, stdout: "", stderr: "" }), run = (...a) => { (globalThis.__runs ??= []).push(a); }, props = () => globalThis.__props ?? {}, panes = () => globalThis.__panes ?? [], focused = () => globalThis.__focused ?? null, spaces = () => globalThis.__spaces ?? [], agents = () => [], readTextFile = () => new Promise(() => {}), home = () => "/h", closeOverlay = () => {}, openOverlay = (o) => { (globalThis.__overlays ??= []).push(o); return "ov1"; };
    export const terminals = () => globalThis.__terms ?? [], theme = () => new Proxy({}, { get: () => "#000" });`,
};
const hooks = `export const resolve = (s, c, next) => ({ ${Object.keys(mods).map((k) => `"${k}": 1`).join(", ")} })[s] ? { url: "stub:" + s, shortCircuit: true } : next(s, c);
  const src = ${JSON.stringify(Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, v])))};
  export const load = (u, c, next) => u.startsWith("stub:") ? { format: "module", source: src[u.slice(5)], shortCircuit: true } : next(u, c);`;
register(stub(hooks));

const { default: AgentsView } = await import(process.env.AV_MAIN ?? "./main.js");
const iso = (min) => new Date(Date.now() - min * 60_000).toISOString();
const lead = (n, o = {}) => ({ address: `t${n}`, name: `lead-r-${n}`, state: "live", status: { state: "working" }, status_ms: Date.now() - 5 * 60_000, labels: ["role=lead", `epic=o/r#${n}`, `herdr.tab=tb${n}`, `herdr.space=${n === 4 ? "spB" : "spA"}`], title: `✳ title ${n}`, ...o });
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
  globalThis.__focus = 0; v.init({}, { focus_handle: () => ({ focus() { globalThis.__focus++; }, is_focused: () => !!globalThis.__isFocused }), timer: { every() {} }, spawn() {}, notify() {} });
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
test("↓ moves the selection and the main area follows with tab.select, never agent.focus (it takes the keyboard from the list)", () => {
  const v = draw(TERMS, { spaces: [{ id: "spA", active: true, tabs: [] }, { id: "spB", active: false, tabs: [] }] }); press(v, "down");
  assert.deepEqual(runs(), [["tab.select", { id: "tb2" }]], "same space: only the tab");
  press(v, "up"); assert.deepEqual(runs().at(-1), ["tab.select", { id: "tb1" }]);
  assert.equal(runs().some((r) => r[0] === "agent.focus" || r[0] === "pane.focus"), false);
});
test("a lead in another space: space.select first, then its tab; a second selection still works", () => {
  const v = draw(TERMS, { spaces: [{ id: "spA", active: true, tabs: [] }, { id: "spB", active: false, tabs: [] }] }); press(v, "space"); press(v, "down"); press(v, "down"); press(v, "down");
  assert.deepEqual(runs().slice(-4), [["tab.select", { id: "tb2" }], ["tab.select", { id: "tb3" }], ["space.select", { id: "spB" }], ["tab.select", { id: "tb4" }]]);
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
test("tab.select hands the keyboard to the lead's pane, so the list takes it back after each selection; ↵ is what leaves it in the tab", () => {
  const v = draw(); const base = globalThis.__focus; timers.length = 0;
  press(v, "down"); assert.equal(globalThis.__focus, base, "not before tab.select has run");
  while (timers.length) timers.shift()(tcx);
  assert.equal(globalThis.__focus, base + 1, "the list focuses itself again once the tab switch has landed");
  press(v, "enter"); while (timers.length) timers.shift()(tcx);
  assert.equal(globalThis.__focus, base + 1, "↵ leaves the keyboard in the tab");
  assert.deepEqual(runs().at(-1), ["pane.focus", { pane: "p2" }]);
});

// ---- cmd-shift-a: tabs-agents asks the list to take the keyboard through a shared flag, and reads back whether it holds it
test("the list keeps asking for the keyboard until it has it (it may not be on screen yet), then clears the request; an old request is dropped", () => {
  const v = draw(); const base = globalThis.__focus;
  v.watchFocus(); assert.equal(globalThis.__focus, base, "no request, no focus");
  globalThis.__shared = { ...globalThis.__shared, "agents-view.focus": Date.now() }; globalThis.__isFocused = false;
  v.watchFocus(); v.watchFocus(); assert.equal(globalThis.__focus, base + 2, "still not focused (the panel was hidden a moment ago): it asks again");
  assert.ok(globalThis.__shared["agents-view.focus"], "the request stays");
  globalThis.__isFocused = true; v.watchFocus(); assert.equal(globalThis.__shared["agents-view.focus"], null, "focused: the request is done");
  globalThis.__isFocused = false; globalThis.__shared["agents-view.focus"] = Date.now() - 5000; const n = globalThis.__focus; v.watchFocus();
  assert.equal(globalThis.__focus, n, "a request older than 2s is dropped without focusing"); assert.equal(globalThis.__shared["agents-view.focus"], null);
});
test("the list publishes whether it holds the keyboard, for the toggle to read", () => {
  const v = draw(); globalThis.__isFocused = true; v.watchFocus(); assert.equal(globalThis.__shared["agents-view.focused"], true);
  globalThis.__isFocused = false; v.watchFocus(); assert.equal(globalThis.__shared["agents-view.focused"], false);
});
test("the hint line says cmd-shift-a comes back here", () => {
  has(draw().drawn, /cmd-shift-a back here/);
});

// kuchbhi#1360: the same mod as the tab-bar count ({ badge: true }) and as the asks popup ({ asks: true })
const { viewModel, inboxItems } = await import("./lib.js");
const askLine = JSON.stringify({ ts: iso(30), event: "ask", id: "a-9", card: "o/r#9", epic: "o/r#2", kind: "merge", from: "lead", title: "Land PR 97", question: "1. Land?", options: [{ q: 1, key: "a", label: "Merges now (Recommended)" }, { q: 1, key: "b", label: "Hold" }] });
const drawAs = (p, asksText) => {
  globalThis.__props = p; globalThis.__terms = []; globalThis.__shared = {};
  const v = new AgentsView();
  globalThis.__focus = 0; v.init({}, { focus_handle: () => ({ focus() { globalThis.__focus++; }, is_focused: () => false }), timer: { every() {} }, spawn() {}, notify() {} });
  v.asks = viewModel({ terminals: [], asksText, nowMs: Date.now() }).asks; v.files.asks = asksText;
  v.drawn = paint(v); globalThis.__props = undefined; return v;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
test("badge: the tab bar shows the open-ask count and nothing when none is open; it never takes the keyboard or the cmd-shift-a flag", () => {
  const v = drawAs({ badge: true }, askLine);
  has(v.drawn, "1 ask for you"); lacks(v.drawn, "Leads");
  assert.equal(globalThis.__focus, 0); assert.equal(globalThis.__shared["agents-view.focused"], undefined);
  lacks(drawAs({ badge: true }, "").drawn, /ask.* for you/);
});
test("popup: each open ask with its options; a click answers through work ask answer with the key and drops the ask; a refused answer brings it back", async () => {
  const calls = []; globalThis.__exec = async (c, a) => { calls.push([c, a]); return { code: 0, stdout: "", stderr: "" }; };
  const v = drawAs({ asks: true }, askLine), [item] = inboxItems(v.asks);
  has(v.drawn, "Land PR 97"); has(v.drawn, "a) Merges now (Recommended)"); has(v.drawn, "b) Hold");
  v.answer(item, item.buttons[0], tcx); await tick();
  assert.deepEqual(calls, [], "a merge ask: the first click only arms");
  has(paint(v), "Confirm: a) Merges now (Recommended)");
  v.answer(item, item.buttons[0], tcx); await tick();
  assert.deepEqual(calls, [["work", ["ask", "answer", "a-9", "--text", "1a: Merges now (Recommended)", "--via", "screen", "--key", "a"]]]);
  has(paint(v), "Nothing waiting on you");
  globalThis.__exec = async () => ({ code: 1, stdout: "", stderr: "ask.sh: a-9 is closed" });
  const w = drawAs({ asks: true }, askLine); w.answer(item, item.buttons[0], tcx); w.answer(item, item.buttons[0], tcx); await tick();
  const d = paint(w); has(d, "Land PR 97"); has(d, "not sent: ask.sh: a-9 is closed");
  globalThis.__exec = undefined;
});
test("popup: the title opens the lead's tab for the ask, in its space, and closes the popup; before the first read it says Reading", () => {
  const v = drawAs({ asks: true }, askLine), [item] = inboxItems(v.asks);
  globalThis.__terms = [{ address: "t18w", state: "live", labels: ["role=lead", "epics=o/r#2", "herdr.tab=tbL", "herdr.space=spL"] }, { address: "w1", state: "live", labels: ["role=worker", "epic=o/r#2", "herdr.tab=tbW"] }];
  globalThis.__runs = []; globalThis.__spaces = [{ id: "spA", active: true }];
  v.openLead(item);
  assert.deepEqual(globalThis.__runs, [["space.select", { id: "spL" }], ["tab.select", { id: "tbL" }]]);
  const w = drawAs({ asks: true }, askLine); w.files.asks = null; has(paint(w), "Reading…");
});
test("popup: 'already answered' from work is never shown as sent; the ask stays and the flash says so", async () => {
  globalThis.__exec = async () => ({ code: 0, stdout: "already answered\n", stderr: "" });
  const dec = JSON.stringify({ ts: iso(30), event: "ask", id: "a-10", card: "o/r#10", epic: "o/r#2", from: "lead", title: "Pick a name", question: "1. Name?", options: [{ q: 1, key: "a", label: "Alpha (Recommended)", then: "x" }] });
  const v = drawAs({ asks: true }, dec), [item] = inboxItems(v.asks);
  v.answer(item, item.buttons[0], tcx); await tick();
  const d = paint(v); has(d, "Pick a name"); has(d, "already answered: open the lead's tab"); lacks(d, /^sent:/);
  globalThis.__exec = undefined;
});
test("popup: a reopened ask shows the agent's reply and an Open the lead's tab button", () => {
  const rows = [JSON.parse(askLine), { ts: iso(10), event: "answered", id: "a-9", key: "a", text: "1a", by: "owner", via: "screen" }, { ts: iso(5), event: "message", thread: "a-9", mid: "m1", from: "agent", text: "PR moved, still land it?" }].map((r) => JSON.stringify(r)).join("\n");
  const d = drawAs({ asks: true }, rows).drawn;
  has(d, "Reply: PR moved, still land it?"); has(d, "Open the lead's tab"); lacks(d, "a) Merges now (Recommended)");
});
