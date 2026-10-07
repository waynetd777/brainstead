---
title: Settings › Vault
kind: screen
screens: [settings/vault]
order: 32
summary: Which folder is your vault, whether Brainstead may change it, and which folders it skips.
---
The vault is the folder of markdown notes Brainstead reads. Brainstead keeps its index in its own database, outside the folder.

## Choose the vault folder
Under **Vault folder**, click **Choose…** and pick the folder. Every `.md` and `.txt` file in it is indexed, except in system and excluded folders. **Show in Finder** opens it.

The card below says how many files are indexed, with counts of notes, wiki pages, sources, templates, open tasks and unresolved links, and when the index was last updated. **Rebuild index** reads every file again and rebuilds the index from scratch; the files aren't changed. An assistant sees the same counts, or why the index failed.

## Make the vault editable
A folder you choose opens with **Read-only** on: Brainstead never changes anything in it. A new vault made on the first screen opens with it off. Turn **Read-only** off to tick tasks, set their dates, capture, save chats and let the daily and weekly summaries write. While it's on, captures from the browser extensions are refused, a saved Ask chat's new turns wait in the app data folder until it's off, and a **Read-only** pill shows in the sidebar's status line and the menu-bar window; click it to come here.

Even with read-only off, Brainstead only saves a file if it hasn't changed since Brainstead read it. Every AI change is listed in [Changes](app:review), where you can revert it.

## Skip folders you don't want indexed
Under **Excluded folders**, type a folder name and press `↩` or click **Add**. Any folder with that name, at any depth, is skipped. Use a name, not a path. Click the cross on a name to stop excluding it; its files are indexed again. System folders can't be excluded.

## Add the example notes
**Add the example notes** adds the notes a new vault is made with, such as **Start here**, a project, a meeting note, two wiki pages and the example templates, each saying it's an example you can delete. Only the ones that aren't in the vault are added; nothing already there is changed. Read-only has to be off. An assistant can add them when you ask: each note is listed in [Changes](app:review) with Revert, and the example templates wait there for you to accept, as every change to a template does.

## Know the system folders
Brainstead treats these folders specially:

- `sources/`: imported files and captured emails and transcripts.
- `wiki/`: entities, concepts and source summaries.
- `Templates/`: note templates, in Templater syntax.
- `images/`: pasted and dropped images. Not indexed.
- `.trash/` and hidden folders: deleted items and other apps' settings. Not indexed.
