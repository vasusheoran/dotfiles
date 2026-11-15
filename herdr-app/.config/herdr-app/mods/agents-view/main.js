// Agents view: leads, workers, questions waiting on the owner, and what is stuck. Reads terminals(), asks.jsonl,
// events.jsonl, the runner's up-next.json and the usage file; no network. The logic is in lib.js (tested with node --test); this file reads, draws and handles keys.
// A side panel (the `agents-view` block of layouts/main-agents.json, opened by the Agents button of the tabs-agents mod): Enter shows the
// selected terminal in the main pane (terminal.show) and a key on an ask posts the answer through `work ask answer`.
// When ~/.config/herdr-app/agents-view-fixture/ exists it is read instead of the live run files (screenshots only).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, props, terminals, panes, focused, theme, readTextFile, home, closeOverlay } from "herdr";
import { pressedText, doneText, failText, viewModel, flatRows, ageText, shortCard, askKeyAction, acceptRecommended, answerArgv, noteArgv, isAskKey, composeAnswer, selectTarget, rightPaneId, perform, runFiles, askView, checklistStep, noteStep, footerHint, composeKey, nudgeArgv, visualArgv, replaceArgv, enterAction,
  inboxTabSteps, inTab, liveAgents, bottomPlan, pickerStep, originView, originKey, goStep, lanesLine, phoneBar, stepAsk, askAt, isNarrow, otherArgv, messageArgv, messageTarget, threadView, messageState, inputStep, paneFor, defaultKey, narrowLanes, speaker, deskNew, headerLine } from "./lib.js";

const MONO = "JetBrains Mono";
const SANS = "Geist";
const REFRESH_MS = 5000;
const POPUP_BODY_H = 560;
const ROW = 28;

const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);

