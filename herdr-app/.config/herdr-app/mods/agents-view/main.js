// Inbox: leads, workers, questions waiting on the owner, and what is stuck. Reads terminals(), asks.jsonl,
// events.jsonl, the runner's up-next.json and the usage file; no network. The logic is in lib.js (tested with node --test); this file reads, draws and handles keys.
// A side panel (the `agents-view` block of layouts/main-agents.json, opened by the Inbox button of the tabs-agents mod): Enter shows the
// selected terminal in the main pane (terminal.show) and a key on an ask posts the answer through `work ask answer`.
// When ~/.config/herdr-app/agents-view-fixture/ exists it is read instead of the live run files (screenshots only).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, shared, setShared, props, terminals, panes, spaces, focused, theme, readTextFile, home, closeOverlay } from "herdr";
import { waitingLines, rightPane, pressedText, doneText, failText, viewModel, flatRows, ageText, shortCard, askKeyAction, acceptRecommended, answerArgv, noteArgv, isAskKey, composeAnswer, selectTarget, rightPaneId, perform, runFiles, askView, checklistStep, noteStep, footerHint, composeKey, nudgeArgv, visualArgv, replaceArgv, enterAction,
  answerLine, hideKey, subKey, partLabel, askState, sentReceipt, openLinks, boardStep, listWindow, ASK_H, resizeAskH, dragAskH, storedAskH, partStep, partNotes, linkSegments, linkTarget, focusStep, submitAnswer, BOARD_EPIC, epicList, inboxTabSteps, inTab, liveAgents, bottomPlan, pickerStep, originView, originKey, goStep, lanesLine, phoneBar, stepAsk, askAt, isNarrow, otherArgv, messageArgv, messageTarget, threadView, messageState, inputStep, paneFor, defaultKey, narrowLanes, speaker, deskNew, headerLine } from "./lib.js";

export const PANE_ON = "agents-view.pane";
const MONO = "JetBrains Mono";
const SANS = "Geist";
const REFRESH_MS = 5000;
const POPUP_BODY_H = 560;
const ROW = 28;
const LIST_ITEMS = 9; // the epic list shows this many rows (group heads count); the selected one sits a third of the way down

// who the message box and t reach: the epic's lead (an epic with no lead: its session), else the asker
const leadFor = (pane) => pane.epic?.lead?.name ?? pane.ask?.terminal ?? null;
const questionsOfAsk = (a) => [...new Set(a.options.map((o) => o.q))].sort((x, y) => x - y);
const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);

const epicOf = (r) => (r?.section === "epic" ? r.row : r?.section === "sub" || r?.section === "subpart" ? r.row.epic : null);

export default class AgentsView extends View {
  init(_props, cx) {
    // cmd-shift-t arrives through tabs-agents (a layout mod, always loaded), which flips this shared flag; t in the top pane flips it too
    this.seenOn = this.paneOn; this.wasOn = this.paneOn; this.focusNew = false; this.bottomWas = null; cx.timer.every(500, (c) => { if (this.paneOn !== this.seenOn) { this.seenOn = this.paneOn; c.notify(); } this.focusWatch(); });
    this.h = cx.focus_handle();
    this.h.focus();
    this.files = { asks: null, events: null, usage: null, upNext: null, settings: null, closed: null, stuck: null };
    this.sel = null; this.selIdx = 0; this.armed = null; this.q = 1; this.hidden = new Set(); this.explicit = this.loadExpanded(); this.openSet = new Set(); this.sentOpen = false; this.outbox = new Map(); this.picks = new Map(); this.shown = null; this.note = ""; this.touched = false;
    this.showRun = false; this.input = null; this.checklist = null; this.kept = new Map(); this.sent = new Set(); this.picOff = new Set(); this.pos = {}; this.width = null; this.back = 0; this.status = new Map(); this.last = null; this.recent = null;
    this.askH = storedAskH(this.loadSize()); this.drag = null; this.notes = new Map(); this.filter = null; this.typing = false; this.unfolded = false; this.qSet = false;
    this.waits = {}; this.screenAt = {}; this.pinned = null; this.picker = null; this.flash = null; this.bottomShown = null; this.lastAgent = null; 
    this.read(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.read(cx));
  }

  // the question box size, remembered across reloads; storage can be missing or blocked, and then the size lasts for the session
  loadSize() { try { return globalThis.localStorage?.getItem(ASK_H.key) ?? null; } catch { return null; } }
  saveSize() { try { globalThis.localStorage?.setItem(ASK_H.key, String(this.askH)); } catch { /* not remembered */ } }
  // the expanded epics, remembered across reloads: an epic the owner opened or closed by hand keeps that; any other is open only while it holds the highlight
  loadExpanded() { try { return new Map(Object.entries(JSON.parse(globalThis.localStorage?.getItem("agents-view.expanded") ?? "{}"))); } catch { return new Map(); } }
  saveExpanded() { try { globalThis.localStorage?.setItem("agents-view.expanded", JSON.stringify(Object.fromEntries(this.explicit))); } catch { /* not remembered */ } }
  selEpicKey(vm) {
    const m = /^sub:([^:]+)/.exec(this.sel ?? "");
    return m ? vm.epics.find((e) => e.asks.some((a) => a.id === m[1]))?.key ?? null : this.sel;
  }
  expandedSet(vm) {
    const sel = this.selEpicKey(vm);
    return new Set(vm.epics.filter((e) => e.asks.length && (this.explicit.has(e.key) ? this.explicit.get(e.key) : e.key === sel)).map((e) => e.key));
  }
  setOpen(key, on, cx) { this.explicit.set(key, on); this.saveExpanded(); cx.notify(); }
  toggleEpic(key, cx) { const { vm } = this.model(); this.setOpen(key, !this.expandedSet(vm).has(key), cx); }
  dragStart(e) { this.drag = { y: e.position.y, h: this.askH }; }
  dragMove(e, cx) { if (!this.drag) return; this.askH = dragAskH(this.drag.h, this.drag.y, e.position.y); cx.notify(); }
  dragEnd() { if (this.drag) { this.drag = null; this.saveSize(); } }

  // the Inbox space became active by any route (shift-up/down, cmd-shift-a, a click): its pane takes the keyboard once, never from the agent pane
  focusWatch() {
    const tab = this.tab(), f = focused();
    const r = focusStep({ inTab: !!tab && f?.tab === tab.tab, was: !!this.wasIn, focusedPane: f?.pane ?? null, own: tab?.pane ?? null, bottom: tab ? rightPane(panes(), tab.tab)?.pane ?? null : null });
    this.wasIn = r.was;
    if (r.focus) run("pane.focus", { pane: r.focus });
  }

  async read(cx) {
    // the fixture folder wins when it holds any of the four files; one read of each, no subprocess
    const read1 = (p) => readTextFile(p).catch(() => null);
    let f = runFiles(home(), true), got = await Promise.all([f.asks, f.events, f.usage, f.upNext, f.settings, f.closed, f.stuck].map(read1));
    this.fixture = got.some((x) => x != null);
    if (!this.fixture) { f = runFiles(home(), false); got = await Promise.all([f.asks, f.events, f.usage, f.upNext, f.settings, f.closed, f.stuck].map(read1)); }
    const [asks, events, usage, upNext, settings, closed, stuck] = got;
    this.files = { asks, events, usage, upNext, settings, closed, stuck };
    if (this.armed && Date.now() - this.armed.at > 10_000) this.armed = null;
    this.note = ""; // a note lasts one refresh, so the usage warning comes back
    this.deskIfGone();
    cx.notify();
    this.readScreens(cx);
  }

  // a lead that is not working may be asking in its terminal only: read its last 15 lines, each lead at most every 30s; the epic row shows a question there (waitingLines)
  async readScreens(cx) {
    const now = Date.now(), leads = this.model().vm.groups.flatMap((g) => g.rows).filter((r) => r.role === "lead" && r.address && r.state !== "working" && now - (this.screenAt[r.address] ?? 0) >= 30_000);
    if (!leads.length) return;
    for (const l of leads) this.screenAt[l.address] = now;
    const got = await Promise.all(leads.map((l) => exec("hc", ["read", l.address, "--lines", "15"]).then((x) => (x?.code === 0 ? String(x.stdout ?? "") : ""), () => "")));
    leads.forEach((l, i) => { this.waits[l.address] = waitingLines(got[i]); }); // the regexes run here, once per read, never in render: the engine interrupts a slow render
    const live = this.model().vm.groups.flatMap((g) => g.rows).filter((r) => r.state !== "working").map((r) => r.address);
    for (const a of Object.keys(this.waits)) if (!live.includes(a)) delete this.waits[a]; // working again, or gone
    cx.notify();
  }

