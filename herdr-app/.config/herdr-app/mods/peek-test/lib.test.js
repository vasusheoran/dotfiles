import { test } from "node:test";
import assert from "node:assert/strict";
import { deskOf } from "./lib.js";

test("deskOf: the live desk, by label in either shape", () => {
  const ts = [{ address: "t1", state: "live", labels: ["role=worker"] }, { address: "t2", state: "live", labels: ["role=desk"] }];
  assert.equal(deskOf(ts).address, "t2");
  assert.equal(deskOf([{ address: "t1", state: "live", labels: { role: "worker" } }, { address: "t3", labels: { role: "desk" } }]).address, "t3");
});
test("deskOf: no desk falls back to the first live terminal; a dead desk does not count; nothing gives null", () => {
  assert.equal(deskOf([{ address: "t1", state: "live", labels: [] }, { address: "t2", state: "exited", labels: ["role=desk"] }]).address, "t1");
  assert.equal(deskOf([]), null); assert.equal(deskOf(null), null);
});
