# Ask and assistants

Ask chats with the AI assistants already on your Mac, Claude Code, Codex, Copilot and Antigravity, signed in with your own accounts, inside your vault.

[Ask](#ask) · [What an assistant can do](#what-an-assistant-can-do) · [Sessions outside the app](#sessions-outside-the-app) · [Questions about Brainstead](#questions-about-brainstead)

## Ask

<a href="images/index.md#ask-and-assistants"><picture><source media="(prefers-color-scheme: dark)" srcset="images/ask-dark.png"><img alt="Ask: a chat in a tab, the assistant's answer with links to notes, and the actions under it" src="images/ask-light.png"></picture></a>

Most screens have an **Ask** button beside `?` that starts a chat about what you're looking at: the selected task, project, Inbox item, change or page, or else the screen itself (its tooltip says which), with the question begun for you to finish.

Ask (⌥⌘7) keeps each chat in a tab (⌘T for a new one). A chat stays in Brainstead's app data until you click **Save**, which puts it in the vault as `Chat. <title>.md` and keeps that note up to date from then on; background runs' chats stay out of the vault the same way. **History** finds, renames, pins, saves or deletes old ones; closed chats that aren't saved or pinned are deleted once 20 newer ones are in History. Pick the assistant and model before the first message. New chats start with the model set in Settings › AI assistants, where each background job can have its own model too.

- An empty chat offers example questions and Brainstead's skills to click, or says **No assistant found** and what to install.
- Keys: ↩ sends, ⇧↩ adds a line, ↑ and ↓ recall earlier messages, and Esc (or **Stop**) stops an answer.
- Messages sent while it answers queue up (a cross takes one out). A dot on a tab marks an answer you haven't seen (the sidebar's Ask badge counts them across the open tabs), and with Claude Code a meter shows how full the chat's context is.
- `/` lists workflows: Brainstead's `/wiki` answers from the vault with citations, with any assistant. The vault's own Claude Code skills are listed too.
- `[[` links a note and `#` a tag.
- After each answer the box offers a next message in grey; → types it in. Settings › AI assistants turns it off and picks its model.
- Under an answer: **Copy**, **File this answer** (as a new wiki page), **Add tasks**, **Update the wiki**, **Save as note** and **Ask another model**.

## What an assistant can do

The assistant never edits a file itself. Claude Code, Codex and Copilot get Brainstead's tools, which ask the app to do what its screens do. So ⌘Z, `log.md` and the rest work just as if you'd done it yourself.

**At once, undoable with ⌘Z** (the app says an assistant made the change):

- The Weekly review's prepared suggestions: accept or skip one (a suggested link is made as a change in Changes instead). Save an open Ask chat to the vault, as Save does. Bookmarks, saved searches, restoring from the Trash, Knowledge health's safe fixes and [Fix name](wiki.md#meeting-notes-and-the-other-tools).

**At once, with no ⌘Z** (only when you ask, and never in a session nobody is watching for the first two):

- The Weekly review's **Start over** (`weekly_start_over`): its progress, notes and handled suggestions are dropped; what it changed in the vault stays.
- Moving over's **Retire them** (`moving_over`): the previous app's skills and scripts go to the Trash, to restore from there.
- How long Changes keeps its history (`changes` with `history`), a setting you change back in Settings › AI assistants.
- Find tasks and projects' suggestions (`suggestions`): accepting one makes it as a change in Changes, with Revert.
- Runs: an ingest (images too), the daily or weekly summary, the weekly review's preparation, the nightly check, a contradictions check, a meeting note from a transcript, with their progress and Stop. What a run changes in the vault is listed in Changes, with Revert. Bookmark triage, a drafted reply and a doc check, as their screens do.

**Made at once, listed in Changes with Revert**: tasks (tick, untick, dates, priority, contexts, effort, project, waiting for, cancel, reorder, add, delete), clarifying an Inbox item (its edits to two notes made or held together), projects (create, status, area, outcome), a change to any page (`edit_page`), a new note (named `Type. Title - date`, or made from one of your templates), a new wiki page, a rename, a move to the Trash. A quote not found in its source is flagged, once. A change to a template, one that adds code that runs, one that changes a [system note's header](notes.md#system-notes), and a rename or trash of a template (or a rename whose link rewrites touch one) is held for you. A session nobody is watching passes `unattended`, and its changes that fail a check are held too, as are those of the runs it starts. An assistant can list changes (`changes`), reject a held one and revert one when you ask it to; it accepts a held change only in a session you're in, and only one held for a failed check (decided 2026-10-05, D-20261005-09).

**What it can read**: search, any page or section, backlinks, which page a name means, your tasks by list, the Inbox, projects, the daily and weekly summaries, the Weekly review's progress and suggestions, Changes, runs, transcripts, the Trash, Activity, the links around a page, sources not yet in the wiki, Knowledge health's report, whether the app is running, and the in-app help.

Nothing changes while the vault is read-only. Antigravity takes no outside tools in the mode Ask runs it, so it reads with its own tools only.

## Sessions outside the app

<a href="images/index.md#ask-and-assistants"><picture><source media="(prefers-color-scheme: dark)" srcset="images/settings-assistants-dark.png"><img alt="Settings › AI assistants: the assistants found, the model for new chats and for each job, and the command that adds Brainstead's tools to Claude Code" src="images/settings-assistants-light.png"></picture></a>

The same tools work from an assistant in Terminal, in every folder. Settings › AI assistants shows each assistant's command to copy; run it once:

```sh
claude mcp add -s user brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp   # Claude Code
codex mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp            # Codex
copilot mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp          # GitHub Copilot
agy mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp              # Antigravity
```

Searching and reading the vault, the health report and help work with Brainstead closed. Everything else needs the app, and opens it.

## Questions about Brainstead

Ask how to do something in Brainstead ("how do I change the capture shortcut?") and the assistant answers from the app's own help, naming where things are, rather than from your vault. The help is the same as the `?` drawer on every screen.
