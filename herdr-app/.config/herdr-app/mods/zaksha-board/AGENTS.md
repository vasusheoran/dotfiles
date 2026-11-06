# zaksha-board

A GitHub Projects v2 board as a Herdr tab, with the live agents on each card. `ctrl-b b` opens it (or selects the tab already showing it).

## Files

- `lib.js`: all logic (config, paginated `gh api graphql` fetch, columns, agent matching, buttons). No herdr/gpui imports.
- `lib.test.js`: behavior tests for `lib.js`, synthetic data only.
- `main.js`: reads, polls and draws; keep logic out of it.
- `board.example.json`: committed template. `board.json`: your real one, gitignored. This repo is public: never commit real owner/project values, card titles or screen text.

## board.json

Copy `board.example.json` to `board.json` here, then:

- `owner`, `project`: the org/user login and project number.
- `priorities`: Priority values shown, in sort order. Items with any other (or no) priority are hidden unless `"showUnprioritized": true`.
- `columns`: `[{name, statuses}]`, left to right. A status in no column is hidden; set `"otherColumn": "OTHER"` to show those in one extra column instead.
- `done`: `{status, limit}`: the newest `limit` items with that status, last column.
- `pollSeconds`: refresh interval (min 15). Edits apply on the next refresh.

Hidden items are counted in the header. A worker shows on a card when its terminal has the label `card=<owner/repo>#<N>` (`hc label t7 card=acme/widgets#12`).

## Run the checks

```sh
node --test herdr-app/.config/herdr-app/mods/zaksha-board/
herdr-app check herdr-app/.config/herdr-app/mods/zaksha-board
```

Write the test first for any logic change.
