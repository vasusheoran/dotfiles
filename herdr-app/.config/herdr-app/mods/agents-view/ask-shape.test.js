// kuchbhi#1115 slice A: every ask explains itself, answers show sent, received, done. All data is synthetic.
// The ask row's fields are documented at the top of claude-plugins plugins/productivity/scripts/asks.jq.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsks, answeredAsks, laneOf, askView, askKeyAction, answerArgv, composeKey, nudgeArgv, viewModel, flatRows, footerHint, isAskKey } from "./lib.js";

const iso = (min) => new Date(Date.parse("2030-01-10T10:00:00Z") + min * 60_000).toISOString();
const NOW = Date.parse("2030-01-10T12:00:00Z");
const opts = [{ q: 1, key: "a", label: "Redis (Recommended)", then: "Redis is wired in" }, { q: 1, key: "b", label: "Memcached", then: "The card switches" }];
const ask = (o = {}) => ({ ts: iso(0), event: "ask", id: "a-1", card: "o/r#5", epic: "o/r#1", from: "worker", question: "Which cache?", body: "Which cache?", options: opts, kind: "decide",
  title: "Pick the cache", today: "Sessions live in memory.", after: "Sessions live in Redis.", checked: "Redis is deployed.", why_you: "It adds a service.", batch_key: "decide:o/r#1", ...o });
const OLD = { ts: iso(0), event: "ask", id: "o-1", card: "o/r#2", from: "worker", question: "Old question?", body: "Old body text", options: [], kind: "decide" };

test("openAsks: the new fields ride along; an old row has none and invents none", () => {
  const [n] = openAsks([ask()], NOW);
  assert.deepEqual([n.today, n.after, n.checked, n.whyYou, n.batchKey], ["Sessions live in memory.", "Sessions live in Redis.", "Redis is deployed.", "It adds a service.", "decide:o/r#1"]);
  assert.deepEqual(n.options.map((o) => o.then), ["Redis is wired in", "The card switches"]);
  const [o] = openAsks([OLD], NOW);
  assert.deepEqual([o.today, o.after, o.checked, o.whyYou, o.batchKey], [null, null, null, null, null]);
  assert.equal(o.body, "Old body text");
});

test("laneOf: kinds map to four lanes, decide and money included, as asks.jq has them", () => {
  const lanes = Object.fromEntries(["merge", "plan", "look", "decide", "you", "roll", "money", "groom", undefined].map((k) => [k, laneOf(k)]));
  assert.deepEqual(lanes, { merge: "key", plan: "look", look: "look", decide: "look", you: "hands", roll: "hands", money: "hands", groom: "groom", undefined: "look" });
  assert.equal(openAsks([OLD], NOW)[0].lane, "look");
});

test("askView: a new ask shows today, after, checked and why you, and each option's then; an old one shows only its old text", () => {
  const [n] = openAsks([ask()], NOW);
  const v = askView(n, {}, null);
  assert.deepEqual(v.evidence, [["Today", "Sessions live in memory."], ["After", "Sessions live in Redis."], ["Checked", "Redis is deployed."], ["Why you", "It adds a service."]]);
  assert.deepEqual(v.questions[0].options.map((o) => o.then), ["Redis is wired in", "The card switches"]);
  const [o] = openAsks([OLD], NOW);
  const ov = askView(o, {}, null);
  assert.deepEqual(ov.evidence, []);
  assert.match(ov.body, /Old body text/);
});

test("x is Done. only on a you ask with no options; with options the panel never posts a bare Done.", () => {
  const [bare] = openAsks([ask({ kind: "you", options: [] })], NOW);
  assert.deepEqual(askKeyAction(bare, "x", null, NOW), { type: "post", text: "Done." });
  const [withOpts] = openAsks([ask({ kind: "you", options: [{ q: 1, key: "a", label: "Done", then: "Recorded" }, { q: 1, key: "b", label: "Later", then: "Stays" }] })], NOW);
  assert.equal(askKeyAction(withOpts, "x", null, NOW), null);
  assert.deepEqual(askKeyAction(withOpts, "a", null, NOW), { type: "post", text: "1a: Done", key: "a" });
});

