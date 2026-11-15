// The Inbox as a main tab (kuchbhi#1115, spec inbox-tab-spec.md): opening the tab, the pane below that follows the highlight or is pinned,
// the origin block, the receipt line, v on a dead agent, the phone layout. Pure logic; the drawn states are in render.test.js. All data is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboxTabSteps, inTab, liveAgents, bottomPlan, attachArgv, loopArgv, paneFile, pickerStep, originView, originKey, goStep, lanesLine, phoneBar, askKeyAction, askView, isAskKey, viewModel,
} from "./lib.js";

const NOW = Date.parse("2030-01-10T12:00:00Z");
const iso = (ago) => new Date(NOW - ago).toISOString();
const term = (o) => ({ address: "t1", name: "card-r-3", state: "live", status: { state: "working" }, labels: ["card=o/r#3", "role=worker", "epic=o/r#1"], ...o });
const TERMS = [term({}), term({ address: "t2", name: "lead-r-1", status: { state: "idle" }, labels: ["role=lead", "epic=o/r#1"] }), term({ address: "t3", name: "desk-r", status: { state: "idle" }, labels: ["role=desk"] })];
const ask = (id, o = {}) => ({ ts: iso(60_000), event: "ask", id, card: `o/r#${id.replace(/\D/g, "")}`, epic: "o/r#1", from: "worker", kind: "decide", title: `T ${id}`, question: "Q", body: "", terminal: "card-r-3",
  options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }, { q: 1, key: "b", label: "B", then: "b" }], ...o });
const vmOf = (asks, terminals = TERMS, closed) => viewModel({ terminals, asksText: asks.map((a) => JSON.stringify(a)).join("\n"), closedJson: closed, nowMs: NOW });
const paneOf = (vm, i = 0) => { const b = vm.batches[i]; return { kind: "ask", ask: b.asks[0], batch: b, thread: b.asks[0].id }; };

