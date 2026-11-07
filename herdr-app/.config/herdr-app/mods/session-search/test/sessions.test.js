// Behavior of the helper script against a synthetic ~/.claude/projects tree.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, statSync } from "node:fs";
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

  const asst = (content, timestamp) => ({ type: "assistant", timestamp, message: { role: "assistant", content } });
  const result = (content) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content }] } });
  put("e", "h-user", lines({ ...user("please grep the Zebrafish config", "/w/h1"), timestamp: "2026-01-02T03:04:05Z" }), 40);
  put("e", "h-asst", lines(user("hello", "/w/h2"), asst([{ type: "text", text: "the Axolotl module is loaded" }, { type: "tool_use", name: "Bash", input: {} }], "2026-02-03T04:05:06Z")), 41);
  put("e", "h-tool", lines(user("go", "/w/h3"), result("narwhal output line"), result([{ type: "text", text: "narwhal in a list" }])), 42);
  put("e", "h-notext", lines(user("go", "/w/h4"), asst([{ type: "tool_use", name: "quokka_tool", input: { a: 1 } }])), 43);
  put("e", "h-cap", lines(user("go", "/w/h5"), ...Array.from({ length: 8 }, (_, i) => asst([{ type: "text", text: `marmot number ${i}` }]))), 44);
  const long = Array.from({ length: 120 }, () => "word").join(" ");
  put("e", "h-long", lines(user(`${long} okapi ${long}`, "/w/h6")), 45);
  put("e", "h-nl", lines(user("line one\nline two okapinl\nline three", "/w/h7")), 46);
  put("e", "h-multi", lines(user("a yakmulti and YAKMULTI here", "/w/h8")), 47);
  put("e", "h-junk", lines('{"broken": "pangolin', user("fine pangolin", "/w/h9"), '{"x": pangolin}'), 48);
  put("e", "p-full", lines({ type: "attachment" }, result("tool noise"), user("the first\nask", "/w/p1"), asst([{ type: "text", text: "early reply" }], "2026-03-01T00:00:00Z"), user("second ask"), asst([{ type: "text", text: "final answer" }, { type: "tool_use", name: "X", input: {} }], "2026-03-02T00:00:00Z"), asst([{ type: "tool_use", name: "Y", input: {} }])), 60);
  put("e", "p-noasst", lines(user("only a question " + "long ".repeat(100), "/w/p2")), 61);
  for (let i = 0; i < 201; i++) put("f", `cap-${i}`, lines(user("capsearchword", "/w/cap")), 1000 + i);
});

const hitsOf = (q, id) => byId(run("search", q), id)?.hits;

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

test("a string user message yields a user hit with text, time and match offsets", () => {
  const [h] = hitsOf("zebrafish", "h-user");
  assert.equal(h.role, "user");
  assert.equal(h.ts, "2026-01-02T03:04:05Z");
  assert.equal(h.text, "please grep the Zebrafish config");
  assert.equal(h.ranges.length, 1);
  assert.equal(h.text.slice(...h.ranges[0]), "Zebrafish");
});
test("assistant text blocks yield assistant hits, tool_use blocks are ignored", () => {
  const hs = hitsOf("axolotl", "h-asst");
  assert.equal(hs.length, 1);
  assert.equal(hs[0].role, "assistant");
  assert.equal(hs[0].text, "the Axolotl module is loaded");
});
test("tool_result content, as a string or a text list, yields tool hits", () => {
  const hs = hitsOf("narwhal", "h-tool");
  assert.deepEqual(hs.map((h) => h.role), ["tool", "tool"]);
  assert.deepEqual(hs.map((h) => h.text), ["narwhal output line", "narwhal in a list"]);
});
test("a match only in non-text JSON (tool_use input, keys) is not a hit, so the session is dropped", () => assert.equal(byId(run("search", "quokka"), "h-notext"), undefined));
test("hits are capped at 5 per session, in transcript order", () => {
  const hs = hitsOf("marmot", "h-cap");
  assert.equal(hs.length, 5);
  assert.deepEqual(hs.map((h) => h.text), [0, 1, 2, 3, 4].map((i) => `marmot number ${i}`));
});
test("long text is cut to a ~240 char snippet at word boundaries, keeping the match", () => {
  const [h] = hitsOf("okapi", "h-long");
  assert.ok(h.text.length <= 260, `len ${h.text.length}`);
  assert.ok(h.text.length >= 100);
  assert.ok(h.text.split(" ").every((w) => w === "word" || w === "okapi"), "no half words");
  assert.equal(h.text.slice(...h.ranges[0]), "okapi");
});
test("newlines in the snippet are kept", () => {
  const [h] = hitsOf("okapinl", "h-nl");
  assert.equal(h.text, "line one\nline two okapinl\nline three");
  assert.equal(h.text.slice(...h.ranges[0]), "okapinl");
});
test("every occurrence in the snippet is a range, case-insensitively", () => {
  const [h] = hitsOf("yakmulti", "h-multi");
  assert.deepEqual(h.ranges.map(([a, b]) => h.text.slice(a, b)), ["yakmulti", "YAKMULTI"]);
});
test("malformed lines, even ones containing the word, are skipped", () => {
  const hs = hitsOf("pangolin", "h-junk");
  assert.deepEqual(hs.map((h) => h.text), ["fine pangolin"]);
});
test("search returns at most 200 sessions by default, newest first", () => {
  const rows = run("search", "capsearchword");
  assert.equal(rows.length, 200);
  assert.equal(rows[0].id, "cap-0");
  assert.equal(rows.some((r) => r.id === "cap-200"), false);
});

test("peek gives the first user message and the last assistant message", () => {
  const p = run("peek", "p-full");
  assert.equal(p.first.role, "user");
  assert.equal(p.first.text, "the first\nask");
  assert.equal(p.last.role, "assistant");
  assert.equal(p.last.text, "final answer");
  assert.equal(p.last.ts, "2026-03-02T00:00:00Z");
});
test("peek with no assistant reply has last = null, and long text is trimmed at a word", () => {
  const p = run("peek", "p-noasst");
  assert.equal(p.last, null);
  assert.ok(p.first.text.length <= 260);
  assert.ok(p.first.text.startsWith("only a question"));
  assert.ok(p.first.text.split(" ").every((w) => ["only", "a", "question", "long", ""].includes(w)));
});
test("peek of an unknown or path-like id is empty", () => {
  assert.deepEqual(run("peek", "nope"), { first: null, last: null });
  assert.deepEqual(run("peek", "../../x"), { first: null, last: null });
});
test("peek is cached by mtime", () => {
  const f = put("e", "p-cache", lines(user("before", "/w/pc")), 70);
  assert.equal(run("peek", "p-cache").first.text, "before");
  const t = statSync(f).mtimeMs / 1000;
  writeFileSync(f, lines(user("after", "/w/pc")));
  utimesSync(f, t, t); // same mtime: served from cache
  assert.equal(run("peek", "p-cache").first.text, "before");
  utimesSync(f, t + 5, t + 5); // new mtime: re-read
  assert.equal(run("peek", "p-cache").first.text, "after");
});