test("answerArgv: a pick carries its key; composeKey joins a key per question", () => {
  const [a] = openAsks([ask()], NOW);
  assert.deepEqual(answerArgv(a, "1a: Redis", { key: "a" }), ["ask", "answer", "a-1", "--text", "1a: Redis", "--via", "screen", "--key", "a"]);
  const two = { ...a, options: [{ q: 1, key: "a", label: "R" }, { q: 1, key: "b", label: "M" }, { q: 2, key: "a", label: "S" }, { q: 2, key: "b", label: "Q" }] };
  assert.equal(composeKey(two, { 1: "1a: R", 2: "2b: Q" }), "1a,2b");
  assert.equal(composeKey(two, { 1: "1a: R" }), null);
});

test("answeredAsks: an answered ask stays until applied, with sent, received, done", () => {
  const ans = { ts: iso(100), event: "answered", id: "a-1", card: "o/r#5", text: "Redis", by: "owner", via: "screen", key: "a" };
  const [s] = answeredAsks([ask(), ans], iso(104) && Date.parse(iso(104)));
  assert.deepEqual([s.id, s.sent, s.received, s.done, s.notPickedUp, s.pick], ["a-1", true, false, false, false, "Redis"]);
  const [r] = answeredAsks([ask(), ans, { ts: iso(101), event: "delivered", id: "a-1", terminal: "card-r-5" }], Date.parse(iso(104)));
  assert.deepEqual([r.sent, r.received, r.done], [true, true, false]);
  assert.deepEqual(answeredAsks([ask(), ans, { ts: iso(101), event: "delivered", id: "a-1" }, { ts: iso(102), event: "applied", id: "a-1" }], Date.parse(iso(104))), []);
  assert.deepEqual(answeredAsks([ask(), ans, { ts: iso(102), event: "closed", id: "a-1", reason: "superseded: PR merged" }], Date.parse(iso(104))), []);
  assert.deepEqual(answeredAsks([ask()], NOW), []);
});

test("answeredAsks: 10 minutes after the answer with no applied is not picked up; sooner is not", () => {
  const ans = { ts: iso(100), event: "answered", id: "a-1", card: "o/r#5", text: "Redis", key: "a" };
  assert.equal(answeredAsks([ask(), ans], Date.parse(iso(109)))[0].notPickedUp, false);
  assert.equal(answeredAsks([ask(), ans], Date.parse(iso(111)))[0].notPickedUp, true);
});

test("openAsks: a closed event closes the ask, like applied", () => {
  assert.deepEqual(openAsks([ask(), { ts: iso(5), event: "closed", id: "a-1", reason: "superseded: PR merged" }], NOW), []);
});

test("nudgeArgv: work ask nudge <id>", () => {
  assert.deepEqual(nudgeArgv({ id: "a-1" }), ["ask", "nudge", "a-1"]);
});

test("viewModel and flatRows: answered asks are rows after the open ones; the nudge key is for a not-picked-up one only", () => {
  const ans = { ts: iso(100), event: "answered", id: "a-1", card: "o/r#5", text: "Redis", key: "a" };
  const vm = viewModel({ terminals: [], asksText: [ask(), ans].map((l) => JSON.stringify(l)).join("\n"), nowMs: Date.parse(iso(120)) });
  assert.equal(vm.sent.length, 1); assert.equal(vm.asks.length, 0);
  const rows = flatRows(vm, { sentOpen: true }).filter((r) => r.section === "sent");
  assert.deepEqual(rows.map((r) => r.id), ["a-1"]);
  assert.match(footerHint("sent"), /nudge/);
});

test("openAsks: a batch with one PR landed stays one entry with both targets, the landed one marked", () => {
  const row = (id, pr, extra = {}) => ask({ id, batch: "b-1", kind: "merge", options: [], target: { repo: "o/r", pr, head: "h" + pr }, ...extra });
  const lines = [row("b-1", 1), row("b-2", 2), { ts: iso(5), event: "landed", id: "b-1", card: "o/r#5", reason: "merged" }];
  const [b, ...rest] = openAsks(lines, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual(b.targets.map((t) => [t.pr, t.landed]), [[1, true], [2, false]]);
  assert.deepEqual(askView(b, null).targets.map((t) => t.label), ["r#1 (landed)", "r#2"]);
});
