// Zaksha board: a GitHub Projects v2 board as a Herdr tab, with the live agents working each card.
// Look follows jkuepker/herdr-layouts' board (columns, 3px status bar per card, mono labels, Focus fade).
// The logic is in lib.js (tested with node --test); this file only reads, polls and draws.
// Opened from keys.json as mod.open:zaksha-board: that opens this mod as a 1px popup which selects the tab
// already showing the board (or makes one) and closes itself.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, run, props, panes, terminals, theme, readTextFile, appHome, closeOverlay, shared, setShared } from "herdr";
import { parseConfig, fetchAll, buildBoard, cardAgents, excerpt, cardButtons, single, boardTab, uiState, toggleEpic } from "./lib.js";

const MOD = "zaksha-board";
const MONO = "JetBrains Mono";
const SANS = "Geist";
const ASK_MS = 5000; // how often blocked workers' screens are read for their excerpt
const UI_KEY = "zaksha-board.ui"; // sort, chips, text, epic filter, view, collapsed rows: herdr shared state, so it survives reopening

const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

export default class Board extends View {
  init(_props, cx) {
    if (props()?.overlay) { // the opener: one board tab, not a new one per keypress
      const tab = boardTab(panes(), MOD);
      if (tab) run("tab.select", { id: tab });
      else run("tab.new", { name: "Board", mod: MOD });
      closeOverlay(props().overlay);
      this.opener = true;
      return;
    }
    this.h = cx.focus_handle();
    this.cfg = null;
    this.state = "loading"; // loading | missing | error | ready
    this.problem = null; // config or fetch error
    this.truncated = null;
    this.items = [];
    this.read = null; // when the last fetch finished
    this.fetching = false;
    this.focus = false;
    this.asks = {}; // terminal address -> excerpt lines
    this.asking = false;
    this.fetch = single((cx) => this.load(cx));
    this.typing = false; // the filter input has the keyboard
    this.input = InputState.new({ placeholder: "Filter  /", value: shared(UI_KEY)?.text ?? "" });
    this.input.on("change", () => this.setUi({ text: this.input.value() }));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(ASK_MS, (cx) => this.readAsks(cx));
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
    this.state = r.error && !this.items.length ? "error" : "ready";
    this.problem = r.error;
    this.truncated = r.truncated;
    if (!r.error) this.items = r.items;
    this.read = Date.now();
    this.schedule(cx, this.cfg.pollSeconds);
  }

  // the next poll; one timer, replaced each time so pollSeconds edits apply
  schedule(cx, seconds) {
    if (this.timerSeconds === seconds) return;
    this.timerSeconds = seconds;
    this.timer?.cancel();
    this.timer = cx.timer.every(seconds * 1000, (cx) => this.refresh(cx));
  }

  // excerpts of what blocked card workers show (hc read), kept as plain lines
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

  ui() { return uiState(this.cfg, shared(UI_KEY)); }
  setUi(change) { if (this.cfg) setShared(UI_KEY, { ...this.ui(), ...change }); }

  press(b) {
    if (b.run) run(...b.run);
    else exec(...b.exec).catch(() => {});
  }

  // ---- drawing ----

