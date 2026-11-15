import { test } from "node:test";
import assert from "node:assert/strict";
import { agentsToggle } from "./lib.js";

const mod = { pane: "p1", tab: "tab-i", mod: "agents-view" };
const NEW = ["tab.new", { name: "Inbox", mod: "agents-view", props: { inbox: true } }];

test("agents toggle: no Inbox tab yet: opens it, and remembers the tab it left", () => {
  assert.deepEqual(agentsToggle({ panes: [{ pane: "p9", tab: "tab-a", terminal: "t1" }], focused: { tab: "tab-a" }, back: null }), { steps: [NEW], back: "tab-a" });
});
test("agents toggle: an Inbox tab that is open elsewhere is selected, not opened twice", () => {
  assert.deepEqual(agentsToggle({ panes: [mod], focused: { tab: "tab-a" }, back: null }), { steps: [["tab.select", { id: "tab-i" }]], back: "tab-a" });
});
test("agents toggle: pressed on the Inbox tab, it goes back to the tab it came from", () => {
  const panes = [mod, { pane: "p9", tab: "tab-a", terminal: "t1" }];
  assert.deepEqual(agentsToggle({ panes, focused: { tab: "tab-i" }, back: "tab-a" }), { steps: [["tab.select", { id: "tab-a" }]], back: null });
});
test("agents toggle: pressed on the Inbox tab with no tab to go back to (or one that is closed), it goes to the previous tab", () => {
  assert.deepEqual(agentsToggle({ panes: [mod], focused: { tab: "tab-i" }, back: null }), { steps: [["tab.prev"]], back: null });
  assert.deepEqual(agentsToggle({ panes: [mod], focused: { tab: "tab-i" }, back: "tab-gone" }), { steps: [["tab.prev"]], back: null });
});
test("agents toggle: with no focused tab it still opens the Inbox", () => {
  assert.deepEqual(agentsToggle({ panes: [], focused: null, back: null }), { steps: [NEW], back: null });
});