// ---- 1. opening the tab
test("open: with no Inbox tab, one tab.new in the selected space, its props saying it is the Inbox", () => {
  assert.deepEqual(inboxTabSteps({ panes: [{ pane: "p9", tab: "tab-a", terminal: "t1" }] }), [["tab.new", { name: "Inbox", mod: "agents-view", props: { inbox: true } }]]);
});
test("open: a tab that already holds the mod is selected, never opened twice", () => {
  assert.deepEqual(inboxTabSteps({ panes: [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p2", tab: "tab-i", terminal: "t1" }] }), [["tab.select", { id: "tab-i" }]]);
});
test("inTab: decided by the props this copy was opened with, not by the tab's name or by what has the focus", () => {
  const panes = [{ pane: "p1", tab: "tab-i", mod: "agents-view" }, { pane: "p9", tab: "tab-a", terminal: "t1" }];
  assert.deepEqual(inTab({ panes, focused: { tab: "tab-i" }, props: { inbox: true } }), { tab: "tab-i", pane: "p1" });
  assert.deepEqual(inTab({ panes, focused: { tab: "tab-a" }, props: { inbox: true } }), { tab: "tab-i", pane: "p1" }, "still the Inbox while another tab has the focus");
  assert.deepEqual(inTab({ panes, focused: null, props: { inbox: true } }), { tab: "tab-i", pane: "p1" });
  assert.equal(inTab({ panes, focused: { tab: "tab-i" }, props: {} }), null, "the side panel has no inbox prop");
  assert.equal(inTab({ panes, focused: { tab: "tab-i" }, props: undefined }), null);
  assert.equal(inTab({ panes: [], focused: null, props: { inbox: true } }), null, "no mod pane to split from");
});

// ---- 2. the pane below follows the highlight
test("liveAgents: the desk, then leads, then workers, as the picker lists them", () => {
  assert.deepEqual(liveAgents(vmOf([])).map((a) => a.name), ["desk-r", "lead-r-1", "card-r-3"]);
});
test("follow: the highlighted ask's own terminal is shown, with its status and the follow hints", () => {
  const vm = vmOf([ask("a-3")]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: null, shown: null, bottom: "p2", own: "p1", on: true });
  assert.equal(p.mode, "follow"); assert.equal(p.address, "t1");
  assert.deepEqual(p.steps, [["pane.close", { pane: "p2" }], ["write", { file: FILE, text: "t1" }], ["pane.split", { pane: "p1", direction: "right", argv: loopArgv(FILE) }]], "a pane we did not make is replaced once");
  assert.equal(p.key, "t1:attach");
  assert.equal(p.head, "card-r-3 · working"); assert.equal(p.hint, "ctrl-b t closes · g open its tab"); assert.equal(p.dim, false);
});
test("follow: no second terminal.show while the same agent is shown", () => {
  const vm = vmOf([ask("a-3")]);
  assert.deepEqual(bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: null, shown: "t1:attach", bottom: "p2", own: "p1", on: true }).steps, []);
});
test("follow: moving to an ask of another agent shows that one", () => {
  const vm = vmOf([ask("a-3", { batch_key: "k1" }), ask("a-4", { terminal: "lead-r-1", card: "o/r#4", batch_key: "k2" })]);
  const p = bottomPlan({ pane: paneOf(vm, 1), vm, pinned: null, last: { address: "t1", name: "card-r-3" }, shown: "t1:attach", bottom: "p2", own: "p1", on: true });
  assert.deepEqual(p.steps, [["write", { file: FILE, text: "t2" }]]); assert.equal(p.head, "lead-r-1 · idle");
});
test("follow: the desk row shows the desk", () => {
  const vm = vmOf([]);
  const p = bottomPlan({ pane: { kind: "desk", thread: "desk" }, vm, pinned: null, last: null, shown: null, bottom: "p2", own: "p1", on: true });
  assert.equal(p.address, "t3"); assert.equal(p.head, "desk-r · idle");
});
test("follow: an ask with no agent behind it keeps the last terminal, dims, and says why", () => {
  const vm = vmOf([ask("a-4", { kind: "you", terminal: undefined })]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: { address: "t1", name: "card-r-3" }, shown: "t1:attach", bottom: "p2", own: "p1", on: true });
  assert.equal(p.mode, "none"); assert.equal(p.dim, true); assert.deepEqual(p.steps, []); assert.equal(p.address, "t1");
  assert.equal(p.head, "no agent behind this ask · showing card-r-3");
});
test("follow: a gone agent keeps the last terminal, dims, and says r replaces it", () => {
  const vm = vmOf([ask("a-5", { terminal: "card-r-9" })]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: { address: "t1", name: "card-r-3" }, shown: "t1:attach", bottom: "p2", own: "p1", on: true });
  assert.equal(p.mode, "gone"); assert.equal(p.dim, true); assert.deepEqual(p.steps, []);
  assert.equal(p.head, "card-r-9 is gone · r replace");
});
test("follow: with nothing shown before and no agent behind the ask, it falls back to the desk", () => {
  const vm = vmOf([ask("a-4", { kind: "you", terminal: undefined })]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: null, shown: null, bottom: "p2", own: "p1", on: true });
  assert.equal(p.address, "t3"); assert.equal(p.head, "no agent behind this ask · showing desk-r");
});
test("pinned: the picked agent stays while the highlight moves, with the pinned header and the way back", () => {
  const vm = vmOf([ask("a-3")]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: "t2", last: null, shown: "t1:attach", bottom: "p2", own: "p1", on: true });
  assert.equal(p.mode, "pinned"); assert.deepEqual(p.steps[0], ["write", { file: FILE, text: "t2" }]);
  assert.equal(p.head, "lead-r-1 · idle · pinned"); assert.equal(p.hint, "ctrl-b t closes · esc follow the highlight · s switch");
});
test("pinned: a pinned agent that has gone away is dropped and the pane follows again", () => {
  const vm = vmOf([ask("a-3")]);
  const p = bottomPlan({ pane: paneOf(vm), vm, pinned: "t-dead", last: null, shown: null, bottom: "p2", own: "p1", on: true });
  assert.equal(p.mode, "follow"); assert.equal(p.unpin, true);
});
test("no lower pane yet: the first attach only splits (nothing to close); with no mod pane to split from, nothing runs", () => {
  const vm = vmOf([ask("a-3")]);
  assert.deepEqual(bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: null, shown: null, bottom: null, own: "p1", on: true }).steps, [["write", { file: FILE, text: "t1" }], ["pane.split", { pane: "p1", direction: "right", argv: loopArgv(FILE) }]]);
  assert.deepEqual(bottomPlan({ pane: paneOf(vm), vm, pinned: null, last: null, shown: null, bottom: null, own: null, on: true }).steps, []);
});
test("picker: j k move within the list, Enter picks the index, esc cancels, the cursor stays inside", () => {
  assert.deepEqual(pickerStep({ cur: 0 }, "down", 3), { type: "move", cur: 1 });
  assert.deepEqual(pickerStep({ cur: 2 }, "j", 3), { type: "move", cur: 2 });
  assert.deepEqual(pickerStep({ cur: 0 }, "up", 3), { type: "move", cur: 0 });
  assert.deepEqual(pickerStep({ cur: 1 }, "enter", 3), { type: "pick", index: 1 });
  assert.deepEqual(pickerStep({ cur: 1 }, "escape", 3), { type: "cancel" });
  assert.deepEqual(pickerStep({ cur: 1 }, "x", 3), { type: "move", cur: 1 });
});

