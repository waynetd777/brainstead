---
title: Meeting note from a transcript
kind: screen
screens: [meeting]
order: 21
summary: Turn a Teams meeting transcript in your sources into a meeting or 1-1 note.
---
The AI writes a meeting or 1-1 note from a Teams transcript in `sources/`, using your meeting template. Open this screen from **Meeting notes** on [Sources](app:sources) or from ⌘K.

**Make a meeting note** does it all in one step when Brainstead is sure of the note's type, name and date and no note of that name exists yet: it writes the note, ingests it and moves the transcript to the Trash. Otherwise it opens this screen at the question. Start it from:

- **Meeting note** on the transcript's row in [Sources](app:sources);
- **Make a meeting note** on the transcript's right-click menu;
- `M` on a transcript capture in the [Inbox](app:inbox).

## Pick a transcript
The list shows the transcripts still to do: those no wiki page cites and no note links. **Show** › **All** shows the rest too, marked "ingested" or "linked from a note". "note exists" means a note of that name is already in the vault, perhaps still empty. Select a transcript to read it in the middle.

Transcripts come from the Teams extension, or a file dropped onto Sources.

## Check the note's details
Brainstead works out the note's **Type** (Meeting, 1-1, Workshop or Interview), its **Date** and, for a 1-1, who it was **With**, from the transcript's file name. "check" in the list means it isn't sure. Your own name, set in [Settings › General](app:settings/general), helps it tell a 1-1 from a meeting.

The date is the meeting's day when the Teams extension found it. When it only has the day the transcript was captured, the list says "check the date" and the note waits: click **Confirm** beside the date, or type the right one.

Change any of them in **The note** card. The file name it will get, such as `1-1. Maya - 2026-10-01.md`, shows below.

## Draft the note
Click **Draft the note**. The AI fills in the note from `Templates/<Type>.md`, with names spelt as your vault spells them. 

To do several at once:

1. Tick them (**Tick all** ticks every one the list shows) and click **Draft all N**.
2. A dialog lists their dates and marks those that are only the capture day. Fix any that's wrong.
3. Click **Draft all N** there. That confirms every date, so there's no need to **Confirm** each one.

When the note exists already, **Draft the note** is off and **Draft all** leaves that transcript out. Open the note to fill it in, or change the name or date to make a new one.

## After the note
The note is made in the vault, listed in [Changes](app:review) with Revert. Brainstead then ingests it into the wiki and, once that's done, moves the transcript to the Trash. A transcript whose note or ingest failed stays where it is.

Turn either step off in [Settings › AI assistants](app:settings/assistants), under Meeting notes. With both off, Brainstead asks after each note: tick what you want and click **Go**, or **Neither**.

A note held in Changes isn't in the vault yet, so the offer comes when you (or an assistant) accept it there. A note is held when a scheduled run's note failed a check, or when it adds code that runs, such as a `dataviewjs` block.

An assistant can list the transcripts as **Show** does and draft a note of any of the four types when you ask. Like **Draft the note**, it needs a name and a date (the transcript's topic and today's date don't count), and won't draft a note that exists already or is being drafted. A note drafted by an assistant nobody is watching is ingested the same way, with changes that fail a check held for you.
