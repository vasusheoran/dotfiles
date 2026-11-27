// The leads side list (kuchbhi#1115, 16 Nov direction): one row per lead, grouped Waiting on you / Stuck / Working, the rest folded. Selecting a lead switches the
// main area to that lead's own tab (agent.focus), where the owner reads and answers; this list never answers anything. The logic is in lib.js (leadRows).
// Reads asks.jsonl, closed-cards.json, stuck.json and each lead's last screen lines (hc read, at most every 30s per lead); no network.
// kuchbhi#1360: the same mod with props { badge: true } is the count of open asks in the tab bar (layouts/main-agents.json), always on screen;
// a click opens it again as a popup with props { asks: true }, where a click on an option answers through `work ask answer` (a merge, roll or money
// ask takes a second click, as the keyboard takes a second press) and a click on the title opens the lead's tab.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, shared, setShared, terminals, panes, spaces, theme, readTextFile, home, props, openOverlay, closeOverlay } from "herdr";
import { badgeText, inboxItems, clickStep, leadFor, viewModel, leadRows, leadStatuses, parseJsonl, waitingLines, lastScreenLine, boardStep, BOARD_EPIC, runFiles, ageText, listWindow, linkSegments, linkTarget, perform } from "./lib.js";

const LIST_FOCUS = "agents-view.focus", LIST_HAS_FOCUS = "agents-view.focused"; // the same names as tabs-agents/lib.js: a mod cannot import another
const MONO = "JetBrains Mono", SANS = "Geist";
const REFRESH_MS = 5000, SCREEN_MS = 30_000;
const LIST_ITEMS = 12; // rows shown at once (group heads count); the selected one sits a third of the way down
const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);

export default class LeadsList extends View {
  init(_props, cx) {
    this.mode = props()?.badge ? "badge" : props()?.asks ? "asks" : "leads";
    this.h = cx.focus_handle();
    if (this.mode !== "badge") this.h.focus();
    this.files = { asks: null, events: null, closed: null, stuck: null }; this.asks = []; this.sent = new Set(); this.armed = null; this.flashAt = 0;
    this.sel = null; this.selIdx = 0; this.unfolded = false; this.flash = ""; this.memo = null;
    this.waits = {}; this.lastLines = {}; this.screenAt = {};
    if (this.mode === "leads") cx.timer.every(250, () => this.watchFocus()); // only the panel's list answers to cmd-shift-a
    this.read(cx);
    cx.timer.every(REFRESH_MS, (c) => this.read(c));
  }

  // cmd-shift-a (tabs-agents.toggle) asks for the keyboard through a shared flag; this publishes whether the list holds it, so the toggle knows to hide it next
  watchFocus() {
    const on = this.h.is_focused(), asked = shared(LIST_FOCUS);
    // the request is a timestamp: while the panel was hidden this instance could not take the keyboard, so it keeps asking until it holds it, for 2s at most
    if (asked) { if (on || Date.now() - asked > 2000) setShared(LIST_FOCUS, null); else this.h.focus(); }
    if (shared(LIST_HAS_FOCUS) !== on) setShared(LIST_HAS_FOCUS, on);
  }

  async read(cx) {
    const read1 = (p) => readTextFile(p).catch(() => null), f = runFiles(home(), false);
    if (this.mode !== "leads") {
      // the count and the popup need the asks and the closed cards only, parsed here every 5s, never in render
      const [asks, closed] = await Promise.all([f.asks, f.closed].map(read1));
      this.files = { asks: asks ?? "", events: null, closed, stuck: null };
      this.asks = viewModel({ terminals: terminals(), asksText: asks, closedJson: closed, nowMs: Date.now() }).asks;
      if (this.flash && Date.now() - this.flashAt > 2 * REFRESH_MS) this.flash = "";
      return cx.notify();
    }
    const [asks, events, closed, stuck] = await Promise.all([f.asks, f.events, f.closed, f.stuck].map(read1));
    this.files = { asks, events, closed, stuck };
    cx.notify();
    this.readScreens(cx);
  }

