// Owner feedback round 1 on the Inbox by epic (kuchbhi#1115): the list window, one question at a time, links, focus, marks then submit. Synthetic data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listWindow, partStep, linkSegments, linkTarget, focusStep, answerLine, submitAnswer, ASK_H, clampAskH, resizeAskH, dragAskH, storedAskH, partNotes, askKeyAction, bottomPlan, openAsks, parseJsonl } from "./lib.js";

test("listWindow: the selected row sits a third of the way down while the list scrolls past it", () => {
  const w = (n, sel) => listWindow(n, sel, 9);
  assert.equal(w(30, 0), 0); assert.equal(w(30, 2), 0); assert.equal(w(30, 3), 0, "inside the first rows the selection moves, the list does not");
  assert.equal(w(30, 10), 7, "past the anchor the list moves: the row stays at the anchor"); assert.equal(10 - w(30, 10), 3);
  assert.equal(w(30, 29), 21, "at the bottom the list stops and the selection moves down"); assert.equal(w(30, 25), 21);
  assert.equal(w(5, 4), 0, "a list that fits is not scrolled"); assert.equal(w(0, 0), 0);
});

test("partStep: left and right move between the parts, then step to the next ask", () => {
  const ask = { options: [{ q: 1, key: "a" }, { q: 2, key: "a" }, { q: 3, key: "a" }] };
  assert.deepEqual(partStep(ask, 1, "right"), { q: 2 }); assert.deepEqual(partStep(ask, 2, "left"), { q: 1 });
  assert.deepEqual(partStep(ask, 3, "right"), { step: "right" }); assert.deepEqual(partStep(ask, 1, "left"), { step: "left" });
  assert.deepEqual(partStep({ options: [{ q: 1, key: "a" }] }, 1, "right"), { step: "right" });
});

test("linkSegments: URLs, owner/repo#N, #N in the epic's repo and absolute paths are links; the rest is text", () => {
  const s = linkSegments("See https://x.test/a?b=1 and o/r#12, then #7 or /Users/v/p/post.md.", "o/r");
  assert.deepEqual(s.map((x) => [x.text, x.link ?? null]), [["See ", null], ["https://x.test/a?b=1", "url"], [" and ", null], ["o/r#12", "issue"], [", then ", null], ["#7", "issue"], [" or ", null], ["/Users/v/p/post.md", "path"], [".", null]]);
  assert.deepEqual(linkSegments("plain words", "o/r"), [{ text: "plain words" }]);
  assert.deepEqual(linkSegments("", "o/r"), []);
});
test("linkTarget: what a click opens", () => {
  assert.deepEqual(linkTarget({ text: "https://x.test/a", link: "url" }, "o/r"), { open: "https://x.test/a" });
  assert.deepEqual(linkTarget({ text: "o/r#12", link: "issue" }, "o/r"), { open: "https://github.com/o/r/issues/12" });
  assert.deepEqual(linkTarget({ text: "#7", link: "issue" }, "q/s"), { open: "https://github.com/q/s/issues/7" });
  assert.deepEqual(linkTarget({ text: "/Users/v/p/post.md", link: "path" }, "o/r"), { open: "/Users/v/p/post.md" });
  assert.equal(linkTarget({ text: "words" }, "o/r"), null);
});

test("focusStep: the Inbox pane takes the keyboard once when its tab becomes active, never from the agent pane", () => {
  assert.deepEqual(focusStep({ inTab: true, was: false, focusedPane: "pX", own: "p1", bottom: "p2" }), { focus: "p1", was: true });
  assert.deepEqual(focusStep({ inTab: true, was: true, focusedPane: "pX", own: "p1", bottom: "p2" }), { focus: null, was: true }, "once per activation");
  assert.deepEqual(focusStep({ inTab: true, was: false, focusedPane: "p2", own: "p1", bottom: "p2" }), { focus: null, was: true }, "the owner is in the agent pane");
  assert.deepEqual(focusStep({ inTab: true, was: false, focusedPane: "p1", own: "p1", bottom: null }), { focus: null, was: true });
  assert.deepEqual(focusStep({ inTab: false, was: true, focusedPane: "pX", own: "p1", bottom: null }), { focus: null, was: false });
});

