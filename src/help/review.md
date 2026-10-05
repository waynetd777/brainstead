---
title: Changes
kind: screen
screens: [review]
order: 13
summary: See what AI assistants and Brainstead's runs changed in your vault, revert any of it, and decide the few changes held for you.
---
Assistants and Brainstead's runs change the vault themselves, and every change they make is listed here with **Revert**. You only need to step in when a change is held for you. Go to Changes with `⌥⌘5`; the sidebar badge and Today's **Changes held for you** card count held changes only. Reading the rest of the feed is optional.

## What's made at once, and what's held
A change you started is made at once: something you asked for in Ask or in a terminal session using Brainstead's tools, or a run you started by hand (Ingest, **Run now**, **Draft the note**, a Knowledge health fix, **File this answer**, a bookmark made into a wiki page, a link from the weekly review). If one of its checks fails, it's still made, and flagged so you can look.

A change from a scheduled run is made at once when it passes every check, and held for you otherwise. Scheduled runs are the nightly check (with the ingests and contradiction check it starts) and the daily and weekly summaries when they run on their own. A terminal session nobody is watching, such as a loop, can say so, and its changes are then treated the same way.

The checks:
- A quote isn't found in its source, or the change rests on text read from an image.
- It rewrites or takes out text in one of your own notes. Your own notes are everything outside `wiki/`, `sources/`, `index.md`, `log.md` and the summaries' notes. Adding to them is fine.
- The page is open in Brainstead with unsaved edits.
- The page is part of an open contradiction.
- The page's properties wouldn't read any more.
- The vault was read-only when the change came. This only happens to a scheduled change: while the vault is read-only, a change you start isn't made at all.

Three kinds of change are always held, whoever started them: a change to a template in `Templates/`, a change to a system note's header (the "This is a system note" callout other parts of Brainstead look for), and a change that adds code that runs when a note is shown (a `dataviewjs` block, inline `$=`, a Tasks `by function` line or Templater's `<% %>`).

Renames and moves to the Trash are made at once, unless the note is a template, the rename would put it in `Templates/`, or the links it updates are in a template: then it's held. Revert renames the note back, or restores it from the Trash.

Assistants' task, Inbox and project edits are listed here too, and held by the same rules. Tasks and projects you change on their own screens aren't.

To have the summaries always held for you, turn on **Hold the summaries for me** in [Settings › Jobs & schedule](app:settings/jobs).

## Read the feed
The feed groups changes by run, newest first: "Nightly check, 5 Oct: 6 changes to 4 pages", an ingest, an Ask chat. Each row shows the title, the page, where it came from, the model and how long ago, with **Flagged**, **Reverted** or a kind such as **New page** or **Task**. Press `J` and `K` to move between changes.

On the right, the change is shown as a diff under its section: removed lines, then added lines, with a little unchanged text either side. Any flags are listed above it. **What it rests on** lists the quotes behind it, each marked **Found in the source**, **Not found in the source**, or **Not checked** for a file Brainstead can't read. Click a quote's source to open it, or **Open the page**.

## Revert a change
**Revert** undoes a change on the page as it is now, keeping any edits made since. It works on any change in the history, not just the last one, and is off while it's going. If the lines the change made have been edited since, or now appear in more than one place so it can't tell which to undo, it says so and shows the page as it was before the change, to copy from. A reverted change is marked **Reverted**; `⌘Z` straight after undoes the revert.

A page's side pane also lists the agent changes to it, under **Agent changes**, each with **Revert**.

## Decide held changes
Held changes are at the top, under **Held for you**, by run, each with why it was held. On a held change:
- **Accept** (`A`) makes it on the page as it is now.
- **Reject** (`R`) turns it down and leaves the page as it is.
- **Edit before accepting** opens the page with the change as an unsaved draft; click **Restore**, edit, then save. If the page already has unsaved edits in Brainstead, it says so and leaves them alone: save or discard them first. Revert can still take the change's lines out once you've saved.

**Accept all** and **Reject all** on a run do every held change in it; `⌘↩` accepts the run of the change you're on. While a run is being accepted, its buttons are off until it's done. The keys do nothing while a dialog is open or you're typing in a field.

A held change keeps what the assistant asked for (a section's new text, a find and replace, a task to add), not a copy of the page. So it still applies after other changes to the page. If what it changes isn't on the page any more, it says so, and you can reject it or edit the page yourself.

A held change that rewrites a whole page is different. If the page has changed since it was held, Accept says so rather than write over your edits; use **Edit before accepting**, or reject it.

An assistant can accept a held change for you only while you're there, and only one held because a check failed; the rest are yours to accept here.

While the vault is read-only, a note says so, with a button to [Settings › Vault](app:settings/vault), and nothing can be accepted or reverted.

## How long history is kept
Changes keeps 90 days of history or 500 MB, whichever comes first; the oldest go first, and held changes stay until you decide them. Set both in [Settings › AI assistants](app:settings/assistants). If your vault is in a OneDrive folder, older versions of a page are also in OneDrive's version history.
