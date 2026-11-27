// The Inbox count in the tab bar and its one-click answers (kuchbhi#1360). All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "./lib.js";
const { viewModel, leadRows } = lib, badgeText = (a) => lib.badgeText(a), inboxItems = (a) => lib.inboxItems(a);

const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000, iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join("\n");
const merge = { ts: iso(30), event: "ask", id: "a-1", card: "o/r#5", epic: "o/r#1", kind: "merge", from: "lead", title: "Land PR 97", question: "1. Land PR 97?",
  options: [{ q: 1, key: "a", label: "Merges now (Recommended)" }, { q: 1, key: "b", label: "Hold" }], target: { repo: "o/p", pr: 97 } };
const asksOf = (text) => viewModel({ terminals: [], asksText: text, nowMs: NOW }).asks;

test("an open ask shows a count in the tab bar; once answered the count drops to nothing", () => {
  assert.equal(badgeText(asksOf(jsonl(merge))), "1 ask for you");
  assert.equal(badgeText(asksOf(jsonl(merge, { ...merge, id: "a-2", card: "o/r#6", title: "Other" }))), "2 asks for you");
  assert.equal(badgeText(asksOf(jsonl(merge, { ts: iso(1), event: "answered", id: "a-1", key: "a", text: "1a: Merges now", by: "owner", via: "screen" }))), "");
  assert.equal(badgeText(asksOf("")), "");
});

test("one click on an option answers the ask as the owner, with the option's key (what merge-green reads)", () => {
  const [item] = inboxItems(asksOf(jsonl(merge)));
  assert.equal(item.id, "a-1"); assert.equal(item.title, "Land PR 97");
  assert.deepEqual(item.buttons.map((b) => b.label), ["a) Merges now (Recommended)", "b) Hold"]);
  assert.deepEqual(item.buttons[0].argv, ["ask", "answer", "a-1", "--text", "1a: Merges now (Recommended)", "--via", "screen", "--key", "a"]);
  assert.ok(!item.buttons[0].argv.includes("--by"), "ask.sh records --by owner by default");
});

test("a multi-part ask answers every part with its recommended option in one click", () => {
  const two = { ts: iso(10), event: "ask", id: "a-3", card: "o/r#7", from: "lead", title: "Two choices", question: "1. A?\n2. B?",
    options: [{ q: 1, key: "a", label: "Yes (Recommended)" }, { q: 1, key: "b", label: "No" }, { q: 2, key: "a", label: "Left" }, { q: 2, key: "b", label: "Right (Recommended)" }] };
  const [item] = inboxItems(asksOf(jsonl(two)));
  assert.deepEqual(item.buttons.map((b) => b.label), ["Accept the recommended answers"]);
  assert.deepEqual(item.buttons[0].argv, ["ask", "answer", "a-3", "--text", "1a: Yes (Recommended)\n2b: Right (Recommended)", "--via", "screen", "--key", "1a,2b"]);
});

test("a batched merge ask offers only 'merge all' (picking PRs needs the checklist); a you-ask with no options offers Done", () => {
  const rows = [{ ...merge, id: "a-4", batch: "a-4" }, { ...merge, id: "a-5", batch: "a-4", target: { repo: "o/p", pr: 98 } }];
  const you = { ts: iso(5), event: "ask", id: "a-6", card: "o/r#8", kind: "you", from: "lead", title: "Run install.sh", question: "1. Run it" };
  const [batch, task] = inboxItems(asksOf(jsonl(...rows, you)));
  assert.deepEqual(batch.buttons.map((b) => b.label), ["a) Merge all 2, in order (Recommended)"]);
  assert.deepEqual(batch.buttons[0].argv.slice(-2), ["--key", "a"]);
  assert.deepEqual(task.buttons.map((b) => [b.label, b.argv]), [["Done", ["ask", "answer", "a-6", "--text", "Done.", "--via", "screen"]]]);
});

test("a lead that holds several epics (the `epics` label /lead sets) is waiting on you when any of them has an open ask", () => {
  const lead = { address: "t18w", name: null, state: "live", status: { state: "working" }, labels: ["role=lead", "epics=o/r#9,o/r#1", "herdr.tab=tb1"] };
  const r = leadRows({ terminals: [lead], asks: asksOf(jsonl(merge)), stuck: [], statuses: {}, titles: {}, waits: {}, lastLines: {}, nowMs: NOW });
  assert.deepEqual(r.groups.map((g) => g.id), ["waiting"]);
  assert.equal(r.groups[0].rows[0].epic, "o/r#1");
});
