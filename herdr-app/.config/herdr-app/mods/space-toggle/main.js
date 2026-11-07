// Space toggle: ctrl-tab flips to the space and tab you were in before (history recorded by zaksha-board).
// Opened as a 1px popup from keys.json (mod.open:space-toggle): acts, then closes itself.
import { View, div } from "gpui-kit";
import { run, props, focused, shared, closeOverlay, notify } from "herdr";
import { pickPrevious } from "./lib.js";

export default class SpaceToggle extends View {
  init() {
    const to = pickPrevious(shared("space-toggle.history") ?? [], focused());
    if (to) { run("space.select", { id: to.space }); run("tab.select", { id: to.tab }); }
    else notify({ title: "No previous space", timeout: 2000 });
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  render() { return div(); }
}
