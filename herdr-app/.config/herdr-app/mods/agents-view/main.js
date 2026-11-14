// Agents view: leads, workers, questions waiting on the owner, and what is stuck. Reads terminals(), asks.jsonl,
// events.jsonl, the runner's up-next.json and the usage file; no network. The logic is in lib.js (tested with node --test); this file reads, draws and handles keys.
// A side panel (the `agents-view` block of layouts/main-agents.json, opened by the Agents button of the tabs-agents mod): Enter shows the
// selected terminal in the main pane (terminal.show) and a key on an ask posts the answer through `work ask answer`.
// When ~/.config/herdr-app/agents-view-fixture/ exists it is read instead of the live run files (screenshots only).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, props, terminals, panes, focused, theme, readTextFile, home, closeOverlay } from "herdr";
import { viewModel, flatRows, ageText, shortCard, askKeyAction, answerArgv, isAskKey, composeAnswer, picksText, selectTarget, rightPaneId, perform, runFiles, askView } from "./lib.js";

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
    this.files = { asks: null, events: null, usage: null, upNext: null };
    this.sel = null; this.selIdx = 0; this.armed = null; this.q = 1; this.hidden = new Set(); this.picks = new Map(); this.shown = null; this.note = "";
    this.read(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.read(cx));
  }

  async read(cx) {
    // the fixture folder wins when it holds any of the four files; one read of each, no subprocess
    const read1 = (p) => readTextFile(p).catch(() => null);
    let f = runFiles(home(), true), got = await Promise.all([f.asks, f.events, f.usage, f.upNext].map(read1));
    this.fixture = got.some((x) => x != null);
    if (!this.fixture) { f = runFiles(home(), false); got = await Promise.all([f.asks, f.events, f.usage, f.upNext].map(read1)); }
    const [asks, events, usage, upNext] = got;
    this.files = { asks, events, usage, upNext };
    if (this.armed && Date.now() - this.armed.at > 10_000) this.armed = null;
    this.note = ""; // a note lasts one refresh, so the usage warning comes back
    this.deskIfGone();
    cx.notify();
  }

  model() {
    const vm = viewModel({ terminals: terminals(), asksText: this.files.asks, eventsText: this.files.events, usageJson: this.files.usage, upNextJson: this.files.upNext, nowMs: Date.now(), hiddenIds: this.hidden });
    return { vm, rows: flatRows(vm).filter((r) => r.section !== "others") }; // other sessions show as one count line
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

  // a key on an open ask: post the answer, open its plan, or arm a merge/roll/money answer for its second key
  askKey(a, k, cx) {
    this.note = "";
    if (/^[1-9]$/.test(k) && a.options.some((o) => String(o.q) === k)) { this.q = Number(k); this.armed = null; return cx.notify(); }
    let r = askKeyAction(a, k, this.armed, Date.now(), this.q);
    if (!r) return;
    this.armed = r.type === "arm" ? r.armed : null;
    if (r.type === "pick") { // kept by id, so a refreshed row keeps its picks
      const picks = { ...this.picks.get(a.id), [r.q]: r.text }; this.picks.set(a.id, picks);
      const text = composeAnswer(a, picks);
      if (text == null) { this.note = `picked ${r.text.split(":")[0]}`; return cx.notify(); }
      r = { type: "post", text };
    }
    if (r.type === "post") {
      if (this.fixture) { this.note = "fixture data: nothing sent"; return cx.notify(); } // screenshots never answer a real ask
      if (this.hidden.has(a.id)) return; // a post for this ask is in flight or done
      this.hidden.add(a.id);
      perform({ type: "post", argv: answerArgv(a, r.text) }, { run, exec, pane: null }).then((x) => {
        if (x?.code === 0) this.note = `answered ${shortCard(a.card)}`; else { this.hidden.delete(a.id); this.note = "answer failed"; }
        cx.notify();
      });
    }
    else if (r.type === "open") perform(r, { run, exec, pane: null });
    else if (r.type === "arm") this.note = `${r.body || "no details"} · press ${k} again within 10s to send`;
    cx.notify();
  }

  key(e, cx) {
    const k = e.keystroke;
    const { rows } = this.model();
    const cur = rows[this.selIdx];
    if (cur?.section === "asks" && isAskKey(cur.row, k, this.armed)) { cx.stop_propagation(); return this.askKey(cur.row, k, cx); }
    this.armed = null; // navigation cancels an armed answer and still moves
    if (!["escape", "enter", "down", "up", "j", "k"].includes(k)) return;
    cx.stop_propagation();
    if (k === "escape") return props()?.overlay ? closeOverlay(props()?.overlay) : undefined;
    if (k === "enter") return this.open(rows[this.selIdx]);
    this.selIdx = Math.max(0, Math.min(rows.length - 1, this.selIdx + (k === "down" || k === "j" ? 1 : -1))); this.q = 1;
    this.sel = rows[this.selIdx]?.key ?? null;
    cx.notify();
  }

  open(r) {
    if (!r || r.section === "asks" || this.fixture) return; // fixture rows are not real terminals
    const t = selectTarget(r, `${home()}/workspace/vasu`);
    if (t?.show) this.show(t.show);
    else if (t?.start) perform({ type: "start-desk", argv: t.start }, { run, exec, pane: this.pane() });
  }

  section(t, label, count, red) {
    return h_flex().w_full().flex_none().px(14).pt(16).pb(4).gap(8).items_baseline()
      .child(div().text_size(12).text_color(t.muted).child(label)).child(mono(11, red ? t.blocked : t.dim, String(count)));
  }

  empty(t, text) { return div().w_full().flex_none().px(14).py(4).text_size(13).text_color(t.dim).child(text); }

  label(t, text) { return div().w_full().flex_none().px(14).pt(8).text_size(12).text_color(t.dim).child(text); }

  keycap(t, k) {
    return div().min_w(18).h(18).px(4).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).font_family(MONO).text_size(11).text_color(t.muted).child(k);
  }

  // an ask: card, kind and age over the first line of the question; selected, it opens in place with its options as buttons
  ask(t, r) {
    const a = r.row, sel = r.key === this.sel;
    const v = askView(a, this.picks.get(a.id) ?? {}, this.armed);
    const el = v_flex().id(r.key).w_full().flex_none().px(14).py(8).gap(2).when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click(() => { if (this.sel !== r.key) { this.sel = r.key; this.q = 1; } })
      .child(h_flex().w_full().gap(8).items_baseline().child(mono(13, t.foreground, v.card)).child(sans(12, t.muted, v.kind)).child(div().flex_1()).child(mono(12, t.muted, v.age)))
      .child(sans(13, t.foreground, v.title).w_full().when(!sel, (e) => e.truncate()));
    if (!sel) return el;
    return el.when(!!v.body, (e) => e.child(sans(12, t.muted, v.body).pt(4)))
      .children(v.questions.map((q) => v_flex().w_full().gap(4).pt(8)
        .when(!!q.title, (e) => e.child(sans(12, t.dim, `${q.q} · ${q.title}`)))
        .children(q.options.map((o) => h_flex().id(`${r.key}:${q.q}${o.key}`).w_full().h(ROW).px(8).gap(10).items_center().rounded(6)
          .bg(o.armed ? t.accent : t.raised).when(o.picked, (e) => e.border_1().border_color(t.accent))
          .on_click((_e, cx) => { this.q = q.q; this.askKey(a, o.key, cx); })
          .child(this.keycap(t, o.key)).child(sans(13, o.armed ? t.background : t.foreground, o.label).flex_1().min_w(0).truncate())
          .when(o.armed, (e) => e.child(sans(11, t.background, "press again to send")))))))
      .when(!!v.status, (e) => e.child(sans(12, t.muted, v.status).pt(4)));
  }

  // one running, stuck or desk row: a status dot, the name, a muted middle, a state on the right
  line(t, r, parts, tone) {
    const sel = r.key === this.sel;
    return h_flex().id(r.key).w_full().h(ROW).flex_none().px(14).gap(8).items_center().when(sel, (e) => e.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click(() => { this.sel = r.key; this.open(r); })
      .child(div().size(6).flex_none().rounded(3).bg(tone ?? t.dim))
      .child(sans(13, t.foreground, parts[0]).flex_1().min_w(72).truncate())
      .child(mono(12, t.muted, parts[1] ?? "").flex_none())
      .child(sans(12, t.muted, parts[2] ?? "").max_w(180).truncate());
  }

  render(cx) {
    const t = theme();
    const { vm, rows } = this.model();
    const keys = rows.map((r) => r.key);
    if (!keys.includes(this.sel)) this.sel = keys[Math.min(this.selIdx, keys.length - 1)] ?? null;
    this.selIdx = Math.max(0, keys.indexOf(this.sel));
    const at = (section, i) => rows.filter((r) => r.section === section)[i];
    const tone = (s) => (s === "blocked" || s === "error" ? t.blocked : s === "working" ? t.working : s === "done" ? t.done : t.dim);

    const runCount = vm.groups.reduce((n, g) => n + g.rows.length, 0) + vm.sides.length;
    const body = [
      this.section(t, "Needs you", vm.asks.length, vm.asksOld),
      ...(vm.asks.length ? vm.asks.map((a, i) => this.ask(t, at("asks", i))) : [this.empty(t, "No questions waiting")]),
      this.section(t, "Running", runCount, false),
      ...(runCount ? [] : [this.empty(t, "Nothing running")]),
      ...vm.groups.flatMap((g) => {
        const first = rows.findIndex((r) => r.section === "group" && r.address === g.rows[0].address);
        return [this.label(t, g.epic), ...g.rows.map((r, i) => this.line(t, rows[first + i], [r.name, r.role === "worker" ? r.model ?? "" : "", r.state], tone(r.state)))];
      }),
      ...(vm.sides.length ? [this.label(t, "Side jobs"), ...vm.sides.map((s, i) => this.line(t, at("side", i), [s.name, [s.card && shortCard(s.card)].filter(Boolean).join(""), s.state], tone(s.state)))] : []),
      this.label(t, "General"),
      this.line(t, at("desk", 0), [vm.desk.name, "", vm.desk.state], tone(vm.desk.state)),
      ...(vm.stuck.length ? [this.section(t, "Stuck", vm.stuck.length, true), ...vm.stuck.map((s, i) => this.line(t, at("stuck", i), [s.name, "", [s.text, s.ageMs == null ? "" : ageText(s.ageMs)].filter(Boolean).join(" · ")], t.blocked))] : []),
      ...(vm.upNext ? [mono(12, t.muted, vm.upNext).w_full().flex_none().px(14).pt(12)] : []),
      ...(vm.othersLine ? [sans(12, t.dim, vm.othersLine).w_full().flex_none().px(14).pt(12)] : []),
    ];

    return v_flex().id("agents-view").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(sans(13, t.foreground, "Agents").font_semibold()).child(div().flex_1()).child(sans(12, t.dim, "j k move · ↵ show terminal")))
      .child(v_flex().id("av-body").w_full().flex_1().min_h(props()?.overlay ? POPUP_BODY_H : 0).overflow_y_scrollbar().children(body))
      .child(div().w_full().flex_none().px(14).py(8).child(this.note ? sans(12, t.foreground, this.note) : mono(11, vm.usageWarn ? t.working : t.dim, vm.usage)));
  }
}
