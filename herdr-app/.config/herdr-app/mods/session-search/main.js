// Search Claude Code sessions: title/folder filter instantly, transcript content via sessions.py (rg).
// Enter focuses the session if it's live, else resumes it in a new tab. Opened by ctrl-b s.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, terminals, focused, spaces, theme, props, closeOverlay, appHome, home } from "herdr";
import { visibleRows, moveSel, createSearch, shortPath, age, liveSessions, actionFor } from "./lib.js";

const ROWS = 12;
const ROW_H = 40;
const helper = (...args) => exec("python3", ["-I", `${appHome()}/mods/session-search/sessions.py`, ...args]).then((r) => JSON.parse(r.stdout));

export default class SessionSearch extends View {
  init(_props, cx) {
    this.all = [];
    this.q = "";
    this.at = 0;
    this.top = 0;
    this.search = createSearch();
    this.input = InputState.new({ placeholder: "Search sessions: title, folder, transcript…" });
    this.input.on("change", (_e, cx) => this.onQuery(this.input.value(), cx));
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    helper("list").then((rows) => { this.all = rows; cx.notify(); }, () => {});
  }

  rows() {
    return visibleRows(this.all, this.q, this.search.hits());
  }

  onQuery(q, cx) {
    this.q = q;
    this.at = this.top = 0;
    const token = this.search.begin(q);
    cx.notify();
    if (!token) return;
    // Debounce: only the latest keystroke in 150 ms actually searches.
    cx.timer.after(150, () => {
      if (!this.search.current(token)) return;
      helper("search", q).then((rows) => { if (this.search.accept(token, rows)) cx.notify(); }, () => {});
    });
  }

  go(r) {
    if (!r) return;
    const f = focused();
    const local = f && spaces().find((s) => s.id === f.space && !s.machine);
    const a = actionFor(r, liveSessions(terminals()), local ? local.id : null);
    closeOverlay(props().overlay);
    run(a.name, a.args);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const live = liveSessions(terminals());
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    const h = home();
    const now = Date.now();

    const row = (r, i) => {
      const on = i === this.at;
      return h_flex()
        .id(`ss-${r.id}`)
        .mx(4)
        .px(10)
        .h(ROW_H)
        .flex_none()
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(div().w(10).flex_none().text_color(live.has(r.id) ? t.working : t.dim).child(live.has(r.id) ? "●" : ""))
        .child(div().flex_1().truncate().text_color(t.foreground).child(r.title))
        .child(div().max_w(240).truncate().text_size(11).text_color(t.dim).child(shortPath(r.cwd, h)))
        .child(div().w(32).flex_none().text_size(11).text_color(t.dim).child(age(r.mtime, now)));
    };

    return v_flex()
      .id("session-search")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return closeOverlay(props().overlay);
        if (k === "down") this.at = moveSel(this.at, rows.length, 1);
        else if (k === "up") this.at = moveSel(this.at, rows.length, -1);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Sessions")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex().id("ss-list").h(ROWS * ROW_H).min_h(0).overflow_hidden()
          .children(rows.slice(this.top, this.top + ROWS).map((r, i) => row(r, this.top + i))),
      );
  }
}
