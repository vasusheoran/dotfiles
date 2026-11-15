// kuchbhi#1117: explain an ask visually. The events (visual_requested, visual_ready, replaced, replace_failed) are written by claude-plugins
// ask.sh and documented at the top of its asks.jq. All data here is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsks, askKeyAction, askView, askGroups, isAskKey, visualArgv, replaceArgv, viewModel, footerHint, inboxBatches, enterAction } from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const iso = (min) => new Date(Date.parse("2030-01-10T10:00:00Z") + min * 60_000).toISOString();
const opts = [{ q: 1, key: "a", label: "Redis (Recommended)", then: "Redis is wired in" }, { q: 1, key: "b", label: "Memcached", then: "The card switches" }];
const ask = (o = {}) => ({ ts: iso(0), event: "ask", id: "a-1", card: "o/r#5", epic: "o/r#1", from: "worker", terminal: "card-r-5", question: "Which cache?", body: "Which cache?", options: opts, kind: "decide",
  title: "Pick the cache", today: "In memory.", after: "In Redis.", checked: "Redis is deployed.", why_you: "It adds a service.", batch_key: "decide:o/r#1", ...o });
const ev = (event, o = {}) => ({ ts: iso(5), event, id: "a-1", ...o });
const REQ = ev("visual_requested"), READY = ev("visual_ready", { ts: iso(9), url: "http://127.0.0.1:7777/p/abc" });
const first = (lines) => openAsks(lines, NOW)[0];
const rawT = (name) => ({ address: `t-${name}`, name, state: "live", status: { state: "idle" }, labels: [] });
const vm = (lines, terminals) => viewModel({ terminals, asksText: lines.map((l) => JSON.stringify(l)).join("\n"), nowMs: NOW });

test("an ask with no visual events has no picture; a request reads coming; a ready picture carries its url", () => {
  assert.deepEqual([first([ask()]).visual, first([ask()]).visualUrl], ["none", null]);
  assert.deepEqual([first([ask(), REQ]).visual, first([ask(), REQ]).visualUrl], ["coming", null]);
  assert.deepEqual([first([ask(), REQ, ev("message_delivered")]).visual], ["coming"]);
  assert.deepEqual([first([ask(), REQ, READY]).visual, first([ask(), REQ, READY]).visualUrl], ["ready", "http://127.0.0.1:7777/p/abc"]);
  assert.equal(first([ask(), READY]).visual, "none", "a picture nobody asked for does not count");
});

test("v on an ask with no picture requests one; on a ready picture it opens the url; plan moves to p", () => {
  assert.deepEqual(askKeyAction(first([ask()]), "v", null, NOW), { type: "visual" });
  assert.deepEqual(askKeyAction(first([ask(), REQ]), "v", null, NOW), { type: "visual" }); // asks again: delivery is re-tried, no second request
  assert.deepEqual(askKeyAction(first([ask(), REQ, READY]), "v", null, NOW), { type: "open", target: "http://127.0.0.1:7777/p/abc" });
  assert.deepEqual(askKeyAction(first([ask({ plan: "https://p.test/x" })]), "p", null, NOW), { type: "open", target: "https://p.test/x" });
  assert.ok(isAskKey(first([ask()]), "v", null));
});

test("v needs no second key, even on a landing ask: it answers nothing", () => {
  const m = first([ask({ kind: "merge", options: [{ q: 1, key: "a", label: "Go (Recommended)", then: "t" }, { q: 1, key: "b", label: "Hold", then: "t" }] })]);
  assert.deepEqual(askKeyAction(m, "v", null, NOW), { type: "visual" });
});

test("the row says picture coming, then open picture; the epic line counts pictures coming", () => {
  assert.equal(askView(first([ask()]), {}, null).visual, null);
  assert.deepEqual(askView(first([ask(), REQ]), {}, null).visual, { label: "picture coming", ready: false });
  assert.deepEqual(askView(first([ask(), REQ, READY]), {}, null).visual, { label: "open picture", ready: true });
  const g = askGroups(openAsks([ask(), REQ, ask({ id: "a-2", card: "o/r#6" })], NOW));
  assert.match(g[0].line, /1 picture coming/);
  assert.doesNotMatch(askGroups(openAsks([ask()], NOW))[0].line, /picture/);
});

test("a ready picture moves its ask to the top of its batch", () => {
  const lines = [ask({ id: "a-1", card: "o/r#5", ts: iso(0) }), ask({ id: "a-2", card: "o/r#6", ts: iso(1) }), ev("visual_requested", { id: "a-2" }), ev("visual_ready", { id: "a-2", ts: iso(9), url: "http://x.test/p" })];
  assert.deepEqual(askGroups(openAsks(lines, NOW))[0].asks.map((a) => a.id), ["a-2", "a-1"]);
  assert.deepEqual(askGroups(openAsks(lines.slice(0, 2), NOW))[0].asks.map((a) => a.id), ["a-1", "a-2"], "without a picture the order is the old one");
});

