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

// kuchbhi#1115: a lane from the kind alone, as asks.jq's `lane` has it (decide and money included; no kind means decide)
export const laneOf = (kind) => ({ merge: "key", you: "hands", roll: "hands", money: "hands", groom: "groom" })[kind ?? "decide"] ?? "look";
const END_EVENTS = new Set(["answered", "applied", "resumed", "closed"]);
const NOT_PICKED_UP_MS = 10 * 60_000;

// Asks that were answered and not applied or closed, oldest answer first: what the owner sent (the pick), whether the asker received it
// (a `delivered` event), and whether it is done (applied, which drops it). Answered 10 minutes ago and not applied: notPickedUp.
export function answeredAsks(lines, nowMs) {
  const asks = new Map(), ev = new Map();
  for (const l of lines) {
    const k = askKey(l);
    if (k == null) continue;
    if (l.event === "ask") { if (!asks.has(k)) asks.set(k, l); }
    else ev.set(k, [...(ev.get(k) ?? []), l]);
  }
  const out = [];
  for (const [k, a] of asks) {
    const x = ev.get(k) ?? [], an = x.find((e) => e.event === "answered");
    if (!an || x.some((e) => e.event === "applied" || e.event === "resumed" || e.event === "closed") || (a.batch != null && a.batch !== k)) continue;
    const at = Date.parse(an.ts);
    out.push({ id: k, card: a.card, epic: a.epic ?? null, title: a.title ?? plainTitle(a.question), pick: an.text, key: an.key ?? null, answeredAt: an.ts, ageMs: nowMs - at,
      sent: true, received: x.some((e) => e.event === "delivered"), done: false, notPickedUp: nowMs - at > NOT_PICKED_UP_MS, lane: laneOf(a.kind), kind: a.kind ?? "decide", from: roleOf(a) });
  }
  return out.sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));
}

