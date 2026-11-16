// cmd-shift-a (tabs-agents.toggle): hidden → show it and focus the list; showing but not focused → focus the list; focused → hide it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleStep, LIST_FOCUS, LIST_HAS_FOCUS } from "./lib.js";

test("the list is hidden (or another panel shows): show it and ask it to take the keyboard", () => {
  assert.deepEqual(toggleStep({ shown: false, focused: false }), { show: true, hide: false, focus: true });
  assert.deepEqual(toggleStep({ shown: false, focused: true }), { show: true, hide: false, focus: true }, "a stale focus flag does not count while it is hidden");
});
test("the list is showing but the keyboard is elsewhere (a lead's terminal): focus the list, keep it showing", () => {
  assert.deepEqual(toggleStep({ shown: true, focused: false }), { show: false, hide: false, focus: true });
});
test("the list holds the keyboard: hide it", () => {
  assert.deepEqual(toggleStep({ shown: true, focused: true }), { show: false, hide: true, focus: false });
});
test("the two shared flags are named for the list's mod", () => {
  assert.equal(LIST_FOCUS, "agents-view.focus"); assert.equal(LIST_HAS_FOCUS, "agents-view.focused");
});
