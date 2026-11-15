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
