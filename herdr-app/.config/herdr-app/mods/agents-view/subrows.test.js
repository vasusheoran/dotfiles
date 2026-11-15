// The epic list shows its structure (owner round 3): an epic expands into its asks, a multi-part ask into its parts. Synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewModel, flatRows, paneFor, partLabel, askState, subKey } from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z"), iso = (m) => new Date(NOW - m * 60_000).toISOString();
const ASK = (id, o = {}) => ({ ts: iso(30), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", kind: "decide", title: `Title ${id}`, question: `Q ${id}`, body: "Q\n\n1. Hero line?\n   a) A (Recommended) => a\n   b) B => b\n",
  options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const PART = (id, q, title) => ({ ts: iso(20), event: "part", id, card: "o/r#99", q, title, question: title, body: `${title}\n\n${q}. ${title}\n   a) Yes (Recommended) => x\n   b) No => y\n`, options: [{ q, key: "a", label: "Yes (Recommended)" }, { q, key: "b", label: "No" }] });
const vm = () => viewModel({ terminals: [], asksText: [ASK("a-1"), PART("a-1", 2, "Show prices?"), PART("a-1", 3, "Hindi now?"), ASK("a-2", { ts: iso(10) }), ASK("a-3", { epic: "o/r#2", card: "o/r#3" })].map((l) => JSON.stringify(l)).join("\n"), nowMs: NOW });

test("flatRows: collapsed epics are one row each; an expanded one is followed by its asks, a multi-part ask by its parts", () => {
  const m = vm(), sections = (x) => flatRows(m, x).filter((r) => r.section !== "desk" && r.section !== "summary").map((r) => r.key);
  assert.deepEqual(sections({}), ["epic:o/r#1", "epic:o/r#2"]);
  assert.deepEqual(sections({ expanded: new Set(["epic:o/r#1"]) }), ["epic:o/r#1", "sub:a-1", "sub:a-1:1", "sub:a-1:2", "sub:a-1:3", "sub:a-2", "epic:o/r#2"]);
  assert.deepEqual(sections({ expanded: new Set(["epic:o/r#2"]) }), ["epic:o/r#1", "epic:o/r#2", "sub:a-3"]);
  const r = flatRows(m, { expanded: new Set(["epic:o/r#1"]) });
  assert.equal(r.find((x) => x.key === "sub:a-1:2").section, "subpart"); assert.equal(r.find((x) => x.key === "sub:a-2").section, "sub");
});
test("subKey: an ask, or one of its parts", () => { assert.equal(subKey({ id: "a-1", options: [{ q: 1 }, { q: 2 }] }, 2), "sub:a-1:2"); assert.equal(subKey({ id: "a-2", options: [{ q: 1 }] }, 1), "sub:a-2"); });
test("paneFor: a sub-row shows exactly its ask, a part row its ask at that part", () => {
  const m = vm(), rows = flatRows(m, { expanded: new Set(["epic:o/r#1"]) }), at = (k) => rows.find((r) => r.key === k);
  const a = paneFor(at("sub:a-2"), m, {}); assert.equal(a.kind, "ask"); assert.equal(a.ask.id, "a-2"); assert.equal(a.epic.ref, "o/r#1");
  const p = paneFor(at("sub:a-1:3"), m, {}); assert.equal(p.ask.id, "a-1"); assert.equal(p.q, 3);
  assert.equal(paneFor(at("epic:o/r#1"), m, { "epic:o/r#1": 1 }).ask.id, "a-2", "the epic row still follows the place in the epic");
});
test("partLabel and askState: a part says marked or open, an ask says open, reply or how many are marked", () => {
  const a = vm().asks.find((x) => x.id === "a-1");
  assert.equal(partLabel(a, 1, {}), "1 Hero line? · open"); assert.equal(partLabel(a, 1, { 1: "1a: A" }), "1 Hero line? · marked a"); assert.equal(partLabel(a, 2, { 2: "2note: x" }), "2 Show prices? · marked note");
  assert.equal(askState(a, {}), "open"); assert.equal(askState(a, { 1: "1a: A", 3: "3b: x" }), "marked 2 of 3"); assert.equal(askState({ ...a, reply: { text: "x" } }, {}), "reply");
  assert.equal(askState(vm().asks.find((x) => x.id === "a-2"), {}), "open");
});
