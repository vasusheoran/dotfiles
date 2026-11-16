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
const THREE = () => lines(ASK("a-1", { epic: "o/r#1", body: "Q\n\n1. Hero line?\n   a) A (Recommended) => a\n   b) B => b\n" }), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?"));
test("a bundled question shows one part at a time: question n of 3, ← → move, the answer line shows the marks", () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); let d = paint(v);
  has(d, "question 1 of 3 ‹ ›"); has(d, "1 · Hero line?"); lacks(d, "2 · Show prices?"); has(d, /Your answer/); has(d, "1 – · 2 – · 3 –");
  press(v, "right"); d = paint(v); has(d, "question 2 of 3 ‹ ›"); has(d, "2 · Show prices?"); has(d, "why 2"); has(d, "→ then 2b"); lacks(d, "1 · Hero line?");
  press(v, "right"); has(paint(v), "question 3 of 3 ‹ ›"); press(v, "left"); has(paint(v), "question 2 of 3 ‹ ›");
});
test("← past the first part and → past the last step to the epic's other ask", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }), PART("a-1", 2, "Show prices?"), ASK("a-9", { epic: "o/r#1", kind: "merge", batch_key: "merge:o/r#1", target: { repo: "o/r", pr: 5, head: "a".repeat(40) }, options: [{ q: 1, key: "a", label: "Land" }] })));
  select(v, epicKey(v, 1)); press(v, "right"); press(v, "right"); has(paint(v), "ask 2 of 2 ‹ ›"); press(v, "left"); has(paint(v), "question 2 of 2 ‹ ›");
});
test("a letter marks the part and moves on; nothing is sent; the receipt counts the marks; ↵ needs every part, ctrl-↵ takes the recommended", async () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "b"); const d = paint(v);
  has(d, "question 2 of 3 ‹ ›"); has(d, "1b · 2 – · 3 –"); has(d, "marked 1 of 3 · ctrl-↵ takes the recommended for the rest"); assert.equal(calls.length, 0);
  press(v, "enter"); has(paint(v), "marked 1 of 3: mark the rest, or ctrl-↵ takes the recommended for them"); await tick(); assert.equal(calls.length, 0);
  press(v, "ctrl-enter"); await tick(); assert.equal(calls[0][calls[0].indexOf("--key") + 1], "1b,2a,3a");
});
test("every part marked: ↵ sends the marks", async () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  for (const k of ["a", "b", "a"]) press(v, k); has(paint(v), "marked 3 of 3 · ↵ sends the answer"); press(v, "enter"); await tick();
  assert.equal(calls[0][calls[0].indexOf("--key") + 1], "1a,2b,3a");
});
test("marks are kept per ask when the owner goes to another epic and back; a part added meanwhile keeps them", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }), PART("a-1", 2, "Show prices?"), ASK("a-2", { epic: "o/r#2" })));
  select(v, epicKey(v, 1)); for (const k of ["1", "b"]) press(v, k);
  select(v, epicKey(v, 2)); paint(v); select(v, epicKey(v, 1)); has(paint(v), "1b · 2 –");
  v.files.asks = lines(ASK("a-1", { epic: "o/r#1" }), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?"), ASK("a-2", { epic: "o/r#2" })); has(paint(v), "1b · 2 – · 3 –");
});
test("links in the ask: URLs, issue refs and paths are underlined links, the lead's name opens its tab", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1", today: "see https://x.test/a and o/r#12 at /Users/v/p/post.md" })));
  select(v, epicKey(v, 1)); const d = paint(v); has(d, "https://x.test/a"); has(d, "o/r#12"); has(d, "/Users/v/p/post.md"); has(d, "lead-r-1"); has(d, "agent:t2");
});
test("a list longer than the pane shows a window: the selection a third of the way down, the rest moves past it", () => {
  const n = 20, titles = Object.fromEntries(Array.from({ length: n }, (_, i) => [`o/r#${i + 1}`, `Epic number ${String(i + 1).padStart(2, "0")}`]));
  const v = drawE(lines(...Array.from({ length: n }, (_, i) => ASK(`a-${i + 1}`, { epic: `o/r#${i + 1}`, card: `o/r#${i + 100}` }))), { closed: [], titles, areas: {} }, terms);
  const names = (d) => d.filter((s) => /^Epic number/.test(s)).filter((s, i, all) => all.indexOf(s) === i), titleOf = (k) => v.model().rows.find((r) => r.key === k).row.title;
  let d = paint(v); assert.equal(d.filter((s) => /^epic:o\/r#\d+$/.test(s)).length, 7, "the window holds 9 items: a group head, 7 epics and the selected one's ask"); has(d, /▼ \d+ below/); lacks(d, /▲/);
  const keys = v.model().rows.filter((r) => r.section === "epic").map((r) => r.key);
  d = select(v, keys[12]); has(d, /▲ \d+ above/); assert.equal(d.filter((s) => /^epic:o\/r#\d+$/.test(s)).indexOf(keys[12]), 3, "the selected row stays at the anchor, a third of the way down");
  d = select(v, keys[19]); lacks(d, /▼/); has(d, titleOf(keys[19]));
});
test("the Inbox pane takes the keyboard once when its tab becomes active, never from the agent pane", () => {
  globalThis.__runs = []; globalThis.__props = { inbox: true };
  globalThis.__panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p2", tab: "tab-i", terminal: "t1" }];
  globalThis.__focused = { space: "s0", tab: "tab-other", pane: "px" };
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })));
  v.focusWatch(); assert.deepEqual(globalThis.__runs, [], "another tab is active: nothing");
  globalThis.__focused = { space: "s1", tab: "tab-i", pane: "px" }; v.focusWatch(); assert.deepEqual(globalThis.__runs, [["pane.focus", { pane: "p1" }]]);
  v.focusWatch(); assert.equal(globalThis.__runs.length, 1, "once per activation");
  globalThis.__focused = { space: "s0", tab: "tab-other", pane: "px" }; v.focusWatch(); globalThis.__focused = { space: "s1", tab: "tab-i", pane: "p2" }; v.focusWatch();
  assert.equal(globalThis.__runs.length, 1, "the owner is in the agent pane");
  globalThis.__props = {}; globalThis.__panes = []; globalThis.__focused = null;
});
const bOnly = () => lines({ ts: iso(2), event: "lead_status", epic: "o/r#2", text: "Waiting on CI" });
test("capital B goes to the board: with none open the receipt says so and nothing runs", () => {
  globalThis.__runs = []; globalThis.__panes = []; globalThis.__spaces = [];
  const v = drawE(bOnly()); select(v, epicKey(v, 2)); press(v, "B");
  has(paint(v), "no board open · ctrl-b b opens it"); assert.equal(globalThis.__runs.length, 0);
});
test("b with the board open: its space and tab are selected and the epic is handed over", () => {
  globalThis.__runs = []; globalThis.__panes = [{ pane: "pb", tab: "tb", mod: "zaksha-board" }]; globalThis.__spaces = [{ id: "sb", name: "Board", tabs: [{ id: "tb" }] }];
  const v = drawE(bOnly()); select(v, epicKey(v, 2)); press(v, "B");
  assert.deepEqual(globalThis.__runs, [["space.select", { id: "sb" }], ["tab.select", { id: "tb" }]]); assert.equal(globalThis.__shared["zaksha-board.epic"], "o/r#2");
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

test("B goes to the board even on an epic whose ask has a b option; the letter b stays an option", () => {
  globalThis.__runs = []; globalThis.__panes = [{ pane: "pb", tab: "tb", mod: "zaksha-board" }]; globalThis.__spaces = [{ id: "sb", name: "Board", tabs: [{ id: "tb" }] }];
  const v = drawE(THREE()); select(v, epicKey(v, 1)); press(v, "b"); assert.deepEqual(globalThis.__runs, [], "b marks the part"); has(paint(v), "1b · 2 – · 3 –");
  press(v, "B"); assert.deepEqual(globalThis.__runs, [["space.select", { id: "sb" }], ["tab.select", { id: "tb" }]]); has(v.drawn.length ? paint(v) : [], /B board/);
  globalThis.__panes = []; globalThis.__spaces = [];
});
test("n on a part with an option picked is a note on that pick; the submit carries one note per part", async () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "a"); press(v, "left"); press(v, "n"); typed(v, "check the ads"); press(v, "enter"); assert.equal(calls.length, 0, "a part's note is kept, not sent");
  { const d = paint(v); has(d, /Note on this part: check the ads/); has(d, "1a · 2 – · 3 –"); }
  press(v, "right"); press(v, "b"); press(v, "left"); press(v, "n"); typed(v, "later"); press(v, "enter");
  press(v, "ctrl-enter"); await tick();
  assert.equal(calls[0][calls[0].indexOf("--note") + 1], "1: check the ads · 2: later"); assert.equal(calls[0][calls[0].indexOf("--key") + 1], "1a,2b,3a");
});
test("n on a part with NO option picked is that part's own answer: marked `note`, the submit sends key other", async () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "right"); press(v, "n"); typed(v, "one strip"); press(v, "enter"); assert.equal(calls.length, 0);
  const d = paint(v); has(d, "1 – · 2 note · 3 –"); has(d, "question 3 of 3 ‹ ›");
  press(v, "ctrl-enter"); await tick();
  assert.equal(calls[0][calls[0].indexOf("--key") + 1], "other"); assert.match(calls[0][calls[0].indexOf("--text") + 1], /2 own answer: one strip/); assert.match(calls[0][calls[0].indexOf("--text") + 1], /^1a: /);
  assert.equal(calls[0].includes("--note"), false, "the part's note is its answer, not an extra note");
});
test("a letter after a note-only part turns the note into a note on that pick", async () => {
  const v = drawE(THREE()); select(v, epicKey(v, 1)); execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  press(v, "n"); typed(v, "maybe"); press(v, "enter"); has(paint(v), "1 note · 2 – · 3 –"); press(v, "left"); press(v, "b"); has(paint(v), "1b · 2 – · 3 –");
  press(v, "ctrl-enter"); await tick(); assert.equal(calls[0][calls[0].indexOf("--key") + 1], "1b,2a,3a"); assert.equal(calls[0][calls[0].indexOf("--note") + 1], "1: maybe");
});
test("a single-question ask: n with no pick sends the note as the answer (key other); there is no o key", async () => {
  execWith(() => ({ code: 0, stdout: "", stderr: "" }));
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); select(v, epicKey(v, 1));
  press(v, "o"); assert.equal(v.input, null, "o does nothing");
  press(v, "n"); typed(v, "Valkey"); press(v, "enter"); await tick();
  assert.equal(calls[0][calls[0].indexOf("--key") + 1], "other"); assert.equal(calls[0][calls[0].indexOf("--text") + 1], "Valkey");
});

