# agents-view

The Leads list for Herdr, plus the asks count in the tab bar and the asks popup.

## What it shows

- **Leads list** (`main.js` `LeadsList`, mode `leads`): one row per lead, grouped into Waiting on you, Stuck and Working. Idle leads are folded under a single line; `space` unfolds them. Selecting a lead switches the main area to that lead's tab. The list never answers anything.
- **Asks count** (mode `badge`, placed in `layouts/main-agents.json`): the number of open asks, shown in the tab bar. Nothing shows when no ask is open.
- **Asks popup** (mode `asks`): opened by clicking the count. Each open ask shows its title (the ask's title, or the first line of its question), a Reply line when there is one, and its option buttons. A click on an option answers it through `work ask answer`. A merge, roll or money ask takes a second click. A click on the title opens the lead's tab.

The grouping and row logic live in `lib.js`. `main.js` only reads inputs, draws and handles keys.

## Where the files live

- `main.js`, `lib.js`, `mod.json`: this folder, in `~/dotfiles/herdr-app/.config/herdr-app/mods/agents-view/`.
- Herdr reads them through `~/.config/herdr-app/mods/agents-view`, a symlink into this folder.
- The layout that places the count is `herdr-app/.config/herdr-app/layouts/main-agents.json`.
- Tests: `*.test.js` next to the code, run with `node --test`.

Inputs, all read locally with no network:

- `~/handoffs/run/asks.jsonl`
- `~/handoffs/run/events.jsonl`
- `~/handoffs/run/closed-cards.json`
- `~/handoffs/run/stuck.json`
- each lead's last screen lines, read with `hc read` at most every 30 seconds per lead

## After a pull in `~/dotfiles`

Herdr hot-reloads only files under `~/.config/herdr-app/mods`. The symlink points into `~/dotfiles`, so a `git pull` changes the files on disk, but the running app keeps the old mod.

To load the new mod, switch layout once: press `cmd-shift-l` (`layout.switch` in `keys.json`). Restarting Herdr also works.

## Keys

| Key | Does |
| :--- | :--- |
| `↑` `↓` or `k` `j` | Move to another lead and show its tab |
| `↵` | Type into the lead's tab |
| `B` | Show the board at this lead's epic, if a board is open |
| `space` | Show or hide the idle leads |
| `cmd-shift-a` | Move the keyboard back to this list |