test("an answered ask drops its picture with it", () => {
  assert.equal(openAsks([ask(), REQ, READY, ev("answered", { text: "x" })], NOW).length, 0);
});

test("asker gone: the panel says so and offers r; nothing is started by it", () => {
  const live = vm([ask(), REQ], [rawT("card-r-5")]).asks[0], gone = vm([ask(), REQ], [rawT("other")]).asks[0];
  assert.equal(live.askerGone, false);
  assert.equal(gone.askerGone, true);
  assert.equal(askView(live, {}, null).gone, false);
  assert.equal(askView(gone, {}, null).gone, true);
  assert.deepEqual(askKeyAction(gone, "r", null, NOW), { type: "replace" });
  assert.equal(askKeyAction(live, "r", null, NOW), null, "r does nothing while the asker is alive");
  assert.ok(isAskKey(gone, "r", null));
  assert.equal(isAskKey(live, "r", null), false);
  const withR = { ...gone, options: [{ q: 1, key: "r", label: "Redis", then: "t" }] }; // an option letter r still wins over the replace key
  assert.equal(askKeyAction(withR, "r", null, NOW).type, "post");
});

test("an ask with no terminal on file is never called gone; a replaced ask is not offered again", () => {
  assert.equal(vm([ask({ terminal: null })], []).asks[0].askerGone, false);
  assert.equal(vm([ask(), ev("replaced")], []).asks[0].askerGone, false);
});

test("the argv for the panel's keys goes through `work ask`", () => {
  assert.deepEqual(visualArgv(first([ask()])), ["ask", "visual", "a-1"]);
  assert.deepEqual(replaceArgv(first([ask()])), ["ask", "replace", "a-1"]);
  assert.deepEqual(visualArgv({ id: "x", url: "https://example.test/o/r/issues/3#issuecomment-77" }), ["ask", "visual", "legacy-77"]);
});

test("the footer hint names v", () => {
  assert.match(footerHint("batch"), /v picture/);
});

test("in the inbox a ready picture goes to the top of its batch, and a coming one is counted", () => {
  const lines = [ask({ id: "a-1", card: "o/r#5", ts: iso(0) }), ask({ id: "a-2", card: "o/r#6", ts: iso(1) }), ask({ id: "a-3", card: "o/r#7", ts: iso(2) }),
    ev("visual_requested", { id: "a-2" }), ev("visual_ready", { id: "a-2", ts: iso(9), url: "http://x.test/p" }), ev("visual_requested", { id: "a-3" })];
  const [b] = inboxBatches(openAsks(lines, NOW));
  assert.deepEqual(b.asks.map((a) => a.id), ["a-2", "a-1", "a-3"]);
  assert.equal(b.coming, 1);
});

test("Enter opens a ready picture while the picture row has focus; with focus on the options it accepts the recommended option", () => {
  const a = first([ask(), REQ, READY]);
  assert.deepEqual(enterAction(a, null, NOW, true), { type: "open", target: "http://127.0.0.1:7777/p/abc" });
  assert.deepEqual(enterAction(a, null, NOW, false), { type: "post", text: "1a: Redis (Recommended)", key: "a" });
  const b = first([ask(), REQ]);
  assert.deepEqual(enterAction(b, null, NOW, true), { type: "post", text: "1a: Redis (Recommended)", key: "a" }, "no picture, nothing to open");
});

test("r is offered for a gone asker whose picture is not ready, asked for or not (ask.sh replace records the request); a failed replace gives the claim back", () => {
  const none = vm([ask()], [rawT("other")]).asks[0], coming = vm([ask(), REQ], [rawT("other")]).asks[0], ready = vm([ask(), REQ, READY], [rawT("other")]).asks[0];
  assert.deepEqual([none, coming, ready].map((a) => a.replaceable), [true, true, false]);
  assert.deepEqual(askKeyAction(none, "r", null, NOW), { type: "replace" }, "no request yet: the replacement records it");
  assert.equal(isAskKey(none, "r", null), true);
  assert.equal(askView(none, {}, null).gone, true, "the panel still says the asker is gone");
  assert.equal(askView(coming, {}, null).replaceable, true);
  assert.equal(vm([ask(), REQ, ev("replaced"), ev("replace_failed")], [rawT("other")]).asks[0].replaceable, true);
  assert.equal(vm([ask(), REQ, ev("replaced")], [rawT("other")]).asks[0].replaceable, false);
});