  btn(t, id, label, primary, onClick) {
    return div().id(id).flex_none().px(9).py(3).rounded(5).border(1).cursor_pointer()
      .bg(primary ? t.blocked : t.raised).border_color(primary ? t.blocked : t.border).text_color(primary ? t.background : t.foreground)
      .font_family(SANS).text_size(12).hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  card(t, c, color) {
    const ags = c.agents.map((a) => h_flex().gap(5).items_center()
      .child(a.status === "working" ? svg("mods/workspace-chrome/spinner.svg").size(10).flex_none().text_color(t.working).spin(900)
        : div().w(7).h(7).rounded(4).bg(t[a.status] ?? t.idle))
      .child(mono(11, a.status === "blocked" ? t.blocked : t.muted, `${a.address} ${a.label}`)));
    const asks = c.agents.filter((a) => a.status === "blocked").flatMap((a) => this.asks[a.address] ?? []);
    const pr = cardButtons(c).find((b) => b.label === "Open PR");
    const prInfo = pr && c.prs.find((p) => p.url === pr.exec[1][0]);
    return div().id(`card-${c.key}`).w_full().flex_none().flex().flex_row().rounded(6).overflow_hidden()
      .bg(c.needsYou ? t.raised : t.surface).border(1).border_color(c.needsYou ? t.blocked : t.border)
      .child(div().w(3).flex_none().bg(color))
      .child(v_flex().flex_1().min_w(0).px(11).py(9).gap(4)
        .child(h_flex().w_full().gap(6).items_center()
          .when(!!c.priority, (el) => el.child(div().flex_none().px(5).rounded(3).bg(t.selected).font_family(MONO).text_size(10).text_color(t.foreground).child(c.priority)))
          .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11).text_color(t.dim).child(c.repo ? `${c.repo}#${c.number}` : "draft"))
          .when(!!c.parent, (el) => el.child(div().id(`ep-${c.key}`).flex_none().max_w(140).truncate().px(5).rounded(3).border(1).cursor_pointer()
            .border_color(t.border).font_family(MONO).text_size(10).text_color(t.muted).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); this.setUi({ epic: c.parent.key }); }).child(c.parent.title)))
          .when(c.type !== "Issue", (el) => el.child(mono(10, t.dim, c.type === "PullRequest" ? "PR" : "draft"))))
        .child(div().font_family(SANS).text_size(13).text_color(t.foreground).child(c.title))
        .when(ags.length > 0, (el) => el.child(h_flex().flex_wrap().gap(10).children(ags)))
        .when(c.needsYou, (el) => el.child(v_flex().px(8).py(6).rounded(4).bg(t.canvas)
          .child(mono(10, t.blocked, "NEEDS YOU"))
          .children((asks.length ? asks : ["(reading screen…)"]).map((l) => mono(11, t.muted, l)))))
        .when(!!prInfo, (el) => el.child(mono(11, t.dim, `PR #${prInfo.number} ${String(prInfo.state).toLowerCase()}`)))
        .child(h_flex().flex_wrap().gap(6).children(cardButtons(c).map((b, i) =>
          this.btn(t, `b-${c.key}-${i}`, b.label, b.label.startsWith("Open worker") && c.needsYou, () => this.press(b))))));
  }

  column(t, name, cards, color, i, faded) {
    return v_flex().id(`col-${i}`).flex_1().min_w(0).min_h(0).gap(8).when(faded, (el) => el.opacity(0.18))
      .child(h_flex().w_full().h(22).flex_none().gap(7).items_center()
        .child(div().w(7).h(7).rounded(4).bg(color))
        .child(mono(11, t.dim, name))
        .child(div().px(5).rounded(8).bg(t.raised).font_family(MONO).text_size(10).text_color(t.muted).child(String(cards.length))))
      .child(v_flex().id(`list-${i}`).w_full().flex_1().min_h(0).gap(8).overflow_y_scrollbar()
        .children(cards.map((c) => this.card(t, c, color)))
        .when(!cards.length, (el) => el.child(div().py(16).w_full().flex().justify_center().font_family(SANS).text_size(12).text_color(t.dim).child("Nothing here."))));
  }

  // a small on/off pill for the header's toggles
  pill(t, id, label, on, onClick) {
    return div().id(id).flex_none().px(7).py(2).rounded(4).border(1).cursor_pointer()
      .bg(on ? t.selected : t.surface).border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.dim)
      .font_family(MONO).text_size(11).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  agentDots(t, agents) {
    return agents.map((a) => h_flex().gap(4).items_center()
      .child(a.status === "working" ? svg("mods/workspace-chrome/spinner.svg").size(9).flex_none().text_color(t.working).spin(900)
        : div().w(6).h(6).rounded(3).bg(t[a.status] ?? t.idle))
      .child(mono(10, a.status === "blocked" ? t.blocked : t.muted, a.address)));
  }

  progress(t, e) {
    return div().w_full().h(3).rounded(2).bg(t.raised).child(div().h_full().rounded(2).bg(t.done).w(`${Math.round(e.total ? (100 * e.completed) / e.total : 0)}%`));
  }

  epicBar(t, epics, ui) {
    return h_flex().id("epics").w_full().flex_none().gap(8).pb(4).overflow_x_scrollbar()
      .child(this.pill(t, "epic-all", "All", !ui.epic, () => this.setUi(toggleEpic(ui, null))))
      .children(epics.map((e) => v_flex().id(`epic-${e.key}`).w(190).flex_none().gap(4).px(8).py(5).rounded(5).border(1).cursor_pointer()
        .bg(ui.epic === e.key ? t.selected : t.surface).border_color(ui.epic === e.key ? t.accent : t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.setUi(toggleEpic(ui, e.key)); })
        .child(h_flex().w_full().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12).text_color(t.foreground).child(e.title))
          .child(mono(10, t.muted, `${e.completed}/${e.total}`)))
        .child(this.progress(t, e))
        .when(e.agents.length > 0, (el) => el.child(h_flex().flex_wrap().gap(8).children(this.agentDots(t, e.agents))))));
  }

  // By epic: one collapsible row per epic, each with the same column cells
  epicRows(t, b, cols, ui) {
    const collapsed = new Set(ui.collapsed);
    const toggle = (key) => this.setUi({ collapsed: collapsed.has(key) ? ui.collapsed.filter((k) => k !== key) : [...ui.collapsed, key] });
    return v_flex().id("rows").w_full().flex_1().min_h(0).gap(10).overflow_y_scrollbar()
      .children(b.rows.map((r) => {
        const open = !collapsed.has(r.key);
        const cells = [...r.columns.map((c, i) => [c.name, c.cards, cols[i][2]]), ["DONE", r.done, t.done]];
        return v_flex().id(`row-${r.key}`).w_full().flex_none().gap(8)
          .child(h_flex().id(`rowh-${r.key}`).w_full().gap(8).items_center().px(6).py(4).rounded(5).bg(t.surface).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); toggle(r.key); })
            .child(mono(11, t.dim, open ? "▾" : "▸"))
            .child(div().font_family(SANS).text_size(13).text_color(t.foreground).child(r.title))
            .when(r.total !== null, (el) => el.child(mono(11, t.muted, `${r.completed}/${r.total}`)).child(div().w(80).child(this.progress(t, r))))
            .children(this.agentDots(t, r.agents))
            .child(div().flex_1())
            .child(mono(10, t.dim, cells.map(([n, c]) => `${n} ${c.length}`).join(" · "))))
          .when(open, (el) => el.child(div().w_full().flex().flex_row().gap(12)
            .children(cells.map(([name, cards, color], i) => v_flex().flex_1().min_w(0).gap(8)
              .child(h_flex().gap(6).items_center().child(div().w(6).h(6).rounded(3).bg(color)).child(mono(10, t.dim, `${name} ${cards.length}`)))
              .children(cards.map((c) => this.card(t, c, color)))
              .when(!cards.length, (el) => el.child(mono(10, t.dim, "—")))))));
      }));
  }

  empty(t, title, body) {
    return v_flex().id("board").size_full().bg(t.canvas).items_center().justify_center().gap(8).p(24)
      .child(div().font_family(SANS).text_size(16).text_color(t.foreground).child(title))
      .child(div().font_family(MONO).text_size(12).text_color(t.muted).child(body));
  }

  render() {
    const t = theme();
    if (this.opener) return div();
    if (this.state === "loading") return this.empty(t, "Loading board…", "");
    if (this.state === "missing") return this.empty(t, "No board.json yet",
      `Copy board.example.json to board.json in ${appHome()}/mods/${MOD}/ and set owner and project.`);
    if (this.state === "error") return this.empty(t, "Board can't load", this.problem ?? "unknown error");

    const b = buildBoard(this.items, this.cfg, terminals(), this.ui());
    const colors = [t.blocked, t.working, t.accent, t.idle, t.unknown];
    const cols = b.columns.map((c, i) => [c.name, c.cards, colors[i % colors.length]]);
    cols.push(["DONE", b.done, t.done]);

    const ui = this.ui();
    const header = h_flex().w_full().flex_none().gap(14).items_center()
      .child(mono(12, t.accent, "Z A K S H A"))
      .children(cols.map(([name, , color]) => h_flex().gap(5).items_center()
        .child(div().w(7).h(7).rounded(4).bg(color))
        .child(mono(11, t.muted, `${name} ${b.counts[name] ?? 0}`))))
      .child(mono(11, t.dim, `of ${b.total}`))
      .when(b.hidden > 0, (el) => el.child(mono(11, t.dim, `${b.hidden} hidden`)))
      .child(div().flex_1())
      .child(mono(11, t.dim, this.fetching ? "reading…" : this.read ? `updated ${hhmm(this.read)}` : ""))
      .child(this.btn(t, "focus", "◎ Focus  F", this.focus, (cx) => { this.focus = !this.focus; cx.notify(); }))
      .child(this.btn(t, "refresh", "↻ Refresh  R", false, (cx) => this.refresh(cx)));

    const label = (text) => mono(10, t.dim, text);
    const controls = h_flex().w_full().flex_none().flex_wrap().gap(8).items_center()
      .child(h_flex().w(260).h(26).flex_none().px(8).items_center().rounded(5).border(1)
        .border_color(this.typing ? t.accent : t.border).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(label("Sort"))
      .child(this.pill(t, "sort-p", "Priority", ui.sort === "priority", () => this.setUi({ sort: "priority" })))
      .child(this.pill(t, "sort-u", "Updated", ui.sort === "updated", () => this.setUi({ sort: "updated" })))
      .child(label("Show"))
      .children(this.cfg.priorities.map((p) => this.pill(t, `prio-${p}`, p, ui.priorities.includes(p),
        () => this.setUi({ priorities: ui.priorities.includes(p) ? ui.priorities.filter((x) => x !== p) : [...ui.priorities, p] }))))
      .child(label("View"))
      .child(this.pill(t, "view-c", "Columns", ui.view === "columns", () => this.setUi({ view: "columns" })))
      .child(this.pill(t, "view-e", "By epic", ui.view === "epics", () => this.setUi({ view: "epics" })));

    const banner = (text, color) => div().w_full().flex_none().px(10).py(6).rounded(6).border(1).border_color(color)
      .font_family(MONO).text_size(11).text_color(color).child(text);

    return v_flex().id("board").size_full().bg(t.canvas).px(16).pt(14).pb(10).gap(12)
      .track_focus(this.h).on_mouse_down("left", () => this.h.focus())
      .on_key_down((e, cx) => {
        if (this.typing) { // keys go to the filter; Esc clears it and gives the keyboard back
          if (e.key !== "escape") return;
          this.input.set_value("");
          this.setUi({ text: "" });
          this.h.focus();
        } else if (e.key === "/") this.input.focus();
        else if (e.key === "r") this.refresh(cx);
        else if (e.key === "f") { this.focus = !this.focus; cx.notify(); }
        else return;
        cx.stop_propagation();
      })
      .child(header)
      .child(controls)
      .when(b.epics.length > 0, (el) => el.child(this.epicBar(t, b.epics, ui)))
      .when(!!this.truncated, (el) => el.child(banner(`Board may be incomplete: ${this.truncated}`, t.blocked)))
      .when(!!this.problem, (el) => el.child(banner(`Last refresh failed (showing ${hhmm(this.read ?? Date.now())} data): ${this.problem}`, t.ansi1 ?? t.blocked)))
      // a plain flex row: h_flex centres its children, which would shrink each column to its header
      .child(ui.view === "epics" ? this.epicRows(t, b, cols, ui) : div().w_full().flex_1().min_h(0).flex().flex_row().gap(12)
        .children(cols.map(([name, cards, color], i) => this.column(t, name, cards, color, i, this.focus && i !== 0 && !cards.some((c) => c.needsYou)))));
  }
}
