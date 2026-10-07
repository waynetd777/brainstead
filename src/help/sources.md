---
title: Sources
kind: screen
screens: [sources]
order: 12
page: Preview a source
summary: The raw material the wiki is built from, and where you ingest it into the wiki.
---
Sources are the files in your vault's `sources/` folder: captured emails and Teams chats, transcripts, PDFs, Word, PowerPoint and Excel files, images, and notes. They are the record, so Brainstead doesn't edit them, except that an ingest (the AI reading a source into the wiki) corrects misheard names, listed in [Changes](app:review) with Revert. Go to Sources with `⌥⌘0`.

## Add a source
- Drag files from Finder onto the Sources screen, or click **Import** and pick them. Each is copied into `sources/` under its own name, or a free one if that name is taken. Folders, files already in the vault and files over 200 MB are refused.
- Capture from the browser with the Outlook and Teams extensions (set up in [Settings › Capture extensions](app:settings/capture)). A capture lands in `sources/` as an `Email. …` or `Teams. …` note, and also waits in the [Inbox](app:inbox).

Nothing can be added while Read-only is on in [Settings › Vault](app:settings/vault).

## See what needs ingesting
Each source has a status: **New** (no wiki page cites it), **Changed** (it changed after the pages citing it were written) or **Ingested**; an assistant sees the same, and lists the New and Changed ones as still to ingest, leaving out a file an ingest can't read (one with no **Ingest** button here), which it won't ingest either. Use **All**, **New**, **Changed** and **Ingested** above the list to filter, and **Search sources** to search their text and names with the same rules as [Search](help:search) (`+word`, `-"a phrase"` and the rest); the Kind column says what each file is, and Folder the folder under `sources/` it's in (— at the top; hover for the full path). Markdown, text, PDF, Word, PowerPoint and Excel files and images (not SVG) can be ingested.

## Ingest a source
Click **Ingest** on a source's row, or **Re-ingest** on one already ingested. A Teams transcript's row has **Meeting note** instead, which writes its meeting note, ingests that and trashes the transcript ([Meeting note from a transcript](app:meeting)); its ▾ has **Ingest into the wiki** for the transcript itself. The **Ingest** button in the top bar ingests every new and changed source, one after another, except Teams transcripts, which get meeting notes instead. You can also choose **Ingest into the wiki** from a note's ⋯ or right-click menu, or with `I` on a capture in the [Inbox](app:inbox).

Ingests wait in one queue, one at a time, the oldest source first (by the date in its name, else the file's), whoever started them, so a newer source has the last word on a page. An ingest reads the source, corrects misspelt names, finds the wiki pages it mentions, has the AI draft changes to them and checks every quote against the source. The AI says what the source adds; Brainstead puts it in place: a dated entry in the page's Timeline (newest first, naming the source; ingesting the source again replaces its entry), a new Current state under the opening text when what's true now changes, and a topical section above the Timeline. On a long page the AI sees the outline with its opening, Current state and newest entries, and rewrites only a section it saw all of; "left out by the checks" says when it tried otherwise.

A change is dropped only when none of its quotes is found in the source. One with some quotes missing is kept and flagged. A change from an image is never dropped for a missing quote, as the AI may read what the computer's text recognition missed; it's kept and flagged.

The changes are made at once, with a line in `log.md`, and listed in [Changes](app:review), where you can revert them. Only when the daily check runs on its schedule is a flagged change held there for you instead. The source is added to each page's `sources:`.

To ingest new sources as soon as they arrive, turn on **Ingest new sources as they arrive** in [Settings › AI assistants](app:settings/assistants).

## Follow an ingest run
The **Ingest runs** pane on the right shows each run's steps as they go, with **Stop** while it runs or waits its turn. An assistant can stop one the same way, the one running or, when none is, the next waiting. When it's done, **See N changes** (or **Review N held changes**) opens Changes, and "left out by the checks" lists what was dropped and why. The last step says how many changes were made and how many are held.

## Preview a source
Open a source to read it. A PDF has a bar with page n of N, previous and next, zoom from 50% to 300% (click the percentage to fit the width again) and **Find in this file**, which lists the pages that match; `↩` goes to the next match's page and `⇧↩` the one before. Word, PowerPoint and Excel files show the text Brainstead reads from them, which search, ingest and quotes use: a document as its paragraphs, a deck slide by slide, a workbook as tables, one per sheet. To see one as it looks in its app, press **Quick Look** or `Space`, which opens it in the macOS Quick Look panel, as Finder does. An image shows with **Text in the image** folded under it: click it to see the text Brainstead read from the image, which search and ingest use. **Open in its app** opens it in the app macOS uses for it. A file Brainstead can't show has both buttons.

When you ingest an image, Claude Code and Codex see the picture as well as its text; Copilot and Antigravity get the text only, so an image with no text needs Claude Code or Codex. A change from an image is flagged in [Changes](app:review), to check against the picture.

## See where a source is used
Beside the preview, the provenance card, **Cited by N pages**, says when the source was last ingested and by which model, and lists the wiki pages that cite it and the passages they cite. **Details** folds away the passages indexed and the file's hash. **Re-ingest** and **Reveal** (in Finder) are at the foot, with **Move to the Trash** apart at the right. An assistant can read the same card for a source.

A source's top bar has **Ask**, which starts a chat about it. A captured thread has **Draft a reply** in its top bar, and other documents have **Doc check**. On the Sources list, **Meeting notes** opens [Meeting note from a transcript](app:meeting).
