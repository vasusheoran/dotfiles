// Agents view: leads, workers, questions waiting on the owner, and what is stuck. Reads terminals(), asks.jsonl,
// events.jsonl, the runner's up-next.json and the usage file; no network. The logic is in lib.js (tested with node --test); this file reads, draws and handles keys.
// Opened from keys.json as mod.open {"name": "agents-view"}, or as the left block of layouts/control-room.json, where Enter shows the
// selected terminal in the right-hand pane (terminal.show) and a key on an ask posts the answer through `work ask answer`.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, props, terminals, panes, focused, theme, readTextFile, home, closeOverlay } from "herdr";
import { viewModel, flatRows, ageText, shortCard, askKeyAction, answerArgv, isAskKey, selectTarget, rightPaneId, perform } from "./lib.js";

const MONO = "JetBrains Mono";
const SANS = "Geist";
const REFRESH_MS = 5000;
const H = { lane: 30, row: 28, two: 46, empty: 30 };

const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);

export default class AgentsView extends View {
  init(_props, cx) {
    this.h = cx.focus_handle();
    this.h.focus();
    this.files = { asks: null, events: null, usage: null, upNext: null };
    this.sel = null; this.selIdx = 0; this.armed = null; this.q = 1; this.hidden = new Set(); this.shown = null; this.note = "";
    this.read(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.read(cx));
  }

  async read(cx) {
    const dir = `${home()}/handoffs/run`;
    const [asks, events, usage, upNext] = await Promise.all([`${dir}/asks.jsonl`, `${dir}/events.jsonl`, `${home()}/.claude/.usage-cache.json`, `${dir}/up-next.json`]
      .map((p) => readTextFile(p).catch(() => null)));
    this.files = { asks, events, usage, upNext };
    if (this.armed && Date.now() - this.armed.at > 10_000) this.armed = null;
    this.deskIfGone();
    cx.notify();
  }

