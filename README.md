# Fylgja for Raycast

A private Raycast extension for the local Fylgja daemon. Fylgja keeps track of what you work on; this extension lets you
see it and get back to it from Raycast.

It has three commands:

- **Fylgja Navigator**: lists what you have worked on, in Fylgja's order. Enter takes you to the item's window or
  session.
- **Fylgja Journal**: shows the journal of the checkout you are in, and lets you act on its items.
- **Fylgja Journal in Menu Bar**: shows where you are in the current checkout, in the macOS menu bar.

Fylgja decides the order, the search results, the counts and where Go takes you. The extension only shows them.

## Get started

You need the Fylgja daemon running on `http://127.0.0.1:7319`. Start it with `fylgja serve`.

Actions that change something, such as marking a journal item done, also need an API secret. Run
`fylgja install secret`, then restart the daemon, because it reads the secret only when it starts.

Then install the extension:

```sh
npm install
npm run dev
```

`npm run dev` builds the extension and imports it into Raycast. While it runs, it rebuilds on every change.

You can stop it with Ctrl+C. Raycast keeps the extension, also after a restart. Run `npm run dev` again only after you
pull or change the code, and stop it once Raycast shows the new build.

The daemon is the only thing that must always run. Without it, every command shows "The Fylgja daemon is not running".

Open Raycast and type "Fylgja" to find the commands. To give the Navigator a hotkey, go to Raycast Settings → Extensions
→ Fylgja → Fylgja Navigator.

## Navigator

Each row is one item: a checkout (a git folder) or an app. The right side of the row shows status tags, the workspace
and the time.

The detail pane is open by default; ⌘I hides and shows it. It starts with the checkout's journal ("Where you are" and
the next steps), then the item's story and summary. Below that are the status tags, the open windows, the time and the
path.

### Status tags

Each tag has an icon for where it comes from. Red and orange tags mean something is waiting for you. Only the most
urgent of those shows; hover over it to see all of them.

| Tag              | Icon         | Color  | Meaning                                                             |
| ---------------- | ------------ | ------ | ------------------------------------------------------------------- |
| needs approval   | star (agent) | red    | An agent waits for you to allow a tool call.                        |
| needs answer     | star (agent) | red    | An agent asked you a question.                                      |
| done             | star (agent) | orange | An agent finished its turn, and you have not looked since.          |
| run finished     | play         | orange | A norn run ended, and you have not been in its project since.       |
| build failed     | hammer       | orange | The build fails. Only for projects you touched today.               |
| review requested | code review  | orange | A pull request needs a review. Only for projects you touched today. |
| unread           | envelope     | orange | A window title shows an unread marker.                              |
| dirty            | diff         | grey   | The checkout has uncommitted changes.                               |
| PR open          | pull request | grey   | The branch has an open pull request.                                |
| todo next        | checklist    | grey   | A todo is marked next, in the project or in one of its workspaces.  |

The ticket (`CBS-2614`), the workspace (`ws 13`) and the time (`1h 7m today` or `9h ago`) are plain text. A state the
extension does not know shows as grey text.

### Navigator shortcuts

| Action                                     | Shortcut            |
| ------------------------------------------ | ------------------- |
| Go                                         | ↵                   |
| Toggle Details                             | ⌘I                  |
| Summarize (only when Fylgja has summaries) | ⌘S                  |
| Go to IDE                                  | ⌘1                  |
| Go to Agent                                | ⌘2                  |
| Go to Terminal                             | ⌘3                  |
| Focus Place (pick one of the open windows) | ⌘G                  |
| Copy Path                                  | Raycast "Copy Path" |
| Copy Ticket                                | Raycast "Copy"      |
| Copy Ranker Explanation                    | none                |
| Refresh                                    | Raycast "Refresh"   |

An action only shows when it can do something: Go needs something open, and Go to IDE, Agent and Terminal need that kind
of window.

Copy Ranker Explanation copies why the item is where it is in the list, for example
`focus 22 · last session +10 · turn done +90`.

"Raycast" in the table means one of Raycast's standard shortcuts, so the keys follow your Raycast version. The extension
never uses ⌘D, ⌘K, ⌘P or ⌘W.

