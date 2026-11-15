// The desk to peek at: a live terminal labelled role=desk, else the first live terminal. Labels are "k=v" strings or an object (raw herdr terminals).
export function deskOf(terminals) {
  const live = (terminals ?? []).filter((t) => t.state == null || t.state === "live");
  const role = (t) => (Array.isArray(t.labels) ? t.labels.find((l) => l === "role=desk") && "desk" : t.labels?.role);
  return live.find((t) => role(t) === "desk") ?? live[0] ?? null;
}
