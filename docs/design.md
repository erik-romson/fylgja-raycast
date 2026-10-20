# Design notes

Why the extension works the way it does. The first part lists where the daemon turned out to differ from the original
brief. The rest records the decisions taken, and how the client handles cases the daemon's API leaves open.

## Where the daemon differs from the brief

Items:

- `/items` also takes `open=<bool>`. Its `total` is counted before `q`, `open` and `limit` are applied.
- An item (`NavItem`) also has a `key`, and optionally a `journal` and a `group`.
- There are more waiting states than the brief listed: `run_finished`, `build_failed`, `review_requested` and `unread`.
  The `state[]` list is sorted alphabetically, not by urgency, so the client picks the most urgent one itself.
- Days come as raw `YYYY-MM-DD` dates; the client turns them into labels such as "Today".

Errors come in four shapes, and the client handles all of them:

- `detail` as a string;
- `detail` as an array (FastAPI's 422 validation error);
- the 409 from summaries when they are turned off: `{scope, ref, state: "disabled"}`;
- `{"detail": "Not Found"}` for an unknown route.

Summaries:

- A summaries POST can answer 200 with a `stale` or `failed` story within its 300-second cache time. No new job starts
  then.
- A first summary that is still running has no `story` yet, so the client tracks "summarizing…" itself.

Journal:

- Changes are `PATCH /journal/items/{id}` (`status` and `pinned`; an empty body is a 422) and
  `POST /journal/items/{id}/todo` (201 when created, 200 when it already exists).
- `POST .../how` answers `fresh` (200) or `pending` (202) only; `GET` can also answer `missing`.
- `/journal/focused` usually answers 200 with an empty journal. That is a normal state, not an error.

Secret:

- The daemon reads the API secret once, when it starts. A new or changed secret gets 401 until the daemon restarts.

Raycast:

- ⌘D is Raycast's Duplicate, ⌘P opens the search bar dropdown, and ⌘↵ belongs to a panel's second action.
- `List.Dropdown` has only one tooltip, and a value saved with `storeValue` cannot be cleared. So the ranker dropdown
  keeps its own saved state instead.

## Decisions

The Navigator list:

- One row per item. An item's windows and sessions ("places") are actions and lines in the detail pane, not rows of
  their own.
- The row's subtitle is the item's `summary`; if it has none, the title of the window Go would open; otherwise nothing.
  The story shows only in the detail pane.
- "Only items with something open" is on by default and sends `open=true`. When it is off, items with nothing open show
  a "nothing open" tag and have no Go.
- "Group by day" is built. Live updates over `/events`, summarizing the top items automatically, and "Windows by
  workspace" are left out.
- The ranker choice is saved with `useCachedState`, not `storeValue`, because the latter cannot be cleared.

The detail pane:

- It is open by default. ⌘I hides it, and the choice is kept.
- It puts the journal first: the item's name, "Where you are" and "Do next", then the story and the summary.
- Its metadata starts with the row's tags, in their colors, because Raycast hides the row's tags while the pane is open.
- To keep the metadata short, Last focus and Today share one Time line, and the ranker's explanation is an action (Copy
  Ranker Explanation) instead of a line.

Status tags:

- Each known state has an icon for its source (agent, run, CI, git, pull request, todo, window), in the tag's color.
- The agent states read "needs approval", "needs answer" and "done" instead of the daemon's `permission`, `input` and
  `turn_done`.
- Raycast has no git icon, so three GitHub Octicons are in `assets/octicons/`.

Go:

- If Go hits an agent session that has no window (the daemon answers 409), the client tries once more with the item's
  IDE window, or else its terminal. It never makes more than two focus calls.

The Journal:

- It is a `List` with the detail pane always open.
- If "Open Source" fails, a toast offers "Open Fylgja Page". The extension never opens a browser tab by itself.

Shortcuts:

- ⌘D, ⌘P and ⌘↵ are not used, because Raycast uses them (see above).
- Copy Path, Copy Ticket, Refresh, Open, Pin and Remove use Raycast's standard shortcuts (`Keyboard.Shortcut.Common`).

Building and testing:

- The extension is private: it runs through `ray develop` or `ray build`. The checks that must pass are `lint:local`,
  `typecheck` and the tests. Publishing is not planned; see [`TODO.md`](TODO.md).
- `@raycast/api` is pinned with `~`, so only patch versions update.
- Test fixtures are written by hand. No live data is committed.

## HTTP client edge cases

- A secret file path that is not absolute after `~/` is expanded (for example `relative/x` or `$FYLGJA_CONFIG_DIR/...`)
  gives the error "No Fylgja API secret at <path>: the path must be absolute", not the usual `fylgja install secret`
  hint.
- Some errors carry no useful detail: a 404 or 409 without a `detail`, or a 400 or 403 whose detail is not one of the
  daemon's known texts. These show as "Fylgja answered <status>". A 413, 415 or 422 without a detail uses that status
  text in its usual message.
- `http://127.0.0.1:80` is treated as having no port. `URL` drops the default port, and `fetch` would then send a `Host`
  header without the port, which the daemon refuses.

A known risk: redirects are refused (`redirect: "error"`). Node's `fetch` then fails with `TypeError("fetch failed")`
and the cause message `unexpected redirect`, which `http.ts` turns into a `bad_response` error. This was checked under
Node 25.9 by the loopback test. If a later Node in Raycast changes that message, a redirect shows as a network error
instead. Either way, the secret is never sent to the redirect target.

## Ranker edge cases

- When the dropdown reports a change, the client compares it with the value the dropdown shows, not with the ranker in
  use. Raycast reports the shown empty value when the view opens and while the options load; comparing this way keeps
  that from overwriting the saved choice.
- If the daemon does not know the requested ranker (422), the client asks again without any ranker. If a saved choice
  that no longer exists gets the 422 before `/rankers` has answered, the Default Ranker preference is also skipped for
  that one open. The next open uses it again.
- Without an answer from `/rankers` (the first open with nothing cached, or a failure), the dropdown has one option,
  "Default". The fallback option takes its name from the answer's `default` field, so today it reads "natural
  (fallback)".
- `/rankers` is fetched again whenever the ranker in use changes, so its `stale_choice` always matches the ranker that
  was sent.