## Journal

The Journal shows the checkout of the window that has focus: what to do next, what to keep in mind, what is blocked, and
what happened each day.

| Action                                          | Shortcut          |
| ----------------------------------------------- | ----------------- |
| How Do I Do This?                               | ↵                 |
| Mark as Done                                    | ⌘↵                |
| Open Source                                     | Raycast "Open"    |
| Make a Todo (shows Todo Exists when one exists) | ⌘T                |
| Pin / Unpin                                     | Raycast "Pin"     |
| Drop                                            | Raycast "Remove"  |
| Refresh                                         | Raycast "Refresh" |

Items that are done or dropped have only Open Source and Refresh.

## Journal in the menu bar

This command puts the Fylgja icon in the macOS menu bar, with a short note on where you are in the checkout you work in.

- **Title**: the first sentence of "Where you are", cut to 40 characters.
- **Tooltip**: the whole "Where you are" text, and a note if Fylgja's last update of it failed.
- **Menu**: the checkout and branch, the whole "Where you are" text and the next steps, then **Open Fylgja Journal** and
  **Refresh**.

It updates every minute, so it follows you to another checkout within a minute. Outside a checkout Fylgja tracks, only
the icon shows. If the daemon cannot be reached, the menu says so; the menu bar never shows a toast.

To turn it on, run the command once in Raycast. Raycast keeps it running from then on, also after a restart. To turn it
off, disable the command under Raycast Settings → Extensions → Fylgja.

## Preferences

For the whole extension:

- **Daemon Address**: default `http://127.0.0.1:7319`. Only `127.0.0.1` and `localhost` are accepted.
- **API Secret File**: default `~/.config/fylgja/api-secret`.

For the Navigator:

- **Default Ranker**: the order to start with. Empty uses Fylgja's default.
- **Days**: how far back the "Changed while you were away" list looks: 1, 3, 7 or 14 days (default 14).
- **Only items with something open**: hides items with no open window or session. On by default.
- **Group by day**: groups the items by the day you last worked on them. Off by default.

## Troubleshooting

- **"Fylgja refused the API secret"** on an action: restart the daemon after `fylgja install secret`; it reads the
  secret only at start. Lists still load, because reading needs no secret.
- **"The Fylgja daemon is not running on …"**: start it with `fylgja serve`. The view has a "Copy Start Command" action.
- **"… has no window; opened …"** after Go: the agent session has no window Fylgja knows of, so the extension opened the
  item's IDE or terminal window instead.
- **The Journal is empty**: it shows the checkout of the focused window. Focus a window inside a checkout Fylgja tracks,
  then open the Journal again.
- **The menu bar title never appears**: run "Fylgja Journal in Menu Bar" once in Raycast to turn it on.

## Development

`npm run check` runs the build, the type check, ESLint, Prettier and all tests. The GitHub Actions workflow runs it on
pushes to `main` and on pull requests. The pre-commit hook runs ESLint and Prettier on the staged files.

`npm run test:live` checks the running daemon's API against what the extension expects. It only reads, and it prints
counts and field names, never your data. Set `FYLGJA_LIVE_URL` to use another address.

The UI has no automated tests. Go through [`docs/manual-test.md`](docs/manual-test.md) in Raycast after UI changes.

`npm run lint` (Raycast's `ray lint`) fails on `author`, because `erikromson` is not a Raycast Store user; its other
checks pass. The extension is not published, so use `npm run lint:local` and `npm run typecheck` instead. They need no
network and no store account. To publish, see [`docs/TODO.md`](docs/TODO.md).

More docs:

- [`docs/design.md`](docs/design.md): why the extension works the way it does.
- [`docs/manual-test.md`](docs/manual-test.md): the checklist to go through in Raycast.
- [`docs/TODO.md`](docs/TODO.md): open questions, and the steps to publish to the Raycast Store.

The git, pull request and code review icons are GitHub Octicons, under the MIT license in `assets/octicons/LICENSE`.

## Privacy

Raycast's cache keeps item names and window titles on disk, just as Fylgja's own store does.
