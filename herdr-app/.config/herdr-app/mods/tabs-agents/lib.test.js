import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceToggle, inboxFinish, PANE_ON } from "./lib.js";

const work = { id: "s1", name: "Work", active: true, tabs: [{ id: "t1" }] };
const inbox = (active = false) => ({ id: "s2", name: "Inbox", active, tabs: [{ id: "t2" }] });
const pane = { pane: "p2", tab: "t2", mod: "agents-view" };
const MOD = ["tab.new", { space: "s2", name: "Inbox", mod: "agents-view", props: { inbox: true } }];

test("first time: a space named Inbox is made, and the owner's space is remembered", () => {
  const r = spaceToggle({ spaces: [work], panes: [], back: null });
  assert.deepEqual(r.steps, [["space.new", { name: "Inbox" }]]); assert.equal(r.back, "s1"); assert.equal(r.finish, true);
});
test("the new space's first terminal tab is replaced by the Inbox mod tab", () => {
  assert.deepEqual(inboxFinish({ spaces: [work, inbox(true)], panes: [] }), [MOD, ["tab.close", { id: "t2" }]]);
  assert.deepEqual(inboxFinish({ spaces: [work], panes: [] }), null, "the space is not there yet: wait");
  assert.deepEqual(inboxFinish({ spaces: [work, inbox(true)], panes: [pane] }), [], "the Inbox tab is there: nothing to do");
});
test("after that: the Inbox space is selected and its pane focused", () => {
  const r = spaceToggle({ spaces: [work, inbox()], panes: [pane], back: null });
  assert.deepEqual(r.steps, [["space.select", { id: "s2" }], ["pane.focus", { pane: "p2" }]]); assert.equal(r.back, "s1"); assert.equal(r.finish, false);
});
test("a space without the Inbox tab (closed by hand) gets it again", () => {
  const r = spaceToggle({ spaces: [work, inbox()], panes: [], back: null });
  assert.deepEqual(r.steps, [["space.select", { id: "s2" }]]); assert.equal(r.finish, true);
});
test("pressed again on the Inbox space: back to the space it came from", () => {
  assert.deepEqual(spaceToggle({ spaces: [work, inbox(true)].map((s) => ({ ...s, active: s.id === "s2" })), panes: [pane], back: "s1" }), { steps: [["space.select", { id: "s1" }]], back: null, finish: false });
});
test("back to a space that is closed, or none remembered: the first other space", () => {
  const sp = [{ ...work, active: false }, inbox(true)];
  assert.deepEqual(spaceToggle({ spaces: sp, panes: [pane], back: "gone" }).steps, [["space.select", { id: "s1" }]]);
  assert.deepEqual(spaceToggle({ spaces: sp, panes: [pane], back: null }).steps, [["space.select", { id: "s1" }]]);
});
test("the flag both panes agree on is named once", () => { assert.equal(PANE_ON, "agents-view.pane"); });

// ---- the toggle says Inbox and shows how many asks wait (owner round 2)
import { readFileSync } from "node:fs";
import { toggleLabel, waitingCount } from "./lib.js";
const NOWMS = Date.parse("2030-01-10T12:00:00Z"), ago = (m) => new Date(NOWMS - m * 60_000).toISOString();
const askLine = (id, o = {}) => ({ ts: ago(60), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: `o/r#${id.replace(/\D/g, "")}`, kind: "decide", question: "Q", body: "Q\n\n1. Q\n   a) A => a\n", options: [{ q: 1, key: "a", label: "A" }], ...o });
const file = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n");
test("the toggle's label: Inbox with nothing waiting, Inbox N with some, and one fewer once one is answered; a reply counts again", () => {
  const label = (text) => toggleLabel(waitingCount(text, null, NOWMS));
  assert.equal(label(null), "Inbox"); assert.equal(label(""), "Inbox");
  assert.equal(label(file(askLine("a-1"), askLine("a-2"), askLine("a-3"))), "Inbox 3");
  const ans = { ts: ago(5), event: "answered", id: "a-2", card: "o/r#2", text: "1a: A", by: "owner", via: "screen" };
  assert.equal(label(file(askLine("a-1"), askLine("a-2"), askLine("a-3"), ans)), "Inbox 2");
  assert.equal(label(file(askLine("a-1"), askLine("a-2"), askLine("a-3"), ans, { ts: ago(1), event: "message", mid: "m1", thread: "a-2", from: "agent", text: "no" })), "Inbox 3");
  assert.equal(label(file(askLine("a-1"), { ...ans, id: "a-1", card: "o/r#1" })), "Inbox");
});
test("the button says Inbox, never Agents, and draws the label with the count", () => {
  const src = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /child\("Agents"\)/); assert.match(src, /toggleLabel\(this\.waiting\)/);
  assert.doesNotMatch(readFileSync(new URL("../agents-view/mod.json", import.meta.url), "utf8"), /Agents/);
});
test("inbox-lib.js is a verbatim copy of the Inbox's lib.js, so the button counts with the same fold (cp ../agents-view/lib.js inbox-lib.js)", () => {
  assert.equal(readFileSync(new URL("./inbox-lib.js", import.meta.url), "utf8"), readFileSync(new URL("../agents-view/lib.js", import.meta.url), "utf8"));
});
