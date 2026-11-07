// The board's "Start /work" dialog: confirm plus optional notes for the agent.
// Props { title, detail, command: { name } }. Enter or cmd-Enter starts, Esc cancels.
// The notes ride in shared state to zaksha-board (nextCommand carries a name only); zaksha-board.start reads and clears them.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, setShared } from "herdr";

export const NOTES_KEY = "zaksha-board.notes";

export default class StartDialog extends View {
  init(_props, cx) {
    this.input = InputState.new({ placeholder: "e.g. use the v2 API, skip the migration" });
    this.focused = true;
    this.input.on("submit", () => this.start());
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.focused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  start() {
    const p = props();
    setShared(NOTES_KEY, this.input.value());
    closeOverlay(p.overlay);
    run(p.command.name, p.command.args ?? {});
  }

  key(e, cx) {
    if (e.key === "escape") closeOverlay(props().overlay);
    else if (e.key === "enter" && (e.modifiers?.platform || e.modifiers?.control)) this.start();
    else return;
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("start-work").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(p.title ?? "Start /work?")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(6).text_size(13).text_color(t.muted).child(p.detail ?? ""))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Notes for the agent (optional)"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.focused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("sw-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("sw-start", "Start", true, () => this.start())));
  }
}
