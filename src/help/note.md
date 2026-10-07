---
title: A note
kind: screen
screens: [doc]
order: 8
summary: One note open, to read in View or write in Edit and Source, with its links, tasks and outline beside it.
---
A note opens in View. Switch to Edit or Source to change it; Brainstead saves only when you ask, and never over a change made in another app. For live lists of tasks or notes in a note, see [Task and Dataview queries](help:queries).

## Switch between View, Edit and Source
The switch in the top bar has three modes:

- **View** (`⌘1`) shows the note rendered: properties, links, tables, task queries, callouts, diagrams and maths. A diagram's buttons zoom it, fit it, and show it full screen (Escape closes it). Maths in `$…$` or `$$…$$` is drawn as formulas; amounts like $5 stay as written.
- **Edit** (`⌘2`) is the markdown itself, hidden except on the line you're editing: headings sized, links as their labels, checkboxes, images drawn.
- **Source** (`⌘3`) is the plain markdown in a monospaced font, with no formatting and no toolbar.

A note made from a template opens in Edit, with the caret where the template put it. Sources only open in View. To edit, turn off **Read-only** in [Settings › Vault](app:settings/vault).

## Write in Edit
The toolbar above the text formats it: text style and headings, bold, italic, strikethrough, highlight (`⇧⌘H`, with a colour from the chevron), inline code, lists, task list, quote, code block, divider, link, link to a note, image, table, today's date, and **Insert a query**.

Type `[[` to link a note and `#` for a tag; both suggest from the vault as you type part of a name (`[[` on its own lists your newest notes, and `#calls` finds `#context/calls`). `⌘`-click a link to open it. Paste or drop an image (a screenshot or a copied image) and it's saved in the vault's `images/` folder and embedded.

Images stay drawn in Edit, even on the line you're on, including `<img>` tags written by other apps. Hover one to frame it: drag a corner handle to resize it, which writes its width into the note (`![[pic.png|400]]`, the way other markdown editors read it, and View and Export PDF show it at that width, smaller only when the page is narrower), or click the trash button to take it out of the note (`⌘Z` puts it back; the file stays in `images/`). Double-click an image to edit its markdown.

Spelling and grammar are checked in Edit and Source: click an underlined word for suggestions, **Learn** or **Ignore**. Turn checking off in [Settings › Notes](app:settings/notes).

## Save, drafts and outside changes
Press `⌘S`, or click **Save** or the **Unsaved · ⌘S** pill. Brainstead keeps unsaved text as a draft about a second after you stop typing, so nothing is lost if the app quits. Opening the note again offers the draft with **Restore** or **Discard**.

Leaving a note with unsaved changes asks first: **Stay**, **Keep as draft**, **Discard changes** or **Save**.

If the file changes in another app, a change on other lines is merged in, and saving keeps both. A change on the same lines shows a banner with **Reload**, **Keep mine** (keeps your text as a draft, the file untouched) and **Compare**, which marks the lines that differ on each side. **Reload** asks before dropping your unsaved changes. Nothing is overwritten.

## System notes
Some notes are system notes that other parts of Brainstead rely on, such as the To Do list and the Scratchpad; [Trash](help:trash) lists them. Their header, the "This is a system note" callout at the top, can't be changed in Brainstead's editor. It shows a lock, and the rest of the note edits as usual. Other apps can still change it; [Knowledge health](app:health) then offers to put it back.

## Find and replace
Press `⌘F` to open the find bar under the top bar. Type to find in the note; the bar shows which match you're on. `↩` goes to the next match, `⇧↩` to the previous one, and `Esc` closes the bar.

In Edit and Source the bar also replaces: type the new text in **Replace with**, then click **Replace** (or press `↩`) for the current match or **Replace all** for every match. `⌘Z` undoes a replace. In View it only finds, and says "Switch to Edit to replace".

## Tick tasks and run queries
Tick a task's box in View or Edit. In View with nothing unsaved it's saved at once and `⌘Z` undoes it; with unsaved edits it joins them. Hover a task's date icon for what it means. In Edit, typing `due:`, `defer:`, `start:` or `created:` in a task opens a date picker.

`tasks` and `dataview` code blocks are live lists of tasks or notes; **Insert a query** builds one, and [Task and Dataview queries](help:queries) has the rest.

## Read callouts and other blocks
When a note's first heading repeats its title, View shows the title once.

In View, a quote that starts with `[!type]`, such as `> [!tip] Before you start`, is drawn as a tinted box with an icon and title. Write `[!type]-` to have it start folded, or `[!type]+` to start open but foldable; click the title to fold it. Tasks inside callouts and quotes work like any other task.

## Change how the document looks
The row under the note's details has two buttons. The sun or moon shows all documents light or dark. The look button (**Look:** and the theme) sets this note's theme and colour; **Use the defaults** drops the note's own look, and **Defaults…** opens [Settings › Notes](app:settings/notes). A note's own look is kept in Brainstead's settings, not in the note, and an assistant can read or change it as these buttons do.

Notes, wiki pages, sources and templates have the same top-bar buttons in the same order: Bookmark, Copy, Rename (a pencil), Graph, Read aloud, Text size and ⋯, then Ask and help. One that doesn't apply, such as Graph on a template or Read aloud on a PDF, is greyed and its tooltip says why.

Some pages have buttons of their own before these. A wiki page has **Refresh from sources**. A captured email or Teams thread has **Draft a reply**, and another source has **Doc check**. A template has **Test run** and **Templater docs ↗**.

The text size button in the top bar sets the document text from 12 to 24 px. `⌘=` and `⌘-` change it, and `⌘0` resets it to 15 px. It holds for every note, and an assistant can set it when you ask.

## Rename, copy, export and more
Rename edits the type, title and date separately, shows the new filename and every link that will change in other files, then **Rename & update links**. An assistant can list the links a rename would change in the same way before it renames. The note stays in its folder, and a message offers **Undo** (as `⌘Z` does).

**Export PDF…** (`⌘P`) saves the note as a PDF: always light, in the note's look, with the title and page numbers in each page's footer. **Copy rich text** pastes formatted into email or a document. **Move to the Trash** is on the ⋯ menu and the Note menu, with Undo.

## Read aloud
Click the speaker on the top bar, or press `⇧⌘P`, to hear the note read aloud in View, a paragraph at a time with each word highlighted; to start from a paragraph, `⌥`-click it or right-click it and choose **Read aloud from here**. A player bar at the foot of the page has the controls, speed and voice, and reading stops when you leave the note; set the default voice and speed in [Settings › Notes](app:settings/notes).

- `⇧⌘P` or `F8`: start reading, or play and pause
- `Space`: play or pause
- `F7` `F9`: previous, next paragraph
- `Esc`: stop
- Click a paragraph while reading to read from there; media keys and headphone buttons work too.

## Use the side pane
Beside the note:

- **Linked from**: the notes and pages that link here, with the line that links.
- **Agent changes**, when an assistant or a run changed the note: the latest changes, each with **Revert**; click one to see it in [Changes](help:review).
- **Open tasks in this note**, to tick from the side.
- **Outline**: the note's headings; click one to jump to it.
- On a 1-1 note named like `1-1. Maya - 2026-10-02.md`, **Last time with Maya**: the previous 1-1 and the follow-ups still open with them (tasks tagged `#followup/maya`).

The chevron on **Linked from** folds the pane away for the full width; **Linked from** in the details row brings it back.
