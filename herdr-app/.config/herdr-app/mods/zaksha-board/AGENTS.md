# zaksha-board

A GitHub Projects v2 board in its own Herdr space, "Board" (kept first, so `ctrl-1` reaches it), with the live agents on each issue. `cmd-shift-b` (alias `ctrl-b b`) toggles: to the board, or back to the space and tab you came from. The space renames itself `Board · N` (N issues need you), `Board` at zero.

## Files

- `lib.js`: all logic (config, the one paginated `gh api graphql` fetch, lanes, views, search, selection, keys, the Board space). No herdr/gpui imports.
- `lib.test.js`: behavior tests for `lib.js`, synthetic data only. Write the test first for any logic change.
- `main.js`: reads, polls and draws; keep logic out of it.
- Starting (`a` on an issue with no agent) opens the sibling mod `zaksha-board-start`: pick /work, Quick or Brief, plus optional notes, passed on as one argv element (`startArgv`, capped at 2000 chars).
- Start dialog keys are the pure `dialogKey` (in `zaksha-board-start/lib.js`, tested from here): `n` focuses notes, `w` /work, `q` Quick, `b` Brief (read-only catch-up, tab `#<N> brief`), Enter starts, Esc leaves the input then cancels.
- The started command labels its own terminal `card=<key>` before claude runs, so the board shows the agent at once.
- `card` holds a comma-separated list of refs (`<owner>/<repo>#<N>,...`, no spaces; `cardList` parses: trim, drop empties, case-insensitive dedupe, order kept). One session shows on every listed issue, counted once in the live pill; a single ref is a list of one, and a tab with several reads `● #<first N> +<k>`.
- `board.example.json`: committed template. `board.json`: your real one, gitignored. This repo is public: never commit real owner/project values, issue titles or screen text.

- Tab marks: a live local terminal labelled `card=<key>` with a `herdr.tab` label renames its tab `● #<N> <title ≤22 chars>` (pure `tabMarks`), however the session got linked. The previous name is kept in shared `zaksha-board.tabmarks` and restored when the label goes; a tab the person renames by hand is released, never overwritten.

- Agents without a `card` label are matched read-only (`linkTerminals`): a live claude terminal whose `agents()` title has `#<N>` (`terminals()` has no title; joined by address), else whose agent space's branch has `<N>` as a whole number (space name must fit the repo). Shown with a `~`; a labelled agent wins; `a` focuses it. Labels are never written.
- The "Now" strip (`nowFlat`) tops every view except search: each issue with a live agent, blocked first.
- Each render records the focused local {space, tab} into shared `space-toggle.history` (`pushHistory`, cap 10); the sibling mod `space-toggle` (bound to `cmd-shift-\` in keys.json, written `"cmd-shift-\\"` there) flips to the previous entry.

## board.json

`owner`, `project` (the org/user and project number), `pollSeconds` (default 300, min 15) and optional `repoPaths` (`{"<owner/repo>": "<path>"}`, `~` expanded; default `~/workspace/vasu/<repo name>`). Fields read from the project: Status, Priority, Area.

## Views and keys

Today (`t`: Needs you, Running, Up next), Epics (`e`: health per open epic, Enter drills in with every child shown), Status (`s`: one column per GitHub Status), search (`/`: every fetched item), Focus (`F`: Needs you only; Enter peeks the agent with `terminal.peek`), Agents (`Shift-A`: every live claude agent grouped by epic, one row per card and agent, Unlinked folded; Enter focuses the agent, or toggles the Unlinked header; `Shift-N` renames its tab, `Shift-L` links it to an issue (search, Enter adds to its `card` label, Esc cancels); pure `agentsView` and `agentsFlat`). The full key table is `keyAction` in `lib.js`; Esc order is `escapeStep`.

GitHub is read on open, when the board becomes visible (at most once a minute), every `pollSeconds`, and on `Shift-R`. Everything else, search included, works on that cache. An agent shows on an issue when its terminal has the label `card=<owner/repo>#<N>` (`hc label t7 card=acme/widgets#12`).

`a: agent (start /work if none)`: with no live agent it focuses a terminal already labelled for the issue, else confirms once, then starts `claude "/work <owner/repo>#<N>"` (or, in Quick mode, a prompt that only does what the notes say, tab `#<N> quick`) as a new tab in the space of the live terminal labelled `desk=<desk>` (`~/handoffs/areas.txt` maps repo name to desk), or in a new space. A missing folder shows an error toast. Epics are skipped.

## Run the checks

```sh
node --test herdr-app/.config/herdr-app/mods/zaksha-board/*.test.js
herdr-app check herdr-app/.config/herdr-app/mods/zaksha-board
```

## Logs

Every mod writes `~/.config/herdr-app/data/logs/<mod>.log` (`zaksha-board`, `zaksha-board-start`, `session-search`, `space-toggle`) through `log.js`, a copy of one file kept identical in each mod folder (mods can't import siblings; `log.test.js` checks the copies match). Herdr keeps no mod output, so this is where a silent failure shows up.

- Line: `ISO-time LEVEL mod message {json}`. Notes text is never logged, only its length.
- Rotation: when a log is over 256 KB, `.log.1` moves to `.log.2` and `.log` to `.log.1` (two old files kept). `fs/promises` has no append or rename, so a write is read + write; failed writes are dropped.
- Read: `tail -f ~/.config/herdr-app/data/logs/zaksha-board.log` (and `zaksha-board-start.log` for the dialog).
- Start flow, in order: `row key a` → `a pressed` → `dialog opened` → dialog `start()` / `closeOverlay` / `run` → `nextCommand` → `startWork` → `folder check` → `areas read` → `startPlan` → `run`. The last line present is where it stopped.