const A = () => openAsks(parseJsonl(JSON.stringify({ ts: "2030-01-01T00:00:00Z", event: "ask", id: "a-1", card: "o/r#1", epic: "o/r#1", from: "lead", question: "Q", title: "T", body: "Q\n\n1. A?\n   a) x (Recommended) => x\n   b) y => y\n\n2. B?\n   a) x (Recommended) => x\n   b) y => y\n\n3. C?\n   a) x (Recommended) => x\n   b) y => y\n",
  options: [1, 2, 3].flatMap((q) => [{ q, key: "a", label: "x (Recommended)" }, { q, key: "b", label: "y" }]) })), Date.parse("2030-01-01T01:00:00Z"))[0];
test("answerLine shows the marks so far; unmarked parts show a dash", () => {
  assert.equal(answerLine(A(), {}), "1 – · 2 – · 3 –");
  assert.equal(answerLine(A(), { 1: "1a: x", 3: "3b: y" }), "1a · 2 – · 3b");
});
test("submitAnswer: Enter needs every part marked; ctrl-Enter takes the recommended for the rest", () => {
  const a = A(), p2 = { 1: "1a: x", 2: "2b: y" }, all = { ...p2, 3: "3a: x" };
  assert.deepEqual(submitAnswer(a, null, 0, p2, false), { type: "incomplete", marked: 2, total: 3 });
  assert.equal(submitAnswer(a, null, 0, all, false).key, "1a,2b,3a");
  assert.equal(submitAnswer(a, null, 0, p2, true).key, "1a,2b,3a");
  assert.equal(submitAnswer(a, null, 0, {}, true).key, "1a,2a,3a");
});

test("the agent pane opens on the right", () => {
  const vm = { desk: { name: "d", address: "t3", state: "idle" }, groups: [], sides: [] };
  const p = bottomPlan({ pane: { kind: "desk" }, vm, pinned: null, last: null, shown: null, bottom: null, own: "p1", on: true });
  assert.equal(p.steps.find((s) => s[0] === "pane.split")[1].direction, "right");
});

test("a note on a part with no option picked is that part's own answer: `2 note` on the line, key other with one line per part", () => {
  const a = A(), picks = { 1: "1a: x", 2: "2note: use a strip", 3: "3b: y" };
  assert.equal(answerLine(a, picks), "1a · 2 note · 3b");
  const r = submitAnswer(a, null, 0, picks, false);
  assert.equal(r.key, "other"); assert.equal(r.text, "1a: x (Recommended)\n2 own answer: use a strip\n3b: y");
});
test("no o key: it does nothing on an ask", () => {
  assert.equal(askKeyAction({ kind: "decide", options: [{ q: 1, key: "a", label: "A" }], targets: [] }, "o", null, 0), null);
});
test("partNotes: one note per part, in order, labelled by the part; none when empty", () => {
  assert.equal(partNotes(A(), { 3: "ask Hindi later", 1: "ok" }), "1: ok · 3: ask Hindi later");
  assert.equal(partNotes(A(), {}), ""); assert.equal(partNotes(A(), { 2: "  " }), "");
});

test("the question box size: default, clamped, [ shrinks and ] grows by a step, a drag follows the pointer", () => {
  assert.equal(ASK_H.def, 360);
  assert.equal(clampAskH(10), ASK_H.min); assert.equal(clampAskH(5000), ASK_H.max); assert.equal(clampAskH(333.7), 334); assert.equal(clampAskH("x"), ASK_H.def);
  assert.equal(resizeAskH(360, "]"), 360 + ASK_H.step); assert.equal(resizeAskH(360, "["), 360 - ASK_H.step);
  assert.equal(resizeAskH(ASK_H.min, "["), ASK_H.min); assert.equal(resizeAskH(ASK_H.max, "]"), ASK_H.max); assert.equal(resizeAskH(360, "x"), 360);
  assert.equal(dragAskH(360, 500, 560), 420); assert.equal(dragAskH(360, 500, 100), ASK_H.min);
});
test("storedAskH: the remembered size comes back clamped; nothing or garbage is the default", () => {
  assert.equal(storedAskH("480"), 480); assert.equal(storedAskH(null), ASK_H.def); assert.equal(storedAskH("abc"), ASK_H.def); assert.equal(storedAskH("99999"), ASK_H.max);
});
