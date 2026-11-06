// Behavior of the helper script against a synthetic ~/.claude/projects tree.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "sessions.py");
const home = mkdtempSync(join(tmpdir(), "ss-home-"));
const proj = (d) => join(home, ".claude", "projects", d);
const lines = (...o) => o.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") + "\n";
const put = (dir, id, body, ageSec = 0) => {
  mkdirSync(proj(dir), { recursive: true });
  const f = join(proj(dir), id + ".jsonl");
  writeFileSync(f, body);
  const t = Date.now() / 1000 - ageSec;
  utimesSync(f, t, t);
  return f;
};
const run = (...args) => JSON.parse(execFileSync("python3", ["-I", script, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" }));
const byId = (rows, id) => rows.find((r) => r.id === id);
const user = (text, cwd = "/w/x") => ({ type: "user", cwd, message: { role: "user", content: text } });

before(() => {
  put("a", "s-title", lines(user("first words", "/w/alpha"), { type: "ai-title", aiTitle: "Old title" }, { type: "ai-title", aiTitle: "Last title" }), 300);
  put("a", "s-custom", lines(user("hi", "/w/beta"), { type: "custom-title", customTitle: "Custom one" }), 200);
  put("a", "s-summary", lines(user("hi", "/w/gamma"), { type: "summary", summary: "A summary" }), 250);
  put("b", "s-first", lines({ type: "attachment" }, { type: "user", cwd: "/w/delta", message: { content: [{ type: "text", text: "  fix   the\n login  bug  " }] } }), 100);
  put("b", "s-none", lines({ type: "attachment", cwd: "/w/epsilon" }), 50);
  put("b", "s-bad", lines("{not json", user("needle in Haystack", "/w/zeta"), "}}", { type: "ai-title", aiTitle: "Survives junk" }), 10);
  put("c", "s-dup", lines(user("needle needle needle", "/w/eta"), user("another needle")), 20);
  put("d", "s-dup", lines(user("needle again", "/w/eta")), 5); // same id in a second project dir
  put("c", "s-regex", lines(user("abc plus a.c", "/w/theta")), 30);
});

test("title is the last ai-title", () => assert.equal(byId(run("list"), "s-title").title, "Last title"));
test("falls back to custom-title, then summary", () => {
  const rows = run("list");
  assert.equal(byId(rows, "s-custom").title, "Custom one");
  assert.equal(byId(rows, "s-summary").title, "A summary");
});
test("falls back to the first user message, whitespace collapsed", () => assert.equal(byId(run("list"), "s-first").title, "fix the login bug"));
test("a session with no title or user message still lists, with a placeholder", () => {
  const r = byId(run("list"), "s-none");
  assert.ok(r.title.length > 0);
  assert.equal(r.cwd, "/w/epsilon");
});
test("cwd is the first cwd field", () => assert.equal(byId(run("list"), "s-title").cwd, "/w/alpha"));
test("malformed lines are skipped", () => assert.equal(byId(run("list"), "s-bad").title, "Survives junk"));
test("list is newest first", () => {
  const ids = run("list").map((r) => r.id);
  assert.deepEqual(ids.filter((i) => ["s-title", "s-custom", "s-first"].includes(i)), ["s-first", "s-custom", "s-title"]);
  const m = run("list").map((r) => r.mtime);
  assert.deepEqual(m, [...m].sort((a, b) => b - a));
});
test("each row carries an mtime in ms", () => assert.ok(Math.abs(byId(run("list"), "s-bad").mtime - (Date.now() - 10000)) < 5000));

test("search is literal and case-insensitive", () => {
  assert.deepEqual(run("search", "HAYSTACK").map((r) => r.id), ["s-bad"]);
  assert.deepEqual(run("search", "a.c").map((r) => r.id), ["s-regex"]); // not regex: "abc" alone doesn't match
});
test("search dedupes by session id across files and matches", () => {
  const ids = run("search", "needle").map((r) => r.id);
  assert.equal(ids.filter((i) => i === "s-dup").length, 1);
  assert.deepEqual(ids.sort(), ["s-bad", "s-dup"]);
});
test("search results carry the same row fields", () => {
  const r = run("search", "haystack")[0];
  assert.equal(r.title, "Survives junk");
  assert.equal(r.cwd, "/w/zeta");
});
test("search is capped and newest first", () => {
  const rows = run("search", "needle", "--limit", "1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "s-dup");
});
test("search with no matches is an empty list", () => assert.deepEqual(run("search", "zzz-nothing-zzz"), []));
test("search with no home projects dir is an empty list", () => {
  const empty = mkdtempSync(join(tmpdir(), "ss-empty-"));
  const out = execFileSync("python3", ["-I", script, "search", "x"], { env: { ...process.env, HOME: empty }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), []);
});

test("index is cached under ~/.cache and refreshed when a file's mtime changes", () => {
  run("list");
  assert.ok(existsSync(join(home, ".cache", "herdr-session-search")));
  put("a", "s-custom", lines(user("hi", "/w/beta"), { type: "ai-title", aiTitle: "Renamed" }), 1);
  assert.equal(byId(run("list"), "s-custom").title, "Renamed");
});
