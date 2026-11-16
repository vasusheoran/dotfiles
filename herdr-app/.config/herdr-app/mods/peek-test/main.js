// Peek test (kuchbhi#1115): a throwaway tab that answers two questions for Herdr mobile: does a mod tab show up on the phone, and does terminal.peek
// open a terminal full screen with a back button. It shows its own width (under 640 is the phone layout of the Inbox) and one button that peeks the desk.
// Open it with ctrl-b p (keys.json mod.open:peek-test): the popup makes the tab and closes itself.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { run, props, terminals, focused, theme, closeOverlay } from "herdr";
import { deskOf } from "./lib.js";

export default class PeekTest extends View {
  init() {
    this.width = null; this.said = "not pressed yet";
    if (props()?.overlay) { run("tab.new", { ...(focused()?.space ? { space: focused().space } : {}), name: "Peek test", mod: "peek-test" }); closeOverlay(props().overlay); }
  }

  render() {
    const t = theme(), desk = deskOf(terminals());
    return v_flex().id("peek-test").size_full().p(16).gap(12).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { this.width = Math.round(size.width); cx.notify(); })
      .child(div().text_size(15).child(`This tab is ${this.width ?? "?"}px wide${this.width != null && this.width < 640 ? " · phone layout" : ""}`))
      .child(div().text_size(12).text_color(t.muted).child(desk ? `Desk: ${desk.name ?? desk.address}` : "No terminal to peek at"))
      .child(div().id("peek").px(14).h(40).flex().items_center().justify_center().rounded(8).bg(t.raised).text_size(14)
        .on_click((_e, cx) => { this.said = desk ? `terminal.peek sent for ${desk.address}` : "no terminal"; if (desk) run("terminal.peek", { terminal: desk.address }); cx.notify(); })
        .child("Peek the desk"))
      .child(div().text_size(12).text_color(t.muted).child(this.said));
  }
}
