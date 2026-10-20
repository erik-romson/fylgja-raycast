# Manual test checklist

Vitest cannot test the Raycast UI, so go through this list in Raycast after UI changes. Run `npm run dev` and keep the
Fylgja daemon running. `npm run test:live` checks the daemon's API separately.

## Navigator

The list:

- [ ] The order is the same as the Recall tab on the Fylgja page, for the same ranker.
- [ ] With a "Changed while you were away" section, the other items follow under an "All items" header, so an item that
      is in both does not look like a duplicate.
- [ ] The first open does not flash the default order, with or without a saved ranker.
- [ ] Real app icons replace the fallback icons once Raycast has listed the apps, without slowing down the first paint.
- [ ] When "Only items with something open" hides everything, "Show Items with Nothing Open…" opens the Navigator
      preferences at that checkbox.

Search and rankers:

- [ ] Typing fast never flashes "No items match".
- [ ] Searching for a ticket key, or for a word that is only in a window title, finds the item.
- [ ] The dropdown comes back with the saved ranker.
- [ ] A ranker that no longer exists, saved in the dropdown or set as the Default Ranker preference, clears itself: the
      list falls back to Fylgja's default and shows no error.

Actions:

- [ ] Every action works on a folder item and on an app item: Go, Toggle Details (⌘I), Go to IDE, Agent and Terminal
      (⌘1, ⌘2, ⌘3), Focus Place (⌘G), Copy Path, Copy Ticket, Copy Ranker Explanation and Refresh.
- [ ] Enter focuses a window, and also a cmux session.
- [ ] Close a window while its row is listed, then press Enter: "That window is gone". The next open does not show the
      closed window from the cache; the row is gone or Go points elsewhere.
- [ ] With summaries on, ⌘S on an item without a story shows "summarizing…", then the story. With summaries off, nothing
      about summaries shows: no Summarize action and no marker.

The detail pane:

- [ ] It is open the first time. ⌘I hides it, and it stays hidden after reopening until the next ⌘I.
- [ ] It starts with the item's name, then "Where you are", up to three "Do next" items and "+N more in the Journal",
      then the story and the summary.
- [ ] Its metadata starts with a "Status" line that has all of the row's tags in their colors: build failed and done in
      orange, needs approval in red.
- [ ] The tags show their icons in the tag's color, on the row and in the pane: a star on needs approval, needs answer
      and done, and the Octicons on dirty, PR open and review requested.
- [ ] A title or summary that contains an image link (`![x](https://example.invalid/x.png)`) shows as text, not as an
      image.

Errors:

- [ ] With the daemon stopped, the "not running" view shows, with "Copy Start Command".
- [ ] With the secret file renamed, Enter shows the secret toast.

## Journal

- [ ] The journal of the focused checkout shows Do next, Keep in mind, Blocked and one section per day. The search bar
      names the checkout.
- [ ] The detail pane starts with the checkout and branch (for example `fylgja-raycast/main · main`). Then come the
      selected item's whole text, its source and its How state, with "Where you are" at the bottom.
- [ ] A thread with "Where you are" text and no items shows the "Where you are" row.
- [ ] Mark as Done, Pin and Unpin, Drop with Undo, and Make a Todo change the item in the same way the Fylgja page shows
      it.
- [ ] How Do I Do This? shows "Pending", then the steps after ⌘R.
- [ ] Open Source on a session focuses it while Raycast is still open, then closes Raycast, with no flicker and no lost
      focus. On a session that is gone, the toast's "Open Fylgja Page" opens the page.

## Journal in the menu bar

- [ ] The command was opened once in Raycast, so its refresh every minute runs.
- [ ] The title appears after the first run. It disappears when a window outside a tracked checkout has focus; no old
      title stays.
- [ ] With the daemon stopped, the menu bar shows only the icon, and the menu holds a message. No toast shows.
