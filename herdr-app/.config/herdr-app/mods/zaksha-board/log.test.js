// Behavior tests for the shared mod logger (log.js, duplicated into every mod). Fake fs, synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeLog, logPath, formatLine, needsRotate, LOG_MAX } from "./log.js";

const memfs = (files = {}) => {
  const calls = [];
  return {
    files, calls,
    mkdir: async (p) => { calls.push(["mkdir", p]); },
    readFile: async (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
    writeFile: async (p, c) => { calls.push(["write", p]); files[p] = c; },
  };
};
const T = Date.parse("2026-03-01T12:00:00Z");

test("logPath: under the app's data/logs, one file per mod", () => {
  assert.equal(logPath("/h/.config/herdr-app", "zaksha-board"), "/h/.config/herdr-app/data/logs/zaksha-board.log");
});

test("formatLine: ISO time, upper-case level, mod, message, then json data", () => {
  assert.equal(formatLine(T, "info", "m", "hello", { a: 1 }), '2026-03-01T12:00:00.000Z INFO m hello {"a":1}\n');
  assert.equal(formatLine(T, "error", "m", "boom"), "2026-03-01T12:00:00.000Z ERROR m boom\n");
});

test("formatLine: unserialisable data never throws and stays on one line", () => {
  const loop = {}; loop.self = loop;
  assert.match(formatLine(T, "warn", "m", "x", loop), /^2026-03-01T12:00:00.000Z WARN m x \S*\n$/);
  assert.equal(formatLine(T, "info", "m", "a\nb").split("\n").length, 2);
});

test("needsRotate: only strictly over 256 KB", () => {
  assert.equal(LOG_MAX, 256 * 1024);
  assert.equal(needsRotate(LOG_MAX), false);
  assert.equal(needsRotate(LOG_MAX + 1), true);
  assert.equal(needsRotate(0), false);
});

const mk = (fs) => makeLog("m", { dir: "/d", fs, now: () => T });

test("log: creates the folder and appends lines in order", async () => {
  const fs = memfs();
  const log = mk(fs);
  log("info", "one"); log("info", "two", { n: 2 });
  await log.flush();
  assert.deepEqual(fs.calls[0], ["mkdir", "/d/data/logs"]);
  assert.equal(fs.files["/d/data/logs/m.log"], formatLine(T, "info", "m", "one") + formatLine(T, "info", "m", "two", { n: 2 }));
});

test("log: at exactly the limit it appends; over it, rotates keeping two old files", async () => {
  const P = "/d/data/logs/m.log";
  const at = memfs({ [P]: "x".repeat(LOG_MAX) });
  const a = mk(at); a("info", "z"); await a.flush();
  assert.equal(at.files[P].length, LOG_MAX + formatLine(T, "info", "m", "z").length);
  assert.equal(P + ".1" in at.files, false);

  const over = memfs({ [P]: "n".repeat(LOG_MAX + 1), [P + ".1"]: "old1", [P + ".2"]: "old2" });
  const b = mk(over); b("info", "z"); await b.flush();
  assert.equal(over.files[P + ".2"], "old1");
  assert.equal(over.files[P + ".1"], "n".repeat(LOG_MAX + 1));
  assert.equal(over.files[P], formatLine(T, "info", "m", "z"));
});

test("log: rotating with no .1 yet just starts .1", async () => {
  const P = "/d/data/logs/m.log";
  const fs = memfs({ [P]: "n".repeat(LOG_MAX + 1) });
  const l = mk(fs); l("info", "z"); await l.flush();
  assert.equal(P + ".2" in fs.files, false);
  assert.equal(fs.files[P + ".1"].length, LOG_MAX + 1);
});

test("log: a burst of writes with slow, interleavable fs keeps every line in call order", async () => {
  const fs = memfs();
  const slow = { ...fs, readFile: async (p) => { await new Promise((r) => setImmediate(r)); return fs.readFile(p); } };
  const l = mk(slow);
  for (let i = 0; i < 20; i++) l("info", `m${i}`);
  await l.flush();
  const got = fs.files["/d/data/logs/m.log"].trim().split("\n").map((x) => x.split(" ")[3]);
  assert.deepEqual(got, Array.from({ length: 20 }, (_, i) => `m${i}`));
});

test("log: a failing fs drops the line, never throws, and later lines still land", async () => {
  const fs = memfs();
  let fail = true;
  const flaky = { ...fs, writeFile: async (p, c) => { if (fail) { fail = false; throw new Error("EIO"); } return fs.writeFile(p, c); } };
  const l = mk(flaky);
  assert.doesNotThrow(() => l("info", "lost"));
  l("info", "kept");
  await l.flush();
  assert.equal(fs.files["/d/data/logs/m.log"], formatLine(T, "info", "m", "kept"));
});

test("log: returns before any write happens (never blocks rendering)", () => {
  const fs = memfs();
  const l = mk(fs);
  assert.equal(l("info", "x"), undefined);
  assert.equal("/d/data/logs/m.log" in fs.files, false);
});

test("log.js is byte-identical in every mod that carries it", () => {
  const here = readFileSync(new URL("./log.js", import.meta.url), "utf8");
  for (const m of ["zaksha-board-start", "session-search", "space-toggle"])
    assert.equal(readFileSync(new URL(`../${m}/log.js`, import.meta.url), "utf8"), here, m);
});