  // each lead's last 15 screen lines, at most every 30s per lead: its last line, and whether it ends with a question for the owner. The regexes run here, never in render:
  // the engine interrupts a slow render
  async readScreens(cx) {
    const now = Date.now(), due = this.model().all.filter((r) => now - (this.screenAt[r.address] ?? 0) >= SCREEN_MS);
    if (!due.length) return;
    for (const r of due) this.screenAt[r.address] = now;
    const got = await Promise.all(due.map((r) => exec("hc", ["read", r.address, "--lines", "15"]).then((x) => (x?.code === 0 ? String(x.stdout ?? "") : ""), () => "")));
    due.forEach((r, i) => { this.waits[r.address] = waitingLines(got[i]); this.lastLines[r.address] = lastScreenLine(got[i]); });
    cx.notify();
  }

  // the rows are rebuilt only when an input changed (or every 30s for the ages): the run file is big and the engine interrupts a slow render
  model() {
    const f = this.files, key = [f.asks, f.events, f.closed, f.stuck, JSON.stringify(terminals()), JSON.stringify(this.waits), JSON.stringify(this.lastLines), Math.floor(Date.now() / 30_000)];
    if (!this.memo || key.some((k, i) => k !== this.memo.key[i])) {
      const vm = viewModel({ terminals: terminals(), asksText: f.asks, eventsText: f.events, closedJson: f.closed, stuckJson: f.stuck, nowMs: Date.now() });
      const list = leadRows({ terminals: terminals(), asks: vm.asks, stuck: vm.stuck, statuses: leadStatuses(parseJsonl(f.asks)), titles: vm.titles, waits: this.waits, lastLines: this.lastLines, nowMs: Date.now() });
      this.memo = { key, list, vm };
    }
    const { list } = this.memo, rows = this.unfolded ? [...list.rows, ...list.fold.rows] : list.rows;
    return { list, rows, all: [...list.rows, ...list.fold.rows] };
  }

  select(i, rows, cx) {
    this.selIdx = Math.max(0, Math.min(rows.length - 1, i)); const r = rows[this.selIdx];
    if (!r) return;
    this.sel = r.key; this.flash = "";
    // the main area switches to the lead's own tab. tab.select leaves the keyboard on the list (agent.focus takes it), so the next arrow key still lands here;
    // only ↵ moves it into the tab (it has to be taken back: see below). A lead without its tab's id (no herdr.tab label) falls back to agent.focus.
    if (!r.tab) return run("agent.focus", { terminal: r.address });
    if (r.space && r.space !== spaces().find((s) => s.active)?.id) run("space.select", { id: r.space });
    run("tab.select", { id: r.tab });
    cx.timer.after(0, () => this.h.focus()); // checked live: tab.select also hands the keyboard to the new tab's pane, so the list takes it back
  }

  key(e, cx) {
    const k = e.keystroke, { rows } = this.model(), cur = rows[this.selIdx];
    if (k === "down" || k === "j") this.select(this.selIdx + 1, rows, cx);
    else if (k === "up" || k === "k") this.select(this.selIdx - 1, rows, cx);
    else if (k === "enter" && cur) { const p = panes().find((x) => x.terminal === cur.address); if (p) run("pane.focus", { pane: p.pane }); } // the keyboard goes into the lead's tab
    else if (k === "B" && cur?.epic) this.board(cur);
    else if (k === "space") this.unfolded = !this.unfolded;
    cx.notify();
  }

  // B: the board where it is already open, at this lead's epic; none open says so. Never opens a board.
  board(cur) {
    const r = boardStep({ spaces: spaces(), panes: panes(), epic: cur.epic });
    if (r.share) setShared(BOARD_EPIC, r.share);
    for (const st of r.steps) run(...st);
    this.flash = r.receipt || `board: showing ${cur.title}`;
  }

