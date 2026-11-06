// Pure UI state: filtering, selection, stale results, live detection, what Enter does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleRows, moveSel, createSearch, shortPath, age, liveSessions, actionFor } from "../lib.js";

const rows = [
  { id: "1", title: "Fix login bug", cwd: "/Users/v/work/app", mtime: 300 },
  { id: "2", title: "Write docs", cwd: "/Users/v/work/site", mtime: 200 },
  { id: "3", title: "Misc", cwd: "/Users/v/Notes", mtime: 100 },
];

test("empty query shows every session in order", () => assert.deepEqual(visibleRows(rows, "", []).map((r) => r.id), ["1", "2", "3"]));
test("query matches title, case-insensitively", () => assert.deepEqual(visibleRows(rows, "LOGIN", []).map((r) => r.id), ["1"]));
test("query matches folder", () => assert.deepEqual(visibleRows(rows, "site", []).map((r) => r.id), ["2"]));
test("content hits are added, newest first, without duplicating title hits", () => {
  const hits = [{ id: "3", title: "Misc", cwd: "/Users/v/Notes", mtime: 100 }, { id: "1", title: "Fix login bug", cwd: "/Users/v/work/app", mtime: 300 }, { id: "9", title: "Other", cwd: "/x", mtime: 150 }];
  assert.deepEqual(visibleRows(rows, "login", hits).map((r) => r.id), ["1", "9", "3"]);
});
test("a query that matches nothing shows nothing", () => assert.deepEqual(visibleRows(rows, "zzz", []), []));

test("moveSel clamps at the ends", () => {
  assert.equal(moveSel(0, 3, -1), 0);
  assert.equal(moveSel(2, 3, 1), 2);
  assert.equal(moveSel(1, 3, 1), 2);
  assert.equal(moveSel(0, 0, 1), 0);
});

test("a newer query supersedes an older one's results", () => {
  const s = createSearch();
  const a = s.begin("lo");
  const b = s.begin("log");
  assert.equal(s.accept(a, [{ id: "old" }]), false);
  assert.deepEqual(s.hits(), []);
  assert.equal(s.accept(b, [{ id: "new" }]), true);
  assert.deepEqual(s.hits().map((r) => r.id), ["new"]);
});
test("a superseded query is no longer current, so it needn't search", () => {
  const s = createSearch();
  const a = s.begin("lo");
  assert.equal(s.current(a), true);
  s.begin("log");
  assert.equal(s.current(a), false);
});
test("clearing the query drops hits and invalidates what's in flight", () => {
  const s = createSearch();
  const a = s.begin("x");
  s.accept(a, [{ id: "h" }]);
  const late = s.begin("xy");
  s.begin("");
  assert.equal(s.accept(late, [{ id: "late" }]), false);
  assert.deepEqual(s.hits(), []);
});

test("shortPath uses ~ for home", () => {
  assert.equal(shortPath("/Users/v/work", "/Users/v"), "~/work");
  assert.equal(shortPath("/Users/v", "/Users/v"), "~");
  assert.equal(shortPath("/Users/vx/work", "/Users/v"), "/Users/vx/work");
});
test("age is compact", () => {
  const now = 1_000_000_000;
  assert.equal(age(now - 20_000, now), "now");
  assert.equal(age(now - 5 * 60_000, now), "5m");
  assert.equal(age(now - 3 * 3_600_000, now), "3h");
  assert.equal(age(now - 2 * 86_400_000, now), "2d");
  assert.equal(age(now - 20 * 86_400_000, now), "2w");
});

test("live sessions come from the claude.session label", () => {
  const live = liveSessions([{ address: "t5", state: "live", labels: { "claude.session": "abc" } }, { address: "t6", state: "exited", labels: { "claude.session": "dead" } }]);
  assert.equal(live.get("abc"), "t5");
  assert.equal(live.has("dead"), false);
});
test("live sessions also come from claude --resume <id> argv", () => {
  const live = liveSessions([{ address: "t7", state: "live", argv: ["claude", "--resume", "xyz"] }]);
  assert.equal(live.get("xyz"), "t7");
});

const row = { id: "abc", title: "A very long title that should be shortened for the tab name", cwd: "/w/app" };
test("Enter on a live session focuses its terminal", () =>
  assert.deepEqual(actionFor(row, new Map([["abc", "t5"]]), "sp1"), { name: "agent.focus", args: { terminal: "t5" } }));
test("Enter on a dead session resumes it in a new tab of the local focused space", () => {
  const a = actionFor(row, new Map(), "sp1");
  assert.equal(a.name, "tab.new");
  assert.equal(a.args.space, "sp1");
  assert.equal(a.args.folder, "/w/app");
  assert.deepEqual(a.args.argv, ["claude", "--resume", "abc"]);
  assert.ok(a.args.name.length <= 30 && a.args.name.startsWith("A very long"));
});
test("with no local focused space it starts a new space instead", () => {
  const a = actionFor(row, new Map(), null);
  assert.equal(a.name, "space.new");
  assert.equal("space" in a.args, false);
  assert.deepEqual(a.args.argv, ["claude", "--resume", "abc"]);
});
