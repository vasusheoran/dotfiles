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

// One row per open ask, keyed by its id (a row from before ids has only its url). The open rule is asks.jq's (claude-plugins; both
// tests share one fixture): an ask line (first per key) stays open until a later answered, applied or legacy resumed line with the
// same key, and is superseded by a later ask of the same kind from the same role on the same card (a merge ask: for the same PR). The rows of a batched merge ask (one per PR, sharing
// `batch`) are one entry carrying `targets`. Oldest first.
// an id-less row is legacy-<trailing digits of its url>, as asks.jq's aid has it
const askKey = (l) => l.id ?? (l.url ? (/(\d+)$/.exec(l.url) ? `legacy-${/(\d+)$/.exec(l.url)[1]}` : l.url) : undefined);
const batchOf = (l) => l.batch ?? askKey(l);
const roleOf = (l) => l.from ?? "worker";
const sameTarget = (a, b) => String(a.target?.repo ?? "").toLowerCase() === String(b.target?.repo ?? "").toLowerCase() && a.target?.pr === b.target?.pr;
// the question's first line without markup or numbering: the title of a row from before --title
export const plainTitle = (q) => firstLine(q, 200).replace(/[*_`#]/g, "").replace(/^\s*\d+\.\s+/, "").replace(/^\s*In plain words:\s*/, "").trim();

export function openAsks(lines, nowMs, closed = []) {
  const open = new Map(), seq = [], noted = new Set();
  for (const l of lines) {
    const k = askKey(l);
    if (l.event === "ask") { if (!open.has(k)) { open.set(k, l); seq.push(l); } }
    else if (k != null && (l.event === "answered" || l.event === "applied" || l.event === "resumed")) { open.delete(k); noted.delete(k); }
    else if (k != null && l.event === "noted") noted.add(k);
  }
  const live = [...open.values()].filter((l) => !closed.includes(l.card)
    && !seq.slice(seq.indexOf(l) + 1).some((n) => l.card != null && n.card === l.card && roleOf(n) === roleOf(l) && (n.kind ?? "decide") === (l.kind ?? "decide") && batchOf(n) !== batchOf(l) && (l.kind !== "merge" || sameTarget(n, l))));
  const groups = new Map();
  for (const l of live) groups.set(batchOf(l), [...(groups.get(batchOf(l)) ?? []), l]);
  return [...groups.values()]
    .map((rows) => {
      const l = rows[0];
      const targets = rows.length > 1 ? rows.map((r) => ({ id: askKey(r), repo: r.target?.repo, pr: r.target?.pr, head: r.target?.head })) : [];
      return {
        id: askKey(l), card: l.card, epic: l.epic ?? null, url: l.url ?? null, question: l.question, title: l.title ?? plainTitle(l.question), titled: l.title != null,
        ts: l.ts, ageMs: nowMs - Date.parse(l.ts), from: roleOf(l),
        options: targets.length ? [{ q: 1, key: "a", label: `Merge all ${targets.length}, in order (Recommended)` }, { q: 1, key: "b", label: "Pick which to merge" }] : Array.isArray(l.options) ? l.options : [],
        kind: l.kind ?? "decide", plan: l.plan ?? null, body: l.body ?? "", targets, noteSent: noted.has(askKey(l)),
      };
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export const DOUBLE_PRESS_MS = 10_000;
const NEEDS_SECOND_KEY = new Set(["merge", "roll", "money"]);

// What a key does on an open ask. `armed` is the pending first press ({ id, key, q, at }) or null.
// Returns { type: "post", text } | { type: "arm", armed, body } | { type: "open", target } | { type: "cancel" } | null.
// `q` is the selected question of the ask (default 1); a letter picks an option within it.
export function askKeyAction(ask, key, armed, nowMs, q = 1) {
  let text = null, pick = false, okey = null;
  if (key === "x" && ask.kind === "you") text = "Done."; // x is reserved for you asks; elsewhere it is an option key
  else if (key === "v") return ask.plan ? { type: "open", target: ask.plan } : null;
  else if (key === "b" && ask.targets?.length > 1) return { type: "checklist" }; // a batched merge ask: b picks which PRs
  else { const o = ask.options.find((o) => o.q === q && o.key === key); if (o) { text = `${o.q}${o.key}: ${o.label}`; okey = o.key; pick = new Set(ask.options.map((o) => o.q)).size > 1; } }
  if (text == null) return armed ? { type: "cancel" } : null;
  const done = pick ? { type: "pick", q, text } : { type: "post", text, ...(okey ? { key: okey } : {}) };
  if (!NEEDS_SECOND_KEY.has(ask.kind)) return done;
  if (armed && armed.id === ask.id && armed.key === key && armed.q === q && nowMs - armed.at <= DOUBLE_PRESS_MS) return done;
  return { type: "arm", armed: { id: ask.id, key, q, at: nowMs }, body: ask.body };
}

const questionsOf = (ask) => [...new Set(ask.options.map((o) => o.q))].sort((a, b) => a - b);

// The option marked "(Recommended)" of each question: { q: key }.
export function recommended(ask) {
  const out = {};
  for (const o of ask.options) if (/\(recommended\)/i.test(o.label) && out[o.q] == null) out[o.q] = o.key;
  return out;
}

// Enter on an ask: pick the recommended option of each question. A merge, roll or money ask still needs the second press.
// Returns what askKeyAction returns ({ type: "post" | "arm" | ... }), or null when there is nothing recommended to accept.
export function acceptRecommended(ask, armed, nowMs) {
  const rec = recommended(ask), qs = questionsOf(ask);
  if (!qs.length || ask.kind === "you") return null;
  if (qs.length === 1) return rec[qs[0]] ? askKeyAction(ask, rec[qs[0]], armed, nowMs, qs[0]) : null;
  if (!qs.every((q) => rec[q])) return null;
  if (NEEDS_SECOND_KEY.has(ask.kind) && !(armed && armed.id === ask.id && armed.key === "enter" && nowMs - armed.at <= DOUBLE_PRESS_MS)) {
    return { type: "arm", armed: { id: ask.id, key: "enter", q: 0, at: nowMs }, body: ask.body };
  }
  return { type: "post", text: qs.map((q) => `${q}${rec[q]}: ${ask.options.find((o) => o.q === q && o.key === rec[q]).label}`).join("\n") };
}

// The checklist of a batched merge ask: state { cur, chosen: [target ids] }. j k move, space toggles, enter sends, escape cancels.
// A step that changes the list returns the new state; enter returns { type: "send", key, only, text }, escape { type: "cancel" }.
export function checklistStep(ask, s, key) {
  const ts = ask.targets, last = ts.length - 1;
  if (key === "escape") return { type: "cancel" };
  if (key === "j" || key === "down") return { ...s, cur: Math.min(last, s.cur + 1) };
  if (key === "k" || key === "up") return { ...s, cur: Math.max(0, s.cur - 1) };
  if (key === "space") {
    const id = ts[s.cur].id, on = new Set(s.chosen);
    on.has(id) ? on.delete(id) : on.add(id);
    return { ...s, chosen: ts.filter((t) => on.has(t.id)).map((t) => t.id) };
  }
  if (key === "enter") {
    const picked = ts.filter((t) => s.chosen.includes(t.id));
    return picked.length
      ? { type: "send", key: "a", only: picked.map((t) => t.pr), text: `Merge ${picked.length} of ${ts.length}: ${picked.map((t) => `${t.repo}#${t.pr}`).join(", ")}` }
      : { type: "send", key: "b", only: [], text: `Hold all ${ts.length}` };
  }
  return s;
}

// The one-line note box. A key returns { text } (still typing), { type: "send", text } (enter: sent alone),
// { type: "keep", text } (tab: held for the next pick) or { type: "cancel" }.
export function noteStep(text, key) {
  if (key === "escape") return { type: "cancel" };
  if (key === "enter" || key === "tab") return text.trim() ? { type: key === "enter" ? "send" : "keep", text: text.trim() } : { type: "cancel" };
  if (key === "backspace") return { text: text.slice(0, -1) };
  if (key === "space") return { text: `${text} ` };
  return { text: key.length === 1 ? text + key : text };
}

// One comment for a multi-question ask: a line per question, once every question has a pick ({ q: text }); else null.
export function composeAnswer(ask, picks) {
  const qs = questionsOf(ask);
  return qs.length && qs.every((q) => picks[q]) ? qs.map((q) => picks[q]).join("\n") : null;
}

export const picksText = (ask, picks) => questionsOf(ask).map((q) => (picks[q] ? `${picks[q].split(":")[0]} ✓` : `${q} ?`)).join(" · ");

// Whether a key belongs to the selected ask: option letters, x (you asks), v, n (a note), a question digit, or any single key while an
// answer is armed (it cancels). j, k and the arrows always navigate, so they never count.
export const isAskKey = (ask, k, armed) => k.length === 1 && !["j", "k"].includes(k)
  && (ask.options.some((o) => o.key === k) || (k === "x" && ask.kind === "you") || k === "v" || k === "n" || ask.options.some((o) => String(o.q) === k) || !!armed);

// The `work` arguments that answer an ask. A row from before ids has only its url: its id is legacy-<comment id>.
// { key } is the picked option (single-question asks: merge-green reads it), { note } rides with the pick, { only } is a batch's chosen PR numbers.
const askId = (ask) => (/^(a|legacy)-/.test(ask.id) ? ask.id : `legacy-${String(ask.url ?? ask.id).match(/(\d+)$/)?.[1] ?? ""}`);
export const answerArgv = (ask, text, { key, note, only } = {}) => ["ask", "answer", askId(ask), "--text", text, "--via", "screen",
  ...(key ? ["--key", key] : []), ...(note ? ["--note", note] : []), ...(only?.length ? ["--only", only.join(",")] : [])];
// A note alone: no text, no key, so it answers nothing.
export const noteArgv = (ask, text) => ["ask", "answer", askId(ask), "--note", text, "--via", "screen"];

// The terminal pane of the tab (the right-hand one in the control-room layout), never a mod pane.
export const rightPaneId = (panes, tab) => panes.find((p) => p.tab === tab && p.terminal)?.pane ?? null;

// Where the view reads: the live run files, or the screenshot fixture folder when it exists.
export function runFiles(home, fixture) {
  if (fixture) { const d = `${home}/.config/herdr-app/agents-view-fixture`; return { asks: `${d}/asks.jsonl`, events: `${d}/events.jsonl`, usage: `${d}/usage.json`, upNext: `${d}/up-next.json`, settings: `${d}/settings.json`, closed: `${d}/closed-cards.json` }; }
  const d = `${home}/handoffs/run`;
  return { asks: `${d}/asks.jsonl`, events: `${d}/events.jsonl`, usage: `${home}/.claude/.usage-cache.json`, upNext: `${d}/up-next.json`, settings: `${d}/settings.json`, closed: `${d}/closed-cards.json` };
}

export function firstLine(text, max) {
  const l = String(text ?? "").split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
}

// The question text per number from an ask body ("1. Which branch?").
export function questionTitles(body) {
  const out = {};
  for (const m of String(body ?? "").matchAll(/^\s*(\d+)\.\s+(.+)$/gm)) out[m[1]] = m[2].trim();
  return out;
}

const OLD_ASK_MS = 3600_000;

// The plan or PR an ask points at: a PR URL reads "PR: owner/repo#n", anything else "Plan: <file name or URL>".
export function planRef(plan) {
  if (!plan) return null;
  const pr = String(plan).match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (pr) return { kind: "pr", line: `PR: ${pr[1]}#${pr[2]}`, full: plan };
  return { kind: "plan", line: `Plan: ${/^https?:/.test(plan) ? plan : String(plan).split("/").pop()}`, full: plan };
}

// What the panel draws for one ask: a short row, and the blocks shown when it is selected.
export function askView(ask, picks, armed) {
  const titles = questionTitles(ask.body);
  const qs = questionsOf(ask);
  return {
    card: shortCard(ask.card), kind: ask.kind, age: ageText(ask.ageMs), old: ask.ageMs > OLD_ASK_MS, title: ask.title, noteSent: ask.noteSent,
    // with a title of its own, the whole question is body; without one the first line is the title and the rest is body
    body: [ask.titled && ask.question.trim() !== ask.title ? ask.question : ask.question.split("\n").slice(1).join("\n"), qs.length ? ask.body.replace(/^\s*\d+\..*$/gm, "").replace(/^\s+[a-z]\).*$/gm, "") : ask.body]
      .map((x) => x.trim()).filter(Boolean).join("\n"),
    targets: ask.targets.map((t) => ({ id: t.id, label: `${shortCard(t.repo)}#${t.pr}` })),
    plan: planRef(ask.plan), marker: { plan: "plan", pr: "PR" }[planRef(ask.plan)?.kind] ?? "",
    questions: qs.map((q) => ({ q, title: titles[q] ?? "", options: ask.options.filter((o) => o.q === q).map((o) => ({
      key: o.key, label: o.label, rec: recommended(ask)[q] === o.key, picked: picks?.[q]?.startsWith(`${q}${o.key}:`) ?? false,
      armed: !!armed && armed.id === ask.id && armed.q === q && armed.key === o.key,
    })) })),
    status: qs.length > 1 ? `${qs.filter((q) => picks?.[q]).length} of ${qs.length} picked` : "",
  };
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

export const sideJobs = (terminals) => terminals
  .filter((t) => t.live && t.labels.role === "side" && !t.labels.epic)
  .map((t) => ({ name: label(t), address: t.address, card: firstCard(t.labels.card), model: t.labels.model ?? null, state: t.state ?? "starting" }));

export function deskRow(terminals) {
  const d = terminals.find((t) => t.live && t.labels.role === "desk");
  return d ? { name: label(d), address: d.address, state: d.state ?? "starting" } : { name: "desk", address: null, state: "not started" };
}

export const otherSessions = (terminals) => terminals
  .filter((t) => t.live && t.state && !t.labels.epic && !["side", "desk"].includes(t.labels.role))
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

// The run settings as one line: runner on or off, worker limit, the reviewers that are on. Defaults match run-settings.sh.
export function runnerLine(text) {
  const s = parse(text);
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const n = s.worker_limit ?? 4, r = { verifier: true, codex: true, agy: false, ...s.reviewers };
  const on = Object.keys(r).filter((k) => r[k]);
  return `Runner setting: ${s.runner ? "on" : "off"} · ${n} worker${n === 1 ? "" : "s"} · reviewers: ${on.join(", ") || "none"}`;
}

const othersLine = (n) => (n ? `+${n} other session${n === 1 ? "" : "s"}` : "");
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

export function viewModel({ terminals, asksText, eventsText, usageJson, upNextJson, settingsJson, closedJson, nowMs, hiddenIds }) {
  const ts = (terminals ?? []).map(normalize);
  const cc = parse(closedJson);
  const closed = Array.isArray(cc?.closed) ? cc.closed : [], titles = cc?.titles && typeof cc.titles === "object" ? cc.titles : {};
  const asks = openAsks(parseJsonl(asksText), nowMs, closed).filter((a) => !hiddenIds?.has(a.id));
  const up = parse(upNextJson);
  const warn = up?.usage?.read && up.usage.read !== "ok" ? up.usage.warn || "usage read failed" : "";
  const usage = [warn, usageText(parse(usageJson))].filter(Boolean).join(" · ");
  const settings = parse(settingsJson);
  return { usage, usageWarn: !!warn, upNext: upNextLine(up, nowMs), runnerLine: runnerLine(settingsJson), runnerOn: settings && typeof settings === "object" && !Array.isArray(settings) ? !!settings.runner : null, asks, askGroups: askGroups(asks, titles), stuck: stuckRows(ts, parseJsonl(eventsText), asks, nowMs), groups: epicGroups(ts), sides: sideJobs(ts), desk: deskRow(ts), others: otherSessions(ts), asksOld: asks.some((a) => a.ageMs > OLD_ASK_MS), othersLine: othersLine(otherSessions(ts).length) };
}

// The asks by epic, one group each: merges first, then decisions, then do-this-yourself, oldest first within a kind; the group with
// the oldest ask first. `line` is the group's one-line summary. A batched merge ask counts one merge per PR.
const kindRank = (a) => (a.kind === "merge" ? 0 : a.kind === "you" ? 2 : 1);
export function askGroups(asks, titles = {}) {
  const by = new Map();
  for (const a of asks) by.set(a.epic ?? a.card, [...(by.get(a.epic ?? a.card) ?? []), a]);
  return [...by].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => kindRank(a) - kindRank(b) || b.ageMs - a.ageMs);
    const n = (r) => sorted.filter((a) => kindRank(a) === r).reduce((s, a) => s + (r === 0 ? Math.max(1, a.targets.length) : 1), 0);
    const part = (c, w) => (c ? `${c} ${w}${c === 1 ? "" : "s"}` : "");
    const oldestMs = Math.max(...sorted.map((a) => a.ageMs));
    return { key, asks: sorted, oldestMs, line: [titles?.[key] || shortCard(key), ...[part(n(0), "merge"), part(n(1), "decision"), part(n(2), "task")].filter(Boolean), `oldest ${ageText(oldestMs)}`].join(" · ") };
  }).sort((a, b) => b.oldestMs - a.oldestMs);
}

