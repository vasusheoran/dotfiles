// The board's start dialog: pick /work, Quick or Brief, add optional notes. Props { title, detail, command: { name } }.
// Keys are dialogKey in ./lib.js. Mode and notes ride in shared state to zaksha-board
// (nextCommand carries a name only); zaksha-board.start reads and clears them.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, setShared } from "herdr";
import { dialogKey } from "./lib.js";

export const NOTES_KEY = "zaksha-board.notes";
export const MODE_KEY = "zaksha-board.mode";

export default class StartDialog extends View {
  init(_props, cx) {
    this.input = InputState.new({ placeholder: "e.g. use the v2 API, skip the migration" });
    this.st = { mode: "work", typing: false };
    this.handle = cx.focus_handle();
    this.input.on("submit", () => this.start());
    this.input.on("focus", (_e, cx) => { this.st = { ...this.st, typing: true }; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.st = { ...this.st, typing: false }; cx.notify(); });
    this.handle.focus();
    cx.timer.after(600, () => { if (!this.st.typing) this.handle.focus(); });
  }

  start() {
    const p = props();
    setShared(NOTES_KEY, this.input.value());
    setShared(MODE_KEY, this.st.mode);
    closeOverlay(p.overlay);
    run(p.command.name, p.command.args ?? {});
  }

  // While typing, Enter is the input's own submit; dialogKey only adds Esc there.
  key(e, cx) {
    const k = e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control) ? "enter" : e.key;
    if (this.st.typing && k === "enter" && !e.modifiers?.platform && !e.modifiers?.control) return;
    const before = this.st;
    const { state, action } = dialogKey(before, k);
    this.st = state;
    if (action === "start") this.start();
    else if (action === "cancel") closeOverlay(props().overlay);
    else if (action === "focus-notes") this.input.focus();
    else if (action === "blur-notes") this.handle.focus();
    else if (state === before) return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    const choice = (id, mode, text) => {
      const on = this.st.mode === mode;
      return h_flex().id(id).flex_1().h(30).items_center().justify_center().rounded(7)
        .bg(on ? t.solid : t.raised).text_color(on ? t.solid_foreground : t.muted).text_size(12.5).font_medium().cursor_pointer()
        .on_click((_e, cx) => { this.st = { ...this.st, mode }; cx.notify(); }).child(text);
    };
    const hints = this.st.typing ? "Enter start · Esc back" : "n notes · w /work · q Quick · b Brief · Enter start · Esc cancel";
    return v_flex().id("start-work").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child(p.title ?? "Start this issue?"))
      .child(div().pt(6).text_size(13).text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().mt(14).p(3).gap(3).rounded(9).bg(t.raised).border_1().border_color(t.input)
        .child(choice("sw-work", "work", "/work")).child(choice("sw-quick", "quick", "Quick")).child(choice("sw-brief", "brief", "Brief")))
      .child(div().pt(14).pb(7).text_size(11.5).text_color(t.dim).child("Notes for the agent (optional)"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.st.typing ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().flex_1())
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(11).text_color(t.dim).child(hints))
        .child(button("sw-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("sw-start", "Start", true, () => this.start())));
  }
}
