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
