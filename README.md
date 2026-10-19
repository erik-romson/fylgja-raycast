# Fylgja for Raycast

A private Raycast extension that is a client of the local Fylgja daemon. It has three commands:

- **Fylgja Navigator** (`navigate`): one row per navigation item, in the daemon's order. Enter focuses the item's window
  or session. It has a ranker dropdown, search, a detail pane, per-item actions, summaries and an optional "group by
  day".
- **Fylgja Journal** (`journal`): the journal of the focused checkout, with actions on its items.
- **Fylgja Journal in Menu Bar** (`journal-menubar`): the first sentence of "Where you are" as the menu bar title,
  refreshed every minute. Open the command once in Raycast to enable its background refresh.

The daemon computes order, search results, counts and Go targets; the extension only renders them.

## Requirements

- The Fylgja daemon, running on `http://127.0.0.1:7319` (`fylgja serve`).
- An API secret for the actions that change something: run `fylgja install secret`, then restart the daemon. The daemon
  reads the secret only at start.

## Shortcuts

Shortcuts marked "Raycast" are Raycast's common shortcuts, so the keys follow the app version. Enter and ⌘Enter belong
to the first and second action of a panel; ⌘D, ⌘K, ⌘P and ⌘W are never assigned.

### Navigator

| Action                                           | Shortcut            |
| ------------------------------------------------ | ------------------- |
| Go                                               | ↵                   |
| Toggle Details                                   | ⌘I                  |
| Summarize (only when summaries are on in Fylgja) | ⌘S                  |
| Go to IDE                                        | ⌘1                  |
| Go to Agent                                      | ⌘2                  |
| Go to Terminal                                   | ⌘3                  |
| Focus Place (a submenu of the open places)       | ⌘G                  |
| Copy Path                                        | Raycast "Copy Path" |
| Copy Ticket                                      | Raycast "Copy"      |
| Refresh                                          | Raycast "Refresh"   |

Go to IDE, Agent and Terminal exist only when the item has that target. Go exists only when something is open.

### Journal

| Action                                       | Shortcut          |
| -------------------------------------------- | ----------------- |
| How Do I Do This?                            | ↵                 |
| Mark as Done                                 | ⌘↵                |
| Open Source                                  | Raycast "Open"    |
| Make a Todo (Todo Exists when one is linked) | ⌘T                |
| Pin / Unpin                                  | Raycast "Pin"     |
| Drop                                         | Raycast "Remove"  |
| Refresh                                      | Raycast "Refresh" |

Items that are done or dropped offer Open Source and Refresh only.

## Install

```sh
npm install
npm run dev
```

`npm run dev` imports the extension into Raycast. It stays there after you stop `ray develop`.

## Preferences

Extension:

- **Daemon Address** (`baseUrl`): default `http://127.0.0.1:7319`. Only `127.0.0.1` and `localhost` are accepted.
- **API Secret File** (`secretFile`): default `~/.config/fylgja/api-secret`.

Fylgja Navigator:

- **Default Ranker** (`defaultRanker`): the ranker to start with; empty uses the daemon's default.
- **Days** (`days`): 1, 3, 7 or 14 (default 14).
- **Only items with something open** (`onlyOpen`): on by default.
- **Group by day** (`groupByDay`): off by default.

## Tests

`npm run check` runs the build, the type check, ESLint, Prettier and every test. `npm run test:live` is a separate,
read-only (GET only) contract check against the running daemon; set `FYLGJA_LIVE_URL` to use another address. It prints
counts and field paths, never values.

## Lint with Raycast

The extension is not published to the Raycast Store, so `author` (`erikromson`) is not a registered Raycast user and
`npm run lint` (`ray lint`) reports it as invalid. Its other checks (icons, ESLint, Prettier) pass. Use
`npm run lint:local` and `npm run typecheck`, which need neither the network nor a store account. To publish, set
`author` to a real Raycast username first.

## Privacy

Raycast's cache keeps item names and window titles on disk, as Fylgja's own store does.