// ---- 5. origin
const closed = (origin, titles = { "o/r#1": "Epic 14: Agent tooling" }) => JSON.stringify({ at: iso(0), closed: [], titles, origin });
test("origin: your card with the epic title, the summary line, the phase trail and the keys", () => {
  const vm = vmOf([ask("a-3", { plan: "https://x.test/mockup.html" })], TERMS, closed({ "o/r#3": { by: "you", summary: "inbox slice B, filed by you", trail: ["Validate", "Plan", "PR #67"] } }));
  const o = originView(vm.asks[0], vm, true);
  assert.deepEqual(o.why, { tag: "your card", epic: "Epic 14: Agent tooling", line: "inbox slice B, filed by you" });
  assert.equal(o.what, "Validate → Plan → PR #67");
  assert.deepEqual(o.how.map((h) => h.key), ["p", "c", "g"]);
});
test("origin: an agent-filed card is marked, and a PR ask offers the diff", () => {
  const vm = vmOf([ask("a-3", { kind: "merge", target: { repo: "o/r", pr: 5, head: "a".repeat(40) } })], TERMS, closed({ "o/r#3": { by: "agent", summary: "three refusal hints print a failing command", trail: ["Validate", "Tests"] } }));
  const o = originView(vm.asks[0], vm, true);
  assert.equal(o.why.tag, "agent-filed"); assert.deepEqual(o.how.map((h) => h.key), ["d", "c", "g"]);
});
test("origin: no live agent behind the ask: no g", () => {
  const vm = vmOf([ask("a-3")], TERMS, closed({ "o/r#3": { by: "you", summary: "s", trail: [] } }));
  assert.deepEqual(originView(vm.asks[0], vm, false).how.map((h) => h.key), ["c"]);
});
test("origin: an old card with no data shows only the epic title: nothing invented", () => {
  const vm = vmOf([ask("a-3")], TERMS, closed({}));
  const o = originView(vm.asks[0], vm, true);
  assert.deepEqual(o, { why: { tag: null, epic: "Epic 14: Agent tooling", line: "" }, what: "", how: [] });
});
test("origin: no closed-cards file at all: the epic's short ref stands in for the title", () => {
  const vm = vmOf([ask("a-3")]);
  assert.equal(originView(vm.asks[0], vm, true).why.epic, "r#1");
});
test("origin: a card with data but an empty trail draws no What line", () => {
  const vm = vmOf([ask("a-3")], TERMS, closed({ "o/r#3": { by: "you", summary: "", trail: [] } }));
  const o = originView(vm.asks[0], vm, false); assert.equal(o.what, ""); assert.equal(o.why.line, "");
});
test("originKey: c opens the card, d the PR files, g the agent; a key that is an option letter stays the option's", () => {
  const vm = vmOf([ask("a-3", { kind: "merge", target: { repo: "o/r", pr: 5, head: "a".repeat(40) } })]), a = vm.asks[0];
  assert.deepEqual(originKey(a, "c", true), { type: "open", target: "https://github.com/o/r/issues/3" });
  assert.deepEqual(originKey(a, "d", true), { type: "open", target: "https://github.com/o/r/pull/5/files" });
  assert.deepEqual(originKey(a, "g", true), { type: "agent" });
  assert.equal(originKey(a, "g", false), null);
  assert.equal(originKey({ ...a, target: null }, "d", true), null);
  assert.equal(originKey({ ...a, options: [{ q: 1, key: "c", label: "C" }] }, "c", true), null);
  assert.equal(originKey(a, "z", true), null);
});
test("isAskKey: c, d and g are taken only when they do something", () => {
  const vm = vmOf([ask("a-3")]), a = vm.asks[0];
  assert.equal(isAskKey(a, "c", null), true); assert.equal(isAskKey(a, "d", null), false);
});

