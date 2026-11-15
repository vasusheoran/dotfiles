// The Agents button and ctrl-b a open the Inbox as a main tab (the same tab.new the i key of the agents-view mod runs), select it when it is open, and from it go
// back to the tab the owner came from. Returns { steps: [[command, args?]...], back } where back is the tab to return to next time.
export function agentsToggle({ panes, focused, back }) {
  const inbox = (panes ?? []).find((p) => p.mod === "agents-view");
  if (inbox && focused?.tab === inbox.tab) {
    const there = back && (panes ?? []).some((p) => p.tab === back);
    return { steps: [there ? ["tab.select", { id: back }] : ["tab.prev"]], back: null };
  }
  const from = focused?.tab ?? null;
  return { steps: [inbox ? ["tab.select", { id: inbox.tab }] : ["tab.new", { name: "Inbox", mod: "agents-view", props: { inbox: true } }]], back: from };
}
