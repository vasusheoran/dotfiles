// Sent asks, replies, the open line and the Inbox count (kuchbhi#1115, owner round 2). Synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsks, answeredAsks, openLinks, askKeyAction, buildEpics, waitingCount, inboxLabel, sentReceipt, hideKey, flatRows, viewModel } from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000;
const iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const ASK = (id, o = {}) => ({ ts: iso(60), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "lead", terminal: "lead-r-1", kind: "decide", title: `Title ${id}`, question: `Q ${id}\n`, body: "Q\n\n1. Q\n   a) A => a\n   b) B => b\n",
  options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const ANS = (id, ago, o = {}) => ({ ts: iso(ago), event: "answered", id, card: `o/r#${id.replace(/\D/g, "")}`, text: "1a: A (Recommended)", key: "a", by: "owner", via: "screen", ...o });
const MSG = (id, ago, from, text, mid) => ({ ts: iso(ago), event: "message", mid: mid ?? `m${ago}${from}`, thread: id, from, text });

test("answeredAsks(all): an applied ask stays as done; without all it is dropped; the lead and the note ride along", () => {
  const ls = [ASK("a-1"), ANS("a-1", 30, { note: "check the ads" }), { ts: iso(29), event: "delivered", id: "a-1" }, { ts: iso(28), event: "applied", id: "a-1" }];
  assert.deepEqual(answeredAsks(ls, NOW), []);
  const [s] = answeredAsks(ls, NOW, true);
  assert.equal(s.done, true); assert.equal(s.received, true); assert.equal(s.notPickedUp, false); assert.equal(s.lead, "lead-r-1"); assert.equal(s.note, "check the ads");
});

test("a reply from the agent on the ask's thread brings an answered ask back as needing the owner, marked reply", () => {
  const ls = [ASK("a-1"), ANS("a-1", 30)];
  assert.equal(openAsks(ls, NOW).length, 0);
  const back = openAsks([...ls, MSG("a-1", 10, "agent", "can't do that because the build is red")], NOW);
  assert.equal(back.length, 1); assert.deepEqual(back[0].reply, { text: "can't do that because the build is red", ts: iso(10) });
  assert.equal(openAsks([...ls, MSG("a-1", 10, "agent", "no"), MSG("a-1", 5, "owner", "ok, wait for green")], NOW).length, 0, "the owner answered the reply by message");
  assert.equal(openAsks([...ls, MSG("a-1", 10, "agent", "no"), ANS("a-1", 5)], NOW).length, 0, "the owner answered again");
  assert.equal(openAsks([...ls, MSG("a-1", 40, "agent", "earlier")], NOW).length, 0, "a message from before the answer is not a reply");
  assert.equal(openAsks([...ls, MSG("a-1", 10, "agent", "no"), { ts: iso(9), event: "applied", id: "a-1" }], NOW).length, 0, "applied ends it");
  assert.equal(openAsks([...ls, MSG("a-9", 10, "agent", "other thread")], NOW).length, 0);
  assert.equal(openAsks([...ls, MSG("a-1", 10, "owner", "my own")], NOW).length, 0, "the owner's own message is not a reply");
});

test("hideKey: a reply asks to be hidden by its own key, so hiding the first answer does not hide the reply", () => {
  assert.equal(hideKey({ id: "a-1" }), "a-1"); assert.equal(hideKey({ id: "a-1", reply: { ts: "T" } }), "a-1@T");
  const ls = [ASK("a-1"), ANS("a-1", 30), MSG("a-1", 10, "agent", "no")];
  const vm = viewModel({ terminals: [], asksText: ls.map((l) => JSON.stringify(l)).join("\n"), nowMs: NOW, hiddenIds: new Set(["a-1"]) });
  assert.equal(vm.asks.length, 1, "the reply shows although a-1 was hidden after the first answer");
  assert.equal(viewModel({ terminals: [], asksText: ls.map((l) => JSON.stringify(l)).join("\n"), nowMs: NOW, hiddenIds: new Set(["a-1", "a-1@" + iso(10)]) }).asks.length, 0);
});

test("buildEpics: an epic whose only ask is gone is working, with no ask; its count drops", () => {
  const ls = [ASK("a-1"), ASK("a-2", { card: "o/r#2" }), ANS("a-1", 3)].map((l) => JSON.stringify(l)).join("\n");
  const vm = viewModel({ terminals: [], asksText: ls, nowMs: NOW });
  assert.equal(vm.asks.length, 1); const [e] = vm.epics; assert.equal(e.asks.length, 1);
  const none = viewModel({ terminals: [], asksText: [ASK("a-1"), ANS("a-1", 3)].map((l) => JSON.stringify(l)).join("\n"), nowMs: NOW });
  assert.equal(none.epics.find((x) => x.ref === "o/r#1")?.asks.length ?? 0, 0); assert.notEqual(none.epics.find((x) => x.ref === "o/r#1")?.state, "needs");
});

test("openLinks: a plan, a mockup, a preview, a stage URL and a manual check each give an open line; a design question gives none", () => {
  const ol = (o) => openLinks(ASK("a-1", o)).map((l) => [l.label, l.target]);
  assert.deepEqual(ol({ plan: "/Users/v/plans/1115/plan.html" }), [["open plan", "/Users/v/plans/1115/plan.html"]]);
  assert.deepEqual(ol({ body: "Look at /Users/v/canvas/1115/mock.html first\n\n1. Q\n   a) A => a\n" }), [["open mockup", "/Users/v/canvas/1115/mock.html"]]);
  assert.deepEqual(ol({ today: "preview is at https://abc.kuchbhi.pages.dev/home" }), [["open preview", "https://abc.kuchbhi.pages.dev/home"]]);
  assert.deepEqual(ol({ checked: "stage: https://stage.kuchbhi.app/login" }), [["open stage", "https://stage.kuchbhi.app/login"]]);
  assert.deepEqual(ol({ kind: "you", body: "Open https://example.test/check and look\n" }), [["open check", "https://example.test/check"]]);
  assert.deepEqual(ol({ body: "The plan is in https://github.com/o/r/issues/5#issuecomment-123 (the /work · Plan comment)\n" }), [["open plan", "https://github.com/o/r/issues/5#issuecomment-123"]]);
  assert.deepEqual(ol({}), [], "a pure design question has no line");
  assert.deepEqual(ol({ today: "see https://github.com/o/r/pull/5" }), [], "a PR is not a thing to look at here");
});
test("openLinks: the order is plan, mockup, preview, stage, check; the same target once; p opens the first", () => {
  const a = ASK("a-1", { plan: "/p/plans/x.html", today: "https://x.pages.dev/a and https://stage.k.app/b and /p/canvas/m.html and /p/canvas/m.html" });
  assert.deepEqual(openLinks(a).map((l) => l.label), ["open plan", "open mockup", "open preview", "open stage"]);
  assert.deepEqual(askKeyAction({ ...a, options: [] }, "p", null, NOW), { type: "open", target: "/p/plans/x.html" });
  assert.equal(askKeyAction(ASK("a-2"), "p", null, NOW), null, "nothing to open");
});

test("buildEpics: an epic with something to look at says 'Needs a look' in its words line", () => {
  const asks = openAsks([ASK("a-1", { today: "preview https://x.pages.dev/" }), ASK("a-2", { epic: "o/r#2" })], NOW);
  const es = buildEpics({ asks, groups: [], stuck: [], closed: [], titles: {}, areas: {}, origin: {}, statuses: {}, nowMs: NOW });
  assert.match(es.find((e) => e.ref === "o/r#1").line, /^Needs a look/); assert.doesNotMatch(es.find((e) => e.ref === "o/r#2").line, /Needs a look/);
});

test("sentReceipt: what, whom, when and the state", () => {
  const [a] = answeredAsks([ASK("a-1"), ANS("a-1", 3, { text: "1a: Hero (Recommended)\n2 own answer: use a strip", note: "ads" }), { ts: iso(2), event: "delivered", id: "a-1" }], NOW, true);
  const r = sentReceipt(a);
  assert.equal(r.what, "1a: Hero (Recommended) · 2 own answer: use a strip · note: ads"); assert.equal(r.to, "lead-r-1 · o/r#1"); assert.match(r.when, /^\d\d:\d\d$/); assert.equal(r.state, "sent ✓ · received ✓ · done –");
});

test("flatRows: one collapsed 'Sent · N' row at the bottom; open, its asks follow; none, no row", () => {
  const ls = [ASK("a-1"), ANS("a-1", 3), ASK("a-2", { epic: "o/r#2", card: "o/r#2" }), ANS("a-2", 4), { ts: iso(3), event: "applied", id: "a-2" }].map((l) => JSON.stringify(l)).join("\n");
  const vm = viewModel({ terminals: [], asksText: ls, nowMs: NOW });
  assert.equal(vm.sent.length, 2);
  const closed = flatRows(vm, {}), open = flatRows(vm, { sentOpen: true });
  assert.deepEqual(closed.filter((r) => r.section === "sent" || r.section === "sentfold").map((r) => r.section), ["sentfold"]); assert.equal(closed.find((r) => r.section === "sentfold").row.label, "Sent · 2");
  assert.deepEqual(open.filter((r) => /sent/.test(r.section)).map((r) => r.section), ["sentfold", "sent", "sent"]);
  assert.equal(flatRows(viewModel({ terminals: [], asksText: JSON.stringify(ASK("a-3")), nowMs: NOW }), {}).some((r) => /sent/.test(r.section)), false);
});

test("waitingCount and inboxLabel: the toggle's number is the open asks of the same fold; sent asks do not count; a reply counts again", () => {
  const t = (...ls) => ls.map((l) => JSON.stringify(l)).join("\n"), closed = JSON.stringify({ closed: ["o/r#77"] });
  assert.equal(waitingCount(t(), closed, NOW), 0); assert.equal(waitingCount(null, null, NOW), 0);
  assert.equal(waitingCount(t(ASK("a-1"), ASK("a-2", { epic: "o/r#2" }), ASK("a-3", { epic: "o/r#3", card: "o/r#77" })), closed, NOW), 2, "an ask of a closed card is not open");
  assert.equal(waitingCount(t(ASK("a-1"), ASK("a-2", { epic: "o/r#2" }), ANS("a-1", 3)), closed, NOW), 1, "one answered: 2 -> 1");
  assert.equal(waitingCount(t(ASK("a-1"), ANS("a-1", 3), MSG("a-1", 1, "agent", "no")), closed, NOW), 1, "a reply counts again");
  assert.equal(inboxLabel(0), "Inbox"); assert.equal(inboxLabel(7), "Inbox 7"); assert.equal(inboxLabel(undefined), "Inbox");
});