  // the view model is the heavy part of a render (the run file is parsed and every ask scanned), and the engine interrupts a slow render: rebuild it only when an input changed, or every 30s for the ages
  model() {
    const f = this.files, key = [f.asks, f.events, f.usage, f.upNext, f.settings, f.closed, f.stuck, JSON.stringify(terminals()), [...this.hidden].join(), JSON.stringify([...this.outbox.values()]), JSON.stringify(this.waits), Math.floor(Date.now() / 30_000)];
    if (!this.memo || key.some((k, i) => k !== this.memo.key[i])) this.memo = { key, vm: this.buildModel() };
    const vm = this.memo.vm;
    this.openSet = this.expandedSet(vm);
    return { vm, rows: flatRows(vm, { showRun: this.showRun, filter: this.filter ?? "", unfolded: this.unfolded, sentOpen: this.sentOpen, expanded: this.openSet }).filter((r) => r.section !== "others") }; // other sessions show as one count line
  }

  buildModel() {
    return viewModel({ terminals: terminals(), asksText: this.files.asks, eventsText: this.files.events, usageJson: this.files.usage, upNextJson: this.files.upNext, settingsJson: this.files.settings, closedJson: this.files.closed, stuckJson: this.files.stuck, nowMs: Date.now(), hiddenIds: this.hidden, waits: this.waits, outbox: [...this.outbox.values()] });
  }

  pane() { return rightPaneId(panes(), focused()?.tab); }

  // when the shown terminal exits, the right-hand pane goes back to the desk
  deskIfGone() {
    if (!this.shown || terminals().some((t) => t.address === this.shown && (t.state == null || t.state === "live"))) return;
    this.shown = null;
    const desk = this.model().vm.desk;
    if (desk.address) this.show(desk.address);
  }

  show(address) { this.shown = address; return perform({ type: "show", terminal: address }, { run, exec, pane: this.pane() }); }

  // { tab, pane } when this view is the Inbox tab (the mod's own pane in a tab named Inbox), else null: the side panel
  tab() { return inTab({ panes: panes(), focused: focused(), props: props() }); }

  // the pane below the mod: split once, then show the agent behind the highlighted ask (or the pinned one). Deferred, never run inside the render.
  syncTab(tab, vm, pane, cx) {
    const bp = rightPane(panes(), tab.tab), bottom = bp?.pane ?? null;
    if (bottom) { this.sawBottom = true; this.missingSince = null; }
    else if (this.sawBottom) { // it was there and is gone: closed by hand, or its program ended, or panes() blinked while tabs changed. Split again only when it stays gone for 3s, so a blink never makes a second pane
      this.missingSince ??= Date.now();
      if (Date.now() - this.missingSince > 3000) { this.sawBottom = false; this.bottomShown = null; this.missingSince = null; }
    }
    if (this.paneOn && !this.wasOn) this.focusNew = true; // opened with t or cmd-shift-t: the keyboard goes to the new pane (moving to another ask does not take it)
    if (!this.paneOn) this.focusNew = false;
    this.wasOn = this.paneOn;
    if (this.focusNew && bottom && bottom !== this.bottomWas) { this.focusNew = false; cx.timer.after(0, () => run("pane.focus", { pane: bottom })); }
    const plan = bottomPlan({ pane, vm, pinned: this.pinned, last: this.lastAgent, shown: this.bottomShown, bottom, bottomTerminal: bp?.terminal ?? null, own: tab.pane, on: this.paneOn });
    if (plan.unpin) this.pinned = null;
    if (plan.address && (plan.mode === "follow" || plan.mode === "pinned")) this.lastAgent = { address: plan.address, name: plan.name };
    if (plan.steps.length) {
      this.bottomShown = plan.key; this.bottomWas = bottom;
      // a split takes the keyboard: give it back to the Inbox pane unless this is the toggle opening the agent pane
      const refocus = plan.steps.some((st) => st[0] === "pane.split") && !this.focusNew;
      cx.timer.after(0, async () => { for (const st of plan.steps) await this.step(st); if (refocus) run("pane.focus", { pane: tab.pane }); });
    }
    this.plan = plan;
    return plan;
  }

  // one step of a plan: the address file, the detach of the attach in the kept pane, or a pane command
  async step([name, a]) {
    if (name === "write") return exec("sh", ["-c", `printf %s '${a.text}' > ${a.file}`]);
    if (name === "detach") return exec("hc", ["keys", a.terminal, "ctrl+\\"]);
    return run(name, a);
  }

  // the running agent behind the highlighted row: its ask's terminal, or the desk
  agentFor(cur, ask, vm) {
    const all = liveAgents(vm);
    if (epicOf(cur)) return (epicOf(cur).lead && all.find((a) => a.address === epicOf(cur).lead.address)) ?? null; // an epic's agent is its lead
    return (ask ? all.find((a) => a.name === ask.terminal) : cur?.section === "desk" ? all.find((a) => a.role === "desk") : null) ?? null;
  }

  // t in the top pane, or cmd-shift-t from anywhere (keys.json tabs-agents.pane): the agent pane below on (a real hc attach) or off
  get paneOn() { return shared(PANE_ON) === true; }
  togglePane(cx) { setShared(PANE_ON, !this.paneOn); cx.notify(); }

  flashOn(a, k, cx) { this.flash = { id: a.id, key: k }; cx.timer.after(300, (c) => { this.flash = null; c.notify(); }); }

  phoneKey(k, cx) { return this.key({ keystroke: k }, cx); }

  // a key on an open ask: post the answer, open its plan, or arm a merge/roll/money answer for its second key
  askKey(a, k, cx) {
    this.note = "";
    if (k === "n" && !a.options.some((o) => o.key === "n")) { this.input = { mode: "note", id: a.id, q: this.q, text: (questionsOfAsk(a).length > 1 ? this.notes.get(a.id)?.[this.q] : this.kept.get(a.id)) ?? "" }; return cx.notify(); }
    if (/^[1-9]$/.test(k) && a.options.some((o) => String(o.q) === k)) { this.q = Number(k); this.qSet = true; this.armed = null; this.follow(a); return cx.notify(); }
    const r = askKeyAction(a, k, this.armed, Date.now(), this.q);
    if (r && ["post", "arm", "pick"].includes(r.type) && a.options.some((o) => o.key === k)) this.flashOn(a, k, cx);
    return this.act(a, r, cx);
  }

  // what a key or Enter resolved to on an ask: post, arm, open the plan, open the batch checklist, or nothing
  act(a, r, cx) {
    if (!r) { this.say(a.id, "fail", "nothing is recommended on this ask: press an option letter"); return cx.notify(); }
    this.armed = r.type === "arm" ? r.armed : null;
    if (r.type === "incomplete") { this.say(a.id, "fail", `marked ${r.marked} of ${r.total}: mark the rest, or ctrl-↵ takes the recommended for them`); return cx.notify(); }
    if (r.type === "gone") { this.say(a.id, "fail", `${a.terminal} is gone, so no picture yet · r starts a replacement with this ask as its brief, and it draws the picture`); return cx.notify(); }
    if (r.type === "visual" || r.type === "replace") return this.picture(a, r.type, cx);
    if (r.type === "checklist") { this.checklist = { id: a.id, cur: 0, chosen: [] }; return cx.notify(); }
    if (r.type === "pick") { // kept by id, so a refreshed row keeps its picks; Enter sends the answer line (the picks, the recommended option for the rest)
      const was = this.picks.get(a.id)?.[r.q];
      if (was?.startsWith(`${r.q}note`)) this.notes.set(a.id, { ...this.notes.get(a.id), [r.q]: was.slice(was.indexOf(":") + 1).trim() }); // a note and now a pick: the note goes with the pick
      const picks = { ...this.picks.get(a.id), [r.q]: r.text }; this.picks.set(a.id, picks); this.qSet = false;
      const total = questionsOfAsk(a).length, marked = questionsOfAsk(a).filter((q) => picks[q]).length, nx = partStep(a, r.q, "right");
      if (nx.q) { this.q = nx.q; this.follow(a); } // marked: on to the next part
      this.say(a.id, "ok", marked === total ? `marked ${marked} of ${total} · ↵ sends the answer` : `marked ${marked} of ${total} · ctrl-↵ takes the recommended for the rest`); return cx.notify();
    }
    if (r.type === "post") this.send(a, answerArgv(a, r.text, { key: r.key, note: questionsOfAsk(a).length > 1 ? partNotes(a, this.notes.get(a.id)) || undefined : this.kept.get(a.id) }), cx, r.text === "Done." && a.kind === "you" ? "done" : "pick", r.text === "Done." ? "" : r.key ?? "");
    else if (r.type === "open") { this.say(a.id, "pending", "opening it…"); perform(r, { run, exec, pane: null }).then((x) => { this.last = { argv: ["open", r.target], code: x?.code, stderr: x?.stderr }; this.say(a.id, x?.code === 0 ? "ok" : "fail", x?.code === 0 ? "opened" : `could not open it${x?.stderr ? `: ${String(x.stderr).trim().split("\n")[0]}` : ""}`); cx.notify(); }, (e) => { this.last = { argv: ["open", r.target], code: null, stderr: String(e?.message ?? e) }; this.say(a.id, "fail", `could not open it: ${e?.message ?? e}`); cx.notify(); }); }
    else if (r.type === "arm") this.say(a.id, "pending", `${r.body || "no details"} · press ${r.armed.key === "enter" ? "↵" : r.armed.key} again within 10s to send`);
    cx.notify();
  }

