// Inbox: pure logic (tested with node --test). main.js reads the inputs, draws and handles keys.
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
// (a `delivered` event), and whether it is done (applied, which drops it unless `all`: the Sent list keeps it as done). Answered 10 minutes ago and not applied: notPickedUp.
export function answeredAsks(lines, nowMs, all = false) {
  const asks = new Map(), ev = new Map();
  for (const l of lines) {
    const k = askKey(l);
    if (k == null) continue;
    if (l.event === "ask") { if (!asks.has(k)) asks.set(k, l); }
    else ev.set(k, [...(ev.get(k) ?? []), l]);
  }
  const out = [];
  for (const [k, a] of asks) {
    const x = ev.get(k) ?? [], an = x.findLast((e) => e.event === "answered"), done = x.some((e) => e.event === "applied");
    if (!an || x.some((e) => e.event === "resumed" || e.event === "closed" || (!all && e.event === "applied")) || (a.batch != null && a.batch !== k)) continue;
    const at = Date.parse(an.ts);
    out.push({ id: k, card: a.card, epic: a.epic ?? null, title: a.title ?? plainTitle(a.question), pick: an.text, key: an.key ?? null, answeredAt: an.ts, ageMs: nowMs - at,
      sent: true, received: x.some((e) => e.event === "delivered"), done, notPickedUp: !done && nowMs - at > NOT_PICKED_UP_MS, lead: a.terminal ?? null, note: an.note ?? null, lane: laneOf(a.kind), kind: a.kind ?? "decide", from: roleOf(a) });
  }
  return out.sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));
}

