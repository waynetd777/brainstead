---
title: Search
kind: screen
screens: [search]
order: 10
summary: Search the whole vault, filter by layer and date, and keep searches you run often.
---
Search looks through every note, wiki page and source's text, titles, headings and tags. Open it from **Search** in the sidebar's Library, with `⌥⌘6` or `⌘⇧F`, or from `⌘K` with **Search everything**.

## Write a search
Type at least two characters. Words match in any form, so `launch` finds `launching`, and a file with more of your words ranks higher. Each result shows its best passage with the matches marked, and how many passages match.

- `+word` must be there; `-word` or `NOT word` mustn't, and nor must `-"exact phrase"`. Both count anywhere in the file, not only in one section: `+budget +launch` finds a note with each in a different section, and `-"soft launch"` leaves out any note that says it.
- `"orbit app"` finds the words together.
- `pilot OR trial` finds either word.
- `budget AND forecast` needs both words.
- `tag:hiring` finds files with that tag or its sub-tags; `-tag:archived` leaves them out.
- `since:2026-09` and `before:2026-10-01` limit by the file's date, or the day it last changed when it has none. A day or a month works.

Clicking a `#tag` in a note searches for it here.

## Narrow and order the results
The **Note**, **Wiki** and **Source** chips choose which layers are searched; at least one stays on. The date menu, **Any time** unless you change it, limits results to the **Past week**, **Past month**, **Past 3 months** or **Past year**, unless your search has its own `since:`.

**Best match** shows the strongest results first; **Latest** and **Oldest** order by the file's date. The line above the results gives the number of files and how long the search took; only the best 200 are shown. Snippets show plain text, without markdown, links' brackets or code. If the search fails, the error shows with **Retry**.

`↑` and `↓` move through the results and `↩` opens one; a click works too. `Esc` clears the box. A note opened from a search scrolls to the first match, with every match marked. Right-click a result for the same menu as on [Notes](app:notes).

## Keep a search
Click **Save search**, give it a name and click **Save**. It's kept in `Me. Smart Lists.md` in the vault, with the layers chosen, and listed under **Saved searches** on the left. Click one to run it again. To change or remove saved searches, edit `Me. Smart Lists.md`.

## Jump anywhere with ⌘K
`⌘K` opens a box over any screen. Type to find:

- **Files**: the best matching notes, wiki pages and sources, with the same syntax as this page. `Tab` switches between **All**, **Notes**, **Wiki** and **Sources**; narrowed to one, ⌘K shows only files and Search everything.
- **Tasks**, on **All** only: open tasks whose text has every word typed; choosing one opens its note at the task's heading.
- Screens to go to, and commands such as **New note**, **Rebuild index** or **Light appearance**. On an open note there's also **Rename this note**, **Insert a query…**, **Ask about this note** and **Move this note to the Trash**.
- **Search everything** (`⌘↩`), **Ask** with what you typed, and **Capture … as a task**, which adds it to the To Do list.

`↑` and `↓` move, and before you type, `←` and `→` move across the Go to columns. `↩` runs the selected item and `Esc` closes.