  // every work call the panel runs goes through here: the pressed line at once, then the confirmed or failed line with the call's exit code and stderr kept in this.last
  call(key, kind, label, argv, cx, then) {
    if (this.fixture) { this.say(key, "fail", "fixture data: nothing sent"); return cx.notify(); }
    this.say(key, "pending", pressedText(kind, label)); cx.notify();
    const done = (x) => {
      this.last = { argv, code: x?.code ?? null, stderr: x?.stderr ?? "" };
      const ok = x?.code === 0;
      this.say(key, ok ? "ok" : "fail", ok ? doneText(kind, label) : failText(kind, x));
      if (then) then(ok);
      cx.notify();
    };
    perform({ type: "post", argv }, { run, exec, pane: null }).then(done, (e) => done({ code: null, stderr: String(e?.message ?? e) }));
  }

  say(key, tone, text) { this.status.set(key, { tone, text }); this.recent = key; }

  // answers go through `work ask answer`; one in flight per ask
  send(a, argv, cx, kind = "pick", label = "") {
    if (this.fixture) { this.say(a.id, "fail", "fixture data: nothing sent"); return cx.notify(); }
    const hk = hideKey(a), val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
    if (this.hidden.has(hk)) return; // a post for this ask is in flight or done
    this.hidden.add(hk);
    this.outbox.set(a.id, { id: a.id, card: a.card, epic: a.epic, title: a.title, pick: val("--text") ?? "", note: val("--note"), key: val("--key"), answeredAt: new Date().toISOString(), ageMs: 0, sent: true, received: false, done: false, notPickedUp: false, lead: a.terminal ?? null, kind: a.kind });
    this.call(a.id, kind, label, argv, cx, (ok) => {
      if (ok) { this.kept.delete(a.id); this.checklist = null; }
      else { this.hidden.delete(hk); this.outbox.delete(a.id); } // not sent: the ask is back in its epic with the failure on it
    });
  }

  // v asks the agent behind the ask for a picture (on file first, then sent); r starts a replacement for a gone asker. Neither answers the ask.
  picture(a, type, cx) { this.call(a.id, type, "", type === "visual" ? visualArgv(a) : replaceArgv(a), cx); }

  // one reminder to the asker of an answer not applied 10 minutes after it was sent; never on a timer
  nudge(a, cx) {
    if (!a.notPickedUp) { this.say(a.id, "fail", "that answer is not overdue yet: a reminder works once it has waited 10 minutes"); return cx.notify(); }
    this.call(a.id, "nudge", "", nudgeArgv(a), cx);
  }

  // a note alone: recorded and sent to the asker, the ask stays open
  sendNote(a, text, cx) { this.call(a.id, "note", "", noteArgv(a, text), cx, (ok) => { if (ok) this.sent.add(a.id); }); }

  // a message to the agent behind an ask (its thread) or to the desk; the run files take it first, then it is delivered
  sendMessage(thread, text, cx, to = null) { this.call(thread, "message", "", messageArgv(thread, text, to), cx, () => this.read(cx)); }

  // a note on one part of a several-part question, kept in the panel until the answer is submitted: with an option picked it is a note on that pick; with none it is the
  // part's own answer (marked `note`), and the part is done
  keepPart(a, i, text, cx) {
    const picks = this.picks.get(a.id) ?? {}, qs = questionsOfAsk(a);
    if (picks[i.q] && !picks[i.q].startsWith(`${i.q}note`)) { this.notes.set(a.id, { ...this.notes.get(a.id), [i.q]: text }); this.say(a.id, "ok", `note kept for part ${i.q}: it goes with the answer`); return cx.notify(); }
    const next = { ...picks, [i.q]: `${i.q}note: ${text}` }; this.picks.set(a.id, next);
    const nx = partStep(a, i.q, "right"); if (nx.q) { this.q = nx.q; this.follow(a); }
    this.say(a.id, "ok", `marked ${qs.filter((q) => next[q]).length} of ${qs.length} · your note is the answer for part ${i.q}`); return cx.notify();
  }

  // while the text input or the batch checklist is open, every key goes to it
  modal(a, k, cx) {
    if (this.input) {
      const i = this.input, r = inputStep(i, k);
      if (r.type === "send") {
        this.input = null;
        if (i.mode !== "message" && questionsOfAsk(a).length > 1) return this.keepPart(a, i, r.text, cx);
        if (i.mode === "note") this.send(a, otherArgv(a, r.text), cx, "other"); // one question and no option picked: the note is the answer
        else this.sendMessage(i.thread, r.text, cx, i.to);
      }
      else if (r.type === "keep") { this.input = null; if (i.mode !== "message" && questionsOfAsk(a).length > 1) return this.keepPart(a, i, r.text, cx); this.kept.set(a.id, r.text); this.say(a.id, "ok", "note kept: it goes with your pick"); }
      else if (r.type === "cancel") this.input = null;
      else this.input = r.input;
    } else {
      const r = checklistStep(a, this.checklist, k);
      if (r.type === "cancel") this.checklist = null;
      else if (r.type === "send") this.send(a, answerArgv(a, r.text, { key: r.key, only: r.only, note: this.kept.get(a.id) }), cx, "pick", "your landing choice");
      else this.checklist = { ...r, id: a.id };
    }
    cx.notify();
  }

  // the question box moved to another part or ask: when the highlight is on a sub-row it goes there too
  follow(a) { if (/^sub:/.test(this.sel ?? "")) this.sel = subKey(a, this.q); }

  // the epic that holds the selected row stays expanded
  select(r) {
    this.touched = true; this.sel = r.key; this.q = 1; this.qSet = false; this.back = 0;
    if (r.section === "sub" || r.section === "subpart") { this.pos = { ...this.pos, [r.row.epic.key]: r.row.epic.asks.indexOf(r.row.ask) }; this.q = r.row.q ?? questionsOfAsk(r.row.ask)[0] ?? 1; }
  }

  // the ask shown for a batch row: the place in the batch is kept in this.pos
  // Enter opens a ready picture while its row has focus; tab hands focus to the options, and back
  onPicture(a) { return a.visual === "ready" && !this.picOff.has(a.id); }

  askOf(r) { return r?.section === "sub" || r?.section === "subpart" ? r.row.ask : r?.section === "epic" && r.row.asks.length ? askAt(this.pos, r.row) : null; }

