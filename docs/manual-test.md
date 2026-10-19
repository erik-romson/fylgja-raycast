# Manual test checklist

The Raycast UI cannot be tested under Vitest. Run `npm run dev` with the Fylgja daemon running and go through this list
after UI changes. `npm run test:live` checks the daemon contract separately.

## Navigator

- [ ] List order equals the Fylgja page's Recall tab for the same ranker.
- [ ] "Show Items with Nothing Open…" (shown when the `onlyOpen` preference hides everything) opens the Navigator
      preferences with the `onlyOpen` checkbox.
- [ ] Enter focuses a window and a cmux session.
- [ ] With the daemon stopped, the "not running" view and "Copy Start Command" show.
- [ ] A renamed secret file gives the secret toast on Enter.
- [ ] Close a window while its row is listed, then press Enter: "That window is gone". The next open does not paint
      the gone window from the cache (the row is gone or has a new Go).
- [ ] The first open does not flash the default order, with or without a stored ranker.
- [ ] A removed ranker (stored in the dropdown, or set as the `defaultRanker` preference) clears itself: the list falls
      back to Fylgja's default and shows no error.
- [ ] The dropdown restores the stored choice.
- [ ] Typing fast shows no "No items match" flash.
- [ ] Searching a ticket key, or a word only in a place title, finds the item.
- [ ] Every action works on a folder item and an app item: Go, Toggle Details (⌘I), Go to IDE/Agent/Terminal
      (⌘1/⌘2/⌘3), Focus Place (⌘G), Copy Path, Copy Ticket, Refresh.
- [ ] The detail pane reads well and holds everything the hidden accessories showed (the "Status" line carries each
      accessory text).
- [ ] A crafted title or summary with an image link (`![x](https://example.invalid/x.png)`) renders as text.
- [ ] Real app icons replace the fallback icons once `getApplications()` resolves, without delaying the first paint.
- [ ] With summaries on, ⌘S on an item without a story shows "summarizing…", then the story. With summaries off,
      nothing about summaries shows (no Summarize action, no marker).

## Journal

- [ ] The focused checkout's journal shows Do next, Keep in mind, Blocked and one section per day. The search bar
      names the checkout.
- [ ] The detail pane starts with the checkout (`folder · branch`, for example `fylgja-raycast/main · main`), then
      the selected item's whole text, its source and How state, with "Where you are" at the bottom.
- [ ] Mark as Done, Pin/Unpin, Drop with Undo and Make a Todo change the item as the Fylgja page shows it.
- [ ] How Do I Do This? shows "Pending", then the steps after ⌘R.
- [ ] A thread with Where text and no items shows the "Where you are" row.
- [ ] Open Source on a session focuses it with Raycast still open, then closes Raycast (no flicker or lost focus). On
      a gone session the toast's "Open Fylgja Page" opens the page.

## Journal in menu bar

- [ ] The command was opened once in Raycast, so its 1-minute background refresh runs.
- [ ] The title appears after the first run, and disappears when a window outside a tracked checkout has focus (no
      earlier title stays).
- [ ] With the daemon stopped, the menu bar shows only the icon and a message in the menu, no toast.