// ---- 4. v on a dead agent
test("v on a gone agent: the panel's own answer, not a request that cannot be delivered; r works at once", () => {
  const vm = vmOf([ask("a-5", { terminal: "card-r-9" })]), a = vm.asks[0];
  assert.equal(a.askerGone, true); assert.equal(a.replaceable, true); // replaceable without a request: ask.sh replace records it
  assert.deepEqual(askKeyAction(a, "v", null, NOW), { type: "gone" });
  assert.deepEqual(askKeyAction(a, "r", null, NOW), { type: "replace" });
  assert.equal(isAskKey(a, "r", null), true);
});
test("v on a live agent still asks for the picture; r does nothing", () => {
  const a = vmOf([ask("a-3")]).asks[0];
  assert.deepEqual(askKeyAction(a, "v", null, NOW), { type: "visual" }); assert.equal(askKeyAction(a, "r", null, NOW), null);
});
test("v on a gone agent whose picture is ready still opens it", () => {
  const a = { ...vmOf([ask("a-5", { terminal: "card-r-9" })]).asks[0], visual: "ready", visualUrl: "http://x/p" };
  assert.deepEqual(askKeyAction(a, "v", null, NOW), { type: "open", target: "http://x/p" });
});

// ---- 3. the pressed option flashes
test("askView: the option just pressed reads as flashed", () => {
  const a = vmOf([ask("a-3")]).asks[0];
  const v = askView(a, {}, null, { id: "a-3", key: "b" });
  assert.deepEqual(v.questions[0].options.map((o) => o.flash), [false, true]);
  assert.deepEqual(askView(a, {}, null, null).questions[0].options.map((o) => o.flash), [false, false]);
});

// ---- 6. phone
test("goStep: agent.focus on the Mac, terminal.peek on the phone", () => {
  assert.deepEqual(goStep("t1", false), ["agent.focus", { terminal: "t1" }]);
  assert.deepEqual(goStep("t1", true), ["terminal.peek", { terminal: "t1" }]);
});
test("lanesLine: the four lanes on one line, zeros included", () => {
  const lanes = [{ lane: "key", count: 3 }, { lane: "look", count: 2 }, { lane: "hands", count: 1 }, { lane: "groom", count: 7 }];
  assert.equal(lanesLine(lanes), "One key 3 · Look 2 · Hands 1 · Not ready 7");
  assert.equal(lanesLine(lanes.map((l) => ({ ...l, count: 0 }))), "One key 0 · Look 0 · Hands 0 · Not ready 0");
});
test("phoneBar: Picture, Note, Open; Open only with an agent behind the ask", () => {
  assert.deepEqual(phoneBar(true).map((b) => [b.key, b.label]), [["v", "Picture"], ["n", "Note"], ["B", "Board"], ["g", "Open"]]);
  assert.deepEqual(phoneBar(false).map((b) => b.key), ["v", "n", "B"]);
});

