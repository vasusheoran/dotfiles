// A lead that asks the owner only in its terminal (kuchbhi#1115, round 4): the panel reads the lead's last screen lines and shows the question on the epic.
// Screens below are captured from real lead terminals (hc read --lines 15), trimmed at the top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitingLines, viewModel, paneFor, flatRows, epicList, parseJsonl } from "./lib.js";

const RULE = "─".repeat(110);
const CHROME = `\n${RULE}\n❯ \n${RULE}\n  ~/workspace/vasu/kuchbhi  main*\n  ctx ━─────────────────── 9% · 7d ━━──────── 28% 1d10h\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent\n`;
// lead-kuchbhi-562, idle, asking in plain text
const WAITING = `⏺ The stage check for #1021 ran only partway, so I haven't given you the prod roll yet. I've recorded your answer to roll
  after the check passes.

  What I couldn't check:
  - a trial org binding a router;

  The validate script needs a raw Vault token to log in as the QA account and as the operator. The session hook blocks me
  from reading the token files, so it stopped before touching anything and there's nothing to clean up.

  To finish the check:
  1. In the Vault UI console, run write auth/token/create policies="claude-ops" ttl="30m".
  2. Save the token it returns to ~/.config/vault/.session-token.
  3. Say go. I'll run the full /validate, which cleans up after itself, and post the result.

  #639 is still waiting on its plan ask, a-20261115213328-b4a064.

✻ Worked for 1m 32s · done 11:53 AM

※ recap: I'm finishing Epic 10's stage check of #1021 before the prod roll, but I couldn't log in to stage without a
  Vault token. Next: save a 30-minute claude-ops token to ~/.config/vault/.session-token and say go. (disable recaps in
  /config)
${CHROME}`;
// a lead mid-turn: the spinner line, and a question mark in an earlier line, are not a wait
const WORKING = `⏺ Bash(hc read t11v --lines 15 2>&1 | tail -22)
  ⎿  Running…

· Blanching… (3m 26s · ↓ 7.7k tokens · thought for 2s)
  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work
${CHROME}`;
// idle after a plain report: no question, no steps for the owner
const REPORT = `⏺ Epic 14 is merged: three PRs landed and the roll ran clean.

✻ Worked for 40s · done 11:53 AM
${CHROME}`;

test("lead-562's real tail is a wait: the quoted lines end with the steps for the owner", () => {
  const w = waitingLines(WAITING);
  assert.ok(w, "idle at a prompt with numbered steps and 'Say go'");
  assert.match(w.join("\n"), /1\. In the Vault UI console/);
  assert.match(w.join("\n"), /3\. Say go/);
  assert.doesNotMatch(w.join("\n"), /recap|Worked for|auto mode/);
});
test("a working lead is not waiting, and neither is an idle one that only reports", () => {
  assert.equal(waitingLines(WORKING), null);
  assert.equal(waitingLines(REPORT), null);
});
test("a question mark alone, or 'Say go' alone, is enough; no screen, no wait", () => {
  assert.ok(waitingLines(`⏺ Roll prod now?\n${CHROME}`));
  assert.ok(waitingLines(`⏺ Ready. Say go.\n${CHROME}`));
  assert.equal(waitingLines(""), null);
  assert.equal(waitingLines(null), null);
});

const NOW = Date.parse("2030-01-10T12:00:00Z"), MIN = 60_000, iso = (ago) => new Date(NOW - ago * MIN).toISOString();
const ask = { ts: iso(900), event: "ask", id: "a-old", card: "o/r#5", epic: "o/r#1", from: "lead", kind: "decide", title: "Router screens", question: "Q", body: "Q\n\n1. Q\n   a) A => a\n", options: [{ q: 1, key: "a", label: "A (Recommended)", then: "a" }], today: "t", after: "a", checked: "c", why_you: "w", batch_key: "decide:o/r#1" };
const lead = { address: "t8n", name: "lead-r-1", state: "live", status: { state: "idle" }, labels: ["role=lead", "epic=o/r#1"] };
const model = (screens, asks = [ask], extra = {}) => viewModel({ terminals: [lead], asksText: asks.map((l) => JSON.stringify(l)).join("\n"), eventsText: "", closedJson: JSON.stringify({ closed: [], titles: { "o/r#1": "Legacy DNS" }, areas: {}, origin: {} }), nowMs: NOW, waits: Object.fromEntries(Object.entries(screens).map(([k, v]) => [k, waitingLines(v)])), ...extra });

test("the epic shows 'Lead is waiting in its terminal' with the lead's lines, above its older open asks, which are marked older", () => {
  const e = model({ t8n: WAITING }).epics[0];
  assert.equal(e.waiting.lines.length > 0, true);
  assert.equal(e.line, "Lead is waiting in its terminal");
  assert.equal(e.state, "needs");
  assert.deepEqual(e.asks.map((a) => a.older), [true]);
  const rows = flatRows(model({ t8n: WAITING }), { expanded: new Set([e.key]) });
  assert.equal(paneFor(rows.find((r) => r.section === "epic"), model({ t8n: WAITING }), {}).kind, "epic", "the epic row shows the waiting card, not its older ask");
});
test("a working lead's epic keeps its ask as it is", () => {
  const e = model({ t8n: WORKING }).epics[0];
  assert.equal(e.waiting, null); assert.equal(e.asks[0].older, undefined); assert.equal(e.line, "Router screens");
});
test("a screen that only repeats an open ask is not a second wait", () => {
  const e = model({ t8n: `⏺ I raised a-old for you: Router screens. Pick one?\n${CHROME}` }).epics[0];
  assert.equal(e.waiting, null);
});
test("a lead with no epic ask and a waiting screen still gets a row that needs the owner", () => {
  const e = model({ t8n: WAITING }, []).epics.find((x) => x.ref === "o/r#1");
  assert.equal(e.state, "needs"); assert.equal(e.line, "Lead is waiting in its terminal");
});
test("the lead's status line shows first when it is newer than the open ask, else the ask's title", () => {
  const st = (ago) => ({ ts: iso(ago), event: "lead_status", epic: "o/r#1", text: "Rolling stage" });
  assert.equal(model({}, [ask, st(5)]).epics[0].line, "Rolling stage");
  assert.equal(model({}, [ask, st(2000)]).epics[0].line, "Router screens");
});
