# Design notes

Why the extension works the way it does: where the daemon differs from the original brief, the decisions taken, and
how the client reads cases the daemon contract leaves open.

## Daemon contract

Where the daemon differs from the brief:

- D1: `/items` also takes `open=<bool>`; `total` is counted before `q`, `open` and `limit`.
- D2: error bodies come in four shapes: string `detail`, array `detail` (FastAPI 422), the summaries 409 body
  `{scope, ref, state: "disabled"}`, and `{"detail":"Not Found"}` for an unknown route. All four are mapped.
- D3: waiting kinds also include `run_finished`, `build_failed`, `review_requested` and `unread`; `state[]` is sorted
  alphabetically, so the client picks the one marker by urgency.
- D4: `NavItem` has `key` and optional `journal` and `group`.
- D5: a summaries POST 200 can be `stale` or `failed` inside the 300 s TTL (no job started); a first summary that is
  running has no `story`; pending is tracked client-side.
- D6: journal writes are `PATCH /journal/items/{id}` (`status`, `pinned`; `{}` is 422) and
  `POST /journal/items/{id}/todo` (201 created, 200 existing).
- D7: `POST .../how` answers only `fresh` (200) or `pending` (202); `GET` adds `missing`.
- D8: the daemon reads the secret once at start; a new or rotated secret gets 401 until it restarts.
- D9: the daemon sends raw `YYYY-MM-DD` days; the client formats the day labels.
- D10: ⌘D is `Common.Duplicate`, ⌘P is reserved (search-bar dropdown), ⌘↵ is reserved for the second action.
- D11: `List.Dropdown` has one `tooltip`, and `storeValue` cannot be cleared, so the dropdown is controlled with its own
  persisted state.
- D12: `/journal/focused` usually answers 200 with an empty journal, a normal state.

## Decisions

- One row per navigation item; places are actions and detail lines.
- Private distribution (`ray develop` / `ray build`); the gates are `lint:local`, `typecheck` and the tests. Publishing
  is not planned, see [`TODO.md`](TODO.md).
- "Group by day" is built; live refresh over `/events`, auto-summarize top N and "Windows by workspace" are left out.
- The subtitle is `summary`, else the title of the `go` place, else empty; the story is in the detail pane only.
- The Navigator's detail pane is open by default (⌘I hides it, and the choice is kept) and journal first: name,
  "Where you are", "Do next", then story and summary. Its metadata starts with the row's accessories as colored tags,
  because the pane hides them.
- `onlyOpen` is on by default and sends `open=true`; with it off, items with nothing open show an accessory and have no
  Go.
- A windowless session (409) gets one fallback to `go_ide`, else `go_terminal`; never more than two focus calls.
- Fixtures are hand-written; no live data is committed.
- The Journal is a `List` with an always-on detail pane.
- Journal "Open Source" failure shows a toast with an "Open Fylgja Page" action; it never opens a browser tab by itself.
- `@raycast/api` is pinned with `~`.
- The ranker choice is persisted with `useCachedState`, not `storeValue`.
- Shortcuts: ⌘D is avoided (Duplicate); ⌘P and ⌘↵ are reserved; Copy Path, Copy Ticket, Refresh, Open, Pin and Remove
  use `Keyboard.Shortcut.Common.*`.

## HTTP client

- A `secretFile` that is not absolute after `~/` expansion (for example `relative/x`, `$FYLGJA_CONFIG_DIR/...`) is
  `no_secret` with the message `No Fylgja API secret at <path>: the path must be absolute` instead of the
  `fylgja install secret` hint.
- A 404 or 409 without a `detail`, and a 400/403 whose detail is not one of the daemon's guard texts, map to
  `server_error` (`Fylgja answered <status>`). A 413/415/422 without a detail use that text inside their kind's message.
- `http://127.0.0.1:80` counts as having no port (`URL` drops the default port, and `fetch` would then send a `Host`
  without the port, which the daemon refuses).

Risk: with `redirect: "error"`, Node's `fetch` rejects any redirect status with `TypeError("fetch failed")` and the
cause message `unexpected redirect`. `http.ts` maps that cause text to `bad_response` (checked under Node 25.9 by the
loopback test). If a later Node in Raycast changes the text, a redirect shows as `network` instead; the bearer is
still never sent to the redirect target.

## Rankers

- `dropdownChange` compares the reported value with the value the dropdown shows, not with the effective rank. So when
  Raycast echoes the shown `""` on mount or while the options load, the stored choice is not overwritten.
- The unknown-ranker 422 refetch goes out with no rank at all. If a stale stored choice gets the 422 before `/rankers`
  answers, the `defaultRanker` preference is also skipped for that run. The next open uses it again.
- Without a `/rankers` answer (first open with no cache, or a failure), the only option is `""`, titled `Default`. The
  fallback option takes its name from the answer's `default` field, so today it reads `natural (fallback)`.
- `/rankers` is fetched again (GET) whenever the effective rank changes, so its `stale_choice` always matches the rank
  that was sent.
