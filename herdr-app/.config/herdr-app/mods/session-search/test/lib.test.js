// Pure UI state: filtering, selection, stale results, live detection, what Enter does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleRows, moveSel, createSearch, shortPath, age, liveSessions, actionFor, keyDir, hoverSel, debounceFor, segments, createPreviews, previewState, wordLines } from "../lib.js";

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

test("Up/Down and ctrl-p/ctrl-n move the selection, like Telescope", () => {
  assert.equal(keyDir("down"), 1);
  assert.equal(keyDir("ctrl-n"), 1);
  assert.equal(keyDir("up"), -1);
  assert.equal(keyDir("ctrl-p"), -1);
  assert.equal(keyDir("a"), 0);
  assert.equal(keyDir("ctrl-a"), 0);
});
test("hovering a row selects it; a stray index leaves the selection alone", () => {
  assert.equal(hoverSel(0, 2, 5), 2);
  assert.equal(hoverSel(3, 9, 5), 3);
  assert.equal(hoverSel(3, -1, 5), 3);
});

test("typing is debounced ~200 ms before rg runs; a blank query never searches", () => {
  assert.equal(debounceFor("login"), 200);
  assert.equal(debounceFor("  "), null);
  assert.equal(debounceFor(""), null);
});

test("segments split a snippet into plain and matched runs", () => {
  assert.deepEqual(segments("fix the login bug", [[8, 13]]), [{ text: "fix the ", hit: false }, { text: "login", hit: true }, { text: " bug", hit: false }]);
  assert.deepEqual(segments("login", [[0, 5]]), [{ text: "login", hit: true }]);
  assert.deepEqual(segments("abc", []), [{ text: "abc", hit: false }]);
});
test("segments tolerate unsorted, overlapping and out-of-range offsets", () => {
  assert.deepEqual(segments("abcdef", [[4, 6], [0, 2], [1, 3], [5, 99]]).filter((s) => s.hit).map((s) => s.text), ["abc", "ef"]);
  assert.equal(segments("abc", [[2, 2]]).map((s) => s.text).join(""), "abc");
});

test("preview loads lazily once per session id and is cached", () => {
  const p = createPreviews();
  assert.equal(p.need("s1"), true);
  assert.equal(p.need("s1"), false); // already in flight
  p.set("s1", { first: null, last: null });
  assert.equal(p.need("s1"), false);
  assert.deepEqual(p.get("s1"), { first: null, last: null });
  assert.equal(p.get("s2"), undefined);
});
test("a failed preview load can be retried", () => {
  const p = createPreviews();
  p.need("s1");
  p.fail("s1");
  assert.equal(p.need("s1"), true);
});

test("a row with content hits previews those hits", () => {
  const h = { role: "user", text: "x", ranges: [[0, 1]] };
  const st = previewState({ id: "a" }, [{ id: "a", hits: [h] }], createPreviews());
  assert.deepEqual(st, { kind: "hits", hits: [h] });
});
test("a title-only match previews the peek, or null while it loads", () => {
  const p = createPreviews();
  assert.deepEqual(previewState({ id: "a" }, [{ id: "b", hits: [{}] }], p), { kind: "peek", peek: null });
  assert.deepEqual(previewState({ id: "a" }, [], p), { kind: "peek", peek: null });
  p.set("a", { first: { text: "hi" }, last: null });
  assert.deepEqual(previewState({ id: "a" }, [], p), { kind: "peek", peek: { first: { text: "hi" }, last: null } });
});
test("no row selected means no preview", () => assert.equal(previewState(undefined, [], createPreviews()), null));

test("wordLines breaks a snippet into lines of word tokens, flagging matched words", () => {
  const lines = wordLines("fix login\nnow", [[4, 9]]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].map((w) => [w.text, w.hit]), [["fix ", false], ["login", true]]);
  assert.deepEqual(lines[1].map((w) => [w.text, w.hit]), [["now", false]]);
});
test("wordLines splits a match inside a word without losing characters", () => {
  const lines = wordLines("prelogin ok", [[3, 8]]);
  assert.equal(lines[0].map((w) => w.text).join(""), "prelogin ok");
  assert.deepEqual(lines[0].filter((w) => w.hit).map((w) => w.text), ["login"]);
});
test("wordLines keeps blank lines", () => assert.equal(wordLines("a\n\nb", []).length, 3));