// ---- the lower pane: one pane, kept; what is attached in it is swapped
const base = (vm, o = {}) => ({ pane: paneOf(vm), vm, pinned: null, last: null, bottom: "p2", bottomTerminal: "t9", own: "p1", on: true, ...o });
const FILE = paneFile("p1");
test("attach: the pane runs a small loop that attaches to the address in a file, never a read loop", () => {
  assert.equal(FILE, "/tmp/herdr-agents-view-p1.addr");
  const a = loopArgv(FILE).join(" ");
  assert.match(a, /hc attach/); assert.match(a, /herdr-agents-view-p1\.addr/); assert.doesNotMatch(a, /hc read/);
  assert.deepEqual(attachArgv("t7r"), ["hc", "attach", "t7r"]);
});
test("open: the address is written first, then one pane is split below the mod running the loop", () => {
  const vm = vmOf([ask("a-3")]);
  assert.deepEqual(bottomPlan(base(vm, { shown: "off", bottom: null, bottomTerminal: null })).steps,
    [["write", { file: FILE, text: "t1" }], ["pane.split", { pane: "p1", direction: "right", argv: loopArgv(FILE) }]]);
});
test("another agent: the pane is kept (no close, no split); the new address is written and the attach in it is detached so the loop attaches the new one", () => {
  const vm = vmOf([ask("a-3", { batch_key: "k1" }), ask("a-4", { terminal: "lead-r-1", card: "o/r#4", batch_key: "k2" })]);
  const p = bottomPlan(base(vm, { pane: paneOf(vm, 1), shown: "t1:attach" }));
  assert.deepEqual(p.steps, [["write", { file: FILE, text: "t2" }], ["detach", { terminal: "t9" }]]);
  assert.ok(!p.steps.some((s) => s[0] === "pane.close" || s[0] === "pane.split"), "the pane keeps its size");
  assert.deepEqual(bottomPlan(base(vm, { shown: "t1:attach" })).steps, [], "the same agent changes nothing");
});
test("another agent with no known terminal in the pane yet: the address is written and nothing is detached", () => {
  const vm = vmOf([ask("a-4", { terminal: "lead-r-1", card: "o/r#4" })]);
  assert.deepEqual(bottomPlan(base(vm, { shown: "t1:attach", bottomTerminal: null })).steps, [["write", { file: FILE, text: "t2" }]]);
});
test("an address with shell characters starts nothing", () => {
  const vm = vmOf([ask("a-3")], [term({ address: "t1;boom" }), TERMS[2]]);
  assert.deepEqual(bottomPlan(base(vm, { shown: null, bottom: null })).steps, []);
});
test("toggle: off, there is no pane and nothing is split; the header says how to open it", () => {
  const vm = vmOf([ask("a-3")]), p = bottomPlan(base(vm, { on: false, bottom: null, shown: null }));
  assert.deepEqual(p.steps, []); assert.equal(p.mode, "off"); assert.equal(p.head, "agent pane closed"); assert.match(p.hint, /^t opens it/);
});
test("toggle: turning it off closes the pane once", () => {
  const vm = vmOf([ask("a-3")]);
  assert.deepEqual(bottomPlan(base(vm, { shown: "t1:attach", on: false })).steps, [["pane.close", { pane: "p2" }]]);
  assert.deepEqual(bottomPlan(base(vm, { shown: "off", on: false })).steps, [], "closed once, not on every render");
});
test("headers: the agent and its status, with the key that closes the pane", () => {
  const vm = vmOf([ask("a-3")]), p = bottomPlan(base(vm, { shown: null }));
  assert.equal(p.head, "card-r-3 · working"); assert.equal(p.hint, "ctrl-b t closes · g open its tab");
});

// ---- a card is in one batch only
test("one batch per card: asks of one card in two lanes are different asks (a decide and a second kind, or two roles); the rule that supersedes is per card, role and kind", () => {
  const tg = (n) => ({ repo: "o/r", pr: n, head: String(n).repeat(40).slice(0, 40) });
  // the shape of epic kuchbhi#162: the epic has look asks on cards A and B, and a hands batch that includes the epic card itself: no card is in two batches
  const vm = vmOf([ask("a-1", { kind: "look", batch_key: "look:o/r#162", epic: "o/r#162", card: "o/r#1081" }), ask("a-2", { kind: "look", batch_key: "look:o/r#162", epic: "o/r#162", card: "o/r#329" }),
    ask("a-3", { kind: "you", batch_key: "hands:o/r#162", epic: "o/r#162", card: "o/r#1024" }), ask("a-4", { kind: "you", batch_key: "hands:o/r#162", epic: "o/r#162", card: "o/r#162" }),
    ask("m-1", { kind: "merge", batch_key: "merge:o/r#162", batch: "m-1", epic: "o/r#162", card: "o/r#72", target: tg(1) }), ask("m-2", { kind: "merge", batch_key: "merge:o/r#162", batch: "m-1", epic: "o/r#162", card: "o/r#72", target: tg(2) })]);
  const seen = new Map();
  for (const b of vm.batches) for (const a of b.asks) seen.set(a.card, [...(seen.get(a.card) ?? []), b.key]);
  for (const [card, keys] of seen) assert.equal(new Set(keys).size, 1, `${card} is in one batch`);
});
