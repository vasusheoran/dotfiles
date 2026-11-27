// The Inbox count in the tab bar and its one-click answers (kuchbhi#1360). All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "./lib.js";

const { viewModel, badgeText, inboxItems, leadRows, stuckRows } = lib;
const clickStep = (...a) => lib.clickStep(...a), leadFor = (...a) => lib.leadFor(...a);
const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000, iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const jsonl = (...rows) => rows.map((r) => JSON.stringify(r)).join("\n");
const merge = { ts: iso(30), event: "ask", id: "a-1", card: "o/r#5", epic: "o/r#1", kind: "merge", from: "lead", terminal: "t18w", title: "Land PR 97", question: "1. Land PR 97?",
  options: [{ q: 1, key: "a", label: "Merges now" }, { q: 1, key: "b", label: "Hold (Recommended)" }], target: { repo: "o/p", pr: 97 } };
const decide = { ts: iso(20), event: "ask", id: "a-2", card: "o/r#6", epic: "o/r#1", from: "lead", title: "Pick a name", question: "1. Name?",
  options: [{ q: 1, key: "a", label: "Alpha (Recommended)" }, { q: 1, key: "b", label: "Beta" }] };
const asksOf = (text) => viewModel({ terminals: [], asksText: text, nowMs: NOW }).asks;
const lead = { address: "t18w", name: null, state: "live", status: { state: "working" }, labels: ["role=lead", "epics=o/r#9,o/r#1", "herdr.tab=tbL", "herdr.space=spL"] };

test("an open ask shows a count in the tab bar; once answered the count drops to nothing", () => {
  assert.equal(badgeText(asksOf(jsonl(merge))), "1 ask for you");
  assert.equal(badgeText(asksOf(jsonl(merge, decide))), "2 asks for you");
  assert.equal(badgeText(asksOf(jsonl(merge, { ts: iso(1), event: "answered", id: "a-1", key: "a", text: "1a: Merges now", by: "owner", via: "screen" }))), "");
  assert.equal(badgeText(asksOf("")), "");
});

test("each option is a button; the recommended one is marked, whatever its letter", () => {
  const [m] = inboxItems(asksOf(jsonl(merge)));
  assert.equal(m.id, "a-1"); assert.equal(m.title, "Land PR 97");
  assert.deepEqual(m.buttons.map((b) => [b.label, b.recommended]), [["a) Merges now", false], ["b) Hold (Recommended)", true]]);
});

test("one click on a decide option answers it as the owner, with the option's key (what merge-green reads)", () => {
  const [ask] = asksOf(jsonl(decide)), [item] = inboxItems([ask]);
  const step = clickStep(ask, item.buttons[0], null, NOW);
  assert.deepEqual(step, { type: "post", argv: ["ask", "answer", "a-2", "--text", "1a: Alpha (Recommended)", "--via", "screen", "--key", "a"] });
  assert.ok(!step.argv.includes("--by"), "ask.sh records --by owner by default");
});

test("a merge, roll or money option needs a second click on the same button within 10s", () => {
  const [ask] = asksOf(jsonl(merge)), [item] = inboxItems([ask]), a = item.buttons[0];
  const first = clickStep(ask, a, null, NOW);
  assert.equal(first.type, "arm");
  assert.deepEqual(clickStep(ask, a, first.armed, NOW + 3000), { type: "post", argv: ["ask", "answer", "a-1", "--text", "1a: Merges now", "--via", "screen", "--key", "a"] });
  assert.equal(clickStep(ask, item.buttons[1], first.armed, NOW + 3000).type, "arm", "another button starts over");
  assert.equal(clickStep(ask, a, first.armed, NOW + 11_000).type, "arm", "too late starts over");
});

test("a multi-part ask answers every part with its recommended option in one click", () => {
  const two = { ts: iso(10), event: "ask", id: "a-3", card: "o/r#7", from: "lead", title: "Two choices", question: "1. A?\n2. B?",
    options: [{ q: 1, key: "a", label: "Yes (Recommended)" }, { q: 1, key: "b", label: "No" }, { q: 2, key: "a", label: "Left" }, { q: 2, key: "b", label: "Right (Recommended)" }] };
  const [ask] = asksOf(jsonl(two)), [item] = inboxItems([ask]);
  assert.deepEqual(item.buttons.map((b) => [b.label, b.recommended]), [["Accept the recommended answers", true]]);
  assert.deepEqual(clickStep(ask, item.buttons[0], null, NOW), { type: "post", argv: ["ask", "answer", "a-3", "--text", "1a: Yes (Recommended)\n2b: Right (Recommended)", "--via", "screen", "--key", "1a,2b"] });
});

test("a batched merge ask offers only 'merge all' (picking PRs needs the checklist); a you-ask with no options offers Done", () => {
  const rows = [{ ...merge, id: "a-4", batch: "a-4" }, { ...merge, id: "a-5", batch: "a-4", target: { repo: "o/p", pr: 98 } }];
  const you = { ts: iso(5), event: "ask", id: "a-6", card: "o/r#8", kind: "you", from: "lead", title: "Run install.sh", question: "1. Run it" };
  const asks = asksOf(jsonl(...rows, you)), [batch, task] = inboxItems(asks);
  assert.deepEqual(batch.buttons.map((b) => b.label), ["a) Merge all 2, in order (Recommended)"]);
  assert.deepEqual(task.buttons.map((b) => b.label), ["Done"]);
  assert.deepEqual(clickStep(asks[1], task.buttons[0], null, NOW), { type: "post", argv: ["ask", "answer", "a-6", "--text", "Done.", "--via", "screen"] });
});

test("an ask opens its lead's tab: the asker when it is a lead, else the lead holding the ask's epic; never a card's own tab", () => {
  const worker = { address: "w1", name: "card-r-5", state: "live", labels: ["role=worker", "epic=o/r#1", "herdr.tab=tbW", "herdr.space=spW"] };
  const ts = [lead, worker];
  assert.deepEqual(leadFor(asksOf(jsonl(merge))[0], ts), { address: "t18w", tab: "tbL", space: "spL" });
  assert.deepEqual(leadFor(asksOf(jsonl({ ...decide, from: "worker", terminal: "w1" }))[0], ts), { address: "t18w", tab: "tbL", space: "spL" });
  assert.equal(leadFor(asksOf(jsonl({ ...decide, epic: "o/r#77", terminal: "w1" }))[0], ts), null, "no lead holds it: nothing to open");
});

test("a lead that holds several epics (the `epics` label /lead sets) is waiting on you when any of them has an open ask", () => {
  const r = leadRows({ terminals: [lead], asks: asksOf(jsonl(merge)), stuck: [], statuses: {}, titles: {}, waits: {}, lastLines: {}, nowMs: NOW });
  assert.deepEqual(r.groups.map((g) => g.id), ["waiting"]);
  assert.equal(r.groups[0].rows[0].epic, "o/r#1");
});

test("a worker under a lead that holds its epic in `epics` is not flagged 'no lead running'", () => {
  const worker = { address: "w1", name: "card-r-5", state: "live", status: { state: "working" }, labels: ["role=worker", "epic=o/r#9"] };
  const rows = stuckRows([lead, worker].map(lib.normalize), [], [], NOW);
  assert.ok(!rows.some((r) => /no lead/.test(r.text ?? "")), JSON.stringify(rows));
});
