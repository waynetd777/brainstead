---
title: Build the wiki
kind: guide
screens: []
order: 3
summary: Add a source, ingest it, check what the AI changed and see the wiki page it builds.
---
Turn your sources into wiki pages that cite them. An ingest makes its changes at once and lists each in Changes, where you can revert it.

## Add a source
Open [Sources](app:sources) and drag a PDF, Word file, image or note onto it, or click **Import**. Emails and Teams chats from the browser extensions land here too (set them up in [Settings › Capture extensions](app:settings/capture)). A new source is marked **New**.

## Ingest your first source
On [Sources](app:sources), click **Ingest** on the source's row. The **Ingest runs** pane shows each step, ending with every quote checked against the source. A change is dropped only when none of its quotes is found; one with some missing is kept and flagged. A change from an image is never dropped for a missing quote, only flagged.

## Check what it changed
The ingest makes its changes at once. Open [Changes](app:review) to read each diff and the quotes it rests on; flagged ones have a quote not found or rest on text read from an image. **Revert** undoes any you don't want, even after later edits.

## Read the page it built
Open the [Wiki](app:wiki) and the page that changed. The small numbers are citations: click one to open the source at that passage. The **Sources** card lists what the page rests on, and **Refresh from sources** ingests them again when they change.

## Ask the wiki a question
In [Ask](app:ask), start a message with `/wiki` and your question, such as "/wiki when does Orbit App launch?". The assistant answers from the wiki and your sources, citing the passages. **File this answer** under a long answer makes it a new wiki page.