test("[ and ] shrink and grow the question box and the size is remembered across reloads", () => {
  const mem = {}; globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); select(v, epicKey(v, 1)); assert.equal(v.askH, 360);
  press(v, "]"); assert.equal(v.askH, 400); assert.equal(mem["agents-view.askH"], "400"); press(v, "["); press(v, "["); assert.equal(v.askH, 320); assert.equal(mem["agents-view.askH"], "320");
  const w = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); assert.equal(w.askH, 320, "a reload reads it back");
  delete globalThis.localStorage; const x = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); press(x, "]"); assert.equal(x.askH, 400, "no storage: it still works");
});
test("dragging the divider between the question box and the list resizes the box and keeps the size", () => {
  const mem = {}; globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" }))); has(v.drawn, "ask-divider");
  v.dragStart({ position: { x: 0, y: 500 } }); v.dragMove({ position: { x: 0, y: 580 } }, tcx); assert.equal(v.askH, 440);
  v.dragMove({ position: { x: 0, y: 5000 } }, tcx); assert.equal(v.askH, 720); v.dragEnd(); v.dragMove({ position: { x: 0, y: 0 } }, tcx); assert.equal(v.askH, 720, "no drag, no change"); assert.equal(mem["agents-view.askH"], "720");
  delete globalThis.localStorage;
});

