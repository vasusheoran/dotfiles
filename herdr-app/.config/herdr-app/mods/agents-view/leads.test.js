// The leads side list (kuchbhi#1115, 16 Nov direction): one row per lead, grouped Waiting on you / Stuck / Working, the rest folded. All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadRows, lastScreenLine } from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000, iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const lead = (n, o = {}) => ({ address: `t${n}`, name: `lead-r-${n}`, state: "live", status: { state: "working" }, status_ms: NOW - 5 * MIN, labels: ["role=lead", `epic=o/r#${n}`], title: `✳ title ${n}`, ...o });
const worker = (n, epic, o = {}) => ({ address: `w${n}`, name: `card-r-${n}`, state: "live", status: { state: "working" }, labels: ["role=worker", `epic=o/r#${epic}`, `card=o/r#${n + 100}`], ...o });
const ask = (epic, o = {}) => ({ id: `a-${epic}`, epic: `o/r#${epic}`, card: `o/r#${epic}`, from: "lead", title: `Ask for ${epic}`, ts: iso(30), ageMs: 30 * MIN, options: [], ...o });
const titles = { "o/r#1": "Epic 1: One", "o/r#2": "Epic 2: Two", "o/r#3": "Epic 3: Three", "o/r#4": "Epic 4: Four", "o/r#5": "Epic 5: Five", "o/r#6": "Epic 6: Six" };
const rows = (o) => leadRows({ terminals: [], asks: [], stuck: [], statuses: {}, titles, waits: {}, lastLines: {}, nowMs: NOW, ...o });
const names = (g) => g.rows.map((r) => r.name);

test("groups: waiting on you (blocked, an open ask, or a question in its terminal), then stuck, then working; the rest fold into one row", () => {
  const r = rows({
    terminals: [lead(1, { status: { state: "blocked", kind: "permission" } }), lead(2), lead(3), lead(4, { status: { state: "idle" } }), lead(5, { status: { state: "done" } }), lead(6, { status: { state: "idle" } }), lead(8), worker(7, 3)],
    asks: [ask(2)], stuck: [{ kind: "gone", name: "card-r-7", address: null, text: "terminal gone, no question", ageMs: 5 * MIN }], waits: { t6: ["1. Say go"] },
  });
  assert.deepEqual(r.groups.map((g) => g.label), ["Waiting on you", "Stuck", "Working"]);
  assert.deepEqual(names(r.groups[0]), ["lead-r-1", "lead-r-2", "lead-r-6"]);
  assert.deepEqual(names(r.groups[1]), ["lead-r-3"]);
  assert.deepEqual(names(r.groups[2]), ["lead-r-8"]);
  assert.equal(r.fold.count, 2); assert.equal(r.fold.label, "2 idle or done · Epics 4, 5");
  assert.deepEqual(r.rows.map((x) => x.name), ["lead-r-1", "lead-r-2", "lead-r-6", "lead-r-3", "lead-r-8"], "selectable rows follow the group order; the fold is not one");
});
test("a row carries the epic's short title, the state's age, and a meta line of lead name and workers", () => {
  const r = rows({ terminals: [lead(2), worker(8, 2), worker(9, 2)], asks: [ask(2)] });
  const x = r.groups[0].rows[0];
  assert.equal(x.title, "Epic 2: Two"); assert.equal(x.ageMs, 30 * MIN); assert.equal(x.meta, "lead-r-2 · 2 workers"); assert.equal(x.address, "t2");
});
test("the last line: the lead's status when newer than the ask, else the ask's title, else its screen", () => {
  const st = (ago) => ({ "o/r#2": { text: "Rolling stage", ts: iso(ago) } });
  assert.equal(rows({ terminals: [lead(2)], asks: [ask(2)], statuses: st(5) }).groups[0].rows[0].last, "Rolling stage");
  assert.equal(rows({ terminals: [lead(2)], asks: [ask(2)], statuses: st(900) }).groups[0].rows[0].last, "Ask for 2");
  assert.equal(rows({ terminals: [lead(3)], lastLines: { t3: "Reviewing #1024's PR" } }).groups[0].rows[0].last, "Reviewing #1024's PR");
  assert.equal(rows({ terminals: [lead(3)] }).groups[0].rows[0].last, "title 3", "no status, no ask, no screen: the terminal's own title, its glyph dropped");
});
test("a resumed lead that Herdr sees as zsh (no status, no app) is still listed, by its name", () => {
  const z = lead(4, { status: null, labels: ["role=lead", "epic=o/r#4"], agent: "zsh" });
  const r = rows({ terminals: [z] });
  assert.equal(r.fold.count, 1, "no status: idle");
  assert.equal(rows({ terminals: [z], asks: [ask(4)] }).groups[0].rows[0].name, "lead-r-4");
  const noLabels = { address: "t9", name: "lead-r-5", state: "live", status: null, labels: [] };
  assert.equal(rows({ terminals: [noLabels], asks: [ask(5)] }).groups[0].rows[0].title, "Epic 5: Five", "the epic number comes from the name when the labels are gone");
});
test("a lead with nothing waiting and a working status is under Working; epics of dead leads do not list", () => {
  const r = rows({ terminals: [lead(1), { ...lead(2), state: "exited" }] });
  assert.deepEqual(names(r.groups[0]), ["lead-r-1"]); assert.equal(r.groups[0].label, "Working"); assert.equal(r.fold.count, 0);
});
test("the last screen line skips the prompt, rules, footer and recap", () => {
  const rule = "─".repeat(60);
  assert.equal(lastScreenLine(`⏺ Reviewing #1024's PR against the hook tests\n\n✻ Worked for 9s\n${rule}\n❯ \n${rule}\n  ⏵⏵ auto mode on\n`), "Reviewing #1024's PR against the hook tests");
  assert.equal(lastScreenLine(""), "");
});