export default class AgentsView extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.h.focus();
    this.files = { asks: null, events: null, usage: null, upNext: null, settings: null, closed: null, stuck: null };
    this.sel = null; this.selIdx = 0; this.armed = null; this.q = 1; this.hidden = new Set(); this.picks = new Map(); this.shown = null; this.note = ""; this.touched = false;
    this.showRun = false; this.input = null; this.checklist = null; this.kept = new Map(); this.sent = new Set(); this.picOff = new Set(); this.pos = {}; this.width = null; this.back = 0; this.status = new Map(); this.last = null; this.recent = null;
    this.pinned = null; this.picker = null; this.flash = null; this.bottomShown = null; this.lastAgent = null; this.taken = null; this.takenAt = null; this.plan = null; this.focusNew = false; this.bottomWas = null;
    this.read(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.read(cx));
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
  }

  model() {
    const vm = viewModel({ terminals: terminals(), asksText: this.files.asks, eventsText: this.files.events, usageJson: this.files.usage, upNextJson: this.files.upNext, settingsJson: this.files.settings, closedJson: this.files.closed, stuckJson: this.files.stuck, nowMs: Date.now(), hiddenIds: this.hidden });
    return { vm, rows: flatRows(vm, { showRun: this.showRun }).filter((r) => r.section !== "others") }; // other sessions show as one count line
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
  syncTab(tab, vm, pane, cx, hl) {
    const bottom = rightPaneId(panes(), tab.tab);
    if (bottom) this.sawBottom = true;
    else if (this.sawBottom) { this.sawBottom = false; this.bottomShown = null; } // it was there and is gone (closed by hand, or its program ended): show again; until it first appears, the split is on its way
    if (this.taken && this.takenAt !== hl) this.taken = null; // moving to another ask gives it back
    if (this.focusNew && bottom && bottom !== this.bottomWas) { this.focusNew = false; cx.timer.after(0, () => run("pane.focus", { pane: bottom })); }
    const plan = bottomPlan({ pane, vm, pinned: this.pinned, last: this.lastAgent, shown: this.bottomShown, bottom, own: tab.pane, taken: this.taken });
    if (plan.unpin) this.pinned = null;
    if (plan.address && (plan.mode === "follow" || plan.mode === "pinned")) this.lastAgent = { address: plan.address, name: plan.name };
    if (plan.steps.length) { this.bottomShown = plan.key; this.bottomWas = bottom; this.focusNew = plan.taken; cx.timer.after(0, () => plan.steps.forEach((st) => run(...st))); }
    this.plan = plan;
    return plan;
  }

  // the running agent behind the highlighted row: its ask's terminal, or the desk
  agentFor(cur, ask, vm) {
    const all = liveAgents(vm);
    return (ask ? all.find((a) => a.name === ask.terminal) : cur?.section === "desk" ? all.find((a) => a.role === "desk") : null) ?? null;
  }

  flashOn(a, k, cx) { this.flash = { id: a.id, key: k }; cx.timer.after(300, (c) => { this.flash = null; c.notify(); }); }

  phoneKey(k, cx) { return this.key({ keystroke: k }, cx); }

  // a key on an open ask: post the answer, open its plan, or arm a merge/roll/money answer for its second key
  askKey(a, k, cx) {
    this.note = "";
    if (k === "n" && !a.options.some((o) => o.key === "n")) { this.input = { mode: "note", id: a.id, text: this.kept.get(a.id) ?? "" }; return cx.notify(); }
    if (/^[1-9]$/.test(k) && a.options.some((o) => String(o.q) === k)) { this.q = Number(k); this.armed = null; return cx.notify(); }
    const r = askKeyAction(a, k, this.armed, Date.now(), this.q);
    if (r && ["post", "arm", "pick"].includes(r.type) && a.options.some((o) => o.key === k)) this.flashOn(a, k, cx);
    if (r?.type === "other") { this.input = { mode: "other", id: a.id, text: "" }; return cx.notify(); }
    return this.act(a, r, cx);
  }

  // what a key or Enter resolved to on an ask: post, arm, open the plan, open the batch checklist, or nothing
  act(a, r, cx) {
    if (!r) { this.say(a.id, "fail", "nothing is recommended on this ask: press an option letter"); return cx.notify(); }
    this.armed = r.type === "arm" ? r.armed : null;
    if (r.type === "gone") { this.say(a.id, "fail", `${a.terminal} is gone, so no picture yet · r starts a replacement with this ask as its brief, and it draws the picture`); return cx.notify(); }
    if (r.type === "visual" || r.type === "replace") return this.picture(a, r.type, cx);
    if (r.type === "checklist") { this.checklist = { id: a.id, cur: 0, chosen: [] }; return cx.notify(); }
    if (r.type === "pick") { // kept by id, so a refreshed row keeps its picks
      const picks = { ...this.picks.get(a.id), [r.q]: r.text }; this.picks.set(a.id, picks);
      const text = composeAnswer(a, picks);
      if (text == null) { this.say(a.id, "ok", `picked ${r.text.split(":")[0]}: pick the other questions, then press Enter to send`); return cx.notify(); }
      r = { type: "post", text, key: composeKey(a, picks) };
    }
    if (r.type === "post") this.send(a, answerArgv(a, r.text, { key: r.key, note: this.kept.get(a.id) }), cx, r.text === "Done." && a.kind === "you" ? "done" : "pick", r.text === "Done." ? "" : r.key ?? "");
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
    if (this.hidden.has(a.id)) return; // a post for this ask is in flight or done
    this.hidden.add(a.id);
    this.call(a.id, kind, label, argv, cx, (ok) => { if (ok) { this.kept.delete(a.id); this.checklist = null; } else this.hidden.delete(a.id); });
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
  sendMessage(thread, text, cx) { this.call(thread, "message", "", messageArgv(thread, text), cx, () => this.read(cx)); }

  // while the text input or the batch checklist is open, every key goes to it
  modal(a, k, cx) {
    if (this.input) {
      const i = this.input, r = inputStep(i, k);
      if (r.type === "send") {
        this.input = null;
        if (i.mode === "note") this.sendNote(a, r.text, cx);
        else if (i.mode === "other") this.send(a, otherArgv(a, r.text), cx, "other");
        else this.sendMessage(i.thread, r.text, cx);
      }
      else if (r.type === "keep") { this.kept.set(a.id, r.text); this.input = null; this.say(a.id, "ok", "note kept: it goes with your pick"); }
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

  // the epic that holds the selected row stays expanded
  select(r) {
    this.touched = true; this.sel = r.key; this.q = 1; this.back = 0;
  }

  // the ask shown for a batch row: the place in the batch is kept in this.pos
  // Enter opens a ready picture while its row has focus; tab hands focus to the options, and back
  onPicture(a) { return a.visual === "ready" && !this.picOff.has(a.id); }

  askOf(r) { return r?.section === "batch" ? askAt(this.pos, r.row) : null; }

  key(e, cx) {
    const k = e.keystroke;
    const { vm, rows } = this.model();
    const cur = rows[this.selIdx], ask = this.askOf(cur);
    const open = this.input ?? this.checklist;
    if (this.picker) { cx.stop_propagation(); return this.pickKey(vm, k, cx); }
    if (this.input?.mode === "message") { cx.stop_propagation(); return this.modal(null, k, cx); }
    if (open && ask && open.id === ask.id) { cx.stop_propagation(); return this.modal(ask, k, cx); }
    this.input = null; this.checklist = null;
    const own = (kk) => !!ask?.options.some((o) => o.key === kk), tab = this.tab(), agent = this.agentFor(cur, ask, vm);
    if (k === "escape" && this.taken) { cx.stop_propagation(); this.taken = null; return cx.notify(); }
    if (k === "t" && tab && !own("t") && ["follow", "pinned"].includes(this.plan?.mode)) { cx.stop_propagation(); this.taken = this.plan.address; this.takenAt = `${cur?.key}|${ask?.id}`; return cx.notify(); }
    if (k === "escape" && this.pinned) { cx.stop_propagation(); this.pinned = null; return cx.notify(); }
    if (k === "s" && tab && !own("s")) { cx.stop_propagation(); this.taken = null; this.picker = { cur: 0 }; return cx.notify(); }
    if (k === "i" && !tab && !own("i")) { cx.stop_propagation(); inboxTabSteps({ panes: panes() }).forEach((s) => run(...s)); return; }
    if (k === "g" && agent && !own("g")) { cx.stop_propagation(); run(...goStep(agent.address, isNarrow(this.width ?? 0))); return; }
    const ok = ask && originKey(ask, k, !!agent);
    if (ok?.type === "open") { cx.stop_propagation(); return this.act(ask, ok, cx); }
    if (k === "/") { cx.stop_propagation(); const pane = paneFor(cur, vm, this.pos); this.input = { mode: "message", thread: pane.kind === "desk" || pane.kind === "empty" ? "desk" : pane.thread, text: "" }; return cx.notify(); }
    if (k === "pageup" || k === "pagedown") { cx.stop_propagation(); this.back = k === "pageup" ? this.back + 5 : Math.max(0, this.back - 5); return cx.notify(); }
    if (cur?.section === "answered") { // an answer the asker has not picked up: the owner's key sends one reminder
      if (k === ".") { cx.stop_propagation(); return this.nudge(cur.row, cx); }
    }
    if (cur?.section === "batch" && (k === "left" || k === "right")) { cx.stop_propagation(); this.pos = stepAsk(this.pos, cur.row, k); this.q = 1; this.armed = null; return cx.notify(); }
    if (k === "tab" && ask?.visual === "ready") { cx.stop_propagation(); this.picOff.has(ask.id) ? this.picOff.delete(ask.id) : this.picOff.add(ask.id); return cx.notify(); }
    if (k === "enter" && ask) {
      cx.stop_propagation(); this.note = "";
      return this.act(ask, enterAction(ask, this.armed, Date.now(), this.onPicture(ask)), cx);
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

  open(r, vm) {
    if (r?.section === "summary") { this.showRun = !this.showRun; return; }
    if (!r || r.section === "batch" || r.section === "answered" || this.fixture) return; // fixture rows are not real terminals
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
  ask(t, a, posText, vm) {
    const r = { key: `ask:${a.id}` }, sel = true;
    const v = askView(a, this.picks.get(a.id) ?? {}, this.armed, this.flash);
    const st = this.status.get(a.id) ?? (v.visual?.ready ? { tone: "ok", text: "picture ready · ↵ opens it" } : v.visual ? { tone: "pending", text: doneText("visual") } : null);
    const og = originView(a, vm, !!this.agentFor(null, a, vm));
    const el = v_flex().id(r.key).w_full().flex_none().px(14).py(8).gap(2).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .child(h_flex().w_full().gap(8).items_baseline().child(mono(13, t.foreground, v.card)).child(sans(12, t.muted, v.kind))
        .when(!!posText, (e) => e.child(sans(11, t.dim, `${posText} ‹ ›`)))
        .when(v.noteSent || this.sent.has(a.id), (e) => e.child(sans(11, t.done, "note sent")))
        .when(!!v.visual, (e) => e.child(sans(11, v.visual.ready ? t.accent : t.working, v.visual.label)))
        .child(div().flex_1()).child(mono(12, t.muted, v.age)))
      .child(h_flex().w_full().gap(6).items_baseline().child(sans(13, t.foreground, v.title).min_w(0).when(!sel, (e) => e.flex_1().truncate()))
        .when(!sel && !!v.marker, (e) => e.child(sans(12, t.dim, `· ${v.marker}`).flex_none())));
    if (!sel) return el;
    // title, where it came from (Why / What / How), what is true today and after, the options with what each does next, the receipt, then the plan or PR link, then the body
    return el
      .child(v_flex().w_full().gap(2).pt(4)
        .child(h_flex().w_full().gap(8).items_baseline().child(sans(11, t.dim, "Why").w(56).flex_none())
          .when(!!og.why.tag, (e) => e.child(sans(11, og.why.tag === "agent-filed" ? t.working : t.muted, og.why.tag).flex_none()))
          .child(sans(12, t.muted, og.why.epic).flex_none()).when(!!og.why.line, (e) => e.child(sans(12, t.muted, `· ${og.why.line}`).flex_1().min_w(0))))
        .when(!!og.what, (e) => e.child(h_flex().w_full().gap(8).items_baseline().child(sans(11, t.dim, "What").w(56).flex_none()).child(sans(12, t.muted, og.what).flex_1().min_w(0))))
        .when(og.how.length > 0, (e) => e.child(h_flex().w_full().gap(8).items_center().child(sans(11, t.dim, "How").w(56).flex_none())
          .children(og.how.map((h) => h_flex().gap(4).items_center().child(this.keycap(t, h.key)).child(sans(11, t.muted, h.label)))))))
      .children(v.evidence.map(([k, text]) => h_flex().w_full().gap(8).items_baseline().pt(2).child(sans(11, t.dim, k).w(56).flex_none()).child(sans(12, t.muted, text).flex_1().min_w(0))))
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
      .children(v.questions.map((q) => v_flex().w_full().gap(4).pt(8)
        .when(!!q.title, (e) => e.child(sans(12, t.dim, `${q.q} · ${q.title}`)))
        .children(q.options.map((o) => h_flex().id(`${r.key}:${q.q}${o.key}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6)
          .bg(o.armed || o.flash ? t.accent : t.raised).when(o.picked, (e) => e.border_1().border_color(t.accent))
          .on_click((_e, cx) => { this.q = q.q; this.askKey(a, o.key, cx); })
          .child(this.keycap(t, o.key)).child(sans(13, o.armed || o.flash ? t.background : t.foreground, o.label).when(!o.then, (e) => e.flex_1()).min_w(0).truncate())
          .when(!!o.then, (e) => e.child(sans(11, o.armed ? t.background : t.dim, `→ ${o.then}`).flex_1().min_w(0).truncate()))
          .when(o.rec && !o.armed, (e) => e.child(sans(11, t.done, "↵").flex_none()))
          .when(o.armed, (e) => e.child(sans(11, t.background, "press again to send")))))))
      .when(!!st, (e) => e.child(this.statusLine(t, st)))
      .when(this.checklist?.id === a.id, (e) => e.child(v_flex().w_full().gap(2).pt(8)
        .children(v.targets.map((tg, i) => h_flex().id(`${r.key}:t${i}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6).bg(this.checklist.cur === i ? t.selected : t.raised)
          .child(mono(12, t.foreground, this.checklist.chosen.includes(tg.id) ? "[x]" : "[ ]")).child(sans(13, t.foreground, tg.label)).child(div().flex_1())))
        .child(sans(11, t.dim, "space toggles · ↵ sends (none = hold all) · esc cancels"))))
      .when(this.input?.id === a.id, (e) => e.child(v_flex().w_full().gap(2).pt(8)
        .child(sans(12, t.muted, this.input.mode === "other" ? "Your own answer" : "Note"))
        .child(h_flex().w_full().h(ROW).px(8).items_center().rounded(6).bg(t.raised).border_1().border_color(t.accent).child(sans(13, t.foreground, `${this.input.text}▏`)))
        .child(sans(11, t.dim, this.input.mode === "other" ? "↵ send as your answer · the agent applies it or replies here · esc cancel" : "↵ send alone · tab keep for your pick · esc cancel"))))
      .when(!!v.plan, (e) => e.child(v_flex().id(`${r.key}:plan`).w_full().pt(8).gap(2)
        .on_click(() => perform({ type: "open", target: v.plan.full }, { run, exec, pane: null }))
        .child(h_flex().gap(8).items_center().child(sans(13, t.accent, v.plan.line)).child(this.keycap(t, "p")))
        .child(mono(11, t.dim, v.plan.full).w_full().truncate())))
      .when(!!v.body, (e) => e.child(div().id(`${r.key}:body`).w_full().max_h(160).overflow_y_scrollbar().pt(4).child(sans(12, t.muted, v.body))))
      .when(!!v.status, (e) => e.child(sans(12, t.muted, v.status).pt(4)));
  }

  // an answered ask until it is applied: sent, received, done; ten minutes unapplied reads "not picked up" and the . key nudges
  answered(t, r) {
    const a = r.row, sel = r.key === this.sel, mark = (on) => (on ? "✓" : "–");
    return v_flex().id(r.key).w_full().flex_none().px(14).py(8).gap(2).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click(() => this.select(r))
      .child(h_flex().w_full().gap(8).items_baseline().child(mono(13, t.foreground, shortCard(a.card))).child(sans(13, t.foreground, a.title).flex_1().min_w(0).truncate()).child(mono(12, t.muted, ageText(a.ageMs))))
      .child(h_flex().w_full().gap(10).items_baseline().child(sans(12, t.muted, `sent ${mark(a.sent)} · received ${mark(a.received)} · done ${mark(a.done)}`))
        .when(a.notPickedUp, (e) => e.child(sans(12, t.blocked, "not picked up")).when(sel, (e2) => e2.child(this.keycap(t, ".")))))
      .when(sel, (e) => e.child(sans(12, t.dim, `You answered: ${String(a.pick).split("\n").join(" · ")}`)));
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
    const toDesk = typing ? this.input.thread === "desk" : pane.kind === "desk" || pane.kind === "empty";
    const to = toDesk ? vm.desk.name : pane.kind === "ask" && pane.ask.terminal ? `${pane.ask.terminal} · agent behind this ask` : "agent behind this ask";
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
    const tab = this.tab(), plan = tab ? this.syncTab(tab, vm, pane, cx, `${curRow?.key}|${pane.ask?.id}`) : null;
    const threadOf = (id) => this.thread(t, vm.threads[id] ?? [], id);
    const picker = this.picker ? [v_flex().w_full().px(14).py(8).gap(2).child(sans(12, t.dim, "Switch to")).children(liveAgents(vm).map((a, i) => h_flex().id(`pick:${a.address}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6).bg(this.picker.cur === i ? t.selected : t.raised)
      .on_click((_e, cx2) => { this.picker = null; this.pinned = a.address; cx2.notify(); }).child(sans(13, t.foreground, a.name).flex_1().min_w(0)).child(sans(12, t.muted, a.state ?? "starting")))).child(sans(11, t.dim, "↑ ↓ move · ↵ show and pin · esc cancel"))] : [];
    const nl = narrow ? narrowLanes(vm.lanes, pane.kind === "ask" ? pane.batch.lane : null) : null;
    const newDesk = deskNew(vm.threads);
    // top: the desk (first, never counted), then the four lanes with their batches; narrow: the current batch's lane and one line for the rest
    const laneRows = (l, only) => [
      h_flex().w_full().flex_none().px(14).pt(10).pb(2).gap(8).items_baseline().child(div().text_size(11).text_color(t.dim).child(l.label)).child(mono(11, l.count ? t.muted : t.dim, String(l.count))),
      ...l.batches.filter((b) => !only || (pane.kind === "ask" && b.key === pane.batch.key)).flatMap((b) => draw(byKey.get(`batch:${b.key}`), (r) => this.batch(t, r))),
    ];
    const curBatches = (nl?.current?.batches ?? []).filter((b) => pane.kind === "ask" && b.key === pane.batch.key).flatMap((b) => draw(byKey.get(`batch:${b.key}`), (r) => this.batch(t, r)));
    const leftEl = () => v_flex().w_full().flex_none().gap(2)
      .when(!narrow, (e) => e.child(this.line(t, byKey.get("desk"), [vm.desk.name, newDesk ? `${newDesk} new` : "", vm.desk.state], tone(vm.desk.state))))
      .children(narrow ? [sans(11, t.dim, lanesLine(vm.lanes)).w_full().flex_none().px(14).pt(8), ...curBatches] : vm.lanes.flatMap((l) => laneRows(l, false)));
    // below: follows the selected row: the desk thread, one ask with its thread, an answered ask with its thread, or the empty inbox
    // an answered ask leaves the open list at once: its status stays on screen until the owner acts on something else
    const shown = pane.kind === "ask" ? pane.ask.id : pane.kind === "desk" ? "desk" : pane.kind === "answered" ? pane.thread : null;
    const away = this.recent && this.recent !== shown ? this.status.get(this.recent) : null;
    const rightEl = () => v_flex().w_full().flex_none().min_w(0).gap(4)
      .children([...(away ? [v_flex().w_full().px(14).child(this.statusLine(t, away))] : []), ...(pane.kind === "desk"
        ? [v_flex().w_full().px(14).py(10).gap(4).child(sans(14, t.foreground, "Desk")).child(sans(12, t.dim, "General messages · / to write · ↵ shows the terminal")).when(this.status.has("desk"), (e) => e.child(this.statusLine(t, this.status.get("desk")))).child(threadOf("desk"))]
        : pane.kind === "ask"
          ? [this.ask(t, pane.ask, `ask ${pane.batch.asks.indexOf(pane.ask) + 1} of ${pane.batch.asks.length}`, vm), v_flex().w_full().px(14).child(threadOf(pane.thread))]
          : pane.kind === "answered"
            ? [v_flex().w_full().px(14).py(10).gap(4).child(sans(14, t.foreground, pane.answered.title)).child(sans(12, t.muted, `You answered: ${String(pane.answered.pick).split("\n").join(" · ")}`))
              .child(sans(12, t.dim, `sent ${pane.answered.sent ? "✓" : "–"} · received ${pane.answered.received ? "✓" : "–"} · done ${pane.answered.done ? "✓" : "–"}`)).when(this.status.has(pane.thread), (e) => e.child(this.statusLine(t, this.status.get(pane.thread)))).child(threadOf(pane.thread))]
            : vm.batches.length
              ? [v_flex().w_full().px(14).py(24).child(sans(12, t.dim, "↵ shows the terminal · ↑ ↓ back to a batch"))]
              : [v_flex().w_full().px(14).py(24).gap(4).child(sans(16, t.foreground, "Nothing needs you.")).child(sans(12, t.dim, "Type below to message the desk."))])]);
    // stacked at every width: the batch list on top, the open ask below it at full width; the message box is the bar under the scrolling body
    const asksBody = [rightEl(), this.chatBar(t, pane, vm), leftEl()];
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
      ...(vm.answered.length ? [this.label(t, "Answered, not applied yet"), ...vm.answered.flatMap((a) => draw(byKey.get(`answered:${a.id}`), (r) => this.answered(t, r)))] : []),
      ...(waiting ? draw(byKey.get("summary:running"), (r) => this.summary(t, r)) : []),
      ...(!waiting || this.showRun ? runBody() : []),
      ...(vm.othersLine ? [sans(12, t.dim, vm.othersLine).w_full().flex_none().px(14).pt(12)] : []),
    ];

    return v_flex().id("agents-view").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx2) => { if (isNarrow(size.width) !== isNarrow(this.width ?? 0)) { this.width = size.width; cx2.notify(); } else this.width = size.width; })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(sans(13, t.foreground, "Inbox").font_semibold()).child(sans(12, t.muted, headerLine(vm).inbox)).when(!tab, (e) => e.child(sans(11, t.dim, "· i opens the tab"))).child(div().flex_1()).child(sans(12, t.dim, headerLine(vm).run)))
      .child(v_flex().id("av-body").w_full().flex_1().min_h(props()?.overlay ? POPUP_BODY_H : 0).overflow_y_scrollbar().children(body))
      .child(div().w_full().flex_none().px(14).py(4).border_t(1).border_color(t.border).child(sans(11, t.dim, footerHint(rows[this.selIdx]?.section))))
      // the header of the pane below (the Inbox tab): who it shows, what it is doing, and how to talk to it
      .when(!!plan, (e) => e.child(h_flex().w_full().flex_none().px(14).py(6).gap(8).items_baseline().border_t(1).border_color(t.border)
        .child(sans(12, plan.dim ? t.dim : t.foreground, plan.head)).child(div().flex_1()).child(sans(11, t.dim, plan.hint))))
      // the phone's bottom bar: Picture, Own idea, Go to agent (a peek of the terminal, full screen)
      .when(narrow, (e) => e.child(h_flex().w_full().flex_none().px(14).py(8).gap(8).border_t(1).border_color(t.border)
        .children(phoneBar(!!this.agentFor(curRow, pane.kind === "ask" ? pane.ask : null, vm)).map((b) => h_flex().id(`bar:${b.key}`).flex_1().h(ROW + 8).items_center().justify_center().rounded(6).bg(t.raised)
          .on_click((_e, cx2) => this.phoneKey(b.key, cx2)).child(sans(13, t.foreground, b.label))))))
      .child(div().w_full().flex_none().px(14).py(8).child(this.note ? sans(12, t.foreground, this.note) : mono(11, vm.usageWarn ? t.working : t.dim, vm.usage)));
  }
}
