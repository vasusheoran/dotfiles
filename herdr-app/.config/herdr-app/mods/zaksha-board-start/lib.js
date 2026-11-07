// The start dialog's logic, with no herdr or gpui imports so zaksha-board/lib.test.js can run it.
// (A mod can't import a sibling mod, so this lives here, not in zaksha-board/lib.js.)

// Keys as a pure step: state {mode, typing}, key -> {state, action}.
// action: "start" | "cancel" | "focus-notes" | "blur-notes" | null. Esc leaves the input first, then cancels.
export function dialogKey(state, key) {
  if (state.typing) {
    if (key === "enter") return { state, action: "start" };
    if (key === "escape") return { state: { ...state, typing: false }, action: "blur-notes" };
    return { state, action: null };
  }
  if (key === "n") return { state: { ...state, typing: true }, action: "focus-notes" };
  if (key === "w") return { state: { ...state, mode: "work" }, action: null };
  if (key === "q") return { state: { ...state, mode: "quick" }, action: null };
  if (key === "enter") return { state, action: "start" };
  if (key === "escape") return { state, action: "cancel" };
  return { state, action: null };
}
