---
title: Build the wiki
kind: guide
screens: []
order: 3
summary: Add a source, ingest it, check what the AI changed and see the wiki page it builds.
---
Turn your sources into wiki pages that cite them. An ingest makes its changes at once and lists each in Changes, where you can revert it.

## Add a source
Open [Sources](app:sources) and drag a PDF, Word file, image or note onto it, or click **Import**. Emails and Teams chats captured with the browser extensions land here too; set those up in [Settings › Capture extensions](app:settings/capture). A new source is marked **New**.

## Ingest your first source
On [Sources](app:sources), click **Ingest** on the source's row. The **Ingest runs** pane shows each step: reading the source, correcting names, finding the pages it mentions, drafting changes and checking every quote against the source. A change is dropped only when none of its quotes is found. One with some quotes missing is kept and flagged. A change from an image is never dropped for a missing quote, as the AI may read what the computer's text recognition missed; it's kept and flagged.

## Check what it changed
The ingest makes its changes at once. Open [Changes](app:review) to read each one's diff and the quotes it rests on; a change with a quote that wasn't found, or that rests on text read from an image, is flagged. **Revert** undoes any you don't want, even after later edits.

## Read the page it built
Open the [Wiki](app:wiki) and the page that changed. The small numbers in its text are citations: click one to open the source at the passage. The **Sources** card lists what the page rests on, and **Refresh from sources** ingests them again when they change.

## Ask the wiki a question
In [Ask](app:ask), start a message with `/wiki` and your question, such as "/wiki when does Orbit App launch?". The assistant answers from the wiki and your sources, citing the passages. **File this answer** under a long answer makes it a new wiki page.