  model() {
    const vm = viewModel({ terminals: terminals(), asksText: this.files.asks, eventsText: this.files.events, usageJson: this.files.usage, upNextJson: this.files.upNext, nowMs: Date.now(), hiddenUrls: this.hidden });
    return { vm, rows: flatRows(vm) };
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
    const r = askKeyAction(a, k, this.armed, Date.now(), this.q);
    if (!r) return;
    this.armed = r.type === "arm" ? r.armed : null;
    if (r.type === "post") {
      if (this.hidden.has(a.url)) return; // a post for this ask is in flight or done
      this.hidden.add(a.url);
      perform({ type: "post", argv: answerArgv(a, r.text) }, { run, exec, pane: null }).then((x) => {
        if (x?.code === 0) this.note = `answered ${shortCard(a.card)}`; else { this.hidden.delete(a.url); this.note = "answer failed"; }
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
    if (k === "escape") return props().overlay ? closeOverlay(props().overlay) : undefined;
    if (k === "enter") return this.open(rows[this.selIdx]);
    this.selIdx = Math.max(0, Math.min(rows.length - 1, this.selIdx + (k === "down" || k === "j" ? 1 : -1))); this.q = 1;
    this.sel = rows[this.selIdx]?.key ?? null;
    cx.notify();
  }

  open(r) {
    if (!r || r.section === "asks") return;
    const t = selectTarget(r, `${home()}/workspace/vasu`);
    if (t?.show) this.show(t.show);
    else if (t?.start) perform({ type: "start-desk", argv: t.start }, { run, exec, pane: this.pane() });
  }

  lane(t, label, count, tone) {
    return h_flex().w_full().h(H.lane).flex_none().px(14).pt(6).gap(8).items_center().border_b(1).border_color(t.border)
      .child(sans(11, tone, label.toUpperCase()).font_semibold()).child(sans(11, t.dim, String(count)));
  }

  empty(t, text) {
    return div().w_full().h(H.empty).flex_none().pl(28).flex().items_center().child(sans(12, t.dim, text).italic());
  }

  // one row: left name, a middle text, a right state; `second` is an optional line below
  line(t, r, cols, second) {
    const sel = r.key === this.sel;
    const first = h_flex().w_full().h(H.row - 2).gap(8).items_center()
      .child(sans(13, t.foreground, cols[0]).w(220).flex_none().truncate())
      .child(sans(12, t.muted, cols[1]).flex_1().min_w(0).truncate())
      .child(sans(12, cols[3] ?? t.muted, cols[2]).flex_none());
    return v_flex().id(r.key).w_full().h(second ? H.two : H.row).flex_none().px(14).pt(1).border_l_2()
      .border_color(sel ? t.accent : t.background).when(sel, (el) => el.bg(t.selected))
      .on_click(() => { this.sel = r.key; this.open(r); })
      .child(first)
      .when(!!second, (el) => el.child(sans(11, t.blocked, second).pl(220).truncate()));
  }

  render(cx) {
    const t = theme();
    const { vm, rows } = this.model();
    const keys = rows.map((r) => r.key);
    if (!keys.includes(this.sel)) this.sel = keys[Math.min(this.selIdx, keys.length - 1)] ?? null;
    this.selIdx = Math.max(0, keys.indexOf(this.sel));
    const at = (section, i) => rows.filter((r) => r.section === section)[i];
    const tone = (s) => (s === "blocked" || s === "error" ? t.blocked : s === "working" ? t.working : s === "done" ? t.done : t.muted);

    const running = vm.groups.length + vm.sides.length;
    const body = [
      this.lane(t, "Needs you", vm.asks.length, t.blocked),
      ...(vm.asks.length ? vm.asks.map((a, i) => this.line(t, at("asks", i), [shortCard(a.card), a.from === "lead" ? "from lead" : "", `waiting ${ageText(a.ageMs)}`], `${a.question}${a.options.length ? ` · q${this.q}: ` + a.options.filter((o) => o.q === this.q).map((o) => `${o.key} ${o.label}`).join(" · ") : ""}`)) : [this.empty(t, "No questions waiting.")]),
      this.lane(t, "Running", running, t.muted),
      ...(running ? [] : [this.empty(t, "Nothing running.")]),
      ...vm.groups.flatMap((g) => {
        const first = rows.findIndex((r) => r.section === "group" && r.address === g.rows[0].address);
        return [sans(11, t.muted, shortCard(g.epic)).px(14).pt(4).flex_none(),
          ...g.rows.map((r, i) => this.line(t, rows[first + i], [r.name, r.role === "worker" ? [r.card && shortCard(r.card), r.model].filter(Boolean).join(" · ") : "", r.state, tone(r.state)]))];
      }),
      ...vm.sides.map((s, i) => this.line(t, at("side", i), [s.name, ["side job", s.card && shortCard(s.card), s.model].filter(Boolean).join(" · "), s.state, tone(s.state)])),
      this.lane(t, "General", 1, t.muted),
      this.line(t, at("desk", 0), [vm.desk.name, "", vm.desk.state, tone(vm.desk.state)]),
      this.lane(t, "Stuck", vm.stuck.length, t.blocked),
      ...(vm.stuck.length ? vm.stuck.map((s, i) => this.line(t, at("stuck", i), [s.name, s.text, s.ageMs == null ? "" : ageText(s.ageMs)])) : [this.empty(t, "Nothing stuck.")]),
      ...(vm.others.length ? [this.lane(t, "Other sessions", vm.others.length, t.muted),
        ...vm.others.map((o, i) => this.line(t, at("others", i), [o.name, o.where ?? "", o.state, tone(o.state)]))] : []),
    ];

    return v_flex().id("agents-view").size_full().bg(t.background)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().flex_none().px(14).py(8).gap(10).items_center().border_b(1).border_color(t.border)
        .child(sans(14, t.foreground, "Agents view").font_semibold()).child(div().flex_1()).child(mono(11, vm.usageWarn ? t.blocked : t.muted, vm.usage)))
      .when(!!vm.upNext, (el) => el.child(div().w_full().flex_none().px(14).py(5).border_b(1).border_color(t.border).child(mono(12, t.foreground, vm.upNext))))
      .child(v_flex().id("av-body").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(body))
      .child(h_flex().w_full().flex_none().gap(14).px(14).py(5).bg(t.chrome).border_t(1).border_color(t.border)
        .child(sans(11, this.note ? t.foreground : t.muted, this.note || "j k move · ↵ show terminal · on an ask: option key · x done · v plan · esc close")));
  }
}