  // the last line, with its links (URLs, #N, paths) clickable
  line(t, text, repo, key) {
    const segs = linkSegments(text, repo);
    if (!segs.some((x) => x.link)) return sans(12, t.muted, text).w_full().min_w(0).max_h(34).overflow_hidden();
    return h_flex().w_full().flex_wrap().items_baseline().max_h(34).overflow_hidden().children(segs.map((x, i) => (x.link
      ? div().id(`${key}:l${i}`).font_family(SANS).text_size(12).text_color(t.accent).underline().cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); const g = linkTarget(x, repo); if (g) perform({ type: "open", target: g.open }, { run, exec, pane: null }); }).child(x.text)
      : div().font_family(SANS).text_size(12).text_color(t.muted).child(x.text))));
  }

  row(t, r, rows) {
    const sel = r.key === this.sel, dot = { waiting: t.accent, stuck: t.blocked, working: t.working }[r.group] ?? t.dim, repo = String(r.epic ?? "").split("#")[0];
    return v_flex().id(r.key).w_full().flex_none().px(14).py(6).gap(2).rounded(6).when(sel, (x) => x.bg(t.selected).border_l_2().border_color(t.accent))
      .on_click((_e, cx) => { this.select(rows.indexOf(r), rows, cx); cx.notify(); })
      .child(h_flex().w_full().gap(8).items_center().child(div().size(7).flex_none().rounded(4).bg(dot)).child(sans(13, t.foreground, r.title).font_semibold().flex_1().min_w(0).truncate())
        .when(r.ageMs != null, (x) => x.child(mono(11, t.muted, ageText(r.ageMs)).flex_none())))
      .child(v_flex().w_full().pl(15).gap(1).child(this.line(t, r.last, repo, r.key)).child(mono(11, t.dim, r.meta).w_full().truncate()));
  }

  // the tab-bar count: nothing when no ask is open
  badge(t) {
    const text = badgeText(this.asks);
    return h_flex().size_full().px(8).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .when(!!text, (e) => e.child(h_flex().id("asks-badge").h(26).px(10).gap(6).items_center().rounded(6).bg(t.accent).text_color(t.background).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => openOverlay({ mod: "agents-view", kind: "popup", width: 560, height: 0.7, props: { asks: true } }))
        .child(sans(12, t.background, text).font_semibold())));
  }

  // a click on an option answers (or arms a merge, roll or money ask); the ask leaves the list at once and comes back if `work` refuses the answer
  answer(item, b, cx) {
    const ask = this.asks.find((a) => a.id === item.id), step = ask && clickStep(ask, b, this.armed, Date.now());
    this.flashAt = Date.now();
    if (step?.type === "arm") { this.armed = step.armed; this.flash = `click again to confirm: ${b.label}`; return cx.notify(); }
    this.armed = null;
    if (step?.type !== "post") return;
    this.sent.add(item.id); this.flash = `sent: ${item.title}`;
    exec("work", step.argv).then((r) => { if (r?.code !== 0) { this.sent.delete(item.id); this.flash = `not sent: ${String(r?.stderr ?? "").trim().split("\n").pop() || "work ask answer failed"}`; } cx.notify(); },
      () => { this.sent.delete(item.id); this.flash = "not sent: work ask answer failed"; cx.notify(); });
    cx.notify();
  }

  // the title opens the lead's tab for the ask (never a card's): the same steps as selecting a lead in the list
  openLead(item) {
    const ask = this.asks.find((a) => a.id === item.id), l = ask && leadFor(ask, terminals());
    if (!l) { this.flash = "no lead holds this ask"; this.flashAt = Date.now(); return; }
    if (!l.tab) run("agent.focus", { terminal: l.address });
    else { if (l.space && l.space !== spaces().find((s) => s.active)?.id) run("space.select", { id: l.space }); run("tab.select", { id: l.tab }); }
    closeOverlay(props()?.overlay);
  }

  popup(t) {
    const items = inboxItems(this.asks.filter((a) => !this.sent.has(a.id)), terminals());
    const armed = (item, b) => this.armed?.id === item.id && this.armed.key === b.key && this.armed.q === b.q;
    const button = (item, b, i) => div().id(`${item.id}:b${i}`).px(10).py(5).rounded(6).border_1().border_color(b.recommended ? t.accent : t.border).bg(b.recommended ? t.accent : t.raised)
      .text_color(b.recommended ? t.background : t.foreground).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); this.answer(item, b, cx); }).child(armed(item, b) ? `Confirm: ${b.label}` : b.label);
    const row = (item) => v_flex().id(item.id).w_full().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border)
      .child(div().id(`${item.id}:title`).w_full().cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.openLead(item); cx.notify(); }).child(sans(13, t.foreground, item.title).font_semibold().underline()))
      .child(h_flex().gap(8).child(mono(11, t.dim, [item.epic, item.kind].filter(Boolean).join(" · "))).when(item.notFromLead, (e) => e.child(mono(11, t.blocked, "not from the lead"))))
      .child(item.buttons.length ? h_flex().w_full().flex_wrap().gap(6).children(item.buttons.map((b, i) => button(item, b, i))) : sans(12, t.muted, "Answer this one in the lead's tab: click the title."));
    return v_flex().id("asks").size_full().min_h(0).bg(t.background).text_color(t.foreground).track_focus(this.h)
      .on_key_down((e) => { if (e.keystroke === "escape") closeOverlay(props()?.overlay); })
      .child(sans(13, t.foreground, this.files.asks == null ? "Reading…" : items.length ? badgeText(items.map((x) => x.id)) : "Nothing waiting on you").font_semibold().w_full().flex_none().px(14).py(10).border_b(1).border_color(t.border))
      .child(v_flex().id("asks-body").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(items.map(row)))
      .when(!!this.flash, (e) => e.child(sans(12, t.working, this.flash).w_full().flex_none().px(14).py(4)));
  }

  render(cx) {
    if (this.mode === "badge") return this.badge(theme());
    if (this.mode === "asks") return this.popup(theme());
    const t = theme(), { list, rows } = this.model();
    if (this.selIdx >= rows.length) this.selIdx = Math.max(0, rows.length - 1);
    if (!this.sel && rows[0]) this.sel = rows[0].key; // nothing is focused until the owner moves
    const items = [
      ...list.groups.flatMap((g) => [{ key: `head:${g.id}`, make: () => sans(11, t.dim, g.label).w_full().flex_none().px(14).pt(10).pb(2) }, ...g.rows.map((r) => ({ key: r.key, make: () => this.row(t, r, rows) }))]),
      ...(list.fold.count ? [{ key: "fold", make: () => h_flex().id("fold").w_full().flex_none().px(14).py(8).on_click((_e, c) => { this.unfolded = !this.unfolded; c.notify(); }).child(sans(12, t.dim, `${this.unfolded ? "▾" : "▸"} ${list.fold.label}`)) }, ...(this.unfolded ? list.fold.rows.map((r) => ({ key: r.key, make: () => this.row(t, r, rows) })) : [])] : []),
    ];
    const at = Math.max(0, items.findIndex((x) => x.key === this.sel)), start = listWindow(items.length, at, LIST_ITEMS);
    const waiting = list.groups.find((g) => g.id === "waiting")?.rows.length ?? 0, working = list.groups.find((g) => g.id === "working")?.rows.length ?? 0;
    return v_flex().id("leads").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus()).on_key_down((e, c) => this.key(e, c))
      .child(v_flex().w_full().flex_none().px(14).py(10).gap(2).border_b(1).border_color(t.border).child(sans(13, t.foreground, "Leads").font_semibold())
        .child(sans(12, t.muted, [waiting ? `${waiting} waiting on you` : "", working ? `${working} working` : ""].filter(Boolean).join(" · ") || "nothing waiting")))
      .child(v_flex().id("leads-body").w_full().flex_1().min_h(0).overflow_y_scrollbar().children(items.slice(start, start + LIST_ITEMS).map((x) => x.make())))
      .when(!!this.flash, (e) => e.child(sans(12, t.working, this.flash).w_full().flex_none().px(14).py(4)))
      .child(div().w_full().flex_none().px(14).py(4).border_t(1).border_color(t.border).child(sans(11, t.dim, "↑ ↓ lead · ↵ type in its tab · cmd-shift-a back here · B board · space shows the idle")));
  }
}
