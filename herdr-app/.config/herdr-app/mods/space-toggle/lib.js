// The most recent history entry that is not where you are now, or null.
export const pickPrevious = (history, focused) =>
  (history ?? []).find((h) => h.space !== focused?.space || h.tab !== focused?.tab) ?? null;