// a batch row holds one line: a long title is cut with an ellipsis
export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function openAsks(lines, nowMs, closed = []) {
  const open = new Map(), seq = [], noted = new Set(), landed = new Set(), asked = new Set(), urls = new Map(), replaced = new Map(), groomed = new Map();
  for (const l of lines) {
    const k = askKey(l);
    if (l.event === "ask") { if (!open.has(k)) { open.set(k, l); seq.push(l); } }
    else if (k != null && END_EVENTS.has(l.event)) { open.delete(k); noted.delete(k); }
    else if (k != null && l.event === "noted") noted.add(k);
    else if (k != null && l.event === "landed") landed.add(k);
    else if (k != null && l.event === "visual_requested") asked.add(k);
    else if (k != null && l.event === "visual_ready" && asked.has(k) && l.url) urls.set(k, l.url); // a picture nobody asked for does not count
    else if (k != null && l.event === "replaced") replaced.set(k, (replaced.get(k) ?? 0) + 1);
    else if (k != null && l.event === "replace_failed") replaced.set(k, (replaced.get(k) ?? 0) - 1); // the claim given back
    else if (k != null && l.event === "groomed") groomed.set(k, { ...groomed.get(k), [l.member]: l }); // newest event per card
  }
  const live = [...open.values()].filter((l) => !closed.includes(l.card)
    && !seq.slice(seq.indexOf(l) + 1).some((n) => l.card != null && n.card === l.card && roleOf(n) === roleOf(l) && (n.kind ?? "decide") === (l.kind ?? "decide") && batchOf(n) !== batchOf(l) && (l.kind !== "merge" || sameTarget(n, l))));
  const groups = new Map();
  for (const l of live) groups.set(batchOf(l), [...(groups.get(batchOf(l)) ?? []), l]);
  return [...groups.values()]
    .map((rows) => {
      const l = rows[0];
      const targets = rows.length > 1 ? rows.map((r) => ({ id: askKey(r), repo: r.target?.repo, pr: r.target?.pr, head: r.target?.head, landed: landed.has(askKey(r)) })) : [];
      return {
        id: askKey(l), card: l.card, epic: l.epic ?? null, url: l.url ?? null, question: l.question, title: l.title ?? plainTitle(l.question), titled: l.title != null,
        ts: l.ts, ageMs: nowMs - Date.parse(l.ts), from: roleOf(l),
        options: targets.length ? [{ q: 1, key: "a", label: `Merge all ${targets.length}, in order (Recommended)` }, { q: 1, key: "b", label: "Pick which to merge" }] : Array.isArray(l.options) ? l.options : [],
        kind: l.kind ?? "decide", lane: laneOf(l.kind), plan: l.plan ?? null, body: l.body ?? "", targets,
        today: l.today ?? null, after: l.after ?? null, checked: l.checked ?? null, whyYou: l.why_you ?? null, batchKey: l.batch_key ?? null, noteSent: noted.has(askKey(l)),
        visual: urls.has(askKey(l)) ? "ready" : asked.has(askKey(l)) ? "coming" : "none", visualUrl: urls.get(askKey(l)) ?? null,
        terminal: l.terminal ?? null, target: l.target ?? null, replaced: (replaced.get(askKey(l)) ?? 0) > 0, askerGone: false, replaceable: false,
        // a groom batch: its cards that are still not ready, with their open choices (kuchbhi#1119)
        cards: Object.values(groomed.get(askKey(l)) ?? {}).filter((g) => !g.ready).map((g) => ({ card: g.member, choices: g.choices ?? [] })),
      };
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export const DOUBLE_PRESS_MS = 10_000;
const NEEDS_SECOND_KEY = new Set(["merge", "roll", "money"]);

// What a key does on an open ask. `armed` is the pending first press ({ id, key, q, at }) or null.
// Returns { type: "post", text, key? } | { type: "arm", armed, body } | { type: "open", target } | { type: "cancel" } | null.
// `q` is the selected question of the ask (default 1); a letter picks an option within it.
export function askKeyAction(ask, key, armed, nowMs, q = 1) {
  let text = null, pick = false, okey = null;
  if (key === "x" && ask.kind === "you" && !ask.options.length) text = "Done."; // x is reserved for you asks; elsewhere it is an option key
  else if (key === "v") return ask.visual === "ready" ? { type: "open", target: ask.visualUrl } : ask.askerGone ? { type: "gone" } : { type: "visual" }; // a picture answers nothing: no second key
  else if (key === "p" && ask.plan && !ask.options.some((o) => o.key === "p")) return { type: "open", target: ask.plan };
  else if (key === "r" && ask.replaceable && !ask.options.some((o) => o.key === "r")) return { type: "replace" };
  else if (key === "b" && ask.targets?.length > 1) return { type: "checklist" }; // a batched merge ask: b picks which PRs
  else {
    const o = ask.options.find((o) => o.q === q && o.key === key);
    if (o) { text = `${o.q}${o.key}: ${o.label}`; okey = o.key; pick = new Set(ask.options.map((o) => o.q)).size > 1; }
    else if (key === "o" && ask.kind !== "merge") return { type: "other" }; // free text, answered with pick other (ask.sh refuses it on a merge ask)
  }
  if (text == null) return armed ? { type: "cancel" } : null;
  const done = pick ? { type: "pick", q, text } : { type: "post", text, ...(okey ? { key: okey } : {}) };
  if (!NEEDS_SECOND_KEY.has(ask.kind)) return done;
  if (armed && armed.id === ask.id && armed.key === key && armed.q === q && nowMs - armed.at <= DOUBLE_PRESS_MS) return done;
  return { type: "arm", armed: { id: ask.id, key, q, at: nowMs }, body: ask.body };
}

// The `--key` of a composed answer: one <q><key> per question, joined by commas; null until every question has a pick.
export const composeKey = (ask, picks) => { const qs = questionsOf(ask); return qs.length && qs.every((q) => picks[q]) ? qs.map((q) => picks[q].split(":")[0]).join(",") : null; };

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
  return { type: "post", text: qs.map((q) => `${q}${rec[q]}: ${ask.options.find((o) => o.q === q && o.key === rec[q]).label}`).join("\n"), key: qs.map((q) => `${q}${rec[q]}`).join(",") };
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
const prOf = (ask) => ask.target?.pr ? ask.target : ask.targets?.find((t) => !t.landed && t.pr) ?? null;
export const isAskKey = (ask, k, armed) => k.length === 1 && !["j", "k"].includes(k)
  && (ask.options.some((o) => o.key === k) || (k === "x" && ask.kind === "you") || k === "v" || k === "n" || k === "c" || (k === "d" && !!prOf(ask)) || (k === "p" && !!ask.plan) || (k === "r" && !!ask.replaceable) || (k === "o" && ask.kind !== "merge") || ask.options.some((o) => String(o.q) === k) || !!armed);

// The `work` arguments that answer an ask. A row from before ids has only its url: its id is legacy-<comment id>.
// { key } is the picked option (single-question asks: merge-green reads it), { note } rides with the pick, { only } is a batch's chosen PR numbers.
const askId = (ask) => (/^(a|legacy)-/.test(ask.id) ? ask.id : `legacy-${String(ask.url ?? ask.id).match(/(\d+)$/)?.[1] ?? ""}`);
export const answerArgv = (ask, text, { key, note, only } = {}) => ["ask", "answer", askId(ask), "--text", text, "--via", "screen",
  ...(key ? ["--key", key] : []), ...(note ? ["--note", note] : []), ...(only?.length ? ["--only", only.join(",")] : [])];
// The owner's request for a picture of an ask, and the key that starts a replacement for a gone asker (claude-plugins ask.sh visual, replace).
export const visualArgv = (ask) => ["ask", "visual", askId(ask)];
export const replaceArgv = (ask) => ["ask", "replace", askId(ask)];
// The owner's reminder to an asker that has not picked its answer up.
export const nudgeArgv = (ask) => ["ask", "nudge", askId(ask)];
// A note alone: no text, no key, so it answers nothing.
export const noteArgv = (ask, text) => ["ask", "answer", askId(ask), "--note", text, "--via", "screen"];

// An answer of the owner's own words: recorded with pick other; the asker applies it or replies in the ask's thread.
export const otherArgv = (ask, text) => answerArgv(ask, text, { key: "other" });

// ---- messages (kuchbhi#1116): `message` and `message_delivered` events of asks.jsonl, grouped by thread (an ask id, or `desk`)
// Returns { thread: [{ mid, from, to, text, ts, received }] }, oldest first. Sent = the message line; received = a message_delivered line,
// or any line from an agent (it was written by the one who received the conversation).
export function threadsOf(lines) {
  const got = new Set(lines.filter((l) => l.event === "message_delivered").map((l) => l.mid));
  const out = {};
  for (const l of lines) {
    if (l.event !== "message" || !l.thread || !l.mid) continue;
    (out[l.thread] ??= []).push({ mid: l.mid, from: l.from, to: l.to ?? null, text: String(l.text ?? ""), ts: l.ts, received: l.from !== "owner" || got.has(l.mid) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
}
export const messageState = (m) => (m.from !== "owner" ? "received" : m.received ? "sent · received" : "sent · waiting: terminal busy or gone");
// `max` messages ending `back` messages before the newest (PgUp scrolls back), and how many are older and newer than the window.
export function threadView(msgs, max = 6, back = 0) {
  const end = msgs.length - Math.min(Math.max(0, back), Math.max(0, msgs.length - max)), start = Math.max(0, end - max);
  return { hidden: start, newer: msgs.length - end, shown: msgs.slice(start, end) };
}
// Who a line is from: you, the desk (an agent in the desk thread), or the agent behind an ask.
export const speaker = (m, thread) => (m.from === "owner" ? "You" : thread === "desk" ? "Desk" : "Agent");
// Desk replies after your last message to the desk.
export function deskNew(threads) {
  const msgs = threads?.desk ?? [];
  return msgs.slice(msgs.findLastIndex((m) => m.from === "owner") + 1).filter((m) => m.from !== "owner").length;
}
// A key in the text input: note, other idea or message. Only the note box keeps (Tab); Tab in the others does nothing, so nothing half typed is sent.
export function inputStep(input, key) {
  if (key === "tab" && input.mode !== "note") return { input };
  const r = noteStep(input.text, key);
  if (r.type === "cancel") return { type: "cancel" };
  if (r.type === "send" || r.type === "keep") return { type: r.type, text: r.text };
  return { input: { ...input, text: r.text } };
}

export const messageArgv = (thread, text) => ["ask", "message", thread, "--text", text, "--by", "owner"];
// With an ask open the message goes to the agent behind it (the ask's thread); with none open, to the desk.
export const messageTarget = (ask) => (ask ? askId(ask) : "desk");

// ---- batches in four lanes (kuchbhi#1116)
export const LANE_LABELS = { key: "ONE KEY", look: "NEEDS A LOOK", hands: "YOUR HANDS", groom: "NOT READY" };
const LANE_ORDER = ["key", "look", "hands", "groom"];
const askCount = (a) => Math.max(1, a.targets?.length ?? 0, a.lane === "groom" ? a.cards?.length ?? 0 : 0); // a groom batch counts its cards
// One batch per batch key (an ask from before batch keys is batched by lane and epic), asks oldest first, batches in lane order.
export function inboxBatches(asks, titles = {}) {
  const by = new Map();
  for (const a of asks) {
    const key = a.batchKey ?? `${a.lane}:${a.epic ?? a.card}`;
    if (!by.has(key)) by.set(key, { key, lane: a.lane, asks: [] });
    by.get(key).asks.push(a);
  }
  return [...by.values()].map((b) => {
    const count = b.asks.reduce((n, a) => n + askCount(a), 0), epic = b.asks[0].epic ?? b.asks[0].card;
    return { ...b, count, epic, name: b.asks.length === 1 && b.lane !== "groom" ? clip(b.asks[0].title, 60) : `${clip(titles?.[epic] || shortCard(epic), 60)} · ${count} ${{ key: "to land", look: "to look at", hands: "for your hands", groom: "to groom" }[b.lane]}`,
      coming: b.asks.filter((a) => a.visual === "coming").length,
      asks: [...b.asks].sort((x, y) => (y.visual === "ready") - (x.visual === "ready") || Date.parse(x.ts) - Date.parse(y.ts)) }; // a ready picture goes to the top
  }).sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || Date.parse(a.asks[0].ts) - Date.parse(b.asks[0].ts));
}
// Enter on an ask: open its ready picture while the picture row has focus (tab moves focus to the options), else accept the recommended option.
export const enterAction = (ask, armed, nowMs, onPicture) => (onPicture && ask.visual === "ready" ? { type: "open", target: ask.visualUrl } : acceptRecommended(ask, armed, nowMs));
export const laneSummary = (batches) => LANE_ORDER.map((lane) => {
  const bs = batches.filter((b) => b.lane === lane);
  return { lane, label: LANE_LABELS[lane], count: bs.reduce((n, b) => n + b.count, 0), batches: bs };
});

// The place in each batch: pos = { batchKey: index }, kept when another batch is shown. A step returns the new pos.
const clampAt = (i, n) => Math.max(0, Math.min(n - 1, i));
export const stepAsk = (pos, batch, dir) => ({ ...pos, [batch.key]: clampAt((pos[batch.key] ?? 0) + (dir === "right" ? 1 : -1), batch.asks.length) });
export const askAt = (pos, batch) => batch.asks[clampAt(pos[batch.key] ?? 0, batch.asks.length)];
// Below this width the batch list sits above the ask.
export const isNarrow = (width) => typeof width === "number" && width < 640;

// What the right-hand side shows for the selected row: the desk thread, the batch's current ask with its thread, an answered ask with its
// thread (where the asker's reply to an other idea shows), or nothing.
export function paneFor(row, vm, pos) {
  if (row?.section === "desk") return { kind: "desk", thread: "desk" };
  if (row?.section === "batch") { const ask = askAt(pos, row.row); return { kind: "ask", ask, batch: row.row, thread: ask.id }; }
  if (row?.section === "answered") return { kind: "answered", answered: row.row, thread: row.row.id };
  return { kind: "empty" };
}
// Until the owner moves: the first batch; with none, the first row that is not the desk; else the desk.
export const defaultKey = (rows) => (rows.find((r) => r.section === "batch") ?? rows.find((r) => r.section !== "desk") ?? rows[0])?.key ?? null;
// A narrow panel shows the current batch's lane and one line for the other lanes that hold asks.
export function narrowLanes(lanes, currentLane) {
  return { current: lanes.find((l) => l.lane === currentLane) ?? null, others: lanes.filter((l) => l.lane !== currentLane && l.count > 0).map((l) => `${l.label} ${l.count}`).join(" · ") };
}
// The header's counts: asks in batches (the desk is not counted), running and stuck.
export function headerLine(vm) {
  const n = vm.lanes.reduce((c, l) => c + l.count, 0), m = vm.batches.length, running = vm.groups.reduce((c, g) => c + g.rows.length, 0) + vm.sides.length;
  return { inbox: n ? `${n} ask${n === 1 ? "" : "s"} in ${m} batch${m === 1 ? "" : "es"}` : "0 asks", run: `${running} running · ${vm.stuck.length} stuck` };
}

// The terminal pane of the tab (the right-hand one in the control-room layout), never a mod pane.
export const rightPaneId = (panes, tab) => panes.find((p) => p.tab === tab && p.terminal)?.pane ?? null;

// Where the view reads: the live run files, or the screenshot fixture folder when it exists.
export function runFiles(home, fixture) {
  if (fixture) { const d = `${home}/.config/herdr-app/agents-view-fixture`; return { asks: `${d}/asks.jsonl`, events: `${d}/events.jsonl`, usage: `${d}/usage.json`, upNext: `${d}/up-next.json`, settings: `${d}/settings.json`, closed: `${d}/closed-cards.json`, stuck: `${d}/stuck.json` }; }
  const d = `${home}/handoffs/run`;
  return { asks: `${d}/asks.jsonl`, events: `${d}/events.jsonl`, usage: `${home}/.claude/.usage-cache.json`, upNext: `${d}/up-next.json`, settings: `${d}/settings.json`, closed: `${d}/closed-cards.json`, stuck: `${d}/stuck.json` };
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
export function askView(ask, picks, armed, flash = null) {
  const titles = questionTitles(ask.body);
  const qs = questionsOf(ask);
  return {
    evidence: [["Today", ask.today], ["After", ask.after], ["Checked", ask.checked], ["Why you", ask.whyYou]].filter(([, v]) => v),
    visual: ask.visual === "ready" ? { label: "open picture", ready: true } : ask.visual === "coming" ? { label: "picture coming", ready: false } : null, gone: !!ask.askerGone, replaceable: !!ask.replaceable,
    card: shortCard(ask.card), kind: ask.kind, age: ageText(ask.ageMs), old: ask.ageMs > OLD_ASK_MS, title: ask.title, noteSent: ask.noteSent,
    // with a title of its own, the whole question is body; without one the first line is the title and the rest is body
    body: [ask.titled && ask.question.trim() !== ask.title ? ask.question : ask.question.split("\n").slice(1).join("\n"), qs.length ? ask.body.replace(/^\s*\d+\..*$/gm, "").replace(/^\s+[a-z]\).*$/gm, "") : ask.body]
      .map((x) => x.trim()).filter(Boolean).join("\n"),
    targets: ask.targets.map((t) => ({ id: t.id, label: `${shortCard(t.repo)}#${t.pr}${t.landed ? " (landed)" : ""}` })),
    cards: (ask.cards ?? []).map((c) => ({ label: shortCard(c.card), choices: c.choices })),
    plan: planRef(ask.plan), marker: { plan: "plan", pr: "PR" }[planRef(ask.plan)?.kind] ?? "",
    questions: qs.map((q) => ({ q, title: titles[q] ?? "", options: ask.options.filter((o) => o.q === q).map((o) => ({
      key: o.key, label: o.label, then: o.then ?? null, rec: recommended(ask)[q] === o.key, picked: picks?.[q]?.startsWith(`${q}${o.key}:`) ?? false,
      armed: !!armed && armed.id === ask.id && armed.q === q && armed.key === o.key, flash: !!flash && flash.id === ask.id && flash.key === o.key,
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

// stuck.json is the watchdog's list ([{terminal, card, kind, since}]). One row per terminal; it wins over stuckRows for the same terminal.
const FLAG_TEXT = { blocked: "blocked 30m+", gone: "terminal gone 30m+", "no-status": "no status 5m after start", undelivered: "first message not delivered", "idle-open": "idle, card still open", silent: "no output for 30m" };
export function watchdogRows(json, terminals, nowMs) {
  const flags = parse(json);
  if (!Array.isArray(flags)) return [];
  const rows = new Map();
  for (const f of flags) {
    if (!f || typeof f.terminal !== "string" || typeof f.kind !== "string" || rows.has(f.terminal)) continue;
    const since = Date.parse(f.since);
    rows.set(f.terminal, { kind: f.kind, name: f.terminal, text: FLAG_TEXT[f.kind] ?? f.kind, ageMs: Number.isNaN(since) ? null : nowMs - since,
      address: terminals.find((t) => t.live && t.name === f.terminal)?.address ?? null });
  }
  return [...rows.values()];
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

const mergeStuck = (own, flagged) => [...own.filter((r) => !flagged.some((f) => f.name === r.name)), ...flagged];

export function viewModel({ terminals, asksText, eventsText, usageJson, upNextJson, settingsJson, closedJson, stuckJson, nowMs, hiddenIds }) {
  const ts = (terminals ?? []).map(normalize);
  const cc = parse(closedJson);
  const closed = Array.isArray(cc?.closed) ? cc.closed : [], titles = cc?.titles && typeof cc.titles === "object" ? cc.titles : {};
  const here = new Set(ts.filter((t) => t.live).map((t) => t.name).filter(Boolean));
  const asks = openAsks(parseJsonl(asksText), nowMs, closed).filter((a) => !hiddenIds?.has(a.id)).map((a) => { const gone = !!a.terminal && !a.replaced && !here.has(a.terminal); return { ...a, askerGone: gone, replaceable: gone && a.visual !== "ready" }; }); // r works at once on a gone asker: ask.sh replace records the picture request itself
  const up = parse(upNextJson);
  const warn = up?.usage?.read && up.usage.read !== "ok" ? up.usage.warn || "usage read failed" : "";
  const usage = [warn, usageText(parse(usageJson))].filter(Boolean).join(" · ");
  const settings = parse(settingsJson);
  return { origin: cc?.origin && typeof cc.origin === "object" ? cc.origin : {}, titles, deskProject: typeof settings?.desk_project === "string" && settings.desk_project ? settings.desk_project : null, usage, usageWarn: !!warn, upNext: upNextLine(up, nowMs), runnerLine: runnerLine(settingsJson), runnerOn: settings && typeof settings === "object" && !Array.isArray(settings) ? !!settings.runner : null, asks, answered: answeredAsks(parseJsonl(asksText), nowMs).filter((a) => !closed.includes(a.card)), askGroups: askGroups(asks, titles), batches: inboxBatches(asks, titles), lanes: laneSummary(inboxBatches(asks, titles)), threads: threadsOf(parseJsonl(asksText)), stuck: mergeStuck(stuckRows(ts, parseJsonl(eventsText), asks, nowMs), watchdogRows(stuckJson, ts, nowMs)), groups: epicGroups(ts), sides: sideJobs(ts), desk: deskRow(ts), others: otherSessions(ts), asksOld: asks.some((a) => a.ageMs > OLD_ASK_MS), othersLine: othersLine(otherSessions(ts).length) };
}

// The asks by epic, one group each: merges first, then decisions, then do-this-yourself, oldest first within a kind; the group with
// the oldest ask first. `line` is the group's one-line summary. A batched merge ask counts one merge per PR.
const kindRank = (a) => (a.kind === "merge" ? 0 : a.kind === "you" ? 2 : 1);
export function askGroups(asks, titles = {}) {
  const by = new Map();
  for (const a of asks) by.set(a.epic ?? a.card, [...(by.get(a.epic ?? a.card) ?? []), a]);
  return [...by].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => (b.visual === "ready") - (a.visual === "ready") || kindRank(a) - kindRank(b) || b.ageMs - a.ageMs); // a ready picture goes to the top
    const coming = sorted.filter((a) => a.visual === "coming").length;
    const n = (r) => sorted.filter((a) => kindRank(a) === r).reduce((s, a) => s + (r === 0 ? Math.max(1, a.targets.length) : 1), 0);
    const part = (c, w) => (c ? `${c} ${w}${c === 1 ? "" : "s"}` : "");
    const oldestMs = Math.max(...sorted.map((a) => a.ageMs));
    return { key, asks: sorted, oldestMs, line: [titles?.[key] || shortCard(key), ...[part(n(0), "merge"), part(n(1), "decision"), part(n(2), "task"), coming ? `${coming} picture${coming === 1 ? "" : "s"} coming` : ""].filter(Boolean), `oldest ${ageText(oldestMs)}`].join(" · ") };
  }).sort((a, b) => b.oldestMs - a.oldestMs);
}

// The running sections as one line, for while something needs you.
// What an expanded ask shows under its title, in order: the options, the plan or PR link, then the body.
export const askLayout = (v) => [v.questions.some((q) => q.options.length) && "options", v.plan && "plan", v.body && "body"].filter(Boolean);

export const runSummary = (vm) => [`Running ${vm.groups.reduce((n, g) => n + g.rows.length, 0) + vm.sides.length}`, `Stuck ${vm.stuck.length}`, vm.runnerOn == null ? "" : `Runner ${vm.runnerOn ? "on" : "off"}`].filter(Boolean).join(" · ");

// Every selectable row in display order: the desk first (never counted), one row per batch in lane order, answered asks, the running summary,
// then running (epics, then side jobs), stuck, then others. While asks wait, running and stuck show only when `showRun` is set.
// A terminal in STUCK and in its epic group is selectable in both.
export function flatRows(vm, { showRun } = {}) {
  const waiting = vm.asks.length > 0;
  const answered = (vm.answered ?? []).map((a) => ({ key: `answered:${a.id}`, section: "answered", address: null, id: a.id, row: a }));
  return [
    { key: "desk", section: "desk", address: vm.desk.address, id: null, row: vm.desk },
    ...(vm.batches ?? []).map((b) => ({ key: `batch:${b.key}`, section: "batch", address: null, id: null, row: b })),
    ...answered,
    ...(waiting ? [{ key: "summary:running", section: "summary", address: null, id: null, row: { line: runSummary(vm) } }] : []),
    ...(waiting && !showRun ? [] : [
      ...vm.groups.flatMap((g) => g.rows.map((r) => ({ key: `group:${r.address}`, section: "group", address: r.address, id: null, row: r }))),
      ...vm.sides.map((s) => ({ key: `side:${s.address}`, section: "side", address: s.address, id: null, row: s })),
      ...vm.stuck.map((s) => ({ key: `stuck:${s.kind}:${s.name}`, section: "stuck", address: s.address, id: null, row: s })),
    ]),
    ...vm.others.map((o) => ({ key: `other:${o.address}`, section: "others", address: o.address, id: null, row: o })),
  ];
}

// The header's key hint for the selected row.
export const footerHint = (section) => ({ batch: "↑ ↓ batch · ← → ask · ↵ recommended · o other idea · n note · v picture · p plan · / message", desk: "/ message the desk · ↵ show terminal · ↑ ↓ move", answered: ". nudge an answer not picked up · j k move", summary: "↵ show running · j k move" }[section] ?? "j k move · ↵ show terminal");

// Enter on a row: show its terminal in the right-hand pane. The desk, when it is not running, starts only on this owner key,
// through spawn.sh, for the project the settings name (desk_project). Batches are not shown.
export function selectTarget(r, deskProject) {
  if (r.address) return { show: r.address };
  if (r.section === "desk" && deskProject) return { start: ["spawn", "desk", "--project", deskProject] };
  return null;
}

// The one-line status of a key press, shown in the open ask (or the answered row, or the desk) in the same redraw as the key: what was pressed,
// then what the call did. A failure says so in plain words with what to do; nothing is silent. kind: pick | other | done | visual | replace | message | nudge | note.
const PRESSED = { pick: "sending your pick", other: "sending your idea", done: "marking it done", visual: "asking the agent for a picture", replace: "starting a replacement", message: "sending your message", nudge: "nudging the asker", note: "sending your note" };
const DONE = { pick: "sent to the agent", other: "your idea sent: the agent applies it or replies below", done: "marked done", visual: "picture requested: it shows here as 'open picture' when the agent has built it", replace: "replacement started", message: "message sent: delivered when the terminal is free", nudge: "reminder sent · next in 10m", note: "note sent" };
export const pressedText = (kind, label = "") => `${PRESSED[kind] ?? "working"}${label ? `: ${label}` : ""}…`;
export const doneText = (kind, label = "") => (kind === "pick" && label ? `picked ${label}: ${DONE.pick}` : DONE[kind] ?? "done");
// res = { code, stderr } of the work call, or null / no code when it could not run at all
export function failText(kind, res) {
  const err = String(res?.stderr ?? "").trim(), first = err.split("\n").find((l) => l.trim())?.trim() ?? "";
  const what = { pick: "your pick", other: "your idea", done: "marking it done", visual: "the picture request", replace: "the replacement", message: "your message", nudge: "the nudge", note: "your note" }[kind] ?? "that";
  if (res == null || typeof res.code !== "number") return `${what} did not run${first ? ` (${first})` : ""}: is the work plugin installed? run /plugin update, then press the key again`;
  if (res.code === 126 || res.code === 127 || /no such script|command not found|unknown (verb|command)|usage:/i.test(err)) return `your plugin is older than this panel (${first || `exit ${res.code}`}): run /plugin update, then press the key again`;
  if (/not open|not waiting to be applied|already has a replacement|already applied/i.test(err)) return `${what} was not sent: that ask is already answered or closed`;
  if (/less than 10 minutes/i.test(err)) return `too soon to nudge: ${first.replace(/^ask: /, "")}`;
  if (/did not take it|busy or gone|is gone|no such terminal|still running|cannot tell whether/i.test(err)) return `${what} was not sent: the agent is busy or gone; try again in a moment, or press r to start a replacement`;
  return `${what} failed (exit ${res.code})${first ? `: ${first.replace(/^ask: /, "")}` : ""}: check the terminal or run work ask pending`;
}

// ---- the Inbox as a main tab (kuchbhi#1115) ----
export const INBOX_MOD = "agents-view", INBOX_TAB = "Inbox";
const tabName = (t) => t.name ?? t.label ?? t.title ?? null;

// One tab.new for the Inbox, or a tab.select when it exists (a tab named Inbox that holds the mod).
export function inboxTabSteps({ spaces, panes, focused }) {
  const own = (spaces ?? []).flatMap((s) => s.tabs ?? []).find((t) => tabName(t) === INBOX_TAB && (panes ?? []).some((p) => p.mod === INBOX_MOD && p.tab === t.id));
  if (own) return [["tab.select", { id: own.id }]];
  const space = focused?.space ?? spaces?.[0]?.id;
  return space ? [["tab.new", { space, name: INBOX_TAB, mod: INBOX_MOD }]] : [];
}
// { tab, pane } when this view runs as the Inbox tab (the focused tab is named Inbox and holds the mod), else null: the side panel.
export function inTab({ spaces, panes, focused }) {
  const t = focused && (spaces ?? []).flatMap((s) => s.tabs ?? []).find((x) => x.id === focused.tab && tabName(x) === INBOX_TAB);
  const p = t && (panes ?? []).find((x) => x.mod === INBOX_MOD && x.tab === t.id);
  return p ? { tab: t.id, pane: p.pane } : null;
}
// The pane below the mod: one pane.split, only while the tab has no terminal pane.
export const splitSteps = ({ panes, tab, own }) => ((panes ?? []).some((p) => p.tab === tab && p.terminal) ? [] : [["pane.split", { pane: own, direction: "down" }]]);

// The running agents the owner can look at: the desk, then leads, then workers and side jobs.
export function liveAgents(vm) {
  const row = (name, address, state, role) => ({ name, address, state, role });
  return [...(vm.desk?.address ? [row(vm.desk.name, vm.desk.address, vm.desk.state, "desk")] : []),
    ...vm.groups.flatMap((g) => g.rows.map((r) => row(r.name, r.address, r.state, r.role))), ...vm.sides.map((s) => row(s.name, s.address, s.state, "side"))];
}
// What the pane below shows: follows the highlighted ask's own terminal, or the pinned agent. An ask with no agent behind it, or a gone one, keeps the
// last terminal (the desk when there was none), dimmed with the reason. step is the terminal.show to run, null when that agent is already shown.
export function bottomPlan({ pane, vm, pinned, last, shown, bottom }) {
  const agents = liveAgents(vm), by = (addr) => agents.find((a) => a.address === addr) ?? null, byName = (n) => agents.find((a) => a.name === n) ?? null;
  const showing = (a, extra) => ({ address: a.address, name: a.name, ...extra, step: bottom && a.address !== shown ? ["terminal.show", { terminal: a.address, pane: bottom }] : null });
  const pin = pinned ? by(pinned) : null;
  if (pin) return showing(pin, { mode: "pinned", dim: false, head: `${pin.name} · ${pin.state ?? "starting"} · pinned`, hint: "esc follow the highlight · s switch" });
  const unpin = !!pinned;
  const follow = (a) => showing(a, { mode: "follow", dim: false, unpin, head: `${a.name} · ${a.state ?? "starting"}`, hint: "type here to talk to it · s switch · g open its tab" });
  const keep = (mode, why) => {
    const k = (last && by(last.address)) ?? agents.find((a) => a.role === "desk") ?? null;
    return { mode, dim: true, unpin, address: k?.address ?? null, name: k?.name ?? null, step: k && bottom && k.address !== shown ? ["terminal.show", { terminal: k.address, pane: bottom }] : null,
      head: why(k?.name ?? "nothing"), hint: "s switch" };
  };
  if (pane?.kind === "desk") { const d = agents.find((a) => a.role === "desk"); if (d) return follow(d); }
  if (pane?.kind === "ask" && pane.ask.terminal) {
    const a = byName(pane.ask.terminal);
    return a ? follow(a) : keep("gone", () => `${pane.ask.terminal} is gone · r replace`);
  }
  if (pane?.kind === "ask" || pane?.kind === "answered") return keep("none", (n) => `no agent behind this ask · showing ${n}`);
  const d = agents.find((a) => a.role === "desk");
  return d ? follow(d) : keep("none", (n) => `no agent behind this ask · showing ${n}`);
}
// The switch picker (s): j k or arrows move inside the list, Enter picks, esc cancels.
export function pickerStep(p, key, n) {
  if (key === "enter") return { type: "pick", index: p.cur };
  if (key === "escape") return { type: "cancel" };
  const d = key === "down" || key === "j" ? 1 : key === "up" || key === "k" ? -1 : 0;
  return { type: "move", cur: Math.max(0, Math.min(n - 1, p.cur + d)) };
}
// The owner's way into the agent: agent.focus on the Mac, terminal.peek (full screen with a back button) on the phone.
export const goStep = (terminal, phone) => [phone ? "terminal.peek" : "agent.focus", { terminal }];
const SHORT_LANE = { key: "ONE KEY", look: "LOOK", hands: "HANDS", groom: "NOT READY" };
export const lanesLine = (lanes) => lanes.map((l) => `${SHORT_LANE[l.lane]} ${l.count}`).join(" · ");
export const phoneBar = (agent) => [{ key: "v", label: "Picture" }, { key: "o", label: "Own idea" }, ...(agent ? [{ key: "g", label: "Go to agent" }] : [])];

// Why / What / How for one ask, from what the runner stored per card (closed-cards.json origin). A card with nothing stored shows only the epic: nothing is invented.
export function originView(ask, vm, hasAgent) {
  const o = vm.origin?.[ask.card], key = ask.epic ?? ask.card;
  const epic = vm.titles?.[key] || shortCard(key);
  if (!o) return { why: { tag: null, epic, line: "" }, what: "", how: [] };
  const pr = prOf(ask);
  return { why: { tag: o.by === "agent" ? "agent-filed" : "your card", epic, line: o.summary ?? "" }, what: (o.trail ?? []).join(" → "),
    how: [ask.plan ? { key: "p", label: planRef(ask.plan)?.kind === "pr" ? "open PR" : "open plan" } : null, pr ? { key: "d", label: "diff" } : null, { key: "c", label: "open card" }, hasAgent ? { key: "g", label: "go to agent" } : null].filter(Boolean) };
}
// c opens the card, d the PR's files, g goes to the agent; never a key that is one of the ask's own option letters.
export function originKey(ask, k, hasAgent) {
  if (ask.options?.some((o) => o.key === k)) return null;
  const m = String(ask.card).match(/^(.+)#(\d+)$/);
  if (k === "c" && m) return { type: "open", target: `https://github.com/${m[1]}/issues/${m[2]}` };
  const pr = prOf(ask);
  if (k === "d" && pr) return { type: "open", target: `https://github.com/${pr.repo}/pull/${pr.pr}/files` };
  if (k === "g" && hasAgent) return { type: "agent" };
  return null;
}

// Runs one action through io = { run, exec, pane }. Nothing happens without a right-hand pane to show in.
export async function perform(a, io) {
  if (a.type === "post") return io.exec("work", a.argv);
  if (a.type === "open") return io.exec("open", [a.target]);
  if (!io.pane) return;
  if (a.type === "show") return io.run("terminal.show", { terminal: a.terminal, pane: io.pane });
  if (a.type === "start-desk") {
    const r = await io.exec("work", a.argv);
    let address = null; try { address = JSON.parse(r.stdout).address; } catch { /* not started */ }
    if (address) io.run("terminal.show", { terminal: address, pane: io.pane });
  }
}
