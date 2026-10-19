# Run report

## step-01 scaffold

Installed versions (`npm ls --depth=0`):

- @raycast/api 1.104.25
- @raycast/eslint-config 2.2.0
- @raycast/utils 2.3.2
- @types/node 22.19.17
- @types/react 19.0.10
- eslint 10.13.0
- prettier 3.9.10
- typescript 6.0.3
- vitest 4.1.12

Raycast app version (`CFBundleShortVersionString`): 1.104.31.

Contract re-check (pre-check 2): matches. No field, route or schema id listed in the plan was removed or renamed.
`JournalHow.state` also allows `stale` and `failed` in the model.

Deviations: the existing `.gitignore` entries (plan and run files) were kept; the four entries of action 1 were added
to them.

## step-02 http core

Interpretations of R3/R6 where the table is silent:

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

## step-05 navigator list

Manual checks (the UI cannot be tested under Vitest):

- The list order equals the Fylgja page's Recall tab for the same ranker.
- "Show Items With Nothing Open…" (shown when the `onlyOpen` preference hides everything) opens the Navigator
  preferences with the `onlyOpen` checkbox.
- Enter focuses a window, and a cmux session.
- Stopping the daemon shows the "not running" view with "Copy Start Command".
- Renaming the secret file gives the secret toast on Enter.
- Close a window while its row is listed, then press Enter: "That window is gone". The next open of the command must
  not paint the gone window from the cache (the row is gone or has a new Go).

## step-06 rankers and search

Manual checks (the UI cannot be tested under Vitest):

- The first open does not flash the default order, either with a stored ranker choice or without one.
- A ranker that was removed from Fylgja (stored in the dropdown, or set as the `defaultRanker` preference) clears
  itself: the list falls back to Fylgja's default and shows no error.
- Typing fast shows no "No items match" flash.
- Searching a ticket key, or a word that appears only in a place title, finds the item.

Interpretations where the plan is silent:

- `dropdownChange` compares the reported value with the value the dropdown shows, not with the effective rank. So
  when Raycast echoes the shown `""` on mount or while the options load, the stored choice is not overwritten.
- The unknown-ranker 422 refetch goes out with no rank at all. If a stale stored choice gets the 422 before
  `/rankers` answers, the `defaultRanker` preference is also skipped for that run. The next open uses it again.
- Without a `/rankers` answer (first open with no cache, or a failure), the only option is `""`, titled `Default`. The
  fallback option takes its name from the answer's `default` field, so today it reads `natural (fallback)`.
- `/rankers` is fetched again (GET) whenever the effective rank changes, so its `stale_choice` always matches the rank
  that was sent.

## step-07 actions and detail

Manual checks (not run in Raycast):

- Every action works on a real folder item and a real app item: Go, Toggle Details (⌘I), Go to IDE/Agent/Terminal (⌘1/⌘2/⌘3), Focus Place (⌘G), Copy Path, Copy Ticket, Refresh.
- The detail pane reads well and holds everything the hidden accessories showed (the "Status" line carries each accessory text).
- A crafted title or summary with an image link (`![x](https://example.invalid/x.png)`) renders as text, not an image.
- Real app icons replace the fallback icons once `getApplications()` resolves.

## step-08 summaries

- Manual check (not run): with summaries on in the daemon's config, ⌘S on an item without a story shows the "summarizing…" marker, then the story. With summaries off, nothing about summaries shows (no Summarize action, no marker).

## step-11 journal command

Manual checks (the UI cannot be tested under Vitest):

- The focused checkout's journal renders: sections Do next, Keep in mind, Blocked, then one per day, with the Where text on top of the detail pane.
- Each action (Mark as Done, Pin/Unpin, Drop with Undo, Make a Todo) changes the item as the Fylgja page shows it.
- How Do I Do This? shows "Pending", then the steps after ⌘R.
- A checkout whose thread has a Where text but no items shows the "Where you are" row.
- Open Source on a session source focuses it with Raycast still open, then Raycast closes (no flicker or lost focus). On a gone session the toast's "Open Fylgja Page" opens the page.

## step-12 journal menu bar

Manual checks (the menu bar cannot be tested under Vitest):

- The title appears after the first run of "Fylgja Journal in Menu Bar".
- The title disappears when a window outside a tracked checkout has focus (no earlier title stays).
- With the daemon stopped, the menu bar shows only the icon, a message in the menu, and no toast.
- The command must be opened once in Raycast to enable its background refresh (every minute).

## step-13 verify

### Blocking

None. The live contract check found no mismatch the plan cannot absorb (no schema id change, no removed route).

### Live contract check

`npm run test:live` (GET only, counts and field paths only) ran once against the local daemon on 2026-10-19 and passed:

- `GET /rankers`: 3 choices, 3 rankers.
- `GET /items`: 69 items in 8 day groups (`total` 69, `shown` 69); `?open=true`: 34 items in 6 day groups (`total` 69);
  `?q=a`: 56 items in 7 day groups; `?rank=<choice>` for each of the 3 choices: 69 items each.
