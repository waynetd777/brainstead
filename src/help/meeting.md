---
title: Meeting note from a transcript
kind: screen
screens: [meeting]
order: 21
summary: Turn a Teams meeting transcript in your sources into a meeting or 1-1 note.
---
The AI writes a meeting or 1-1 note from a Teams transcript in `sources/`, using your meeting template, and Brainstead makes the note (listed in [Changes](app:review), where you can revert it). Open it from **Meeting notes** on [Sources](app:sources), from ⌘K, or with `M` on a transcript capture in the [Inbox](app:inbox).

## Pick a transcript
The list shows the transcripts still to do: those no wiki page cites and no note links. Switch **Show** to **All** to see the rest, marked "ingested" or "linked from a note". "note exists" means a note of that name is already in the vault, perhaps still empty. Select a transcript to read it in the middle.

Transcripts get there from the Teams extension, or from a file you drop onto Sources.

## Check the note's details
Brainstead works out the note's **Type** (Meeting, 1-1, Workshop or Interview) from the transcript's file name. It also works out the **Date** and, for a 1-1, who it was **With**. "check" in the list means it isn't sure. The date is the meeting's day when the Teams extension found it on the recap page (the transcript's **Meeting:** line). When it only has the day the transcript was captured, the list says "check the date" and the note waits: click **Confirm** beside the date, or type the right one. Change any of them in **The note** card; the file name it will get, such as `1-1. Maya - 2026-10-01.md`, shows below. Your own name, set in [Settings › General](app:settings/general), helps it tell a 1-1 from a meeting.

## Draft the note
Click **Draft the note**. The AI fills in the note from `Templates/<Type>.md`, with names spelt as your vault spells them. The run shows in the pane on the right. To do several at once, tick them and click **Draft all N**; they are drafted one after another. When the note exists already, **Draft the note** is off and **Draft all** leaves that transcript out: open the note to fill it in, or change the name or date for a new one.

## Accept it
The note is made in the vault, listed in [Changes](app:review) with Revert. Then Brainstead offers to ingest the note into the wiki and to move the transcript to the Trash: tick what you want and click **Go**, or **Neither**. When several notes are drafted, each gets its own offer, one after another. A note held in Changes (from a scheduled run whose note failed a check, or a note that adds code that runs, such as a `dataviewjs` block, whoever started it) isn't in the vault yet, so the offer comes when you accept it there.