// a batch row holds one line: a long title is cut with an ellipsis
export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function openAsks(lines, nowMs, closed = []) {
  const parts = new Map(), open = new Map(), seen = new Map(), ended = new Map(), msgs = [], seq = [], noted = new Set(), landed = new Set(), asked = new Set(), urls = new Map(), replaced = new Map(), groomed = new Map();
  for (const l of lines) {
    if (l.event === "message" && l.thread) { msgs.push(l); continue; }
    const k = askKey(l);
    if (l.event === "ask") { if (!open.has(k)) { open.set(k, l); seq.push(l); if (!seen.has(k)) seen.set(k, l); } }
    else if (k != null && END_EVENTS.has(l.event)) { open.delete(k); noted.delete(k); ended.set(k, l); }
    else if (k != null && l.event === "noted") noted.add(k);
    else if (k != null && l.event === "landed") landed.add(k);
    else if (k != null && l.event === "part") parts.set(k, [...(parts.get(k) ?? []), l]); // a lead's later question on the epic: part n+1 of this ask
    else if (k != null && l.event === "visual_requested") asked.add(k);
    else if (k != null && l.event === "visual_ready" && asked.has(k) && l.url) urls.set(k, l.url); // a picture nobody asked for does not count
    else if (k != null && l.event === "replaced") replaced.set(k, (replaced.get(k) ?? 0) + 1);
    else if (k != null && l.event === "replace_failed") replaced.set(k, (replaced.get(k) ?? 0) - 1); // the claim given back
    else if (k != null && l.event === "groomed") groomed.set(k, { ...groomed.get(k), [l.member]: l }); // newest event per card
  }
  // an answered ask comes back, marked `reply`, when the agent wrote on its thread after the answer and the owner has not answered that since (a message or another answer)
  for (const [k, e] of ended) {
    if (e.event !== "answered" || open.has(k) || !seen.has(k)) continue;
    const mine = msgs.filter((m) => m.thread === k && Date.parse(m.ts) > Date.parse(e.ts)), reply = mine.findLast((m) => m.from !== "owner");
    if (!reply || mine.some((m) => m.from === "owner" && Date.parse(m.ts) > Date.parse(reply.ts))) continue;
    const row = { ...seen.get(k), reply: { text: String(reply.text ?? ""), ts: reply.ts } };
    open.set(k, row); seq.push(row);
  }
  const live = [...open.values()].filter((l) => !closed.includes(l.card)
    && !seq.slice(seq.indexOf(l) + 1).some((n) => l.card != null && n.card === l.card && roleOf(n) === roleOf(l) && (n.kind ?? "decide") === (l.kind ?? "decide") && batchOf(n) !== batchOf(l) && (l.kind !== "merge" || sameTarget(n, l))))
  const groups = new Map();
  for (const l of live) groups.set(batchOf(l), [...(groups.get(batchOf(l)) ?? []), l]);
  return [...groups.values()]
    .map((rows) => {
      const l = rows[0];
      const targets = rows.length > 1 ? rows.map((r) => ({ id: askKey(r), repo: r.target?.repo, pr: r.target?.pr, head: r.target?.head, landed: landed.has(askKey(r)) })) : [];
      return {
        id: askKey(l), card: l.card, epic: l.epic ?? null, url: l.url ?? null, question: l.question, title: l.title ?? plainTitle(l.question), titled: l.title != null,
        ts: l.ts, ageMs: nowMs - Date.parse(l.ts), from: roleOf(l),
        options: targets.length ? [{ q: 1, key: "a", label: `Merge all ${targets.length}, in order (Recommended)` }, { q: 1, key: "b", label: "Pick which to merge" }] : [...(Array.isArray(l.options) ? l.options : []), ...(parts.get(askKey(l)) ?? []).flatMap((p) => p.options ?? [])],
        parts: (parts.get(askKey(l)) ?? []).map((p) => ({ q: p.q, card: p.card, title: p.title, question: p.question, today: p.today, after: p.after, checked: p.checked, whyYou: p.why_you })), landed: landed.has(askKey(l)),
        kind: l.kind ?? "decide", lane: laneOf(l.kind), plan: l.plan ?? null, body: (l.body ?? "") + (parts.get(askKey(l)) ?? []).map((p) => `\n${p.body ?? ""}`).join(""), targets,
        today: l.today ?? null, after: l.after ?? null, checked: l.checked ?? null, whyYou: l.why_you ?? null, batchKey: l.batch_key ?? null, noteSent: noted.has(askKey(l)),
        visual: urls.has(askKey(l)) ? "ready" : asked.has(askKey(l)) ? "coming" : "none", visualUrl: urls.get(askKey(l)) ?? null,
        reply: l.reply ?? null, terminal: l.terminal ?? null, target: l.target ?? null, replaced: (replaced.get(askKey(l)) ?? 0) > 0, askerGone: false, replaceable: false,
        // a groom batch: its cards that are still not ready, with their open choices (kuchbhi#1119)
        cards: Object.values(groomed.get(askKey(l)) ?? {}).filter((g) => !g.ready).map((g) => ({ card: g.member, choices: g.choices ?? [] })),
      };
    })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

// The key the panel hides an ask by once it has sent its answer: a reply to that answer is a new thing to answer, so it has its own.
export const hideKey = (a) => (a.reply ? `${a.id}@${a.reply.ts}` : a.id);

export const DOUBLE_PRESS_MS = 10_000;
const NEEDS_SECOND_KEY = new Set(["merge", "roll", "money"]);

// What a key does on an open ask. `armed` is the pending first press ({ id, key, q, at }) or null.
// Returns { type: "post", text, key? } | { type: "arm", armed, body } | { type: "open", target } | { type: "cancel" } | null.
// `q` is the selected question of the ask (default 1); a letter picks an option within it.
export function askKeyAction(ask, key, armed, nowMs, q = 1) {
  let text = null, pick = false, okey = null;
  if (key === "x" && ask.kind === "you" && !ask.options.length) text = "Done."; // x is reserved for you asks; elsewhere it is an option key
  else if (key === "v") return ask.visual === "ready" ? { type: "open", target: ask.visualUrl } : ask.askerGone ? { type: "gone" } : { type: "visual" }; // a picture answers nothing: no second key
  else if (key === "p" && !ask.options.some((o) => o.key === "p") && openLinks(ask).length) return { type: "open", target: openLinks(ask)[0].target };
  else if (key === "r" && ask.replaceable && !ask.options.some((o) => o.key === "r")) return { type: "replace" };
  else if (key === "b" && ask.targets?.length > 1) return { type: "checklist" }; // a batched merge ask: b picks which PRs
  else {
    const o = ask.options.find((o) => o.q === q && o.key === key);
    if (o) { text = `${o.q}${o.key}: ${o.label}`; okey = o.key; pick = new Set(ask.options.map((o) => o.q)).size > 1; }
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
export function acceptRecommended(ask, armed, nowMs, picks = {}) {
  const eff = effective(ask, picks), qs = questionsOf(ask);
  if (!qs.length || ask.kind === "you") return null;
  if (qs.length === 1) return eff[qs[0]] ? askKeyAction(ask, eff[qs[0]], armed, nowMs, qs[0]) : null;
  if (!qs.every((q) => eff[q])) return null;
  if (NEEDS_SECOND_KEY.has(ask.kind) && !(armed && armed.id === ask.id && armed.key === "enter" && nowMs - armed.at <= DOUBLE_PRESS_MS)) {
    return { type: "arm", armed: { id: ask.id, key: "enter", q: 0, at: nowMs }, body: ask.body };
  }
  if (qs.some((q) => eff[q] === "note")) return { type: "post", text: "", key: "other" }; // submitAnswer words it
  return { type: "post", text: qs.map((q) => `${q}${eff[q]}: ${ask.options.find((o) => o.q === q && o.key === eff[q]).label}`).join("\n"), key: qs.map((q) => `${q}${eff[q]}`).join(",") };
}
// The option that goes with each question: the owner's pick ("1b: label"), else the recommended one: { q: key }.
const effective = (ask, picks = {}) => { const rec = recommended(ask), out = {}; for (const q of questionsOf(ask)) out[q] = picks[q] ? picks[q].split(":")[0].slice(String(q).length) : rec[q]; return out; };
// The line under the question: the marks so far, one `<q><key>` per marked question and `<q> –` where none is made yet.
export const answerLine = (ask, picks = {}) => questionsOf(ask).map((q) => (picks[q] ? picks[q].split(":")[0].replace("note", " note") : `${q} –`)).join(" · ");
// Enter submits when every part is marked ({type:"incomplete", marked, total} otherwise); `all` (ctrl-Enter) takes the recommended option for the parts left unmarked.
// A part whose note is its answer ("<q>note: <text>": a note and no option picked) makes the answer `--key other` with one line per part as the text.
export function submitAnswer(ask, armed, nowMs, picks = {}, all = false) {
  const qs = questionsOf(ask), marked = qs.filter((q) => picks[q]).length;
  if (qs.length > 1 && !all && marked < qs.length) return { type: "incomplete", marked, total: qs.length };
  const r = acceptRecommended(ask, armed, nowMs, picks);
  if (r?.type !== "post" || !qs.some((q) => picks[q]?.startsWith(`${q}note`))) return r;
  const eff = effective(ask, picks);
  return { type: "post", key: "other", text: qs.map((q) => (eff[q] === "note" ? `${q} own answer: ${picks[q].slice(picks[q].indexOf(":") + 1).trim()}` : `${q}${eff[q]}: ${ask.options.find((o) => o.q === q && o.key === eff[q]).label}`)).join("\n") };
}
// The notes of the parts as one line for `--note`: `<q>: <text>` per part with a note, in order.
export const partNotes = (ask, notes = {}) => questionsOf(ask).filter((q) => (notes[q] ?? "").trim()).map((q) => `${q}: ${notes[q].trim()}`).join(" · ");

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
  && (ask.options.some((o) => o.key === k) || (k === "x" && ask.kind === "you") || k === "v" || k === "n" || k === "c" || (k === "d" && !!prOf(ask)) || (k === "p" && openLinks(ask).length > 0) || (k === "r" && !!ask.replaceable) || ask.options.some((o) => String(o.q) === k) || !!armed);

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

// ---- the tab-bar count and its popup (kuchbhi#1360): the owner sees open asks without opening the panel and answers with one click ----
export const badgeText = (asks) => (asks.length ? `${asks.length} ask${asks.length === 1 ? "" : "s"} for you` : "");
// One entry per open ask with its buttons, each the `work` argv that answers it. The click is the deliberate second press a merge,
// roll or money ask needs, so no arming. Picking a batch's PRs or writing an answer of one's own stays in the asker's tab.
export function inboxItems(asks) {
  return asks.map((ask) => {
    const qs = new Set(ask.options.map((o) => o.q)), buttons = [];
    if (ask.kind === "you" && !ask.options.length) buttons.push({ label: "Done", argv: answerArgv(ask, "Done.") });
    else if (qs.size > 1) {
      const r = acceptRecommended(ask, { id: ask.id, key: "enter", q: 0, at: 0 }, 0);
      if (r?.type === "post") buttons.push({ label: "Accept the recommended answers", argv: answerArgv(ask, r.text, { key: r.key }) });
    } else for (const o of ask.options) if (!(ask.targets?.length > 1 && o.key === "b")) buttons.push({ label: `${o.key}) ${o.label}`, argv: answerArgv(ask, `${o.q}${o.key}: ${o.label}`, { key: o.key }) });
    return { id: ask.id, title: ask.title, epic: ask.epic ?? ask.card, kind: ask.kind, buttons };
  });
}

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

export const messageArgv = (thread, text, to = null) => ["ask", "message", thread, "--text", text, "--by", "owner", ...(to ? ["--to", to] : [])];
// With an ask open the message goes to the agent behind it (the ask's thread); with none open, to the desk.
export const messageTarget = (ask) => (ask ? askId(ask) : "desk");

// ---- batches in four lanes (kuchbhi#1116)
export const LANE_LABELS = { key: "One key", look: "Needs a look", hands: "Your hands", groom: "Not ready" };
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
export const enterAction = (ask, armed, nowMs, onPicture, picks = {}, all = false) => (onPicture && ask.visual === "ready" ? { type: "open", target: ask.visualUrl } : submitAnswer(ask, armed, nowMs, picks, all));
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
  if (row?.section === "epic") { const e = row.row; if (!e.asks.length || e.waiting) return { kind: "epic", epic: e, thread: `epic:${e.ref}` }; const ask = askAt(pos, e); return { kind: "ask", ask, batch: e, epic: e, thread: ask.id }; }
  if (row?.section === "sub" || row?.section === "subpart") { const { epic, ask, q } = row.row; return { kind: "ask", ask, batch: epic, epic, thread: ask.id, ...(q ? { q } : {}) }; }
  if (row?.section === "fold") return { kind: "fold", fold: row.row, thread: null };
  if (row?.section === "batch") { const ask = askAt(pos, row.row); return { kind: "ask", ask, batch: row.row, thread: ask.id }; }
  if (row?.section === "sent") return { kind: "answered", answered: row.row, thread: row.row.id };
  if (row?.section === "sentfold") return { kind: "sentfold", fold: row.row, thread: null };
  return { kind: "empty" };
}
// Until the owner moves: the first batch; with none, the first row that is not the desk; else the desk.
export const defaultKey = (rows) => (rows.find((r) => r.section === "epic" && r.row.state === "needs") ?? rows.find((r) => r.section === "batch") ?? rows.find((r) => r.section !== "desk" && r.section !== "epic" && r.section !== "fold") ?? rows[0])?.key ?? null;
// A narrow panel shows the current batch's lane and one line for the other lanes that hold asks.
export function narrowLanes(lanes, currentLane) {
  return { current: lanes.find((l) => l.lane === currentLane) ?? null, others: lanes.filter((l) => l.lane !== currentLane && l.count > 0).map((l) => `${l.label} ${l.count}`).join(" · ") };
}
// The header's counts: asks in batches (the desk is not counted), running and stuck.
export function headerLine(vm) {
  const by = (st) => (vm.epics ?? []).filter((e) => e.state === st).length, n = by("needs");
  return { inbox: n ? `${n} epic${n === 1 ? " needs" : "s need"} you` : "Nothing needs you", run: `${by("working")} working · ${by("stuck")} stuck` };
}

// The terminal pane of the tab (the right-hand one in the control-room layout), never a mod pane.
export const rightPaneId = (panes, tab) => panes.find((p) => p.tab === tab && p.terminal)?.pane ?? null;
export const rightPane = (panes, tab) => panes.find((p) => p.tab === tab && p.terminal) ?? null;

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

// The Sent list: every answer the owner sent, newest first (at most 30). An answer the file does not show yet (the outbox) is there as sent; an ask that came back
// with a reply is in its epic again, not here.
const SENT_MAX = 30;
export const sentList = (answered, outbox, open, closed) => {
  const back = new Set(open.map((a) => a.id));
  const newest = new Map([...answered, ...outbox].map((a) => [a.id, a])); for (const a of [...answered, ...outbox]) if (Date.parse(a.answeredAt) >= Date.parse(newest.get(a.id).answeredAt)) newest.set(a.id, a);
  return [...newest.values()].filter((a) => !closed.includes(a.card) && !back.has(a.id)).sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt)).slice(0, SENT_MAX);
};
export function viewModel({ outbox = [], terminals, asksText, eventsText, usageJson, upNextJson, settingsJson, closedJson, stuckJson, nowMs, hiddenIds, waits = {} }) {
  const ts = (terminals ?? []).map(normalize), asksLines = parseJsonl(asksText); // parsed once: the run file is big and the view redraws often
  const cc = parse(closedJson);
  const closed = Array.isArray(cc?.closed) ? cc.closed : [], titles = cc?.titles && typeof cc.titles === "object" ? cc.titles : {};
  const here = new Set(ts.filter((t) => t.live).map((t) => t.name).filter(Boolean));
  const asks = openAsks(asksLines, nowMs, closed).filter((a) => !hiddenIds?.has(hideKey(a))).map((a) => { const gone = !!a.terminal && !a.replaced && !here.has(a.terminal); return { ...a, askerGone: gone, replaceable: gone && a.visual !== "ready" }; }); // r works at once on a gone asker: ask.sh replace records the picture request itself
  const up = parse(upNextJson);
  const warn = up?.usage?.read && up.usage.read !== "ok" ? up.usage.warn || "usage read failed" : "";
  const usage = [warn, usageText(parse(usageJson))].filter(Boolean).join(" · ");
  const settings = parse(settingsJson);
  const stuck = mergeStuck(stuckRows(ts, parseJsonl(eventsText), asks, nowMs), watchdogRows(stuckJson, ts, nowMs)), groups = epicGroups(ts);
  return { origin: cc?.origin && typeof cc.origin === "object" ? cc.origin : {}, titles, deskProject: typeof settings?.desk_project === "string" && settings.desk_project ? settings.desk_project : null, usage, usageWarn: !!warn, upNext: upNextLine(up, nowMs), runnerLine: runnerLine(settingsJson), runnerOn: settings && typeof settings === "object" && !Array.isArray(settings) ? !!settings.runner : null, asks, sent: sentList(answeredAsks(asksLines, nowMs, true), outbox, asks, closed), askGroups: askGroups(asks, titles), batches: inboxBatches(asks, titles), lanes: laneSummary(inboxBatches(asks, titles)), threads: threadsOf(asksLines), stuck, groups, epics: buildEpics({ asks, groups, stuck, closed, titles, areas: cc?.areas && typeof cc.areas === "object" ? cc.areas : {}, origin: cc?.origin && typeof cc.origin === "object" ? cc.origin : {}, statuses: leadStatuses(asksLines), waits, nowMs }), sides: sideJobs(ts), desk: deskRow(ts), others: otherSessions(ts), asksOld: asks.some((a) => a.ageMs > OLD_ASK_MS), othersLine: othersLine(otherSessions(ts).length) };
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
export function flatRows(vm, { showRun, filter = "", unfolded = false, sentOpen = false, expanded = new Set() } = {}) {
  const list = epicList(vm.epics ?? [], { filter, unfolded });
  const waiting = vm.asks.length > 0;
  const sent = vm.sent?.length ? [{ key: "sentfold", section: "sentfold", address: null, id: null, row: { label: `Sent · ${vm.sent.length}`, count: vm.sent.length, open: sentOpen } }, ...(sentOpen ? vm.sent.map((a) => ({ key: `sent:${a.id}`, section: "sent", address: null, id: a.id, row: a })) : [])] : [];
  return [
    { key: "desk", section: "desk", address: vm.desk.address, id: null, row: vm.desk },
    ...list.rows.flatMap((r) => (r.kind === "fold" ? [{ key: "fold", section: "fold", address: null, id: null, row: r }] : [{ key: r.epic.key, section: "epic", address: null, id: null, row: r.epic }, ...(expanded.has(r.epic.key) ? subRows(r.epic) : [])])),
    ...sent,
    ...(waiting ? [{ key: "summary:running", section: "summary", address: null, id: null, row: { line: runSummary(vm) } }] : []),
    ...(waiting && !showRun ? [] : [
      ...vm.groups.flatMap((g) => g.rows.map((r) => ({ key: `group:${r.address}`, section: "group", address: r.address, id: null, row: r }))),
      ...vm.sides.map((s) => ({ key: `side:${s.address}`, section: "side", address: s.address, id: null, row: s })),
      ...vm.stuck.map((s) => ({ key: `stuck:${s.kind}:${s.name}`, section: "stuck", address: s.address, id: null, row: s })),
    ]),
    ...vm.others.map((o) => ({ key: `other:${o.address}`, section: "others", address: o.address, id: null, row: o })),
  ];
}

// An expanded epic: one sub-row per ask, and under a multi-part ask one per part. Keys: sub:<ask> and sub:<ask>:<part>.
export const subKey = (ask, q) => (questionsOf(ask).length > 1 && q ? `sub:${ask.id}:${q}` : `sub:${ask.id}`);
const subRows = (epic) => epic.asks.flatMap((a) => [{ key: `sub:${a.id}`, section: "sub", address: null, id: a.id, row: { epic, ask: a, q: null } },
  ...(questionsOf(a).length > 1 ? questionsOf(a).map((q) => ({ key: `sub:${a.id}:${q}`, section: "subpart", address: null, id: a.id, row: { epic, ask: a, q } })) : [])]);

// The header's key hint for the selected row.
export const footerHint = (section) => ({ sub: "↑ ↓ ask or part · ← → step · 1-9 then a letter changes one · n note · ↵ send", subpart: "↑ ↓ ask or part · ← → step · a letter marks it · n note · ↵ send", epic: "↑ ↓ rows · ← → step asks and parts · space opens or closes the epic · ↵ send recommended · 1-9 then a letter changes one · n note · f filter · B board · t lead's terminal · / message the lead", fold: "space shows or hides the finished · ↑ ↓ move", batch: "↑ ↓ batch · ← → ask · ↵ recommended · o other idea · n note · v picture · p plan · / message", desk: "/ message the desk · ↵ show terminal · ↑ ↓ move", sent: ". nudge an answer not picked up · ↑ ↓ move", sentfold: "space shows or hides what you sent · ↑ ↓ move", summary: "↵ show running · j k move" }[section] ?? "j k move · ↵ show terminal");

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

// One tab.new for the Inbox (in the selected space, the mod's props say it is the Inbox), or a tab.select when a tab already holds the mod.
export function inboxTabSteps({ panes }) {
  const own = (panes ?? []).find((p) => p.mod === INBOX_MOD);
  return own ? [["tab.select", { id: own.tab }]] : [["tab.new", { name: INBOX_TAB, mod: INBOX_MOD, props: { inbox: true } }]];
}
// { tab, pane } when this copy of the mod was opened as the Inbox tab (its props say so), else null: the side panel. Its own pane is the mod pane
// of the focused tab when there is one, else the first mod pane.
export function inTab({ panes, focused, props }) {
  if (!props?.inbox) return null;
  const mine = (panes ?? []).filter((p) => p.mod === INBOX_MOD);
  const p = mine.find((x) => x.tab === focused?.tab) ?? mine[0];
  return p ? { tab: p.tab, pane: p.pane } : null;
}

// The running agents the owner can look at: the desk, then leads, then workers and side jobs.
export function liveAgents(vm) {
  const row = (name, address, state, role) => ({ name, address, state, role });
  return [...(vm.desk?.address ? [row(vm.desk.name, vm.desk.address, vm.desk.state, "desk")] : []),
    ...vm.groups.flatMap((g) => g.rows.map((r) => row(r.name, r.address, r.state, r.role))), ...vm.sides.map((s) => row(s.name, s.address, s.state, "side"))];
}
// The lower pane is a real `hc attach` to the agent (typeable), opened with t or cmd-shift-t and closed the same way; it sizes the agent's terminal to the pane
// while it is open. There is no pane until t. The pane runs a small loop that attaches to the address in a file; moving to another agent writes the new
// address and detaches (ctrl+\) the attach in it, so the loop attaches the new one in the SAME pane: it is split once and keeps its size.
// terminal.show only jumps to an agent that has a pane of its own, so it is not used.
const SAFE_ADDR = /^[A-Za-z0-9/_.-]+$/;
export const attachArgv = (addr) => ["hc", "attach", addr];
export const paneFile = (own) => `/tmp/herdr-agents-view-${own}.addr`;
export const loopArgv = (file) => ["sh", "-c", `f=${file}; while a=$(cat "$f" 2>/dev/null); [ -n "$a" ]; do hc attach "$a" || sleep 1; done`];
// What the pane below shows once it is on: follows the highlighted ask's own terminal, or the pinned agent. An ask with no agent behind it, or a gone one,
// keeps the last terminal (the desk when there was none), dimmed with the reason. steps: ["write", {file, text}] the address, ["detach", {terminal}] the attach
// in the kept pane, ["pane.split", ...] the one split, ["pane.close", ...]; none while that agent is already attached. `shown` is the key of what is there now.
export function bottomPlan({ pane, vm, pinned, last, shown, bottom, bottomTerminal = null, own, on = false }) {
  if (!on) return { mode: "off", dim: true, address: null, name: null, key: "off", steps: bottom && shown !== "off" ? [["pane.close", { pane: bottom }]] : [], head: "agent pane closed", hint: "t opens it · cmd-shift-t from anywhere" };
  const agents = liveAgents(vm), by = (addr) => agents.find((a) => a.address === addr) ?? null, byName = (n) => agents.find((a) => a.name === n) ?? null;
  const keyOf = (a) => `${a.address}:attach`;
  const show = (a) => {
    if (!own || !SAFE_ADDR.test(a.address) || !SAFE_ADDR.test(own) || keyOf(a) === shown) return [];
    const file = paneFile(own), write = ["write", { file, text: a.address }], split = ["pane.split", { pane: own, direction: "right", argv: loopArgv(file) }];
    if (!bottom) return [write, split];
    if (!String(shown ?? "").endsWith(":attach")) return [["pane.close", { pane: bottom }], write, split]; // a pane we did not make: start clean
    return [write, ...(bottomTerminal ? [["detach", { terminal: bottomTerminal }]] : [])];
  };
  const showing = (a, extra) => ({ address: a.address, name: a.name, key: keyOf(a), ...extra, steps: show(a) });
  const pin = pinned ? by(pinned) : null;
  if (pin) return showing(pin, { mode: "pinned", dim: false, head: `${pin.name} · ${pin.state ?? "starting"} · pinned`, hint: "cmd-shift-t closes · esc follow the highlight · s switch" });
  const unpin = !!pinned;
  const follow = (a) => showing(a, { mode: "follow", dim: false, unpin, head: `${a.name} · ${a.state ?? "starting"}`, hint: "cmd-shift-t closes · g open its tab" });
  const keep = (mode, why) => {
    const k = (last && by(last.address)) ?? agents.find((a) => a.role === "desk") ?? null;
    return { mode, dim: true, unpin, address: k?.address ?? null, name: k?.name ?? null, key: k ? keyOf(k) : null, steps: k ? show(k) : [],
      head: why(k?.name ?? "nothing"), hint: "cmd-shift-t closes · s switch" };
  };
  if (pane?.kind === "desk") { const d = agents.find((a) => a.role === "desk"); if (d) return follow(d); }
  if (pane?.epic) { // an epic's agent is its lead, not the worker whose ask it is
    const a = pane.epic.lead ? by(pane.epic.lead.address) : null;
    return a ? follow(a) : keep("none", (n) => `no lead running · showing ${n}`);
  }
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
const SHORT_LANE = { key: "One key", look: "Look", hands: "Hands", groom: "Not ready" };
export const lanesLine = (lanes) => lanes.map((l) => `${SHORT_LANE[l.lane]} ${l.count}`).join(" · ");
export const phoneBar = (agent) => [{ key: "v", label: "Picture" }, { key: "n", label: "Note" }, { key: "B", label: "Board" }, ...(agent ? [{ key: "g", label: "Open" }] : [])];

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

// ---- Inbox by epic (kuchbhi#1115) ----
// The newest lead_status per epic: { epic: { text, ts, terminal? } }. An event with no text is ignored.
export function leadStatuses(lines) {
  const out = {};
  for (const l of lines) if (l.event === "lead_status" && l.epic && typeof l.text === "string" && l.text) out[l.epic] = { text: l.text, ts: l.ts, ...(l.terminal ? { terminal: l.terminal } : {}) };
  return out;
}

// The board's Area field, by its friendly name; one map. An Area not in it shows as itself with a capital; no Area: the repo.
export const AREA_NAMES = { agents: "Agent tooling", gtm: "Marketing", pwa: "Parent app", infra: "Infrastructure", security: "Security", home: "Home", business: "Business", support: "Support" };
const repoOf = (epic) => String(epic).split("#")[0].split("/").pop();
export const groupName = (area, epic) => (area ? AREA_NAMES[String(area).toLowerCase()] ?? `${String(area)[0].toUpperCase()}${String(area).slice(1)}` : repoOf(epic));

// A lead sitting at its prompt with a question or steps for the owner that were never raised as an ask: the last lines of its screen, or null.
// Working (a spinner line "· Doing… (12s"), no prompt, or nothing for the owner in the last answer: null. The lead's footer, recap and "Worked for" lines are left out.
export function waitingLines(screen) {
  const all = String(screen ?? "").split("\n");
  if (all.some((l) => /^\s*\S\s+\S.*…\s*\(\d+[smh]\b|esc to interrupt/.test(l))) return null;
  const prompt = all.findLastIndex((l) => /^❯/.test(l));
  if (prompt < 0) return null;
  let text = all.slice(0, prompt).filter((l) => !/^─{5,}/.test(l));
  const done = text.findIndex((l) => /^(✻|※)/.test(l)); // "Worked for…" and the recap close the answer
  if (done >= 0) text = text.slice(0, done);
  const bullet = text.findLastIndex((l) => /^⏺/.test(l)), mine = text.slice(Math.max(bullet, 0)).filter((l) => l.trim());
  if (!/\?|\bsay go\b|^\s*\d+\.\s/im.test(mine.join("\n"))) return null;
  return mine.slice(-8).map((l) => l.replace(/^⏺\s*/, "").trimEnd());
}

const STATE_RANK = { needs: 0, stuck: 1, working: 2, done: 3 };
const lastOf = (a) => (Array.isArray(a) && a.length ? a[a.length - 1] : null);

// One row per epic: those with an open ask, a running terminal or a status line. state: needs (an open ask), stuck, working, done (the epic is closed and nothing waits).
// line: the lead's status, else the open ask's title, else what is stuck, else the last /work phase of its cards. prs: the badges, deduplicated by number.
export function buildEpics({ asks, groups, stuck, closed, titles, areas, origin, statuses, waits, nowMs }) {
  const keys = new Set([...asks.map((a) => a.epic ?? a.card), ...groups.map((g) => g.epic), ...Object.keys(statuses ?? {})]);
  const closedSet = new Set(closed ?? []);
  return [...keys].map((key) => {
    const mine = asks.filter((a) => (a.epic ?? a.card) === key).sort((a, b) => (a.kind === "merge") - (b.kind === "merge") || b.ageMs - a.ageMs);
    const rows = groups.find((g) => g.epic === key)?.rows ?? [];
    const lead = rows.find((r) => r.role === "lead") ?? rows.find((r) => r.role !== "worker") ?? null, workers = rows.filter((r) => r.role === "worker");
    const mineRows = new Set(rows.flatMap((r) => [r.address, r.name]));
    const stucks = (stuck ?? []).filter((s) => mineRows.has(s.address) || mineRows.has(s.name));
    const st = statuses?.[key] ?? null;
    // the lead's screen: idle at a prompt with a question for the owner that no open ask carries (the lines name no open ask's id or title)
    const lines = lead ? waits?.[lead.address] ?? null : null, text = (lines ?? []).join("\n");
    const waiting = lines && !mine.some((a) => text.includes(a.id) || (a.title && text.includes(a.title))) ? { lines } : null;
    const state = mine.length || waiting ? "needs" : closedSet.has(key) ? "done" : stucks.length ? "stuck" : "working";
    const prs = [];
    const addPr = (pr, state2) => { if (pr == null) return; const at = prs.findIndex((p) => p.pr === pr); if (at < 0) prs.push({ pr, state: state2 }); else if (state2 === "merged") prs[at].state = "merged"; };
    for (const a of mine) { for (const t of a.targets ?? []) addPr(t.pr, t.landed ? "merged" : "waiting"); if (!(a.targets ?? []).length && a.target?.pr != null) addPr(a.target.pr, a.landed ? "merged" : "waiting"); }
    for (const a of mine) for (const p of origin?.[a.card]?.trail ?? []) { const m = /^PR #(\d+)/.exec(p); if (m) addPr(Number(m[1]), "waiting"); }
    const phase = lastOf(origin?.[key]?.trail) ?? mine.map((a) => lastOf(origin?.[a.card]?.trail)).find(Boolean) ?? null;
    const newest = mine.length ? Math.min(...mine.map((a) => a.ageMs)) : Infinity, stAge = st?.ts ? nowMs - Date.parse(st.ts) : Infinity;
    const words = (st && stAge < newest ? st.text : null) ?? mine[0]?.title ?? st?.text ?? stucks[0]?.text ?? phase ?? (state === "done" ? "finished" : ""), line = waiting ? "Lead is waiting in its terminal" : mine.some((a) => openLinks(a).length) ? ["Needs a look", words].filter(Boolean).join(" · ") : words;
    const area = areas?.[key] ?? null;
    return {
      key: `epic:${key}`, ref: key, num: Number(String(key).split("#").pop()), title: titles?.[key] || shortCard(key), area, group: groupName(area, key),
      state, line, prs, ageMs: mine.length ? Math.max(...mine.map((a) => a.ageMs)) : st?.ts ? nowMs - Date.parse(st.ts) : null,
      asks: waiting ? mine.map((a) => ({ ...a, older: true })) : mine, waiting, lead: lead ? { name: lead.name, address: lead.address } : null, workers, stuck: stucks, origin: origin?.[mine[0]?.card] ?? origin?.[key] ?? null,
    };
  });
}

// The epics as the list draws them: groups by Area (needs you, stuck, working inside each), the finished folded into one row, and `rows`, the selectable ones in order.
// filter: text that narrows by title, number (#22 or 22) or area; unfolded: the finished epics follow the fold row.
export function epicList(epics, { filter = "", unfolded = false } = {}) {
  const f = String(filter ?? "").trim().toLowerCase().replace(/^#/, "");
  const hit = (e) => !f || e.title.toLowerCase().includes(f) || String(e.num) === f || (e.area ?? "").toLowerCase().includes(f) || e.group.toLowerCase().includes(f);
  const shown = epics.filter(hit), live = shown.filter((e) => e.state !== "done"), finished = shown.filter((e) => e.state === "done");
  const by = new Map();
  for (const e of live) by.set(e.group, [...(by.get(e.group) ?? []), e]);
  const groups = [...by].map(([name, list]) => ({ name, epics: list.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (b.ageMs ?? 0) - (a.ageMs ?? 0) || a.num - b.num) }))
    .sort((a, b) => STATE_RANK[a.epics[0].state] - STATE_RANK[b.epics[0].state] || a.name.localeCompare(b.name));
  const fold = { kind: "fold", label: `${finished.length} finished`, count: finished.length, open: unfolded };
  const rows = [...groups.flatMap((g) => g.epics.map((e) => ({ kind: "epic", epic: e }))), ...(finished.length ? [fold, ...(unfolded ? finished.map((e) => ({ kind: "epic", epic: e })) : [])] : [])];
  return { groups, finished: { count: finished.length, epics: finished }, rows };
}

// b: the board where it is already open. Returns { steps, share, receipt }: select its space and tab and hand it the epic (the shared flag the board mod reads);
// with none open, nothing runs and the receipt says so. Never opens a board.
export const BOARD_MOD = "zaksha-board", BOARD_EPIC = "zaksha-board.epic";
export function boardStep({ spaces, panes, epic }) {
  if (!epic) return { steps: [], share: null, receipt: "no epic selected" };
  const board = (panes ?? []).find((p) => p.mod === BOARD_MOD), sp = board && (spaces ?? []).find((s) => (s.tabs ?? []).some((t) => t.id === board.tab));
  if (!board || !sp) return { steps: [], share: null, receipt: "no board open · ctrl-b b opens it" };
  return { steps: [["space.select", { id: sp.id }], ["tab.select", { id: board.tab }]], share: epic, receipt: "" };
}

// The list window (kuchbhi#1115, feedback 1): the selected row sits about a third of the way down while the entries move past it; at the top and the bottom the
// window stops and the selection moves instead. Returns the index of the first item shown.
export const listWindow = (n, sel, size) => Math.max(0, Math.min(Math.max(0, n - size), sel - Math.floor(size / 3)));

// ← / →: the previous or next part of the ask (question numbers); past the ends the epic's next or previous ask ({ step }).
export function partStep(ask, q, dir) {
  const qs = questionsOf(ask), i = qs.indexOf(q) + (dir === "right" ? 1 : -1);
  return i >= 0 && i < qs.length ? { q: qs[i] } : { step: dir };
}

// Links in text: URLs, owner/repo#N, #N (in the epic's repo) and absolute paths become { text, link: url | issue | path }; the rest is { text }.
const LINK_RE = /(https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?])|([\w.-]+\/[\w.-]+#\d+)|(#\d+)\b|((?:^|(?<=[\s(]))\/(?:[\w.@+~-]+\/)*[\w@+~-]+(?:\.[\w@+~-]+)*)/g;
export function linkSegments(text, repo) {
  const out = []; let at = 0;
  for (const m of String(text ?? "").matchAll(LINK_RE)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], link: m[1] ? "url" : m[4] ? "path" : "issue" }); at = m.index + m[0].length;
  }
  if (at < String(text ?? "").length) out.push({ text: text.slice(at) });
  return out;
}
export function linkTarget(seg, repo) {
  if (seg.link === "url" || seg.link === "path") return { open: seg.text };
  if (seg.link === "issue") { const m = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(seg.text); return m ? { open: `https://github.com/${m[1] ?? repo}/issues/${m[2]}` } : null; }
  return null;
}

// The Inbox pane takes the keyboard once when its tab becomes active (any route), unless the owner is already in its agent pane. Returns { focus: pane | null, was }.
export const focusStep = ({ inTab, was, focusedPane, own, bottom }) => ({ focus: inTab && !was && own && focusedPane !== own && !(bottom && focusedPane === bottom) ? own : null, was: !!inTab });

// The question box (the top area) is resizable: [ and ] step it, a drag of the divider follows the pointer, and the size is remembered (localStorage, `agents-view.askH`).
export const ASK_H = { def: 360, min: 120, max: 720, step: 40, key: "agents-view.askH" };
export const clampAskH = (h) => (Number.isFinite(Number(h)) && h !== null && h !== "" ? Math.max(ASK_H.min, Math.min(ASK_H.max, Math.round(Number(h)))) : ASK_H.def);
export const resizeAskH = (h, key) => (key === "]" ? clampAskH(h + ASK_H.step) : key === "[" ? clampAskH(h - ASK_H.step) : h);
export const dragAskH = (h0, y0, y) => clampAskH(h0 + (y - y0));
export const storedAskH = (raw) => clampAskH(raw);

// ---- owner round 2 (kuchbhi#1115): the receipt, the Sent list, the open line, the Inbox button's count
const mark = (on) => (on ? "✓" : "–"), two = (n) => String(n).padStart(2, "0");
export function sentReceipt(a) {
  const at = new Date(a.answeredAt);
  return {
    what: [...String(a.pick ?? "").split("\n").map((s) => s.trim()).filter(Boolean), ...(a.note ? [`note: ${a.note}`] : [])].join(" · "),
    to: [a.lead, a.epic ?? a.card].filter(Boolean).join(" · "),
    when: `${two(at.getHours())}:${two(at.getMinutes())}`,
    state: `sent ${mark(a.sent)} · received ${mark(a.received)} · done ${mark(a.done)}`,
  };
}

// Anything to look at before answering, as open lines in this order: the plan, a mockup, a preview, a stage URL, a manual check. Found in the ask's own plan field and in its text
// (old asks too): canvas/ or .html paths, /plans/, a `/work · Plan` comment URL, pages.dev, a stage host; a URL in a do-this-yourself ask is its check. Each target once.
const LOOK_ORDER = ["plan", "mockup", "preview", "stage", "check"];
const linkMemo = new Map(); // the same ask is scanned on every render; its text rarely changes
export function openLinks(ask) {
  const key = [ask.plan, ask.kind, ask.question, ask.body, ask.today, ask.after, ask.checked, ask.whyYou, ...(ask.parts ?? []).flatMap((p) => [p.today, p.after, p.checked])].join("\u0001");
  if (!linkMemo.has(key)) { if (linkMemo.size > 200) linkMemo.clear(); linkMemo.set(key, scanLinks(ask)); }
  return linkMemo.get(key);
}
function scanLinks(ask) {
  const text = [ask.question, ask.body, ask.today, ask.after, ask.checked, ask.whyYou, ...(ask.parts ?? []).flatMap((p) => [p.today, p.after, p.checked])].filter(Boolean).join("\n");
  const found = [];
  const add = (kind, target) => { if (target && !found.some((f) => f.target === target)) found.push({ kind, label: kind === "pr" ? "open PR" : `open ${kind}`, target }); };
  if (ask.plan) add(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(ask.plan) ? "pr" : "plan", ask.plan);
  for (const line of text.split("\n")) for (const raw of line.split(/\s+/)) {
    const t = raw.replace(/^[("'`<\[]+/, "").replace(/[)"'`>\],.;:]+$/, "");
    const url = /^https?:\/\/([^/]+)(\/[^?#]*)?/.exec(t);
    if (url) {
      const host = url[1].toLowerCase(), path = url[2] ?? "";
      if (/\/pull\/\d+/.test(path)) continue;
      if (/\/issues\/\d+#issuecomment-\d+/.test(t) && /plan/i.test(line)) add("plan", t);
      else if (/\/plans\//.test(path)) add("plan", t);
      else if (host.endsWith("pages.dev")) add("preview", t);
      else if (/(^|[.-])(stage|staging|stg)([.-]|$)/.test(host)) add("stage", t);
      else if (/\/canvas\//.test(path) || /\.html?$/.test(path)) add("mockup", t);
      else if (ask.kind === "you" && !/github\.com$/.test(host)) add("check", t);
    } else if (/^(file:\/\/)?\/\S+/.test(t)) {
      if (/\/plans\//.test(t)) add("plan", t);
      else if (/\/canvas\//.test(t) || /\.html?$/.test(t)) add("mockup", t);
    }
  }
  return found.sort((a, b) => (a.kind === "pr" ? -1 : LOOK_ORDER.indexOf(a.kind)) - (b.kind === "pr" ? -1 : LOOK_ORDER.indexOf(b.kind)));
}

// The Inbox button's number: the open asks, folded as the panel folds them (an answered ask is not open, a reply opens it again). Nothing waits: no number.
export function waitingCount(asksText, closedJson, nowMs) {
  const cc = parse(closedJson);
  return openAsks(parseJsonl(asksText), nowMs, Array.isArray(cc?.closed) ? cc.closed : []).length;
}
export const inboxLabel = (n) => (n > 0 ? `Inbox ${n}` : "Inbox");

// A part's row text: its number and title, then whether it is marked (the letter, or `note`) or open. An ask's state: reply, how many parts are marked, or open.
export const partLabel = (ask, q, picks = {}) => `${q} ${questionTitles(ask.body)[q] || `question ${q}`} · ${picks[q] ? `marked ${picks[q].split(":")[0].slice(String(q).length)}` : "open"}`;
export const askState = (ask, picks = {}) => {
  const qs = questionsOf(ask), n = qs.filter((q) => picks[q]).length;
  return ask.reply ? "reply" : qs.length > 1 && n ? `marked ${n} of ${qs.length}` : "open";
};

// ---- The leads side list (kuchbhi#1115, 16 Nov direction): one row per lead; the lead's own tab is where the owner answers ----
// The last line of a lead's screen that is its own words: not the prompt, the rules, the footer, "Worked for" or the recap.
export function lastScreenLine(screen) {
  const all = String(screen ?? "").split("\n"), prompt = all.findLastIndex((l) => /^❯/.test(l));
  const body = (prompt < 0 ? all : all.slice(0, prompt)).filter((l) => l.trim() && !/^\s*─{5,}/.test(l) && !/^\s*(✻|※|⏵)/.test(l));
  const l = body.at(-1);
  return l ? l.replace(/^\s*⏺\s*/, "").trim() : "";
}

const GROUPS = [["waiting", "Waiting on you"], ["stuck", "Stuck"], ["working", "Working"]];
const glyphless = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}#]+/u, "").trim();
// Rows by group, the rest folded. A lead is a terminal labelled role=lead or named lead-*: Herdr's own agent detection is not asked, because a resumed
// session shows as zsh with no status (#1127). The epic comes from the label, else from the number in the name.
export function leadRows({ terminals, asks, stuck, statuses, titles, waits, lastLines, nowMs }) {
  const ts = (terminals ?? []).map((raw) => ({ ...normalize(raw), title: raw.title ?? null })).filter((t) => t.live);
  const known = [...Object.keys(titles ?? {}), ...Object.keys(statuses ?? {}), ...(asks ?? []).map((a) => a.epic ?? a.card)].filter(Boolean);
  const epicOf = (t) => t.labels.epic ?? known.find((k) => /\d+$/.test(t.name ?? "") && k.endsWith(`#${/(\d+)$/.exec(t.name)[1]}`)) ?? null;
  const out = [];
  for (const t of ts.filter((x) => x.labels.role === "lead" || /^lead-/.test(x.name ?? ""))) {
    // a /lead claim labels its terminal with every epic it holds (`epics`, comma-separated): the row is the one with an open ask, else the first
    const held = String(t.labels.epics ?? "").split(",").map((s) => s.trim()).filter(Boolean), hasAsk = (e) => (asks ?? []).some((a) => (a.epic ?? a.card) === e);
    const epic = t.labels.epic ?? held.find(hasAsk) ?? held[0] ?? epicOf(t), mine = (asks ?? []).filter((a) => epic && [epic, ...held].includes(a.epic ?? a.card));
    const workers = ts.filter((x) => x.labels.role === "worker" && epic && [epic, ...held].includes(x.labels.epic)), own = new Set([t, ...workers].flatMap((x) => [x.address, x.name]));
    const stucks = (stuck ?? []).filter((s) => s.kind !== "blocked" && (own.has(s.address) || own.has(s.name)));
    const asked = mine.length > 0, quoted = (waits?.[t.address] ?? []).length > 0 && t.state !== "working";
    const group = t.state === "blocked" || asked || quoted ? "waiting" : stucks.length ? "stuck" : t.state === "working" ? "working" : "rest";
    const st = epic ? statuses?.[epic] : null, newest = mine.length ? Math.min(...mine.map((a) => a.ageMs)) : Infinity;
    const last = (st && nowMs - Date.parse(st.ts) < newest ? st.text : null) ?? mine[0]?.title ?? lastLines?.[t.address] ?? glyphless(t.title);
    const ageMs = mine.length ? Math.max(...mine.map((a) => a.ageMs)) : group === "stuck" ? stucks.find((s) => s.ageMs != null)?.ageMs ?? null : typeof t.statusMs === "number" ? nowMs - t.statusMs : null;
    out.push({
      key: `lead:${t.address}`, address: t.address, tab: t.labels["herdr.tab"] ?? null, space: t.labels["herdr.space"] ?? null, name: t.name ?? t.address, epic, group, ageMs, last: last ?? "", workers: workers.length,
      title: (epic && titles?.[epic]) || shortCard(epic ?? t.name), meta: [t.name ?? t.address, workers.length ? `${workers.length} worker${workers.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
    });
  }
  const groups = GROUPS.map(([id, label]) => ({ id, label, rows: out.filter((r) => r.group === id) })).filter((g) => g.rows.length);
  const rest = out.filter((r) => r.group === "rest"), nums = rest.map((r) => Number(String(r.epic ?? "").split("#").pop())).filter(Boolean).sort((a, b) => a - b);
  return { groups, fold: { count: rest.length, label: `${rest.length} idle or done${nums.length ? ` · Epics ${nums.join(", ")}` : ""}`, rows: rest }, rows: groups.flatMap((g) => g.rows) };
}
