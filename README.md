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
| Copy Ranker Explanation                          | none                |
| Refresh                                          | Raycast "Refresh"   |

Go to IDE, Agent and Terminal exist only when the item has that target. Go exists only when something is open. Copy
Ranker Explanation copies why the item has its place in the list, for example
`focus 22 · last session +10 · turn done +90`.

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

## Status tags

The tags on a Navigator row, and in the detail pane's Status line, come from the daemon. Each has an icon for where it
comes from. Of the waiting tags (red and orange), only the most urgent shows; its tooltip lists them all.

| Tag              | Icon         | Color  | Meaning                                                            |
| ---------------- | ------------ | ------ | ------------------------------------------------------------------ |
| needs approval   | star (agent) | red    | An agent waits for you to allow a tool call.                       |
| needs answer     | star (agent) | red    | An agent asked you a question.                                     |
| done             | star (agent) | orange | An agent finished its turn, and you have not looked since.         |
| run finished     | play         | orange | A norn run ended, and you have not focused its project since.      |
| build failed     | hammer       | orange | The project's build fails (projects touched today).                |
| review requested | code review  | orange | An open pull request needs a review (projects touched today).      |
| unread           | envelope     | orange | A window title shows an unread marker.                             |
| dirty            | diff         | grey   | The checkout has uncommitted changes.                              |
| PR open          | pull request | grey   | The branch has an open pull request.                               |
| todo next        | checklist    | grey   | A todo is marked next, in the project or in one of its workspaces. |

Tickets, the workspace (`ws 13`) and the time (`1h 7m today`, `9h ago`) are plain text. A state the extension does not
know shows as grey text. The git, pull request and code review icons are GitHub Octicons (MIT, see
`assets/octicons/LICENSE`).

## Journal in the menu bar

"Fylgja Journal in Menu Bar" puts the Fylgja icon in the macOS menu bar with a short note of where you are in the
checkout of the focused window.

- **Title**: the first sentence of the checkout's "Where you are", cut to 40 characters.
- **Tooltip**: the whole "Where you are" text, and a note when Fylgja's last attempt to update it failed.
- **Menu**: the checkout (`folder · branch`), the whole Where text and the shown "Do next" items, then **Open Fylgja
  Journal** (opens the Journal command) and **Refresh**.

It asks the daemon again every minute, so the title follows you to another checkout within a minute. When the focused
window is not in a checkout Fylgja tracks, only the icon shows. When the daemon cannot be reached, the menu holds the
message; the menu bar never shows a toast.

Run the command once in Raycast to turn it on; Raycast keeps it running from then on, also after a restart. To turn it
off, disable the command under Raycast Settings → Extensions → Fylgja.

## Install

```sh
npm install
npm run dev
```

`npm run dev` imports the extension into Raycast. It stays there after you stop `ray develop`.

Open Raycast and type "Fylgja" to find the commands. To open the Navigator with a hotkey, set one under Raycast
Settings → Extensions → Fylgja → Fylgja Navigator.

## Troubleshooting

- **"Fylgja refused the API secret"** on an action: the daemon reads the secret only at start. Restart it after
  `fylgja install secret`. Lists still load, because reads need no secret.
- **"The Fylgja daemon is not running on …"**: start it with `fylgja serve`. The view offers "Copy Start Command".
- **"… has no window; opened …"** after Go: the session has no window the daemon knows of, so the extension focused the
  item's IDE or terminal window instead.
- **The Journal is empty**: it shows the checkout of the focused window. Focus a window inside a checkout Fylgja
  tracks, then open the Journal again.
- **The menu bar title never appears**: open "Fylgja Journal in Menu Bar" once in Raycast to enable its background
  refresh.

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
counts and field paths, never values. The UI has no automated tests; [`docs/manual-test.md`](docs/manual-test.md) is
the checklist to go through in Raycast after UI changes.

## Lint with Raycast

The extension is not published to the Raycast Store, so `author` (`erikromson`) is not a registered Raycast user and
`npm run lint` (`ray lint`) reports it as invalid. Its other checks (icons, ESLint, Prettier) pass. Use
`npm run lint:local` and `npm run typecheck`, which need neither the network nor a store account. To publish, set
`author` to a real Raycast username first; see `docs/TODO.md`.

## Docs

- [`docs/design.md`](docs/design.md): the daemon contract as the client sees it, and the design decisions.
- [`docs/manual-test.md`](docs/manual-test.md): the manual UI checklist.
- [`docs/TODO.md`](docs/TODO.md): open questions, and the steps to publish to the Raycast Store.

## Privacy

Raycast's cache keeps item names and window titles on disk, as Fylgja's own store does.