// The running sections as one line, for while something needs you.
// What an expanded ask shows under its title, in order: the options, the plan or PR link, then the body.
export const askLayout = (v) => [v.questions.some((q) => q.options.length) && "options", v.plan && "plan", v.body && "body"].filter(Boolean);

export const runSummary = (vm) => [`Running ${vm.groups.reduce((n, g) => n + g.rows.length, 0) + vm.sides.length}`, `Stuck ${vm.stuck.length}`, vm.runnerOn == null ? "" : `Runner ${vm.runnerOn ? "on" : "off"}`].filter(Boolean).join(" · ");

// Every selectable row in display order: one row per epic with asks (the open epic lists its asks under it), the running summary,
// then running (epics, then side jobs), the desk and stuck, then others. While asks wait, running, the desk and stuck show only when
// `showRun` is set. A terminal in STUCK and in its epic group is selectable in both.
export function flatRows(vm, { openEpic, showRun } = {}) {
  const groups = vm.askGroups ?? [], open = groups.find((g) => g.key === openEpic) ?? groups[0], waiting = vm.asks.length > 0;
  return [
    ...groups.flatMap((g) => [{ key: `epic:${g.key}`, section: "epic", address: null, id: null, row: g },
      ...(g === open ? g.asks.map((a) => ({ key: `ask:${a.id}`, section: "asks", address: null, id: a.id, row: a })) : [])]),
    ...(waiting ? [{ key: "summary:running", section: "summary", address: null, id: null, row: { line: runSummary(vm) } }] : []),
    ...(waiting && !showRun ? [] : [
      ...vm.groups.flatMap((g) => g.rows.map((r) => ({ key: `group:${r.address}`, section: "group", address: r.address, id: null, row: r }))),
      ...vm.sides.map((s) => ({ key: `side:${s.address}`, section: "side", address: s.address, id: null, row: s })),
      { key: "desk", section: "desk", address: vm.desk.address, id: null, row: vm.desk },
      ...vm.stuck.map((s) => ({ key: `stuck:${s.kind}:${s.name}`, section: "stuck", address: s.address, id: null, row: s })),
    ]),
    ...vm.others.map((o) => ({ key: `other:${o.address}`, section: "others", address: o.address, id: null, row: o })),
  ];
}

// The header's key hint for the selected row.
export const footerHint = (section) => ({ asks: "↵ accept recommended · n note · v open", epic: "↵ open epic · j k move", summary: "↵ show running · j k move" }[section] ?? "j k move · ↵ show terminal");

// Enter on a row: show its terminal in the right-hand pane, or start the desk when there is none. Asks are not shown.
export function selectTarget(r, cwd) {
  if (r.address) return { show: r.address };
  if (r.section === "desk") return { start: ["run", "--bg", "--json", "--name", "desk", "--no-parent", "--label", "role=desk", "--cwd", cwd, "--", "claude"] };
  return null;
}

// Runs one action through io = { run, exec, pane }. Nothing happens without a right-hand pane to show in.
export async function perform(a, io) {
  if (a.type === "post") return io.exec("work", a.argv);
  if (a.type === "open") return io.exec("open", [a.target]);
  if (!io.pane) return;
  if (a.type === "show") return io.run("terminal.show", { terminal: a.terminal, pane: io.pane });
  if (a.type === "start-desk") {
    const r = await io.exec("hc", a.argv);
    let address = null; try { address = JSON.parse(r.stdout).address; } catch { /* not started */ }
    if (address) io.run("terminal.show", { terminal: address, pane: io.pane });
  }
}
