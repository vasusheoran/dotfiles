// Zaksha board: a GitHub Projects v2 board in its own "Board" space, with the live agents on each issue.
// The logic is in lib.js (tested with node --test); this file only reads, polls and draws.
// Opened from keys.json as mod.open:zaksha-board (cmd-shift-b, ctrl-b b): that opens this mod as a 1px popup
// which toggles between the Board space and where you were (lib toggleBoard), then closes itself.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Popup } from "gpui-base";
import { exec, hc, run, props, panes, spaces, focused, terminals, theme, readTextFile, appHome, home, notify, openOverlay, closeOverlay, shared, setShared, nextCommand } from "herdr";
import {
  parseConfig, fetchAll, cardAgents, excerpt, single, defaultUi, todayView, epicsView, drillView, statusView, searchView, focusView,
  needsCount, flatten, rowButtons, primaryAction, startPlan, repoFolder, keyAction, escapeStep, renameStep, boardSpace, toggleBoard, ensureBoard,
  shouldRefreshOnShow, syncLabel, ageText, liveSummary, moveSel, resolveSel, afterPeek, scrollTop, clampTop, facets, PRIORITIES,
} from "./lib.js";

const MOD = "zaksha-board";
const MONO = "JetBrains Mono";
const SANS = "Geist";
const ASK_MS = 5000; // how often blocked agents' screens are read for their question line
const FROM_KEY = "zaksha-board.from"; // where cmd-shift-b came from: shared, since the opener is another copy
const NARROW = 1000;
const H = { lane: 30, group: 24, row: 28, two: 46, more: 24, empty: 30, ehead: 26, epic: 40 };
const VIEWS = [["today", "Today", "what needs you, all issues"], ["epics", "Epics", "how each epic is doing"], ["status", "Status", "issues by GitHub status"]];

const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);
const stop = (fn) => (e, cx) => { cx.stop_propagation(); fn(e, cx); };

// ---- the opener: one keypress, one toggle ----

function openerTick(cx, st, n) {
  const all = spaces();
  const board = boardSpace(all);
  if (board && !st.shellTabs) { st.shellTabs = board.tabs.map((t) => t.id); run("space.select", { id: board.id }); }
  const steps = board ? ensureBoard({ spaces: all, panes: panes(), mod: MOD, shellTabs: st.shellTabs }) : [];
  const todo = steps.filter((s) => s[0] !== "tab.select" && !st.sent.has(JSON.stringify(s)));
  for (const s of todo) { st.sent.add(JSON.stringify(s)); run(...s); }
  const settled = board && steps.every((s) => s[0] === "tab.select" || st.sent.has(JSON.stringify(s))) && !steps.some((s) => s[0] === "tab.new");
  if (settled || n >= 30) { focusBoardPane(); closeOverlay(props().overlay); return; }
  cx.timer.after(120, (cx) => openerTick(cx, st, n + 1));
}

function focusBoardPane() {
  const board = boardSpace(spaces());
  const pane = board && panes().find((p) => p.mod === MOD && board.tabs.some((t) => t.id === p.tab));
  if (pane) run("pane.focus", { pane: pane.pane });
}

function toggle() {
  const r = toggleBoard({ spaces: spaces(), panes: panes(), focused: focused(), from: shared(FROM_KEY) ?? null, mod: MOD });
  if (JSON.stringify(r.from) !== JSON.stringify(shared(FROM_KEY) ?? null)) setShared(FROM_KEY, r.from);
  for (const s of r.steps) run(...s);
  return r.steps;
}

