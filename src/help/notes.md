---
title: Notes
kind: screen
screens: [notes]
order: 7
summary: Every note in the vault outside the system folders, to search, sort, filter and open.
---
Notes lists every markdown note in the vault, apart from the wiki, sources and templates. Click a row to open it. A note can also hold live lists of tasks or notes: see [Task and Dataview queries](help:queries).

## Search the list
Type in **Search notes** to search the notes' text, titles and tags with the same index and syntax as the [Search](app:search) page. Words match in any form, so `launch` finds `launching`. Search starts at two characters. `↑` `↓` move between the matches, `↩` opens one with the matches marked, `Esc` clears the box, and the switch beside it, shown while you search, orders them by **Best match** or **Latest**. Snippets show plain text. If the search fails, the error shows with **Retry**.

## Sort and filter
Click a column header (Type, Title, Date, File, Modified, Size) to sort by it; click it again to reverse. The list starts with the most recently modified first. Date comes from the file name's date, or the `date` or `created` property.

The chips filter by type: **All**, the five commonest types with their counts, and **Other** for the rest and for notes with no type. A type chosen from elsewhere, such as an Activity pie, gets a chip of its own. **Group by type** shows the notes in a band per type, each with its count, notes with no type last. The count of what's shown is on the right.

## Act on a note from the list
Right-click a row for its menu:

- **Ask about this note**, **Ingest into the wiki**, **Bookmark** (or **Remove bookmark**).
- **Copy markdown**, **Copy path**, **Copy title**.
- **Reveal in Finder**.
- **Rename…**, which can update every link to the note, and **Discard draft** when the note has unsaved changes kept as a draft.
- **Move to the Trash**, which moves it to the vault's `.trash` folder, with Undo. See [Trash](app:trash).

## Make a new note
Click **New note** in the top bar, or press `⌘N` anywhere. Choose **Blank note** and give it a type, title and date, or pick a template from the vault's Templates folder: it shows as a summary of the questions it asks, with **Show code** for its Templater code. The filename is built as `Type. Title - YYYY-MM-DD.md`, and the dialog says whether it's free. Press `⌘↩` or click **Create**.

## Spot unsaved drafts
A note with unsaved changes kept as a draft shows an amber **Draft** chip by its title.
