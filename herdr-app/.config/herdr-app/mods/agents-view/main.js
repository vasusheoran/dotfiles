// Agents view: leads, workers, questions waiting on the owner, and what is stuck. Reads terminals(), asks.jsonl,
// events.jsonl and the usage file; no network. The logic is in lib.js (tested with node --test); this file reads, draws and handles keys.
// Opened from keys.json as mod.open {"name": "agents-view"}.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, props, terminals, theme, readTextFile, home, closeOverlay } from "herdr";
import { viewModel, flatRows, ageText, shortCard } from "./lib.js";

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
    this.files = { asks: null, events: null, usage: null };
    this.sel = null; this.selIdx = 0;
    this.read(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.read(cx));
  }

  async read(cx) {
    const dir = `${home()}/handoffs/run`;
    const [asks, events, usage] = await Promise.all([`${dir}/asks.jsonl`, `${dir}/events.jsonl`, `${home()}/.claude/.usage-cache.json`]
      .map((p) => readTextFile(p).catch(() => null)));
    this.files = { asks, events, usage };
    cx.notify();
  }

  model() {
    const vm = viewModel({ terminals: terminals(), asksText: this.files.asks, eventsText: this.files.events, usageJson: this.files.usage, nowMs: Date.now() });
    return { vm, rows: flatRows(vm) };
  }

  key(e, cx) {
    const k = e.keystroke;
    if (!["escape", "enter", "down", "up", "j", "k"].includes(k)) return;
    cx.stop_propagation();
    if (k === "escape") return closeOverlay(props().overlay);
    const { rows } = this.model();
    if (k === "enter") return this.open(rows[this.selIdx]);
    this.selIdx = Math.max(0, Math.min(rows.length - 1, this.selIdx + (k === "down" || k === "j" ? 1 : -1)));
    this.sel = rows[this.selIdx]?.key ?? null;
    cx.notify();
  }

  open(r) {
    if (!r) return;
    if (r.address) { closeOverlay(props().overlay); run("agent.focus", { terminal: r.address }); }
    else if (r.url) exec("open", [r.url]).catch(() => {});
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

    const body = [
      this.lane(t, "Asks", vm.asks.length, t.blocked),
      ...(vm.asks.length ? vm.asks.map((a, i) => this.line(t, at("asks", i), [shortCard(a.card), a.from === "lead" ? "from lead" : "", `waiting ${ageText(a.ageMs)}`], a.question)) : [this.empty(t, "No questions waiting.")]),
      this.lane(t, "Stuck", vm.stuck.length, t.blocked),
      ...(vm.stuck.length ? vm.stuck.map((s, i) => this.line(t, at("stuck", i), [s.name, s.text, s.ageMs == null ? "" : ageText(s.ageMs)])) : [this.empty(t, "Nothing stuck.")]),
      ...vm.groups.flatMap((g) => {
        const first = rows.findIndex((r) => r.section === "group" && r.address === g.rows[0].address);
        return [this.lane(t, shortCard(g.epic), g.rows.length, t.muted),
          ...g.rows.map((r, i) => this.line(t, rows[first + i], [r.name, r.role === "worker" ? [r.card && shortCard(r.card), r.model].filter(Boolean).join(" · ") : "", r.state, tone(r.state)]))];
      }),
      ...(vm.others.length ? [this.lane(t, "Other sessions", vm.others.length, t.muted),
        ...vm.others.map((o, i) => this.line(t, at("others", i), [o.name, o.where ?? "", o.state, tone(o.state)]))] : []),
    ];

    return v_flex().id("agents-view").size_full().bg(t.background)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().flex_none().px(14).py(8).gap(10).items_center().border_b(1).border_color(t.border)
        .child(sans(14, t.foreground, "Agents view").font_semibold()).child(div().flex_1()).child(mono(11, t.muted, vm.usage)))
      .child(v_flex().id("av-body").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(body))
      .child(h_flex().w_full().flex_none().gap(14).px(14).py(5).bg(t.chrome).border_t(1).border_color(t.border)
        .child(sans(11, t.muted, "j k move · ↵ open terminal / ask · esc close")));
  }
}
