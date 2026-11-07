# zaksha-board

A GitHub Projects v2 board in its own Herdr space, "Board" (kept first, so `ctrl-1` reaches it), with the live agents on each issue. `cmd-shift-b` (alias `ctrl-b b`) toggles: to the board, or back to the space and tab you came from. The space renames itself `Board · N` (N issues need you), `Board` at zero.

## Files

- `lib.js`: all logic (config, the one paginated `gh api graphql` fetch, lanes, views, search, selection, keys, the Board space). No herdr/gpui imports.
- `lib.test.js`: behavior tests for `lib.js`, synthetic data only. Write the test first for any logic change.
- `main.js`: reads, polls and draws; keep logic out of it.
- `board.example.json`: committed template. `board.json`: your real one, gitignored. This repo is public: never commit real owner/project values, issue titles or screen text.

## board.json

`owner`, `project` (the org/user and project number) and `pollSeconds` (default 300, min 15). Fields read from the project: Status, Priority, Area.

## Views and keys

Today (`t`: Needs you, Running, Up next), Epics (`e`: health per open epic, Enter drills in with every child shown), Status (`s`: one column per GitHub Status), search (`/`: every fetched item), Focus (`F`: Needs you only; Enter peeks the agent with `terminal.peek`). The full key table is `keyAction` in `lib.js`; Esc order is `escapeStep`.

GitHub is read on open, when the board becomes visible (at most once a minute), every `pollSeconds`, and on `Shift-R`. Everything else, search included, works on that cache. An agent shows on an issue when its terminal has the label `card=<owner/repo>#<N>` (`hc label t7 card=acme/widgets#12`).

## Run the checks

```sh
node --test herdr-app/.config/herdr-app/mods/zaksha-board/
herdr-app check herdr-app/.config/herdr-app/mods/zaksha-board
```