- `GET /journal/focused`: answer kind `empty` (no thread to check structurally; the menu bar model ran on it).
- Every answer matched the contract: required keys present with the right JSON type, no `null`, optional keys of the
  right type, no unknown enum value, every `days[]` complete (no `contract` error), every `go`, `go_ide`, `go_agent` and
  `go_terminal` target found in the item's `places`. Every item went through the row, detail, action and icon builders
  without throwing.
- No type, validation or fixture change was needed.
- Not covered by the live data: the thread branch of the journal (the focused journal was empty), so `journalView` and
  the thread structure check ran only against the hand-written fixtures in the default suite.

### Deviations from the brief

Daemon contract (D1-D12):

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

Decisions:

- One row per navigation item; places are actions and detail lines.
- Private distribution (`ray develop` / `ray build`), placeholder `author` `TODO-raycast-handle`, gates are `lint:local`
  and `tsc`.
- "Group by day" is built; live refresh over `/events`, auto-summarize top N and "Windows by workspace" are left out.
- The subtitle is `summary`, else the title of the `go` place, else empty; the story is in the detail pane only.
- `onlyOpen` is on by default and sends `open=true`; with it off, items with nothing open show an accessory and have no
  Go.
- A windowless session (409) gets one fallback to `go_ide`, else `go_terminal`; never more than two focus calls.
- Fixtures are hand-written; no live data is committed.
- The Journal is a `List` with an always-on detail pane.
- Journal "Open Source" failure shows a toast with an "Open Fylgja Page" action; it never opens a browser tab by itself.
- `@raycast/api` is `~1.104.25`.
- The ranker choice is persisted with `useCachedState`, not `storeValue`.

Shortcut changes: ⌘D avoided (Duplicate); ⌘P and ⌘↵ reserved; Copy Path, Copy Ticket, Refresh, Open, Pin and Remove use
`Keyboard.Shortcut.Common.*`.

### Manual checklist (not run in Raycast)

From the step 05-12 sections above:

- [ ] List order equals the Fylgja page's Recall tab for the same ranker.
- [ ] "Show Items With Nothing Open…" opens the Navigator preferences.
- [ ] Enter focuses a window and a cmux session.
- [ ] With the daemon stopped, the "not running" view and "Copy Start Command" show.
- [ ] A renamed secret file gives the secret toast on Enter.
- [ ] A gone window gives "That window is gone", and the next open does not paint it from the cache.
- [ ] The first open does not flash the default order, with or without a stored ranker.
- [ ] A removed ranker (stored, or in the `defaultRanker` preference) clears itself without an error.
- [ ] Typing fast shows no "No items match" flash.
- [ ] Searching a ticket key, or a word only in a place title, finds the item.
- [ ] Every Navigator action works on a folder item and an app item (Go, Toggle Details, ⌘1-⌘3, Focus Place, Copy Path,
      Copy Ticket, Refresh).
- [ ] The detail pane reads well and holds everything the hidden accessories showed.
- [ ] A crafted title or summary with an image link renders as text.
- [ ] Real app icons replace the fallback icons once `getApplications()` resolves.
- [ ] With summaries on, ⌘S shows "summarizing…", then the story; with summaries off nothing about summaries shows.
- [ ] The Journal shows Do next, Keep in mind, Blocked and one section per day, with the Where text on top of the detail.
- [ ] Mark as Done, Pin/Unpin, Drop with Undo and Make a Todo change the item as the Fylgja page shows it.
- [ ] How Do I Do This? shows "Pending", then the steps after ⌘R.
- [ ] A thread with Where text and no items shows the "Where you are" row.
- [ ] Open Source on a session focuses it with Raycast still open, then closes Raycast; on a gone session the toast's
      "Open Fylgja Page" opens the page.
- [ ] The menu bar title appears after the first run, and disappears when a window outside a tracked checkout has focus.
- [ ] With the daemon stopped, the menu bar shows only the icon and a message in the menu, no toast.
- [ ] The menu bar command was opened once in Raycast, so its 1-minute refresh runs.

Added in this step:

- [ ] Brief open question 4, "here now": does `frecency` with the current item lowered point to the right place when
      switching?
- [ ] Is `summary` a good enough subtitle (Fylgja wish 2)?
- [ ] Does hiding items with nothing open by default hide work you wanted to find by search?
- [ ] ⌘1-⌘3 and ⌘G work in the action panel.
- [ ] The dropdown restores the stored choice.
- [ ] `getApplications()` does not delay the first paint.

### Notes for the Fylgja repo

- Every live session lacked a process chain (`no process chain recorded for the session`, decision 0029) on 2026-10-19,
  so no session could be focused (`POST /focus/session` answers 409 "session has no window").
- `go` and `go_agent` point at sessions without a window.
- 17 pairs of app items share a name (bundle-id key against name key).
- `summary` is empty on most app items.
- `docs/api/items.md` lacks two error shapes: the array `detail` (FastAPI 422, which echoes `input`) and the summaries
  409 body `{scope, ref, state: "disabled"}`.
- The brief's optional changes remain wishes: `bundle_id` and the host app on `ItemPlace`, and a short headline.

### `ray lint`

Not run in the pipeline (it needs the network and a real `author`). Set `author` in `package.json` to your Raycast
handle, then run `npm run lint`.
