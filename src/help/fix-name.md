---
title: Fix a name everywhere
kind: screen
screens: []
order: 25
summary: Correct a name that was spelt wrong across all your notes at once, and stop it coming back.
---
When a transcript or a notetaker gets a name wrong, such as "Lina" for Lena, Fix a name everywhere corrects it in every note in one go. Open it from **Fix a name everywhere…** in ⌘K.

## Type the two names
Type the name as it was written in **Written as** and the right one in **Correct spelling**. Brainstead lists every file with the wrong name, showing the lines it's on with the wrong spelling struck out and the right one beside it. If the correct name only adds a surname ("Sam" to "Sam Carter"), a surname already there isn't doubled.

## See what happens to each file
Each file is marked with what the fix will do:

- **Rewrite**: a note, corrected in place. Its modification time is kept.
- **Add as alias**: the right person's wiki page gets the wrong spelling as an alias, so links and searches still find it.
- **Left alone**: sources and templates. Sources are the raw record and aren't changed here.
- **Guarded: someone else**: a file about someone whose real name is the "wrong" spelling.
- **Skipped**: a conflicted copy of this file exists.

A file whose name holds the wrong spelling is marked **In the file name: rename it separately**. Untick any file you want left as it is. An assistant fixing a name for you sees the same list, each file with what will happen to it and how many will change, and can do the same: it names the files to change, and the rest are left alone.

## Protect someone with that name
If the wrong spelling is also someone else's real name, type part of the file names about them, such as "Lina Park", in the box below the names, with commas between several. Those files are never touched. **Ask about each file** starts every note to rewrite unticked, so you tick each one after reading it, and an ingest never applies an ambiguous correction on its own.

## Apply it
Leave **Remember this correction** on to add it to Brainstead's list of name corrections (kept in its app data folder, not the vault), so future captures, transcripts and ingests spell it right. The **Where it's from** box records where you learnt it. Click **Apply**. The notes, the alias and the remembered correction are one change: `⌘Z` undoes it all.

An assistant fixing a name takes the same choices: the files to leave alone, Remember this correction (on unless you say otherwise) and where it's from.