export default class Board extends View {
  init(_props, cx) {
    if (props()?.overlay) {
      this.opener = true;
      const steps = toggle();
      if (steps.some((s) => s[0] === "space.new")) { openerTick(cx, { sent: new Set(), shellTabs: null }, 0); return; }
      if (steps.some((s) => s[0] === "space.select" && s[1].id === boardSpace(spaces())?.id)) focusBoardPane();
      closeOverlay(props().overlay);
      return;
    }
    this.h = cx.focus_handle();
    this.cfg = null;
    this.state = "loading"; // loading | missing | error | ready
    this.problem = null;
    this.truncated = null;
    this.items = [];
    this.read = null;
    this.fetching = false;
    this.fetch = single((cx) => this.load(cx));
    this.asks = {}; // terminal address -> excerpt lines
    this.asking = false;
    this.ui = defaultUi(); // per session, not across restarts
    this.prevView = "today";
    this.sel = null; this.selIdx = 0; this.top = 0; this.follow = true; this.wheel = 0;
    this.hover = null; this.dd = null; this.width = 1400; this.listH = 600;
    this.shown = false; this.renamed = null;
    this.typing = false;
    this.input = InputState.new({ placeholder: "Search all items — title, #number, area, repo" });
    this.input.on("change", (_e, cx) => { this.setUi({ query: this.input.value().trim() }); this.sel = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.act("primary", cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.asked = null; this.pending = new Set(); // /work starts: the issue asked about, and those starting
    this.refresh(cx);
    cx.timer.every(ASK_MS, (cx) => this.readAsks(cx));
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "focus") { this.h.focus(); cx.notify(); } else if (c === "start") this.startWork(cx); } });
  }

  refresh(cx) {
    const p = this.fetch(cx);
    if (!p) return; // one fetch in flight at a time
    this.fetching = true;
    cx.notify();
    p.catch((e) => { this.problem = String(e?.message ?? e); }).finally(() => { this.fetching = false; cx.notify(); });
  }

  async load(cx) {
    const parsed = parseConfig(await readTextFile(`${appHome()}/mods/${MOD}/board.json`));
    if (parsed.missing || parsed.error) {
      this.state = parsed.missing ? "missing" : "error";
      this.problem = parsed.error ?? null;
      this.schedule(cx, 60);
      return;
    }
    this.cfg = parsed.cfg;
    const r = await fetchAll((args) => exec("gh", args), this.cfg);
    this.problem = r.error;
    this.truncated = r.truncated;
    if (!r.error) { this.items = r.items; this.read = Date.now(); }
    this.state = r.error && !this.items.length ? "error" : "ready";
    this.schedule(cx, this.cfg.pollSeconds);
  }

  // the next poll; one timer, replaced when pollSeconds changes
  schedule(cx, seconds) {
    if (this.timerSeconds === seconds) return;
    this.timerSeconds = seconds;
    this.timer?.cancel();
    this.timer = cx.timer.every(seconds * 1000, (cx) => this.refresh(cx));
  }

  // what blocked agents on issues show (hc read): their question line
  readAsks(cx) {
    if (this.asking) return;
    const blocked = [...cardAgents(terminals()).values()].flat().filter((a) => a.status === "blocked");
    if (!blocked.length) return;
    this.asking = true;
    cx.spawn(async (cx) => {
      let changed = false;
      for (const t of blocked) {
        let lines = [];
        try { const r = await hc(["read", t.address, "--lines", "40"]); if (r.code === 0) lines = excerpt(r.stdout, 3); } catch { /* no screen */ }
        if (JSON.stringify(lines) !== JSON.stringify(this.asks[t.address] ?? [])) { this.asks[t.address] = lines; changed = true; }
      }
      this.asking = false;
      if (changed) cx.notify();
    });
  }

  setUi(change) { this.ui = { ...this.ui, ...change }; }

  setView(view) {
    if (this.ui.view !== view) this.prevView = this.ui.view;
    this.setUi({ view, epic: null, query: "", showLow: {} });
    this.input.set_value("");
    this.sel = null; this.top = 0; this.follow = true;
  }

  openEpic(key) { this.setUi({ view: "epic", epic: key, query: "", doneOpen: false }); this.input.set_value(""); this.sel = null; this.top = 0; }

  leave() { toggle(); }

  // what the main area shows now: {kind: "list" | "epics" | "status", ...}
  model() {
    const ui = this.ui, t = terminals();
    if (ui.query) { const v = searchView(this.items, t, ui.query); return { kind: "list", flat: flatten({ lanes: v.groups }), search: v }; }
    if (ui.focus) return { kind: "list", flat: flatten(focusView(this.items, t)) };
    if (ui.view === "epic") {
      const v = drillView(this.items, t, ui.epic, ui);
      if (v) return { kind: "list", flat: flatten(v), drill: v };
      this.setUi({ view: "epics", epic: null });
    }
    if (ui.view === "epics") {
      const v = epicsView(this.items, t, Date.now());
      return { kind: "list", flat: [{ kind: "ehead", key: "ehead" }, ...v.rows.map((r) => ({ kind: "epic", key: r.key, row: r }))] };
    }
    if (ui.view === "status") return { kind: "status", status: statusView(this.items, t, ui) };
    return { kind: "list", flat: flatten(todayView(this.items, t, ui)) };
  }

  rowsOf(m) {
    if (m.kind === "status") return m.status.columns.flatMap((c) => c.rows.map((r) => ({ key: r.key, row: r })));
    return m.flat.filter((x) => x.kind === "row" || x.kind === "epic");
  }

  selected() { return this.rows.find((r) => r.key === this.sel) ?? null; }

  act(kind, cx) {
    const r = this.selected();
    if (!r) return;
    const row = r.row;
    if (row.epic && kind === "primary") { this.openEpic(row.key); cx.notify(); return; }
    let a = null;
    if (kind === "primary") {
      a = primaryAction(row, { focus: this.ui.focus });
      if (a?.run?.[0] === "terminal.peek") { this.sel = afterPeek(this.rows.map((x) => x.key), row.key); this.follow = true; }
    } else a = rowButtons(row).find((b) => b.label.toLowerCase() === kind);
    if (kind === "agent" && !a?.run) this.askStart(row);
    else this.press(a);
    cx.notify();
  }

  // `a` with no live agent: focus a card terminal that exists, else confirm, then startWork()
  askStart(row) {
    const p = startPlan(row, terminals(), null, this.cfg, home(), { pending: this.pending });
    if (p.action === "focus") run("agent.focus", { terminal: p.terminal });
    else if (p.action === "confirm") {
      this.asked = row;
      openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 170, props: { title: p.title, detail: p.detail, command: { name: `${MOD}.start` } } });
    }
  }

  async startWork(cx) {
    const row = this.asked;
    this.asked = null;
    if (!row || this.pending.has(row.key)) return;
    this.pending.add(row.key);
    try {
      const folder = repoFolder(row.repo, this.cfg, home());
      const ok = (await exec("test", ["-d", folder]).catch(() => ({ code: 1 }))).code === 0;
      const areas = await readTextFile(`${home()}/handoffs/areas.txt`).catch(() => null);
      const p = startPlan(row, terminals(), areas, this.cfg, home(), { confirmed: true, pending: this.pending, exists: () => ok });
      if (p.action === "start") { run(...p.step); cx.timer.after(30000, () => this.pending.delete(row.key)); return; }
      if (p.action === "error") notify({ title: "Can't start /work", body: p.message, level: "error" });
      else if (p.action === "focus") run("agent.focus", { terminal: p.terminal });
    } catch (e) { notify({ title: "Can't start /work", body: String(e?.message ?? e), level: "error" }); }
    this.pending.delete(row.key);
  }

  press(a) {
    if (a?.run) run(...a.run);
    else if (a?.exec) exec(...a.exec).catch(() => {});
  }

  key(e, cx) {
    if (this.typing) {
      if (e.keystroke === "escape") {
        if (this.ui.query) { this.input.set_value(""); this.setUi({ query: "" }); } else this.h.focus();
      } else if (e.keystroke === "down" || e.keystroke === "up") this.move(e.keystroke === "down" ? 1 : -1);
      else return;
      cx.stop_propagation(); cx.notify();
      return;
    }
    const a = keyAction(e.keystroke);
    if (!a) return;
    cx.stop_propagation();
    const ui = this.ui;
    const filters = (ui.view === "today" || ui.view === "status") && !ui.query && !ui.focus;
    if (a === "search") this.input.focus();
    else if (a === "escape") {
      if (this.dd) this.dd = null;
      else { const s = escapeStep(ui); if (s.leave) return this.leave(); this.ui = s.ui; this.sel = null; if (!s.ui.query) this.input.set_value(""); }
    } else if (a === "down" || a === "up" || a === "down5" || a === "up5") this.move({ down: 1, up: -1, down5: 5, up5: -5 }[a]);
    else if (a === "primary" || a === "agent" || a === "issue" || a === "pr") return this.act(a, cx);
    else if (a === "today" || a === "epics" || a === "status") { this.setUi({ focus: false }); this.setView(a); }
    else if (a === "back") { if (ui.query) { this.setUi({ query: "" }); this.input.set_value(""); } else if (ui.view === "epic") this.setView("epics"); }
    else if (a.startsWith("prio:") && filters) this.togglePrio(a.slice(5));
    else if (a === "allprio" && filters) this.setUi({ priorities: [...PRIORITIES, ""], showLow: {} });
    else if (a === "group") this.setUi({ group: !ui.group });
    else if (a === "live") this.setUi({ live: !ui.live });
    else if (a === "refresh") this.refresh(cx);
    else if (a === "focus") { this.setUi({ focus: !ui.focus, query: "" }); this.sel = null; }
    else if (a === "needs") { if (ui.query || ui.view !== "today") { this.setUi({ focus: false }); this.setView("today"); } this.sel = null; }
    this.follow = true;
    cx.notify();
  }

  togglePrio(p) {
    const on = this.ui.priorities.includes(p);
    this.setUi({ priorities: on ? this.ui.priorities.filter((x) => x !== p) : [...this.ui.priorities, p], showLow: {} });
  }

  move(d) { this.sel = moveSel(this.rows.map((r) => r.key), this.sel, d); this.follow = true; }

  // the board became visible: refresh (at most once a minute); keep the space's name carrying the count
  housekeeping(cx) {
    const board = boardSpace(spaces());
    const shown = !!board && focused()?.space === board.id;
    if (shouldRefreshOnShow(this.shown, shown, this.read, Date.now())) cx.timer.after(0, (cx) => this.refresh(cx));
    this.shown = shown;
    if (this.state !== "ready") return;
    const step = renameStep(board, needsCount(this.items, terminals()));
    if (step && this.renamed !== step[1].name) { this.renamed = step[1].name; cx.timer.after(0, () => run(...step)); }
  }

  // ---- drawing ----

  prioChip(t, p, struck) {
    const fill = { P0: t.ansi1, P1: t.ansi3 }[p];
    const known = PRIORITIES.includes(p);
    return div().w(26).flex_none().py(2).rounded(4).flex().justify_center().font_family(MONO).text_size(10).font_weight(700)
      .when(!!fill, (el) => el.bg(fill).text_color(t.background))
      .when(p === "P2", (el) => el.border(1).border_color(t.ansi3).text_color(t.ansi3))
      .when(p === "P3" || p === "P4", (el) => el.bg(t.raised).text_color(t.muted))
      .when(!known, (el) => el.border(1).border_color(t.border).text_color(t.dim))
      .when(struck, (el) => el.line_through().opacity(0.6))
      .child(known ? p : "P–");
  }

  statusChip(t, status) {
    const tone = { Blocked: t.ansi1, "Needs answer": t.blocked, Inbox: t.ansi5, "In progress": t.working, Done: t.done }[status];
    return div().w(82).flex_none().px(4).py(1).rounded(4).flex().justify_center().truncate().font_family(SANS).text_size(10)
      .when(!!tone, (el) => el.border(1).border_color(tone).text_color(tone))
      .when(!tone, (el) => el.bg(t.raised).text_color(t.muted))
      .child(status ?? "No status");
  }

  agentDots(t, row) {
    if (!row.agents.length) return [];
    const dot = (a) => {
      if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
      const glyph = { blocked: "?", done: "✓" }[a.status] ?? "";
      return div().w(12).h(12).rounded_full().flex().items_center().justify_center().bg(t[a.status] ?? t.idle)
        .font_family(MONO).text_size(9).font_weight(700).text_color(t.background).child(glyph);
    };
    return [h_flex().gap(2).items_center().children(row.agents.map(dot))
      .child(mono(10, t.muted, row.agents.map((a) => a.address).join(",")))];
  }

  bar(t, completed, total, w) {
    const pct = total ? Math.round((100 * completed) / total) : 0;
    return div().w(w).h(6).flex_none().rounded(3).bg(t.raised).overflow_hidden()
      .child(div().h_full().rounded(3).bg(pct < 30 ? t.working : t.done).w(`${pct}%`));
  }

  tag(t, text) {
    return div().flex_none().px(5).rounded(4).border(1).border_color(t.border).bg(t.chrome).font_family(SANS).text_size(10).text_color(t.muted).child(text);
  }

  buttons(t, row) {
    return h_flex().flex_none().gap(2).px(2).py(1).rounded(6).bg(t.popover).border(1).border_color(t.border)
      .children(rowButtons(row).map((b) => {
        const starts = b.key === "a" && !b.run && !row.epic && !!row.repo && !!row.number;
        const on = !!(b.run || b.exec) || starts;
        return h_flex().id(`act-${row.key}-${b.key}`).gap(3).px(6).py(1).rounded(4).items_center()
          .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(stop(() => (starts ? this.askStart(row) : this.press(b)))))
          .child(sans(11, on ? t.accent : t.dim, b.label)).child(mono(9, t.dim, b.key));
      }));
  }

  row(t, row, opts = {}) {
    const narrow = this.width < NARROW;
    const sel = row.key === this.sel;
    const ask = row.asking ? (this.asks[row.asking] ?? []).at(-1) ?? "reading screen…" : null;
    const pr = [...(row.prs ?? [])].sort((a, b) => (b.state === "OPEN") - (a.state === "OPEN") || b.number - a.number)[0];
    const isPr = row.type === "PullRequest";
    const struck = this.ui.view === "epic" && !this.ui.query && !this.ui.priorities.includes(row.priority ?? "");
    const crumb = row.parent && !narrow && !this.ui.group && this.ui.view !== "epic";
    const first = h_flex().w_full().h(H.row - 2).gap(8).items_center()
      .child(this.prioChip(t, row.priority, struck))
      .child(mono(11, isPr ? t.ansi5 : t.muted, row.number ? `${isPr ? "⇅" : "#"}${row.number}` : "draft").w(46).flex_none())
      .child(sans(13, row.notOnBoard ? t.dim : t.foreground, row.title).flex_1().min_w(0).truncate())
      .child((row.notOnBoard ? mono(10, t.dim, "not on board").w(82).flex_none() : this.statusChip(t, row.status)))
      .when(crumb, (el) => el.child(sans(11, t.dim, `↳ ${row.parent.title}`).w(170).flex_none().truncate()))
      .when(!narrow, (el) => el.child(h_flex().w(118).flex_none().gap(3).justify_end()
        .when(!!row.area, (el) => el.child(this.tag(t, row.area)))
        .when(!!row.repo && row.repo !== this.mainRepo, (el) => el.child(this.tag(t, row.repo.split("/")[1])))))
      .child(h_flex().w(110).flex_none().gap(6).justify_end().items_center()
        .when(!!pr, (el) => el.child(mono(10, pr.state === "MERGED" ? t.done : pr.state === "OPEN" ? t.ansi5 : t.dim, `⇅ #${pr.number}`)))
        .children(this.agentDots(t, row))
        .when(row.noAgent, (el) => el.child(sans(10, t.dim, "no agent").italic())))
      .child(mono(10, t.dim, ageText(Date.now(), row.updatedAt)).w(30).flex_none().flex().justify_end())
      .when(sel || this.hover === row.key, (el) => el.child(this.buttons(t, row)));
    return v_flex().id(`row-${row.key}`).w_full().h(ask ? H.two : H.row).flex_none().px(14).pt(1).border_l_2()
      .border_color(sel ? t.accent : t.background).when(sel, (el) => el.bg(t.selected)).when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .when(row.notOnBoard || opts.dim, (el) => el.opacity(0.6))
      .on_hover((h, cx) => { const k = h ? row.key : this.hover === row.key ? null : this.hover; if (k !== this.hover) { this.hover = k; cx.notify(); } })
      .on_click((e, cx) => { this.sel = row.key; if (e.click_count > 1) this.act("primary", cx); else cx.notify(); })
      .child(first)
      .when(!!ask, (el) => el.child(h_flex().w_full().gap(6).pl(88).items_center()
        .child(mono(10, t.muted, `${row.asking} asks`)).child(sans(11, t.blocked, ask).flex_1().min_w(0).truncate())));
  }

  laneHeader(t, l) {
    const tone = { needs: t.blocked, running: t.working, done: t.done, epics: t.muted, open: t.working, closed: t.done }[l.key] ?? t.muted;
    const count = l.total !== undefined && l.rows.length < l.total && !l.collapsed ? `${l.rows.length} of ${l.total}` : String(l.total ?? l.rows.length);
    return h_flex().id(`lane-${l.key}`).w_full().h(H.lane).flex_none().px(14).pt(6).gap(8).items_center().border_b(1).border_color(t.border)
      .child(sans(11, tone, l.label.toUpperCase()).font_semibold())
      .child(sans(11, t.dim, count))
      .when(l.collapsed !== undefined, (el) => el.child(div().flex_1()).child(div().id(`tog-${l.key}`).cursor_pointer()
        .on_click(stop((_e, cx) => { this.setUi({ doneOpen: !this.ui.doneOpen }); cx.notify(); }))
        .child(sans(11, t.accent, l.collapsed ? `show ${l.total}` : "hide"))));
  }

  item(t, x) {
    if (x.kind === "lane") return this.laneHeader(t, x.lane);
    if (x.kind === "group") {
      const e = x.group.epic;
      return h_flex().w_full().h(H.group).flex_none().pl(22).pr(14).gap(8).items_center()
        .child(sans(11, t.muted, e ? e.title : "No epic").font_semibold().truncate())
        .when(!!e && e.total != null, (el) => el.child(this.bar(t, e.completed, e.total, 60)).child(mono(10, t.dim, `${e.completed}/${e.total}`)));
    }
    if (x.kind === "more") return div().id(x.key).w_full().h(H.more).flex_none().pl(48).flex().items_center().cursor_pointer()
      .on_click(stop((_e, cx) => { this.setUi({ showLow: { ...this.ui.showLow, [x.lane]: true } }); cx.notify(); }))
      .child(sans(11, t.accent, x.more.label));
    if (x.kind === "empty") return div().w_full().h(H.empty).flex_none().pl(48).flex().items_center().child(sans(12, t.dim, x.text).italic());
    if (x.kind === "ehead") return this.epicHead(t);
    if (x.kind === "epic") return this.epicRow(t, x.row);
    return this.row(t, x.row, { dim: !!this.ui.query && x.row.state && x.row.state !== "OPEN" });
  }

  epicCols(narrow) { return narrow ? [28, null, 120, 130, 70] : [28, null, 150, 160, 70, 40]; }

  epicHead(t) {
    const w = this.epicCols(this.width < NARROW);
    const cells = ["", "Epic", "Progress", "needs · run · next", "area", "age"].slice(0, w.length);
    return h_flex().w_full().h(H.ehead).flex_none().px(14).gap(12).items_center().border_b(1).border_color(t.border)
      .children(cells.map((c, i) => sans(10, t.dim, c.toUpperCase()).when(w[i] == null, (el) => el.flex_1()).when(w[i] != null, (el) => el.w(w[i]).flex_none())));
  }

  epicRow(t, e) {
    const narrow = this.width < NARROW, w = this.epicCols(narrow), sel = e.key === this.sel;
    const cnt = (n, tone) => div().px(6).py(1).rounded(4).bg(n ? t.raised : t.chrome).font_family(MONO).text_size(11).text_color(n ? tone : t.dim).child(String(n));
    return h_flex().id(`epic-${e.key}`).w_full().h(H.epic).flex_none().px(14).gap(12).items_center().border_l_2()
      .border_color(sel ? t.accent : t.background).when(sel, (el) => el.bg(t.selected)).when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.sel = e.key; this.openEpic(e.key); cx.notify(); })
      .child(div().w(w[0]).flex_none().child(this.prioChip(t, e.priority)))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .child(mono(11, t.muted, `#${e.number}`)).child(sans(13, t.foreground, e.title).font_weight(500).truncate())
        .when(e.stuck, (el) => el.child(div().flex_none().px(6).rounded_full().bg(t.raised).font_family(SANS).text_size(10).font_weight(600)
          .text_color(t.blocked).child(`no update ${e.stuckDays}d`))))
      .child(h_flex().w(w[2]).flex_none().gap(8).items_center().child(this.bar(t, e.completed, e.total, w[2] - 50)).child(mono(11, t.muted, `${e.completed}/${e.total}`)))
      .child(h_flex().w(w[3]).flex_none().gap(6).child(cnt(e.counts.needs, t.blocked)).child(cnt(e.counts.running, t.working)).child(cnt(e.counts.next, t.foreground)))
      .child(div().w(w[4]).flex_none().when(!!e.area, (el) => el.child(this.tag(t, e.area))))
      .when(!narrow, (el) => el.child(mono(10, t.dim, ageText(Date.now(), e.touched)).w(w[5]).flex_none()));
  }

  // only the items that fit, from this.top; keyboard moves keep the selection in view, the wheel moves top
  list(t, flat) {
    const h = flat.map((x) => (x.kind === "row" && x.row.asking ? H.two : H[x.kind]));
    const i = flat.findIndex((x) => x.key === this.sel);
    if (this.follow && i >= 0) this.top = scrollTop(h, Math.min(this.top, i), i, this.listH);
    this.follow = false;
    this.top = clampTop(h, this.top, this.listH);
    const shown = [];
    for (let k = this.top, used = 0; k < flat.length && used < this.listH + H.two; k++) { shown.push(flat[k]); used += h[k]; }
    this.lastH = h;
    return v_flex().id("list").size_full().overflow_hidden()
      .on_size_change((size, cx) => { if (Math.abs(size.height - this.listH) > 1) { this.listH = size.height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => {
        this.wheel -= e.delta.y;
        let moved = 0;
        while (this.wheel >= H.row) { this.wheel -= H.row; moved++; }
        while (this.wheel <= -H.row) { this.wheel += H.row; moved--; }
        if (!moved) return;
        const top = clampTop(this.lastH ?? [], this.top + moved, this.listH);
        if (top !== this.top) { this.top = top; cx.notify(); }
      })
      .children(shown.map((x) => this.item(t, x)));
  }

  statusBoard(t, v) {
    const narrow = this.width < NARROW;
    const tone = (s) => ({ Inbox: t.blocked, "Needs answer": t.blocked, Blocked: t.blocked, "In progress": t.working, Done: t.done }[s] ?? t.muted);
    const cols = v.columns.map((c) => v_flex().id(`col-${c.status}`).flex_1().min_w(150).h_full().border_r(1).border_color(t.border)
      .child(h_flex().h(H.lane).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(sans(11, tone(c.status), c.status.toUpperCase()).font_semibold().truncate())
        .child(sans(11, t.dim, c.rows.length < c.total ? `${c.rows.length} of ${c.total}` : String(c.total))))
      .child(v_flex().id(`colb-${c.status}`).flex_1().min_h(0).overflow_y_scrollbar()
        .children(c.rows.map((r) => this.card(t, r)))
        .when(!c.rows.length && !c.more, (el) => el.child(div().px(10).py(8).child(sans(12, t.dim, c.empty))))
        .when(!!c.more, (el) => el.child(div().id(`more-${c.status}`).px(10).py(5).cursor_pointer()
          .on_click(stop((_e, cx) => { this.setUi({ showLow: { ...this.ui.showLow, [c.status]: true } }); cx.notify(); }))
          .child(sans(11, t.accent, c.more.label))))));
    return div().id("status").size_full().when(narrow, (el) => el.overflow_x_scrollbar())
      .child(h_flex().h_full().min_w(cols.length * 150).w_full().items_start().children(cols));
  }

  // a Status-view row: two lines, no status chip (the column is the status)
  card(t, r) {
    const sel = r.key === this.sel;
    return v_flex().id(`card-${r.key}`).w_full().flex_none().px(8).py(4).gap(2).border_l_2().border_b(1).border_color(t.border)
      .when(sel, (el) => el.bg(t.selected).border_color(t.accent)).when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((e, cx) => { this.sel = r.key; if (e.click_count > 1) this.act("primary", cx); else cx.notify(); })
      .child(h_flex().gap(6).items_center().child(this.prioChip(t, r.priority)).child(mono(11, t.muted, r.number ? `#${r.number}` : "draft"))
        .child(div().flex_1()).children(this.agentDots(t, r)).child(mono(10, t.dim, ageText(Date.now(), r.updatedAt))))
      .child(sans(12, t.foreground, r.title))
      .when(!!r.asking, (el) => el.child(sans(11, t.blocked, (this.asks[r.asking] ?? []).at(-1) ?? `${r.asking} asks`).truncate()))
      .when(sel, (el) => el.child(this.buttons(t, r)));
  }

  pill(t, id, label, on, onClick) {
    return h_flex().id(id).flex_none().gap(4).px(8).py(3).rounded(6).border(1).items_center().cursor_pointer()
      .border_color(on ? t.accent : t.border).bg(t.background).text_color(on ? t.accent : t.foreground)
      .font_family(SANS).text_size(12).hover((s) => s.bg(t.hover)).on_click(stop((_e, cx) => { onClick(); cx.notify(); }))
      .child(label);
  }

  menu(t, id, label, options, current, pick) {
    const open = this.dd === id;
    const trigger = this.pill(t, `dd-${id}`, label, !!current, () => { this.dd = open ? null : id; });
    return Popup.new(`pop-${id}`, trigger).anchor("top_left")
      .when(open, (el) => el.content(v_flex().id(`menu-${id}`).min_w(160).max_h(360).overflow_y_scrollbar().p(6).gap(1).rounded(8)
        .bg(t.popover).border(1).border_color(t.border).shadow_md()
        .children(options.map(([value, text]) => h_flex().id(`opt-${id}-${value ?? "all"}`).gap(8).px(8).py(4).rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(stop((_e, cx) => { pick(value); cx.notify(); }))
          .child(sans(12, t.accent, (Array.isArray(current) ? current.includes(value) : value === current) ? "✓" : "").w(12))
          .child(sans(12, t.foreground, text))))));
  }

  header(t, m) {
    const ui = this.ui, narrow = this.width < NARROW;
    const inToday = (ui.view === "today" || ui.view === "status") && !ui.query && !ui.focus;
    const f = facets(this.items);
    const live = liveSummary(terminals());
    const blocked = / · (\d+) blocked/.exec(live);
    const sync = syncLabel({ now: Date.now(), read: this.read, fetching: this.fetching, count: this.items.length, error: this.problem });
    const views = h_flex().flex_none().p(2).rounded(7).bg(t.raised).children(VIEWS.map(([v, name, sub]) => {
      const on = !ui.query && !ui.focus && (ui.view === v || (v === "epics" && ui.view === "epic"));
      return v_flex().id(`v-${v}`).px(12).py(3).rounded(5).cursor_pointer().when(on, (el) => el.bg(t.background))
        .on_click(stop((_e, cx) => { this.setUi({ focus: false }); this.setView(v); cx.notify(); }))
        .child(sans(13, on ? t.foreground : t.muted, name).font_weight(500))
        .when(!narrow, (el) => el.child(sans(10, on ? t.muted : t.dim, sub)));
    }));
    const search = h_flex().flex_1().min_w(110).max_w(300).h(28).px(8).gap(6).items_center().rounded(7).border(1)
      .border_color(this.typing ? t.accent : t.input).bg(t.background)
      .child(sans(12, t.muted, "⌕"))
      .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
      .when(!!m.search, (el) => el.child(sans(11, t.muted, m.search.count)))
      .child(mono(10, t.muted, "/").px(4).rounded(4).border(1).border_color(t.border));
    const chips = h_flex().flex_none().gap(3).children(PRIORITIES.map((p) => {
      const on = ui.priorities.includes(p);
      const fill = { P0: t.ansi1, P1: t.ansi3, P2: t.ansi3 }[p] ?? t.muted;
      return div().id(`chip-${p}`).px(7).py(4).rounded(6).border(1).font_family(MONO).text_size(11).font_weight(600)
        .when(on && inToday, (el) => el.bg(fill).border_color(fill).text_color(t.background))
        .when(!on || !inToday, (el) => el.bg(t.background).border_color(t.border).text_color(t.muted))
        .when(!inToday, (el) => el.line_through().opacity(0.45))
        .when(inToday, (el) => el.cursor_pointer().on_click(stop((_e, cx) => { this.togglePrio(p); cx.notify(); })))
        .child(p);
    }));
    const areaMenu = this.menu(t, "area", `Area ${ui.area ?? "all"} ▾`, [[null, "all"], ...f.areas.map((a) => [a, a])], ui.area, (v) => { this.setUi({ area: v }); this.dd = null; });
    const repoMenu = this.menu(t, "repo", `Repo ${ui.repo ? ui.repo.split("/")[1] : "all"} ▾`, [[null, "all"], ...f.repos.map((r) => [r, r])], ui.repo, (v) => { this.setUi({ repo: v }); this.dd = null; });
    const filtersMenu = this.menu(t, "filters", "Filters ▾",
      [...PRIORITIES.map((p) => [p, p]), ...f.areas.map((a) => [`area:${a}`, `area ${a}`]), ...f.repos.map((r) => [`repo:${r}`, `repo ${r}`])],
      [...ui.priorities, ui.area && `area:${ui.area}`, ui.repo && `repo:${ui.repo}`].filter(Boolean),
      (v) => { if (v.startsWith("area:")) this.setUi({ area: ui.area === v.slice(5) ? null : v.slice(5) }); else if (v.startsWith("repo:")) this.setUi({ repo: ui.repo === v.slice(5) ? null : v.slice(5) }); else this.togglePrio(v); });
    return h_flex().w_full().flex_none().gap(6).px(12).py(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(views).child(search)
      .when(!narrow, (el) => el.child(chips).child(areaMenu).child(repoMenu))
      .when(narrow, (el) => el.child(filtersMenu))
      .child(div().flex_1())
      .child(this.pill(t, "group", `group: ${ui.group ? "epic" : "lane"}`, ui.group, () => this.setUi({ group: !ui.group })))
      .child(this.pill(t, "focus", "Focus F", ui.focus, () => { this.setUi({ focus: !ui.focus, query: "" }); this.sel = null; }))
      .child(h_flex().id("live").flex_none().gap(6).px(9).py(3).rounded_full().border(1).items_center().cursor_pointer()
        .border_color(ui.live ? t.accent : t.border).bg(ui.live ? t.selected : t.background)
        .on_click(stop((_e, cx) => { this.setUi({ live: !ui.live }); cx.notify(); }))
        .child(div().w(7).h(7).rounded_full().bg(t.done).loop("opacity", { from: 0.35, to: 1, period: 1600 }))
        .child(sans(12, t.foreground, blocked ? live.slice(0, blocked.index) : live))
        .when(!!blocked, (el) => el.child(sans(12, t.blocked, `· ${blocked[1]} blocked`).font_semibold())))
      .child(h_flex().id("sync").flex_none().gap(4).items_center().cursor_pointer().on_click(stop((_e, cx) => this.refresh(cx)))
        .when(this.fetching, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(10).text_color(t.working).spin(900)))
        .child(sans(11, sync.stale ? t.blocked : t.muted, sync.label).when(sync.stale, (el) => el.font_semibold())));
  }

  context(t, m) {
    const ui = this.ui;
    if (ui.query) return null;
    if (ui.focus) return h_flex().w_full().flex_none().px(14).py(7).gap(10).items_center().border_b(1).border_color(t.border)
      .child(sans(12, t.blocked, "Focus").font_semibold()).child(sans(12, t.muted, "Needs you only · Enter peeks the agent, Esc in the peek comes back here · F or Esc leaves Focus"));
    if (!m.drill) return null;
    const e = m.drill.epic;
    const { completed = 0, total = 0 } = e.subIssues ?? {};
    return h_flex().w_full().flex_none().px(14).py(7).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().id("crumb-back").cursor_pointer().on_click(stop((_e, cx) => { this.setView("epics"); cx.notify(); })).child(sans(12, t.accent, "Epics")))
      .child(sans(12, t.dim, "›"))
      .child(sans(12, t.foreground, `#${e.number} ${e.title}`).font_semibold().truncate())
      .child(this.bar(t, completed, total, 120))
      .child(sans(12, t.muted, `${completed}/${total} · ${total ? Math.round((100 * completed) / total) : 0}%`))
      .child(div().flex_1())
      .child(div().id("crumb-issue").cursor_pointer().on_click(stop(() => this.press(rowButtons(e)[1]))).child(sans(12, t.accent, "Issue ↗")))
      .child(sans(12, t.muted, "all priorities"));
  }

  footer(t, m) {
    const ui = this.ui;
    const note = ui.query ? "global search · ignores filters" : ui.focus ? "Focus" : ui.view === "epic" ? m.drill?.footer ?? ""
      : ui.view === "status" ? "Done column limited to 8; epics excluded" : ui.live ? "live only" : "";
    const hint = (k, text) => h_flex().gap(4).items_center().child(mono(10, t.muted, k).px(4).rounded(3).border(1).border_color(t.border).bg(t.background)).child(sans(11, t.muted, text));
    return h_flex().w_full().flex_none().gap(14).px(14).py(5).items_center().overflow_hidden().bg(t.chrome).border_t(1).border_color(t.border)
      .children([["/", "search"], ["j k", "move"], ["↵", "agent / issue"], ["a", "agent (start /work if none)"], ["i", "issue"], ["p", "PR"], ["t e s", "views"],
        ["g", "group"], ["l", "live"], ["F", "focus"], ["0–4", "priority"], ["n", "needs you"], ["⇧R", "refresh"]]
        .slice(0, this.width < NARROW ? 6 : 13).map(([k, s]) => hint(k, s)))
      .child(div().flex_1())
      .child(sans(11, t.muted, note).truncate());
  }

  empty(t, title, body) {
    return v_flex().id("board").size_full().bg(t.background).items_center().justify_center().gap(8).p(24)
      .child(sans(16, t.foreground, title))
      .child(mono(12, t.muted, body));
  }

  skeleton(t) {
    const bone = (w) => div().w(w).h(10).rounded(3).bg(t.raised).loop("opacity", { from: 0.4, to: 1, period: 1400 });
    const lane = (label, tone, n) => [h_flex().h(H.lane).px(14).pt(6).border_b(1).border_color(t.border).child(sans(11, tone, label).font_semibold()),
      ...Array.from({ length: n }, (_, i) => h_flex().h(H.row).px(14).gap(8).items_center().child(bone(26)).child(bone(40)).child(bone(200 + ((i * 97) % 260))))];
    return v_flex().size_full().relative()
      .children([...lane("NEEDS YOU", t.blocked, 5), ...lane("RUNNING", t.working, 4)])
      .child(v_flex().absolute().top(0).left(0).size_full().items_center().justify_center().gap(8)
        .child(svg("mods/workspace-chrome/spinner.svg").size(18).text_color(t.working).spin(900))
        .child(sans(12, t.muted, this.items.length ? `fetching ${this.items.length} items…` : "fetching items…")));
  }

  render(cx) {
    const t = theme();
    if (this.opener) return div();
    this.housekeeping(cx);
    if (this.state === "missing") return this.empty(t, "No board.json yet", `Copy board.example.json to board.json in ${appHome()}/mods/${MOD}/ and set owner and project.`);
    if (this.state === "error") return this.empty(t, "Board can't load", this.problem ?? "unknown error");

    const loading = this.state === "loading";
    const m = loading ? { kind: "loading" } : this.model();
    this.rows = loading ? [] : this.rowsOf(m);
    const keys = this.rows.map((r) => r.key);
    if (this.sel == null && keys.length) {
      const needs = m.flat?.find((x) => x.kind === "row" && x.lane === "needs");
      this.sel = needs?.key ?? keys[0];
      this.follow = true;
    }
    this.sel = resolveSel(keys, this.sel, this.selIdx);
    this.selIdx = Math.max(0, keys.indexOf(this.sel));
    const repos = {};
    for (const it of this.items) if (it.repo) repos[it.repo] = (repos[it.repo] ?? 0) + 1;
    this.mainRepo = Object.entries(repos).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const sync = syncLabel({ now: Date.now(), read: this.read, fetching: this.fetching, count: this.items.length, error: this.problem });
    const banner = (text, tone) => h_flex().w_full().flex_none().px(14).py(6).gap(10).items_center().bg(t.raised).border_b(1).border_color(t.border)
      .child(sans(12, tone, text));

    const main = loading ? this.skeleton(t)
      : m.kind === "status" ? this.statusBoard(t, m.status)
      : m.search?.empty ? div().pt(30).pl(48).child(sans(12, t.dim, m.search.empty).italic())
      : this.list(t, m.flat);

    return v_flex().id("board").size_full().bg(t.background)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .track_focus(this.h).on_mouse_down("left", () => { if (!this.typing) this.h.focus(); })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t, loading ? {} : m))
      .when(!!sync.banner, (el) => el.child(banner(sync.banner, t.blocked)))
      .when(!!this.truncated, (el) => el.child(banner(`Board may be incomplete: ${this.truncated}`, t.blocked)))
      .when(!loading && !!this.context(t, m), (el) => el.child(this.context(t, m)))
      .child(div().w_full().flex_1().min_h(0).child(main))
      .child(this.footer(t, m));
  }
}