  key(e, cx) {
    const k = e.keystroke;
    const { vm, rows } = this.model();
    const cur = rows[this.selIdx], ask = this.askOf(cur);
    const open = this.input ?? this.checklist;
    if (this.picker) { cx.stop_propagation(); return this.pickKey(vm, k, cx); }
    if (this.typing && !this.input) { cx.stop_propagation(); return this.filterKey(k, cx); }
    if (this.input?.mode === "message") { cx.stop_propagation(); return this.modal(null, k, cx); }
    if (open && ask && open.id === ask.id) { cx.stop_propagation(); return this.modal(ask, k, cx); }
    this.input = null; this.checklist = null;
    const own = (kk) => !!ask?.options.some((o) => o.key === kk), tab = this.tab(), agent = this.agentFor(cur, ask, vm);
    const app = (kk) => k === kk && !own(kk); // f is the panel's key unless the open ask has an option f; option letters always mean options, so the board is capital B
    if (app("f")) { cx.stop_propagation(); this.filter ??= ""; this.typing = true; return cx.notify(); }
    if ((k === "B" || k === "shift-b") && epicOf(cur)) { cx.stop_propagation(); return this.board(cur, vm, cx); }
    if (k === "space" && cur?.section === "fold") { cx.stop_propagation(); this.unfolded = !this.unfolded; return cx.notify(); }
    if (k === "space" && cur?.section === "epic" && cur.row.asks.length) { cx.stop_propagation(); return this.toggleEpic(cur.row.key, cx); }
    if ((k === "space" || k === "enter") && cur?.section === "sentfold") { cx.stop_propagation(); this.sentOpen = !this.sentOpen; return cx.notify(); }
    if (k === "escape" && this.filter != null) { cx.stop_propagation(); this.filter = null; this.touched = false; return cx.notify(); }
    if ((k === "[" || k === "]") && !own(k)) { cx.stop_propagation(); this.askH = resizeAskH(this.askH, k); this.saveSize(); return cx.notify(); }
    if (k === "t" && tab && !own("t")) { cx.stop_propagation(); return this.togglePane(cx); }
    if (k === "escape" && this.pinned) { cx.stop_propagation(); this.pinned = null; return cx.notify(); }
    if (k === "s" && tab && !own("s")) { cx.stop_propagation(); this.picker = { cur: 0 }; return cx.notify(); }
    if (k === "i" && !tab && !own("i")) { cx.stop_propagation(); run("tabs-agents.toggle"); return; } // the Inbox lives in its own space: tabs-agents makes or selects it
    if (k === "g" && agent && !own("g")) { cx.stop_propagation(); run(...goStep(agent.address, isNarrow(this.width ?? 0))); return; }
    const ok = ask && originKey(ask, k, !!agent);
    if (ok?.type === "open") { cx.stop_propagation(); return this.act(ask, ok, cx); }
    if (k === "/") { cx.stop_propagation(); const pane = paneFor(cur, vm, this.pos); const toDesk = ["desk", "empty", "fold"].includes(pane.kind); this.input = { mode: "message", thread: toDesk ? "desk" : pane.thread, to: toDesk ? null : leadFor(pane), text: "" }; return cx.notify(); }
    if (k === "pageup" || k === "pagedown") { cx.stop_propagation(); this.back = k === "pageup" ? this.back + 5 : Math.max(0, this.back - 5); return cx.notify(); }
    if (cur?.section === "sent") { // an answer the asker has not picked up: the owner's key sends one reminder
      if (k === ".") { cx.stop_propagation(); return this.nudge(cur.row, cx); }
    }
    if ((epicOf(cur) || cur?.section === "batch") && (k === "left" || k === "right")) {
      cx.stop_propagation(); this.armed = null;
      const ep = epicOf(cur), batch = ep ?? cur.row, open = !!ep && this.openSet.has(ep.key);
      if (cur.section === "epic" && ep.asks.length && (open ? k === "left" && (this.pos[ep.key] ?? 0) === 0 && this.q === (questionsOfAsk(ask)[0] ?? 1) : k === "right")) return this.setOpen(ep.key, !open, cx); // ← at the start closes an open epic, → opens a closed one; otherwise they step
      const st = ask ? partStep(ask, this.q, k) : { step: k };
      if (st.q) this.q = st.q;
      else { this.pos = stepAsk(this.pos, batch, k); const nx = askAt(this.pos, batch), qs = questionsOfAsk(nx); this.q = k === "left" ? qs[qs.length - 1] ?? 1 : qs[0] ?? 1; }
      if (ep?.asks.length && open) { this.sel = subKey(askAt(this.pos, ep), this.q); this.touched = true; } // the highlight goes where the box went
      return cx.notify();
    }
    if (k === "tab" && ask?.visual === "ready") { cx.stop_propagation(); this.picOff.has(ask.id) ? this.picOff.delete(ask.id) : this.picOff.add(ask.id); return cx.notify(); }
    if ((k === "enter" || k === "ctrl-enter") && ask) {
      cx.stop_propagation(); this.note = "";
      return this.act(ask, enterAction(ask, this.armed, Date.now(), this.onPicture(ask), this.picks.get(ask.id) ?? {}, k === "ctrl-enter"), cx);
    }
    if (ask && isAskKey(ask, k, this.armed)) { cx.stop_propagation(); return this.askKey(ask, k, cx); }
    this.armed = null; // navigation cancels an armed answer and still moves
    if (!["escape", "enter", "down", "up", "j", "k"].includes(k)) return;
    cx.stop_propagation();
    if (k === "escape") return props()?.overlay ? closeOverlay(props()?.overlay) : undefined;
    if (k === "enter") { this.open(rows[this.selIdx], vm); return cx.notify(); }
    this.selIdx = Math.max(0, Math.min(rows.length - 1, this.selIdx + (k === "down" || k === "j" ? 1 : -1)));
    if (rows[this.selIdx]) this.select(rows[this.selIdx]);
    cx.notify();
  }

  // the agent picker: a pick shows that agent in the pane below and pins it
  pickKey(vm, k, cx) {
    const list = liveAgents(vm), r = pickerStep(this.picker, k, list.length);
    if (r.type === "move") this.picker = { cur: r.cur };
    else { this.picker = null; if (r.type === "pick" && list[r.index]) this.pinned = list[r.index].address; }
    cx.notify();
  }

  // typing in the filter line: letters narrow the epics, backspace erases, up and down move, enter keeps the filter, escape clears it
  filterKey(k, cx) {
    if (k === "escape") { this.filter = null; this.typing = false; this.touched = false; }
    else if (k === "enter") this.typing = false;
    else if (k === "backspace") { this.filter = (this.filter ?? "").slice(0, -1); this.touched = false; }
    else if (k === "down" || k === "up") { const { rows } = this.model(); this.selIdx = Math.max(0, Math.min(rows.length - 1, this.selIdx + (k === "down" ? 1 : -1))); if (rows[this.selIdx]) this.select(rows[this.selIdx]); }
    else if (k === "space" || k.length === 1) { this.filter = (this.filter ?? "") + (k === "space" ? " " : k); this.touched = false; }
    cx.notify();
  }

  // b: the board where it is already open, at this epic; none open says so
  board(cur, vm, cx) {
    const ep = epicOf(cur), key = paneFor(cur, vm, this.pos).thread ?? `epic:${ep.ref}`, r = boardStep({ spaces: spaces(), panes: panes(), epic: ep.ref });
    if (r.share) setShared(BOARD_EPIC, r.share);
    for (const st of r.steps) run(...st);
    this.say(key, r.receipt ? "fail" : "ok", r.receipt || `board: showing ${ep.title}`);
    cx.notify();
  }

  open(r, vm) {
    if (r?.section === "fold") { this.unfolded = !this.unfolded; return; }
    if (r?.section === "sentfold") { this.sentOpen = !this.sentOpen; return; }
    if (r?.section === "summary") { this.showRun = !this.showRun; return; }
    if (!r || r.section === "batch" || r.section === "epic" || r.section === "sub" || r.section === "subpart" || r.section === "sent" || this.fixture) return; // fixture rows are not real terminals
    const t = selectTarget(r, vm?.deskProject ?? null);
    if (t?.show) this.show(t.show);
    else if (t?.start) perform({ type: "start-desk", argv: t.start }, { run, exec, pane: this.pane() });
    else if (r.section === "desk") this.note = "no desk project: set desk_project in the run settings";
  }

  section(t, label, count, red, hint) {
    return h_flex().w_full().flex_none().px(14).pt(16).pb(4).gap(8).items_baseline()
      .child(div().text_size(12).text_color(t.muted).child(label)).child(mono(11, red ? t.blocked : t.dim, String(count))).when(!!hint, (e) => e.child(sans(11, t.dim, hint)));
  }

  // the status of the last key on this ask / thread: pending, ok or failed, in one line
  statusLine(t, st) { return sans(12, st.tone === "fail" ? t.blocked : st.tone === "ok" ? t.done : t.working, st.text).w_full().flex_none().pt(6); }

  empty(t, text) { return div().w_full().flex_none().px(14).py(4).text_size(13).text_color(t.dim).child(text); }

  label(t, text) { return div().w_full().flex_none().px(14).pt(8).text_size(12).text_color(t.dim).child(text); }

