import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPrevious } from "./lib.js";

const H = [{ space: "a", tab: "1" }, { space: "b", tab: "2" }, { space: "c", tab: "3" }];

test("pickPrevious: the most recent entry that is not where you are", () => {
  assert.deepEqual(pickPrevious(H, { space: "a", tab: "1" }), { space: "b", tab: "2" });
  assert.deepEqual(pickPrevious(H, { space: "z", tab: "9" }), { space: "a", tab: "1" });
});

test("pickPrevious: another tab of the same space counts as elsewhere", () => {
  assert.deepEqual(pickPrevious(H, { space: "a", tab: "5" }), { space: "a", tab: "1" });
});

test("pickPrevious: nothing when history is empty or only here", () => {
  assert.equal(pickPrevious([], { space: "a", tab: "1" }), null);
  assert.equal(pickPrevious([{ space: "a", tab: "1" }], { space: "a", tab: "1" }), null);
  assert.equal(pickPrevious(undefined, null), null);
});
