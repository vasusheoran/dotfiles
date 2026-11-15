// The shared flag the Inbox (agents-view) reads to open its agent pane; the key in the Inbox and ctrl-b t (tabs-agents.pane) both flip it.
export const PANE_ON = "agents-view.pane";

// The Agents button and ctrl-b a: the Inbox lives in its own Herdr space (kuchbhi#1115). First time: make the space (steps, then `inboxFinish` puts the Inbox mod tab in it
// once it exists); after that: select it and focus the Inbox pane; pressed on it: go back to the space the owner came from.
// Returns { steps: [[command, args]...], back, finish } where back is the space to return to next time and finish says the mod tab still has to be made.
const MOD = "agents-view", NAME = "Inbox";
const inboxSpace = (spaces) => (spaces ?? []).find((s) => s.name === NAME);
export function spaceToggle({ spaces, panes, back }) {
  const sp = inboxSpace(spaces), active = (spaces ?? []).find((s) => s.active);
  if (!sp) return { steps: [["space.new", { name: NAME }]], back: active?.id ?? null, finish: true };
  if (active?.id === sp.id) {
    const to = (spaces ?? []).find((s) => s.id === back && s.id !== sp.id) ?? (spaces ?? []).find((s) => s.id !== sp.id);
    return { steps: to ? [["space.select", { id: to.id }]] : [], back: null, finish: false };
  }
  const own = (panes ?? []).find((p) => p.mod === MOD && sp.tabs.some((t) => t.id === p.tab));
  return { steps: [["space.select", { id: sp.id }], ...(own ? [["pane.focus", { pane: own.pane }]] : [])], back: active?.id ?? null, finish: !own };
}
// The second half of the first open: the Inbox mod tab in the Inbox space, then the shell tab the new space started with is closed.
// null while the space is not there yet; [] when the mod tab already is.
export function inboxFinish({ spaces, panes }) {
  const sp = inboxSpace(spaces);
  if (!sp) return null;
  if ((panes ?? []).some((p) => p.mod === MOD && sp.tabs.some((t) => t.id === p.tab))) return [];
  return [["tab.new", { space: sp.id, name: NAME, mod: MOD, props: { inbox: true } }], ...sp.tabs.map((t) => ["tab.close", { id: t.id }])];
}
