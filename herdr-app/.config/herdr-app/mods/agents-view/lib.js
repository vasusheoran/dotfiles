// Agents view: pure logic (tested with node --test). main.js reads the inputs, draws and handles keys.
const GONE_MAX_MS = 7 * 24 * 3600_000; // a worker gone longer than this is history, not stuck
const RUNNER_SILENT_MS = 12 * 60_000; // the runner ticks every 5 minutes
const BLOCKED_TEXT = { permission: "permission prompt", question: "question", auth: "sign-in needed" };

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    try { const o = JSON.parse(line); if (o && typeof o === "object" && !Array.isArray(o)) out.push(o); } catch { /* blank or broken line */ }
  }
  return out;
}

// One row per open url: an ask line (first per url) stays open until a later resumed line with the same url. Oldest first.
export function openAsks(lines, nowMs) {
  const open = new Map();
  for (const l of lines) {
    if (l.event === "ask" && !open.has(l.url)) open.set(l.url, l);
    else if (l.event === "resumed") open.delete(l.url);
  }
  return [...open.values()]
    .map((l) => ({ card: l.card, epic: l.epic ?? null, url: l.url, question: l.question, ts: l.ts, ageMs: nowMs - Date.parse(l.ts), from: l.from ?? "worker" }))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export function usageText(u) {
  const find = (kind) => u?.limits?.find?.((l) => l.kind === kind);
  const all = find("weekly_all"), scoped = find("weekly_scoped");
  return [all && `week ${Math.round(all.percent)}%`, scoped && `${scoped.scope?.model?.display_name ?? "model"} ${Math.round(scoped.percent)}%`].filter(Boolean).join(" · ");
}

const labelsOf = (raw) => Array.isArray(raw.labels)
  ? Object.fromEntries(raw.labels.map((l) => { const i = String(l).indexOf("="); return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)]; }))
  : (raw.labels ?? {});

export function normalize(raw) {
  const labels = labelsOf(raw);
  return {
    address: raw.address,
    name: raw.name ?? null,
    live: raw.state == null || raw.state === "live",
    labels,
    state: typeof raw.status === "string" ? raw.status : raw.status?.state ?? null,
    kind: raw.report?.kind ?? raw.status?.kind ?? null,
    msg: raw.report?.msg ?? raw.status?.msg ?? null,
    statusMs: raw.status_ms ?? raw.report?.status_ms ?? null,
    where: raw.where ?? labels.where ?? null,
  };
}

const label = (t) => t.name ?? t.address;
const firstCard = (v) => String(v ?? "").split(",")[0].trim() || null;

export function stuckRows(terminals, events, asks, nowMs) {
  const live = terminals.filter((t) => t.live);
  const taken = new Set();
  const rows = [];
  const take = (kind, pick) => {
    for (const t of live) {
      if (taken.has(t) || !pick(t)) continue;
      taken.add(t);
      const r = pick(t);
      rows.push({ kind, name: label(t), text: r.text, ageMs: typeof t.statusMs === "number" ? nowMs - t.statusMs : null, address: t.address });
    }
  };
  take("blocked", (t) => t.state === "blocked" && { text: (BLOCKED_TEXT[t.kind] ?? "blocked") + (t.msg ? `: ${t.msg}` : "") });
  take("error", (t) => t.state === "error" && { text: "error" });

  const liveNames = new Set(live.map((t) => t.name).filter(Boolean));
  const asked = new Set(asks.filter((a) => a.from === "worker").map((a) => a.card));
  const names = [...new Set(events.map((e) => e.name).filter(Boolean))];
  for (const name of names) {
    const mine = events.filter((e) => e.name === name);
    const startAt = mine.findLastIndex((e) => e.event === "start");
    const st = mine[startAt];
    if (!st || st.role !== "worker" || liveNames.has(name) || asked.has(st.card)) continue;
    if (mine.slice(startAt + 1).some((e) => e.event === "stop" && e.reason === "retired")) continue;
    const ageMs = nowMs - Date.parse(mine.at(-1).ts);
    if (ageMs < GONE_MAX_MS) rows.push({ kind: "gone", name, text: "terminal gone, no question", ageMs, address: null });
  }

  const leads = new Set(live.filter((t) => t.labels.role === "lead").map((t) => t.labels.epic));
  take("no-lead", (t) => t.labels.role === "worker" && t.labels.epic && !leads.has(t.labels.epic) && { text: "no lead running" });
  return rows;
}

const ROLE_ORDER = { lead: 0, worker: 1 };
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function epicGroups(terminals) {
  const groups = new Map();
  for (const t of terminals) {
    if (!t.live || !t.labels.epic) continue;
    if (!groups.has(t.labels.epic)) groups.set(t.labels.epic, []);
    groups.get(t.labels.epic).push({ name: label(t), address: t.address, role: t.labels.role ?? null, card: firstCard(t.labels.card), model: t.labels.model ?? null, state: t.state ?? "starting" });
  }
  return [...groups.keys()].sort(byName).map((epic) => ({
    epic,
    rows: groups.get(epic).sort((a, b) => (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2) || byName(a.name, b.name)),
  }));
}

export const otherSessions = (terminals) => terminals
  .filter((t) => t.live && t.state && !t.labels.epic)
  .map((t) => ({ name: label(t), address: t.address, where: t.where, state: t.state }));

export function ageText(ms) {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

export const shortCard = (ref) => String(ref ?? "").split("/").pop();

const num = (ref) => `#${String(ref).split("#").pop()}`;
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// The runner's pick (up-next.json) as one line, or null when there is no file or it can't be read.
export function upNextLine(up, nowMs) {
  const at = Date.parse(up?.at);
  if (Number.isNaN(at)) return null;
  const age = nowMs - at;
  if (age > RUNNER_SILENT_MS) return `Runner has not checked for ${ageText(age)}`;
  if (up.state === "none") return `Up next: nothing to start · checked ${ageText(age)} ago`;
  if (!up.epic || !up.card) return null;
  const what = { "would-start": `runner off, would start · checked ${ageText(age)} ago`, started: `runner on, lead started ${hhmm(at)}`, "not-started": `not started: ${up.reason}` }[up.state];
  return what ? `Up next: ${num(up.epic)} → card ${num(up.card)} · ${what}` : null;
}

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

export function viewModel({ terminals, asksText, eventsText, usageJson, upNextJson, nowMs }) {
  const ts = (terminals ?? []).map(normalize);
  const asks = openAsks(parseJsonl(asksText), nowMs);
  const up = parse(upNextJson);
  const warn = up?.usage?.read && up.usage.read !== "ok" ? up.usage.warn || "usage read failed" : "";
  const usage = [warn, usageText(parse(usageJson))].filter(Boolean).join(" · ");
  return { usage, usageWarn: !!warn, upNext: upNextLine(up, nowMs), asks, stuck: stuckRows(ts, parseJsonl(eventsText), asks, nowMs), groups: epicGroups(ts), others: otherSessions(ts) };
}

// Every selectable row in display order. A terminal in STUCK and in its epic group is selectable in both.
export const flatRows = (vm) => [
  ...vm.asks.map((a) => ({ key: `ask:${a.url}`, section: "asks", address: null, url: a.url, row: a })),
  ...vm.stuck.map((s) => ({ key: `stuck:${s.kind}:${s.name}`, section: "stuck", address: s.address, url: null, row: s })),
  ...vm.groups.flatMap((g) => g.rows.map((r) => ({ key: `group:${r.address}`, section: "group", address: r.address, url: null, row: r }))),
  ...vm.others.map((o) => ({ key: `other:${o.address}`, section: "others", address: o.address, url: null, row: o })),
];