// ---- owner round 2: the receipt on its own ask, Sent, a reply, the open line
const SENT_TERM = "lead-r-1", OK = () => ({ code: 0, stdout: "", stderr: "" });
const MSGE = (id, ago, from, text) => ({ ts: iso(ago), event: "message", mid: `m${ago}${from}`, thread: id, from, text });
const ANSE = (id, ago, o = {}) => ({ ts: iso(ago), event: "answered", id, card: `o/r#${id.replace(/\D/g, "")}`, text: "1a: A (Recommended)", key: "a", by: "owner", via: "screen", ...o });
test("the receipt sits on its own ask: what, whom, when; the next ask of the epic shows none; the epic count drops", async () => {
  const v = drawE(lines(ASK("a-1", { terminal: SENT_TERM }), ASK("a-2", { terminal: SENT_TERM, ts: iso(10) })));
  select(v, epicKey(v, 1)); has(paint(v), "Title a-1"); execWith(OK); press(v, "a"); await tick();
  const d = paint(v); has(d, "Title a-2"); lacks(d, /^You sent/); has(d, "Sent · 1");
  assert.equal(v.model().vm.asks.length, 1); assert.equal(v.model().rows.find((r) => r.section === "epic" && r.row.num === 1).row.asks.length, 1);
  select(v, "sentfold"); press(v, "space"); const s = select(v, "sent:a-1");
  has(s, "You sent: 1a: A (Recommended)"); has(s, /^to lead-r-1 · o\/r#1 · \d\d:\d\d$/); has(s, "sent ✓ · received – · done –");
});
test("an ask sent leaves its epic: with nothing left it is working, no question shown, and its receipt shows on that epic only", async () => {
  const v = drawE(lines(ASK("a-1", { terminal: SENT_TERM }))); select(v, epicKey(v, 1)); execWith(OK); press(v, "a"); await tick();
  const e = v.model().rows.find((r) => r.section === "epic" && r.row.num === 1).row; assert.equal(e.asks.length, 0); assert.notEqual(e.state, "needs");
  let d = paint(v); lacks(d, "Title a-1"); has(d, "You sent: 1a: A (Recommended)"); has(d, /^to lead-r-1 · o\/r#1 · \d\d:\d\d$/);
  d = select(v, epicKey(v, 2)); lacks(d, /^You sent/);
});
test("Sent opened: each ask with its state; one not picked up shows it once and . nudges it", async () => {
  const E = { epic: "o/r#2", terminal: "lead-r-2" };
  const v = drawE(lines(ASK("a-5", E), ANSE("a-5", 40), ASK("a-6", E), ANSE("a-6", 2), { ts: iso(1), event: "delivered", id: "a-6" }, ASK("a-7", E), ANSE("a-7", 20), { ts: iso(19), event: "delivered", id: "a-7" }, { ts: iso(18), event: "applied", id: "a-7" }));
  v.sentOpen = true; let d = paint(v); has(d, "Sent · 3"); eachRow(v, "sent");
  d = select(v, "sent:a-5"); has(d, "sent ✓ · received – · done –"); assert.equal(d.filter((s) => s === "not picked up").length, 1);
  has(select(v, "sent:a-6"), "sent ✓ · received ✓ · done –"); has(select(v, "sent:a-7"), "sent ✓ · received ✓ · done ✓"); lacks(paint(v), "Answered, not applied yet");
  execWith(OK); select(v, "sent:a-5"); press(v, "."); await tick(); assert.deepEqual(calls[0].slice(-3), ["ask", "nudge", "a-5"]);
});
test("a reply from the agent brings the ask back to its epic as needing the owner, marked reply, with the reply first; sent again it leaves again", async () => {
  const v = drawE(lines(ASK("a-1", { terminal: SENT_TERM }), ANSE("a-1", 30), MSGE("a-1", 10, "agent", "can't do that because the build is red")));
  assert.equal(v.model().rows.find((r) => r.section === "epic" && r.row.num === 1).row.state, "needs"); lacks(v.drawn, "Sent · 1");
  const d = select(v, epicKey(v, 1)); has(d, "reply"); has(d, "Reply from the agent: can't do that because the build is red");
  assert.ok(d.indexOf("Reply from the agent: can't do that because the build is red") < d.indexOf("Why"), "the reply comes first");
  execWith(OK); press(v, "b"); await tick();
  assert.equal(v.model().vm.asks.length, 0); const e = v.model().rows.find((r) => r.section === "epic" && r.row.num === 1).row; assert.notEqual(e.state, "needs"); has(paint(v), "Sent · 1");
});
test("the open line: a new ask's plan and an old ask's mockup, preview and stage show first; p opens the first; a design question has none", async () => {
  const v = drawE(lines(ASK("a-1", { plan: "/Users/v/plans/1/plan.html", terminal: SENT_TERM }), ASK("a-2", { epic: "o/r#2", terminal: "lead-r-2", today: "mock /Users/v/canvas/9/m.html, preview https://x.kuchbhi.pages.dev/a, stage https://stage.kuchbhi.app/b" }),
    ASK("a-3", { epic: "o/r#3", terminal: "lead-r-3", card: "o/r#33", title: "Hero line?" })), { ...twoEpics, areas: {} });
  let d = select(v, epicKey(v, 1)); has(d, "open plan"); has(d, "/Users/v/plans/1/plan.html"); has(v.drawn, /^Needs a look/);
  d = select(v, epicKey(v, 2)); has(d, "open mockup"); has(d, "open preview"); has(d, "open stage"); assert.ok(d.indexOf("open mockup") < d.indexOf("open preview") && d.indexOf("open preview") < d.indexOf("open stage"));
  d = select(v, epicKey(v, 3)); lacks(d, /^open /);
  execWith(OK); select(v, epicKey(v, 2)); press(v, "p"); await tick(); assert.ok(calls[0].includes("/Users/v/canvas/9/m.html"), `opened ${calls[0]}`);
});

// ---- owner round 3: the list shows the structure; the highlight and the question box agree
const FAM = () => lines(ASK("a-1", { epic: "o/r#1", ts: iso(30) }), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?"), ASK("a-2", { epic: "o/r#1", card: "o/r#22", ts: iso(10) }), ASK("a-3", { epic: "o/r#2", card: "o/r#3" }));
test("collapsed is the default except for the selected epic: the others show no asks or parts", () => {
  const v = drawE(FAM()); let d = select(v, epicKey(v, 2)); lacks(d, "Title a-2"); lacks(d, "2 Show prices? · open");
  d = select(v, epicKey(v, 1)); has(d, "Title a-2"); has(d, "1 Q · open"); has(d, "2 Show prices? · open"); has(d, "3 Hindi now? · open");
  d = select(v, epicKey(v, 2)); lacks(d, "2 Show prices? · open"); has(d, "Title a-3");
});
test("← on the expanded epic collapses it, → or space expands it again, a click on the chevron toggles", () => {
  const v = drawE(FAM()); select(v, epicKey(v, 1)); has(paint(v), "2 Show prices? · open");
  press(v, "left"); lacks(paint(v), "2 Show prices? · open"); lacks(paint(v), "Title a-2");
  press(v, "right"); has(paint(v), "2 Show prices? · open"); assert.equal(v.sel, epicKey(v, 1), "expanding keeps the highlight on the epic");
  press(v, "space"); lacks(paint(v), "2 Show prices? · open"); press(v, "space"); has(paint(v), "2 Show prices? · open");
  v.toggleEpic(epicKey(v, 1), tcx); lacks(paint(v), "2 Show prices? · open"); v.toggleEpic(epicKey(v, 1), tcx); has(paint(v), "2 Show prices? · open");
});
test("↑ ↓ move the highlight through the sub-rows and the box shows exactly the highlighted one", () => {
  const v = drawE(FAM()); select(v, epicKey(v, 1)); const at = () => ({ sel: v.sel, d: paint(v) });
  press(v, "down"); assert.equal(v.sel, "sub:a-1"); has(paint(v), "Title a-1");
  press(v, "down"); assert.equal(v.sel, "sub:a-1:1"); has(paint(v), "question 1 of 3 ‹ ›");
  press(v, "down"); assert.equal(v.sel, "sub:a-1:2"); has(paint(v), "question 2 of 3 ‹ ›"); has(paint(v), "2 · Show prices?");
  press(v, "down"); press(v, "down"); assert.equal(v.sel, "sub:a-2"); has(paint(v), "Title a-2"); lacks(paint(v), /^question \d of 3/); has(paint(v), "ask 2 of 2 ‹ ›");
  press(v, "up"); assert.equal(v.sel, "sub:a-1:3"); has(paint(v), "question 3 of 3 ‹ ›");
  void at;
});
test("← → step the parts and the asks, and the highlight follows so it always matches the box", () => {
  const v = drawE(FAM()); select(v, epicKey(v, 1));
  press(v, "right"); assert.equal(v.sel, "sub:a-1:2"); has(paint(v), "question 2 of 3 ‹ ›");
  press(v, "right"); assert.equal(v.sel, "sub:a-1:3"); has(paint(v), "question 3 of 3 ‹ ›");
  press(v, "right"); assert.equal(v.sel, "sub:a-2"); has(paint(v), "ask 2 of 2 ‹ ›");
  press(v, "left"); assert.equal(v.sel, "sub:a-1:3"); has(paint(v), "question 3 of 3 ‹ ›");
  press(v, "left"); press(v, "left"); assert.equal(v.sel, "sub:a-1:1"); has(paint(v), "question 1 of 3 ‹ ›");
});
test("a mark shows on its part row and the ask row, and the highlight moves on with it", () => {
  const v = drawE(FAM()); select(v, epicKey(v, 1)); press(v, "down"); press(v, "down"); assert.equal(v.sel, "sub:a-1:1");
  press(v, "b"); assert.equal(v.sel, "sub:a-1:2"); const d = paint(v); has(d, "1 Q · marked b"); has(d, "marked 1 of 3"); has(d, "question 2 of 3 ‹ ›");
});
test("the expanded epics are remembered across reloads", () => {
  const mem = {}; globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, x) => { mem[k] = String(x); } };
  const v = drawE(FAM()); select(v, epicKey(v, 1)); press(v, "left"); assert.ok(mem["agents-view.expanded"], "saved");
  const w = drawE(FAM()); select(w, epicKey(w, 1)); lacks(paint(w), "2 Show prices? · open"); press(w, "right"); has(paint(w), "2 Show prices? · open");
  const x = drawE(FAM()); select(x, epicKey(x, 2)); has(paint(x), "Title a-3");
  delete globalThis.localStorage;
});

// ---- a lead asking only in its terminal (kuchbhi#1115, round 4)
const SCREEN = `⏺ To finish the check:\n  1. Save the token.\n  2. Say go.\n\n✻ Worked for 9s\n\n${"─".repeat(80)}\n❯ \n${"─".repeat(80)}\n  ⏵⏵ auto mode on\n`;
test("an idle lead's question shows on its epic, quoted, above its older ask; the screen is read at most every 30s per lead", async () => {
  const reads = []; globalThis.__exec = async (c, a) => { reads.push([c, ...a]); return { code: 0, stdout: SCREEN, stderr: "" }; };
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })), twoEpics, EPIC_TERMS.map((t) => (t.name === "lead-r-1" ? { ...t, status: { state: "idle" } } : t)));
  await v.readScreens(kcx); await v.readScreens(kcx);
  assert.deepEqual(reads, [["hc", "read", "t2", "--lines", "15"]], "one read of the idle lead, none of the working ones, none again inside 30s");
  const p = paint(v);
  has(p, "Lead is waiting in its terminal"); has(v.model().rows.length ? p : [], "Title a-1");
  select(v, epicKey(v, 1)); const sel = paint(v);
  has(sel, "lead-r-1 says, in its terminal"); has(sel, "  2. Say go."); has(sel, /older ask/);
  has(paint(v), "older");
});
test("a lead that is working is never read", async () => {
  const reads = []; globalThis.__exec = async (c, a) => { reads.push(a); return { code: 0, stdout: SCREEN, stderr: "" }; };
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })));
  await v.readScreens(kcx); assert.deepEqual(reads, []);
});

// ---- the view model is built once per change, not once per render: the engine interrupts a slow render (seen live against a 375KB run file)
test("the view model is rebuilt only when an input changes", () => {
  const v = drawE(lines(ASK("a-1", { epic: "o/r#1" })));
  const a = v.model().vm; assert.equal(v.model().vm, a, "same inputs, same model");
  v.files.asks = lines(ASK("a-1", { epic: "o/r#1" }), ASK("a-2", { epic: "o/r#2" })); assert.notEqual(v.model().vm, a, "a changed run file rebuilds it");
  const b = v.model().vm; v.hidden.add("a-2"); assert.notEqual(v.model().vm, b, "a hidden ask rebuilds it");
});