  keycap(t, k) {
    return div().min_w(18).h(18).px(4).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).font_family(MONO).text_size(11).text_color(t.muted).child(k);
  }

  // an ask: card, kind and age over the first line of the question; selected, it opens in place with its options as buttons
  ask(t, a, posText, vm, epic = null) {
    const r = { key: `ask:${a.id}` }, sel = true;
    const v = askView(a, this.picks.get(a.id) ?? {}, this.armed, this.flash);
    const st = this.status.get(a.id) ?? (v.visual?.ready ? { tone: "ok", text: "picture ready · ↵ opens it" } : v.visual ? { tone: "pending", text: doneText("visual") } : null);
    const og = originView(a, vm, !!this.agentFor(null, a, vm));
    const el = v_flex().id(r.key).w_full().flex_none().px(14).py(8).gap(2).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .child(h_flex().w_full().gap(8).items_baseline().child(mono(13, t.foreground, v.card)).child(sans(12, t.muted, v.kind))
        .when(!!posText, (e) => e.child(sans(11, t.dim, `${posText} ‹ ›`)))
        .when(v.noteSent || this.sent.has(a.id), (e) => e.child(sans(11, t.done, "note sent")))
        .when(!!v.visual, (e) => e.child(sans(11, v.visual.ready ? t.accent : t.working, v.visual.label)))
        .when(!!a.reply, (e) => e.child(sans(11, t.working, "reply")))
        .child(div().flex_1()).child(mono(12, t.muted, v.age)))
      .child(h_flex().w_full().gap(6).items_baseline().child(sans(13, t.foreground, v.title).min_w(0).when(!sel, (e) => e.flex_1().truncate()))
        .when(!sel && !!v.marker, (e) => e.child(sans(12, t.dim, `· ${v.marker}`).flex_none())));
    if (!sel) return el;
    const repo = String(a.epic ?? a.card ?? "").split("#")[0], cur = questionsOfAsk(a).includes(this.q) ? this.q : questionsOfAsk(a)[0], nq = questionsOfAsk(a).length;
    const overview = epic ? [epic.group, epic.lead ? `lead ${epic.lead.name}` : "no lead running", `${epic.workers.length} worker${epic.workers.length === 1 ? "" : "s"}`, ...epic.prs.map((p) => `#${p.pr} ${p.state}`)].join(" · ") : "";
    // title, where it came from (Why / What / How), what is true today and after, the options with what each does next, the receipt, then the plan or PR link, then the body
    return el
      .when(!!a.reply, (e) => e.child(sans(12, t.foreground, `Reply from the agent: ${a.reply.text}`).pt(4)))
      .children(openLinks(a).map((o, i) => v_flex().id(`${r.key}:open${i}`).w_full().pt(i ? 2 : 6).gap(2).on_click(() => perform({ type: "open", target: o.target }, { run, exec, pane: null }))
        .child(h_flex().gap(8).items_center().child(sans(13, t.accent, o.label).underline()).when(i === 0, (x) => x.child(this.keycap(t, "p"))))
        .child(mono(11, t.accent, o.target).underline().w_full().truncate())))
      .when(!!epic, (e) => e.child(h_flex().w_full().gap(6).items_baseline().pt(2).child(sans(11, t.dim, epic.group)).child(sans(11, t.dim, epic.lead ? "lead" : "no lead running")).when(!!epic.lead, (x) => x.child(this.agentLink(t, epic.lead)))
        .child(sans(11, t.dim, `${epic.workers.length} worker${epic.workers.length === 1 ? "" : "s"}${epic.prs.length ? " · " : ""}${epic.prs.map((p) => `#${p.pr} ${p.state}`).join(" · ")}`))))
      .child(v_flex().w_full().gap(2).pt(4)
        .child(h_flex().w_full().gap(8).items_baseline().child(sans(11, t.dim, "Why").w(56).flex_none())
          .when(!!og.why.tag, (e) => e.child(sans(11, og.why.tag === "agent-filed" ? t.working : t.muted, og.why.tag).flex_none()))
          .child(sans(12, t.muted, og.why.epic).flex_none()).when(!!og.why.line, (e) => e.child(sans(12, t.muted, `· ${og.why.line}`).flex_1().min_w(0))))
        .when(!!og.what, (e) => e.child(h_flex().w_full().gap(8).items_baseline().child(sans(11, t.dim, "What").w(56).flex_none()).child(sans(12, t.muted, og.what).flex_1().min_w(0))))
        .when(og.how.length > 0, (e) => e.child(h_flex().w_full().gap(8).items_center().child(sans(11, t.dim, "How").w(56).flex_none())
          .children(og.how.map((h) => h_flex().gap(4).items_center().child(this.keycap(t, h.key)).child(sans(11, t.muted, h.label)))))))
      .children(v.evidence.map(([k, text]) => h_flex().w_full().gap(8).items_baseline().pt(2).child(sans(11, t.dim, k).w(56).flex_none()).child(v_flex().flex_1().min_w(0).child(this.rich(t, 12, t.muted, text, repo, `${r.key}:ev:${k}`)))))
      .when(!!v.visual?.ready, (e) => e.child(h_flex().id(`${r.key}:picture`).w_full().pt(8).gap(8).items_center()
        .on_click((_e, cx) => this.act(a, askKeyAction(a, "v", null, Date.now()), cx))
        .child(sans(13, t.accent, "open picture")).child(this.keycap(t, "v")).when(this.onPicture(a), (e) => e.child(sans(11, t.done, "↵")).child(sans(11, t.dim, "tab: options"))).when(this.onPicture(a), (e) => e.border_1().border_color(t.accent).rounded(6).px(8).h(ROW))))
      .when(v.gone, (e) => e.child(h_flex().w_full().pt(8).gap(8).items_center()
        .child(sans(12, t.blocked, "the agent behind this ask is gone")).when(v.replaceable, (e) => e.child(sans(12, t.muted, "start a replacement with this ask as its brief")).child(this.keycap(t, "r")))
        .when(!v.replaceable, (e) => e.child(sans(12, t.muted, "press v for a picture, then start a replacement")))))
      .when(v.cards.length > 0, (e) => e.child(v_flex().w_full().gap(2).pt(8)
        .child(sans(12, t.dim, `${v.cards.length} card${v.cards.length === 1 ? "" : "s"} not ready`))
        .children(v.cards.map((c) => h_flex().w_full().gap(8).items_baseline().px(8)
          .child(mono(12, t.foreground, c.label).w(56).flex_none()).child(sans(12, t.muted, c.choices.join(" · ")).flex_1().min_w(0).truncate())))))
      .when(nq > 1, (e) => e.child(sans(11, t.dim, `question ${questionsOfAsk(a).indexOf(cur) + 1} of ${nq} ‹ ›`).pt(8)))
      .children(v.questions.filter((q) => q.q === cur).map((q) => v_flex().w_full().gap(4).pt(8)
        .when(!!q.title, (e) => e.child(sans(12, t.dim, `${q.q} · ${q.title}`)))
        .when(!!a.parts?.find((p) => p.q === q.q)?.whyYou, (e) => e.child(h_flex().w_full().gap(8).items_baseline().child(sans(11, t.dim, "Why you").flex_none()).child(sans(12, t.muted, a.parts.find((p) => p.q === q.q).whyYou).flex_1().min_w(0))))
        .children(q.options.map((o) => h_flex().id(`${r.key}:${q.q}${o.key}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6)
          .bg(o.armed || o.flash ? t.accent : t.raised).when(o.picked, (e) => e.border_1().border_color(t.accent))
          .on_click((_e, cx) => { this.q = q.q; this.askKey(a, o.key, cx); })
          .child(this.keycap(t, o.key)).child(sans(13, o.armed || o.flash ? t.background : t.foreground, o.label).when(!o.then, (e) => e.flex_1()).min_w(0).truncate())
          .when(!!o.then, (e) => e.child(sans(11, o.armed ? t.background : t.dim, `→ ${o.then}`).flex_1().min_w(0).truncate()))
          .when(o.rec && !o.armed, (e) => e.child(sans(11, t.done, "↵").flex_none()))
          .when(o.armed, (e) => e.child(sans(11, t.background, "press again to send")))))))
      .when(!!this.notes.get(a.id)?.[cur], (e) => e.child(sans(12, t.muted, `Note on this part: ${this.notes.get(a.id)[cur]}`).pt(4)))
      .when(!!this.picks.get(a.id)?.[cur]?.startsWith(`${cur}note`), (e) => e.child(sans(12, t.foreground, `Your answer is the note: ${this.picks.get(a.id)[cur].slice(this.picks.get(a.id)[cur].indexOf(":") + 1).trim()}`).pt(4)))
      .when(v.questions.length > 0 && a.targets.length < 2, (e) => e.child(h_flex().w_full().gap(8).items_baseline().pt(6).child(sans(12, t.dim, "Your answer")).child(mono(13, t.foreground, answerLine(a, this.picks.get(a.id) ?? {})))
        .child(sans(11, t.dim, "↵ send all recommended · 1-9 then a letter changes one · n note").flex_1().min_w(0).truncate())))
      .when(!!st, (e) => e.child(this.statusLine(t, st)))
      .when(this.checklist?.id === a.id, (e) => e.child(v_flex().w_full().gap(2).pt(8)
        .children(v.targets.map((tg, i) => h_flex().id(`${r.key}:t${i}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6).bg(this.checklist.cur === i ? t.selected : t.raised)
          .child(mono(12, t.foreground, this.checklist.chosen.includes(tg.id) ? "[x]" : "[ ]")).child(sans(13, t.foreground, tg.label)).child(div().flex_1())))
        .child(sans(11, t.dim, "space toggles · ↵ sends (none = hold all) · esc cancels"))))
      .when(this.input?.id === a.id, (e) => e.child(v_flex().w_full().gap(2).pt(8)
        .child(sans(12, t.muted, "Note"))
        .child(h_flex().w_full().h(ROW).px(8).items_center().rounded(6).bg(t.raised).border_1().border_color(t.accent).child(sans(13, t.foreground, `${this.input.text}▏`)))
        .child(sans(11, t.dim, "↵ no option picked: your note is the answer · tab keeps it for your pick · esc cancel"))))
      .when(!!v.body, (e) => e.child(div().id(`${r.key}:body`).w_full().max_h(160).overflow_y_scrollbar().pt(4).child(this.rich(t, 12, t.muted, v.body, repo, `${r.key}:body`))))
      .when(!!v.status, (e) => e.child(sans(12, t.muted, v.status).pt(4)));
  }

  // an expanded epic's ask, or one part of a multi-part ask: the highlight moves through these and the question box shows the highlighted one
  subRow(t, r) {
    const sel = r.key === this.sel, { ask: a, q } = r.row, picks = this.picks.get(a.id) ?? {};
    const el = h_flex().id(r.key).w_full().flex_none().gap(8).items_baseline().py(3).rounded(6).when(sel, (x) => x.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); cx.notify(); });
    return q ? el.pl(52).pr(14).child(sans(12, sel ? t.foreground : t.muted, partLabel(a, q, picks)).flex_1().min_w(0).truncate())
      : el.pl(34).pr(14).child(sans(12, a.older ? t.dim : t.foreground, a.title).flex_1().min_w(0).truncate()).when(!!a.older, (x) => x.child(sans(11, t.dim, "older").flex_none())).child(mono(11, t.muted, ageText(a.ageMs)).flex_none()).child(sans(11, a.reply ? t.working : t.dim, askState(a, picks)).flex_none());
  }

  // a sent ask: its state (sent, received, done), "not picked up" after ten minutes and the . key nudges; what was sent shows in the pane below when it is selected
  sentRow(t, r) {
    const a = r.row, sel = r.key === this.sel, rc = sentReceipt(a);
    return v_flex().id(r.key).w_full().flex_none().px(14).py(8).gap(2).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click(() => this.select(r))
      .child(h_flex().w_full().gap(8).items_baseline().child(mono(13, t.foreground, shortCard(a.card))).child(sans(13, t.foreground, a.title).flex_1().min_w(0).truncate()).child(mono(12, t.muted, ageText(a.ageMs))))
      .child(h_flex().w_full().gap(10).items_baseline().child(sans(12, t.muted, rc.state))
        .when(a.notPickedUp, (e) => e.child(sans(12, t.blocked, "not picked up")).when(sel, (e2) => e2.child(this.keycap(t, ".")))));
  }

  // the owner's receipt for one sent ask: what, to whom and when, then the state
  receipt(t, a) {
    const rc = sentReceipt(a);
    return v_flex().w_full().gap(2).child(sans(12, t.muted, `You sent: ${rc.what}`)).child(sans(12, t.dim, `to ${rc.to} · ${rc.when}`)).child(sans(12, t.dim, rc.state))
      .when(this.status.has(a.id), (e) => e.child(this.statusLine(t, this.status.get(a.id))));
  }

  // the Sent line: collapsed, one row at the bottom of the list
  sentFold(t, r) {
    const sel = r.key === this.sel;
    return h_flex().id(r.key).w_full().h(ROW).flex_none().px(14).gap(8).items_center().when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); this.sentOpen = !this.sentOpen; cx.notify(); })
      .child(mono(12, t.dim, this.sentOpen ? "▾" : "▸")).child(sans(12, t.muted, r.row.label)).child(sans(11, t.dim, "space"));
  }

  // running, stuck and the runner as one line while asks wait; Enter shows or hides the lists
  summary(t, r) {
    const sel = r.key === this.sel;
    return h_flex().id(r.key).w_full().h(ROW).flex_none().px(14).gap(8).items_center().when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); this.showRun = !this.showRun; cx.notify(); })
      .child(mono(12, t.dim, this.showRun ? "▾" : "▸")).child(sans(12, t.muted, r.row.line).flex_1().min_w(0).truncate());
  }

  // one running, stuck or desk row: a status dot, the name, a muted middle, a state on the right
  line(t, r, parts, tone) {
    const sel = r.key === this.sel;
    return h_flex().id(r.key).w_full().h(ROW).flex_none().px(14).gap(8).items_center().when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click(() => { this.touched = true; this.sel = r.key; this.open(r, this.model().vm); })
      .child(div().size(6).flex_none().rounded(3).bg(tone ?? t.dim))
      .child(sans(13, t.foreground, parts[0]).flex_1().min_w(72).truncate())
      .child(mono(12, t.muted, parts[1] ?? "").flex_none())
      .child(sans(12, t.muted, parts[2] ?? "").max_w(180).truncate());
  }

  // one batch of the left list: its name and how many asks it holds
  batch(t, r) {
    const sel = r.key === this.sel, b = r.row;
    return h_flex().id(r.key).w_full().flex_none().px(14).py(4).gap(8).items_center().rounded(6).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); cx.notify(); })
      .child(v_flex().flex_1().min_w(0).child(sans(13, t.foreground, b.name).truncate()).child(sans(11, t.dim, shortCard(b.epic))))
      .child(mono(12, t.muted, String(b.count)));
  }

  // one epic of the list: a status dot, the title and number, the age; under it what is happening or needed in words, and its PR badges
  epicRow(t, r) {
    const sel = r.key === this.sel, e = r.row, dot = { needs: t.accent, stuck: t.blocked, working: t.working, done: t.done }[e.state];
    const badge = (b) => mono(11, { merged: "#a371f7", waiting: "#d4a72c", passed: "#3fb950" }[b.state], `#${b.pr}`).flex_none();
    return v_flex().id(r.key).w_full().flex_none().px(14).py(4).gap(1).rounded(6).when(sel, (x) => x.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); cx.notify(); })
      .child(h_flex().w_full().gap(8).items_center()
        .when(e.asks.length > 0, (x) => x.child(div().id(`${r.key}:chev`).flex_none().w(14).on_click((_e, cx) => { cx.stop_propagation(); this.select(r); this.toggleEpic(e.key, cx); }).child(mono(12, t.dim, this.openSet.has(e.key) ? "▾" : "▸"))))
        .child(div().size(7).flex_none().rounded(4).bg(dot))
        .child(sans(13, e.state === "done" ? t.muted : t.foreground, e.title).flex_1().min_w(0).truncate()).child(mono(11, t.dim, `#${e.num}`).flex_none()).when(e.ageMs != null, (x) => x.child(mono(12, t.muted, ageText(e.ageMs)).flex_none())))
      .child(h_flex().w_full().gap(8).items_center().pl(15).child(sans(12, e.state === "needs" ? t.foreground : t.muted, e.line).flex_1().min_w(0).truncate()).children(e.prs.map(badge)));
  }

  groupHead(t, g) {
    return h_flex().w_full().flex_none().px(14).pt(10).pb(2).gap(8).items_baseline().child(div().text_size(11).text_color(t.dim).child(g.name)).child(mono(11, t.muted, String(g.epics.length)));
  }

  // the finished epics, folded into one row; space or Enter shows them
  foldRow(t, r) {
    const sel = r.key === this.sel;
    return h_flex().id(r.key).w_full().h(ROW).flex_none().px(14).gap(8).items_center().when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(r); this.unfolded = !this.unfolded; cx.notify(); })
      .child(mono(12, t.dim, this.unfolded ? "▾" : "▸")).child(sans(12, t.muted, r.row.label)).child(sans(11, t.dim, "space"));
  }

  filterLine(t) {
    return h_flex().w_full().flex_none().px(14).py(4).gap(8).items_center().child(sans(12, this.typing ? t.foreground : t.muted, `Filter: ${this.filter}${this.typing ? "▏" : ""}`)).child(sans(11, t.dim, "esc clears"));
  }

  // an epic with no open question: who runs it, what is happening, its PRs and where it came from
  epicOverview(t, e, thread, sent = null) {
    const od = e.origin?.summary;
    return v_flex().w_full().px(14).py(10).gap(4)
      .child(h_flex().w_full().gap(8).items_baseline().child(sans(14, t.foreground, e.title).flex_1().min_w(0)).child(mono(11, t.dim, `#${e.num}`)))
      .child(sans(12, e.waiting ? t.working : t.muted, e.line || "nothing reported yet"))
      .when(!!e.waiting, (x) => x.child(v_flex().w_full().gap(1).px(8).py(8).rounded(6).bg(t.raised).child(sans(11, t.dim, `${e.lead.name} says, in its terminal`)).children(e.waiting.lines.map((l) => mono(12, t.foreground, l).w_full().min_w(0))).child(h_flex().gap(6).items_center().pt(4).child(this.keycap(t, "t")).child(sans(11, t.dim, "opens its terminal")))))
      .when(!!e.waiting && e.asks.length > 0, (x) => x.child(sans(11, t.dim, `${e.asks.length} older ask${e.asks.length === 1 ? "" : "s"} below: ${e.asks.map((a) => ageText(a.ageMs)).join(", ")}`)))
      .child(h_flex().w_full().gap(6).items_baseline().child(sans(11, t.dim, e.group)).child(sans(11, t.dim, e.lead ? "lead" : "no lead running")).when(!!e.lead, (x) => x.child(this.agentLink(t, e.lead)))
        .child(sans(11, t.dim, `${e.workers.length} worker${e.workers.length === 1 ? "" : "s"}${e.prs.length ? " · " : ""}${e.prs.map((p) => `#${p.pr} ${p.state}`).join(" · ")}`)))
      .when(!!od, (x) => x.child(this.rich(t, 12, t.dim, od, String(e.ref).split("#")[0], `ov:${e.key}`)))
      .when(!!sent, (x) => x.child(this.receipt(t, sent)))
      .when(this.status.has(thread), (x) => x.child(this.statusLine(t, this.status.get(thread))));
  }

  // text with its links drawn as underlined links: a URL or a path opens with `open`, owner/repo#N and #N open the issue; text with none stays one wrapped line
  rich(t, size, color, text, repo, key) {
    const segs = linkSegments(text, repo);
    if (!segs.some((x) => x.link)) return sans(size, color, text);
    return h_flex().w_full().flex_wrap().items_baseline().children(segs.map((x, i) => (x.link
      ? div().id(`${key}:l${i}`).font_family(SANS).text_size(size).text_color(t.accent).underline().cursor_pointer().on_click(() => this.openLink(x, repo)).child(x.text)
      : div().font_family(SANS).text_size(size).text_color(color).child(x.text))));
  }

  openLink(seg, repo) { const g = linkTarget(seg, repo); if (g) perform({ type: "open", target: g.open }, { run, exec, pane: null }); }

  // an agent's name as a link: its own tab
  agentLink(t, a, size = 11) {
    return div().id(`agent:${a.address}`).font_family(SANS).text_size(size).text_color(t.accent).underline().cursor_pointer().on_click(() => run(...goStep(a.address, isNarrow(this.width ?? 0)))).child(a.name);
  }

  // a thread: the last messages (PgUp for older), each with sent / received
  thread(t, msgs, id) {
    if (!msgs.length) return div();
    const v = threadView(msgs, 6, this.back);
    return v_flex().w_full().gap(2).pt(8).border_t(1).border_color(t.border)
      .child(sans(11, t.dim, `Thread · ${msgs.length} message${msgs.length === 1 ? "" : "s"}${v.hidden ? ` · ${v.hidden} earlier (PgUp)` : ""}${v.newer ? ` · ${v.newer} newer (PgDn)` : ""}`))
      .children(v.shown.map((m) => h_flex().w_full().gap(6).items_baseline()
        .child(sans(12, m.from === "owner" ? t.accent : t.foreground, `${speaker(m, id)}: ${m.text}`).flex_1().min_w(0))
        .child(sans(10, t.dim, messageState(m)).flex_none())));
  }

  // the text input at the bottom: a message goes to the agent behind the open ask, else to the desk
  chatBar(t, pane, vm) {
    const typing = this.input?.mode === "message";
    const toDesk = typing ? this.input.thread === "desk" : ["desk", "empty", "fold"].includes(pane.kind);
    const lead = typing && !toDesk ? this.input.to : leadFor(pane);
    const to = toDesk ? vm.desk.name : lead ? `${lead} · ${pane.epic ? "the epic's lead" : "agent behind this ask"}` : "no lead running";
    return h_flex().w_full().flex_none().px(14).py(6).gap(8).items_center().border_t(1).border_color(t.border)
      .child(sans(11, t.dim, `To: ${to}`).flex_none())
      .child(h_flex().flex_1().min_w(0).h(ROW).px(8).items_center().rounded(6).bg(t.raised).when(typing, (e) => e.border_1().border_color(t.accent))
        .child(sans(13, typing ? t.foreground : t.dim, typing ? `${this.input.text}▏` : "/ to write a message").truncate()));
  }

  render(cx) {
    const t = theme();
    const { vm, rows } = this.model();
    const keys = rows.map((r) => r.key);
    if (!this.touched) this.sel = defaultKey(rows); // until the owner moves: the first batch, never the desk when there is anything else
    if (!keys.includes(this.sel)) this.sel = keys[Math.min(this.selIdx, keys.length - 1)] ?? null;
    this.selIdx = Math.max(0, keys.indexOf(this.sel));
    const tone = (s) => (s === "blocked" || s === "error" ? t.blocked : s === "working" ? t.working : s === "done" ? t.done : t.dim);

    const byKey = new Map(rows.map((r) => [r.key, r]));
    const waiting = vm.asks.length > 0, runCount = vm.groups.reduce((n, g) => n + g.rows.length, 0) + vm.sides.length;
    // flatRows leaves rows out (the closed epics' asks, the lists while hidden): a row that is not in `rows` is not drawn
    const draw = (r, f) => (r ? [f(r)] : []);
    const narrow = isNarrow(this.width ?? 0);
    const curRow = rows[this.selIdx], pane = paneFor(curRow, vm, this.pos);
    // the Inbox tab and the phone read in the order of the spec: the open ask, the message box, then the lanes; the side panel keeps the lanes on top
    const tab = this.tab(), plan = tab ? this.syncTab(tab, vm, pane, cx) : null;
    const threadOf = (id) => this.thread(t, vm.threads[id] ?? [], id);
    const picker = this.picker ? [v_flex().w_full().px(14).py(8).gap(2).child(sans(12, t.dim, "Switch to")).children(liveAgents(vm).map((a, i) => h_flex().id(`pick:${a.address}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6).bg(this.picker.cur === i ? t.selected : t.raised)
      .on_click((_e, cx2) => { this.picker = null; this.pinned = a.address; cx2.notify(); }).child(sans(13, t.foreground, a.name).flex_1().min_w(0)).child(sans(12, t.muted, a.state ?? "starting")))).child(sans(11, t.dim, "↑ ↓ move · ↵ show and pin · esc cancel"))] : [];
    const newDesk = deskNew(vm.threads);
    // top: the desk (first, never counted), the filter line, then the epics grouped by Area (needs you, stuck, working), the finished folded into one row
    const list = epicList(vm.epics, { filter: this.filter ?? "", unfolded: this.unfolded });
    // built when asked for (below the open ask and the message box), so the strings are drawn in that order
    const leftEl = () => {
      // one item per group head, epic row and fold row; only LIST_ITEMS of them show, the selected one a third of the way down while the rest move past it
      const items = [
        ...list.groups.flatMap((g) => [{ key: `head:${g.name}`, make: () => [this.groupHead(t, g)] }, ...g.epics.flatMap((e) => [{ key: e.key, make: () => draw(byKey.get(e.key), (r) => this.epicRow(t, r)) }, ...rows.filter((r) => (r.section === "sub" || r.section === "subpart") && r.row.epic.key === e.key).map((r) => ({ key: r.key, make: () => draw(r, (x) => this.subRow(t, x)) }))])]),
        ...(list.finished.count ? [{ key: "fold", make: () => draw(byKey.get("fold"), (r) => this.foldRow(t, r)) }, ...(this.unfolded ? list.finished.epics.map((e) => ({ key: e.key, make: () => draw(byKey.get(e.key), (r) => this.epicRow(t, r)) })) : [])] : []),
      ];
      const at = Math.max(0, items.findIndex((x) => x.key === this.sel)), start = listWindow(items.length, at, LIST_ITEMS), shown = items.slice(start, start + LIST_ITEMS);
      return v_flex().w_full().flex_none().gap(2)
        .when(!narrow, (e) => e.child(this.line(t, byKey.get("desk"), [vm.desk.name, newDesk ? `${newDesk} new` : "", vm.desk.state], tone(vm.desk.state))))
        .when(this.filter != null, (e) => e.child(this.filterLine(t)))
        .when(start > 0, (e) => e.child(sans(11, t.dim, `▲ ${start} above`).px(14)))
        .children(shown.flatMap((x) => x.make()))
        .when(start + LIST_ITEMS < items.length, (e) => e.child(sans(11, t.dim, `▼ ${items.length - start - LIST_ITEMS} below`).px(14)));
    };
    // below: follows the selected row: the desk thread, one ask with its thread, an answered ask with its thread, or the empty inbox
    // an answered ask leaves the open list at once: its status stays on screen until the owner acts on something else
    const shown = pane.kind === "ask" ? pane.ask.id : pane.kind === "desk" ? "desk" : pane.kind === "answered" || pane.kind === "epic" ? pane.thread : null;
    const away = null; // a receipt belongs to its own ask: it shows there and in Sent, never on the next ask
    const rightEl = () => v_flex().w_full().flex_none().min_w(0).gap(4)
      .children([...(away ? [v_flex().w_full().px(14).child(this.statusLine(t, away))] : []), ...(pane.kind === "desk"
        ? [v_flex().w_full().px(14).py(10).gap(4).child(sans(14, t.foreground, "Desk")).child(sans(12, t.dim, "General messages · / to write · ↵ shows the terminal")).when(this.status.has("desk"), (e) => e.child(this.statusLine(t, this.status.get("desk")))).child(threadOf("desk"))]
        : pane.kind === "ask"
          ? [this.ask(t, pane.ask, pane.batch.asks.length > 1 ? `ask ${pane.batch.asks.indexOf(pane.ask) + 1} of ${pane.batch.asks.length}` : "", vm, pane.epic ?? null), v_flex().w_full().px(14).child(threadOf(pane.thread))]
          : pane.kind === "epic"
            ? [this.epicOverview(t, pane.epic, pane.thread, vm.sent.find((x) => x.epic === pane.epic.ref) ?? null), v_flex().w_full().px(14).child(threadOf(pane.thread))]
            : pane.kind === "fold"
              ? [v_flex().w_full().px(14).py(24).child(sans(12, t.dim, `${pane.fold.label}: space shows them`))]
          : pane.kind === "sentfold"
            ? [v_flex().w_full().px(14).py(24).child(sans(12, t.dim, `${pane.fold.label}: space shows what you sent`))]
          : pane.kind === "answered"
            ? [v_flex().w_full().px(14).py(10).gap(4).child(sans(14, t.foreground, pane.answered.title)).child(this.receipt(t, pane.answered)).child(threadOf(pane.thread))]
            : vm.asks.length
              ? [v_flex().w_full().px(14).py(24).child(sans(12, t.dim, "↵ shows the terminal · ↑ ↓ back to a batch"))]
              : [v_flex().w_full().px(14).py(24).gap(4).child(sans(16, t.foreground, "Nothing needs you.")).child(sans(12, t.dim, "Type below to message the desk."))])]);
    // stacked at every width: the batch list on top, the open ask below it at full width; the message box is the bar under the scrolling body
    // the open ask scrolls inside its own box, so a long one never moves the message box or the lanes, and the pane keeps its size
    const asksBody = [div().id("ask-scroll").w_full().flex_none().when(!!tab, (e) => e.h(this.askH)).when(!tab, (e) => e.max_h(this.askH)).overflow_y_scrollbar().child(rightEl()), div().id("ask-divider").w_full().h(6).flex_none().cursor_row_resize().bg(t.border).on_mouse_down("left", (e) => this.dragStart(e)), this.chatBar(t, pane, vm), leftEl()];
    // built only when shown: while asks wait and the lists are hidden, `rows` has no running, desk or stuck rows
    const runBody = () => [
      this.section(t, "Running", runCount, false),
      ...(runCount ? [] : [this.empty(t, "Nothing running")]),
      ...vm.groups.flatMap((g) => {
        return [this.label(t, g.epic), ...g.rows.flatMap((r) => draw(byKey.get(`group:${r.address}`), (x) => this.line(t, x, [r.name, r.role === "worker" ? r.model ?? "" : "", r.state], tone(r.state))))];
      }),
      ...(vm.sides.length ? [this.label(t, "Side jobs"), ...vm.sides.flatMap((s) => draw(byKey.get(`side:${s.address}`), (x) => this.line(t, x, [s.name, [s.card && shortCard(s.card)].filter(Boolean).join(""), s.state], tone(s.state))))] : []),
      ...(vm.stuck.length ? [this.section(t, "Stuck", vm.stuck.length, true), ...vm.stuck.flatMap((s) => draw(byKey.get(`stuck:${s.kind}:${s.name}`), (x) => this.line(t, x, [s.name, "", [s.text, s.ageMs == null ? "" : ageText(s.ageMs)].filter(Boolean).join(" · ")], t.blocked)))] : []),
      ...(vm.upNext ? [mono(12, t.muted, vm.upNext).w_full().flex_none().px(14).pt(12)] : []),
      ...(vm.runnerLine ? [mono(12, t.muted, vm.runnerLine).w_full().flex_none().px(14).pt(vm.upNext ? 4 : 12)] : []),
    ];
    const body = [
      ...picker,
      ...asksBody,
      ...(vm.sent.length ? [...draw(byKey.get("sentfold"), (r) => this.sentFold(t, r)), ...(this.sentOpen ? vm.sent.flatMap((a) => draw(byKey.get(`sent:${a.id}`), (r) => this.sentRow(t, r))) : [])] : []),
      ...(waiting ? draw(byKey.get("summary:running"), (r) => this.summary(t, r)) : []),
      ...(!waiting || this.showRun ? runBody() : []),
      ...(vm.othersLine ? [sans(12, t.dim, vm.othersLine).w_full().flex_none().px(14).pt(12)] : []),
    ];

    return v_flex().id("agents-view").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx)).on_mouse_move((e, cx2) => this.dragMove(e, cx2)).on_mouse_up("left", () => this.dragEnd())
      .on_size_change((size, cx2) => { if (isNarrow(size.width) !== isNarrow(this.width ?? 0)) { this.width = size.width; cx2.notify(); } else this.width = size.width; })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(sans(13, t.foreground, "Inbox").font_semibold()).child(sans(12, t.muted, headerLine(vm).inbox)).when(!tab, (e) => e.child(sans(11, t.dim, "· i opens the tab"))).child(div().flex_1()).child(sans(12, t.dim, headerLine(vm).run)))
      .child(v_flex().id("av-body").w_full().flex_1().min_h(props()?.overlay ? POPUP_BODY_H : 0).overflow_y_scrollbar().children(body))
      .child(div().w_full().flex_none().px(14).py(4).border_t(1).border_color(t.border).child(sans(11, t.dim, footerHint(rows[this.selIdx]?.section))))
      // the header of the pane below (the Inbox tab): who it shows, what it is doing, and how to talk to it
      .when(!!plan, (e) => e.child(h_flex().w_full().flex_none().px(14).py(6).gap(8).items_baseline().border_t(1).border_color(t.border)
        .child(sans(12, plan.dim ? t.dim : t.foreground, plan.head)).child(div().flex_1()).child(sans(11, t.dim, plan.hint))))
      // the phone's bottom bar: Picture, Note, Go to agent (a peek of the terminal, full screen)
      .when(narrow, (e) => e.child(h_flex().w_full().flex_none().px(14).py(8).gap(8).border_t(1).border_color(t.border)
        .children(phoneBar(!!this.agentFor(curRow, pane.kind === "ask" ? pane.ask : null, vm)).map((b) => h_flex().id(`bar:${b.key}`).flex_1().h(ROW + 8).items_center().justify_center().rounded(6).bg(t.raised)
          .on_click((_e, cx2) => this.phoneKey(b.key, cx2)).child(sans(13, t.foreground, b.label))))))
      .child(div().w_full().flex_none().px(14).py(8).child(this.note ? sans(12, t.foreground, this.note) : mono(11, vm.usageWarn ? t.working : t.dim, vm.usage)));
  }
}
