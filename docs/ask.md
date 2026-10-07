# Ask and assistants

Ask chats with the AI assistants already on your Mac, Claude Code, Codex, Copilot and Antigravity, signed in with your own accounts, inside your vault.

[Ask](#ask) · [What an assistant can do](#what-an-assistant-can-do) · [Sessions outside the app](#sessions-outside-the-app) · [Questions about Brainstead](#questions-about-brainstead)

## Ask

<a href="images/index.md#ask-and-assistants"><picture><source media="(prefers-color-scheme: dark)" srcset="images/ask-dark.png"><img alt="Ask: a chat in a tab, the assistant's answer with links to notes, and the actions under it" src="images/ask-light.png"></picture></a>

Most screens have an **Ask** button beside `?` that starts a chat about what you're looking at: the selected task, project, Inbox item, change or page, or else the screen itself (its tooltip says which), with the question begun for you to finish.

Ask (⌥⌘7) keeps each chat in a tab (⌘T for a new one). A chat stays in Brainstead's app data until you click **Save**, which puts it in the vault as `Chat. <title>.md` and keeps that note up to date from then on; background runs' chats stay out of the vault the same way. **History** finds, renames, pins, saves or moves old ones to the Trash; closed chats that aren't saved or pinned are deleted once 20 newer ones are in History. Pick the assistant and model before the first message. New chats start with the model set in Settings › AI assistants, where each background job can have its own model too.

- An empty chat offers example questions and Brainstead's skills to click, or says **No assistant found** and what to install.
- Keys: ↩ sends, ⇧↩ adds a line, ↑ and ↓ recall earlier messages, and Esc (or **Stop**) stops an answer.
- Messages sent while it answers queue up (a cross takes one out). A dot on a tab marks an answer you haven't seen (the sidebar's Ask badge counts them across the open tabs), and with Claude Code a meter shows how full the chat's context is.
- `/` lists workflows: Brainstead's `/wiki` answers from the vault with citations, with any assistant. The vault's own Claude Code skills are listed too.
- `[[` links a note and `#` a tag.
- After each answer the box offers a next message in grey; → types it in. **Suggest a next message**, under **New chats use** in Settings › AI assistants, turns it off, and **Models by job** picks its model.
- Under an answer: **Copy**, **File this answer** (as a new wiki page), **Add tasks**, **Update the wiki**, **Save as note** and **Ask another model**.

## What an assistant can do

The assistant never edits a file itself. Claude Code, Codex and Copilot get Brainstead's tools, which ask the app to do what its screens do. So ⌘Z, `log.md` and the rest work just as if you'd done it yourself.

**At once, undoable with ⌘Z** (the app says an assistant made the change):

- The Weekly review's prepared suggestions: accept or skip one (a suggested link is made as a change in Changes instead). Save an open Ask chat to the vault, as Save does. The Weekly review's Finish and save. Bookmarks, saved searches, restoring from the Trash (under another path too), adding files to Sources (`import_sources`), Knowledge health's safe fixes and the buttons an issue has of its own (`health_issue`: Create, Not duplicates, an unused image to the Trash), and [Fix name](wiki.md#meeting-notes-and-the-other-tools) (in every file it would change, or only those given, as ticking them does).

**At once, with no ⌘Z** (only when you ask, and never in a session nobody is watching for the first two):

- The Weekly review's **Start over** (`weekly_start_over`): its progress, notes and handled suggestions are dropped; what it changed in the vault stays.
- Moving over's **Retire them** (`moving_over`): the previous app's skills and scripts go to the Trash, to restore from there.
- How long Changes keeps its history (`changes` with `history`), a setting you change back in Settings › AI assistants.
- Settings › Vault's **Rebuild index** (`rebuild_index`): every file is read again; the files aren't changed.
- Your tools that start Claude Code sessions (`automated_tools`), listed in Settings › Jobs & schedule.
- Knowledge health's Ignore and Show again (`ignore_issue`), for issues with no fix.
- Find tasks and projects' suggestions (`suggestions`): accepting one makes it as a change in Changes, with Revert.
- Going through the Weekly review (`weekly_step`: start, next step, notes), marking a contradiction resolved or ignored (`contradictions`), Ask's chats (`chats`: rename, pin or unpin, move to the Trash), Tasks' saved lists (`task_lists`) and settings (`settings`, all but the vault, Read-only and the folders left out: Open at login, the models for new chats and for each job, the spelling language, the read-aloud voice and speed, the document look and whether documents are light or dark among them; a note's own look stays in the note).
- Runs: an ingest (images too), the daily or weekly summary, the weekly review's preparation, the daily check, Find tasks and projects, a contradictions check, a meeting note from a transcript, Knowledge health's Write Current state (`write_current_state`), with their progress and Stop. What a run changes in the vault is listed in Changes, with Revert: `run_status` lists the last eight summary runs as Settings › Jobs & schedule does, each with the id of its change, so `changes revert` undoes one as Recent runs' **Undo** does. Bookmark triage, a drafted reply and a doc check, as their screens do.

**Made at once, listed in Changes with Revert**: tasks (tick, untick, dates, priority, contexts, effort, project, waiting for, cancel, reorder, add, delete), clarifying an Inbox item (its edits to two notes made or held together), projects (create; status, area and Done looks like, in the screen's names: a Completed project is `completed`, written `status: done` in its note), a change to any page (`edit_page`), a new note (named `Type. Title - date`, or made from one of your templates), a new wiki page, a rename, a move to the Trash, Knowledge health's Reshape pages (`reshape_pages`, one run to revert together) and Link to… (`health_issue`), a saved Contradictions report, a new template (`create_template`, always held). A quote not found in its source is flagged, once. A change to a template, one that adds code that runs, one that changes a [system note's header](notes.md#system-notes), and a rename or trash of a template (or a rename whose link rewrites touch one) is held for you. A session nobody is watching passes `unattended`, and its changes that fail a check are held too, as are those of the runs it starts. An assistant can list changes (`list_changes`), and reject a held one or revert one (`changes`) when you ask it to; it accepts a held change only in a session you're in, and only one held for a failed check (decided 2026-10-05, D-20261005-09).

**What it can read**: search, any page or section, backlinks, which page a name means, the facts ingest kept for each wiki page (`facts`), your tasks by list (with the Tasks screen's effort filter and Group by: `list_tasks` with `effort` and `group`), the Inbox (with `suggest`, the model's suggestion for each of the first 20 items, as **Suggest** gives it; accepting one is `clarify_inbox` with its values), projects, the daily and weekly summaries, the Weekly review's progress and suggestions, Changes, runs, transcripts, the Trash, Activity (by action and words, as its chips and search filter it), the links around a page, sources not yet in the wiki, Knowledge health's report (`lint`, as the screen shows it while the app is open) and its Page shape check (`page_shape`), the contradictions found, Ask's chats, the settings, whether the app is running, and the in-app help.

Each read is a tool of its own, marked read-only, beside the tool that changes the same thing: `list_changes`, `list_chats`, `list_trash` (and `restore_from_trash`), `list_bookmarks`, `list_saved_searches`, `list_contradictions`, `list_suggestions`, `list_automated_tools`, `list_task_lists` and `list_settings`. So an assistant can be let read without asking you. `list_bookmarks` also says which bookmarks Triage would flag (untouched for two weeks), so bookmark triage (`triage_bookmarks`) is only the model's suggestions on the ones given.

Every tool that lists something, tasks included, says how many there are and gives a page at a time (`limit`, `offset`, and `query` to keep rows with all those words). Changes is one list, the held changes first and then those made, newest first, paged as a whole. The main lists also give their rows as data the assistant can read field by field, and `search`, `list_projects`, `list_changes`, `activity` and `graph` give a short line a row unless the assistant asks for `detail`. A call with arguments a tool can't take is answered with what's wrong, so the assistant can try again. Nothing changes while the vault is read-only. Antigravity takes no outside tools in the mode Ask runs it, so it reads with its own tools only.

## Sessions outside the app

<a href="images/index.md#ask-and-assistants"><picture><source media="(prefers-color-scheme: dark)" srcset="images/settings-assistants-dark.png"><img alt="Settings › AI assistants: the assistants found, the model for new chats and for each job, and the command that adds Brainstead's tools to Claude Code" src="images/settings-assistants-light.png"></picture></a>

The same tools work from an assistant in Terminal, in every folder. Settings › AI assistants shows each assistant's command to copy; run it once:

```sh
claude mcp add -s user brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp   # Claude Code
codex mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp            # Codex
copilot mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp          # GitHub Copilot
agy mcp add brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp              # Antigravity
```

Searching and reading the vault, facts, the summaries, the health report, the Page shape check and help work with Brainstead closed. Everything else needs the app, and opens it. `open` brings the window to the front on a screen (by its sidebar name), a Settings pane, a note (with lines highlighted, when given), a search, or Meeting note from a transcript, Draft a reply or Check a document on the transcript, thread or document to work on.

What you're typing and haven't saved (a note's unsaved edits, a draft in a box) stays with the screen: no tool reads or changes it.

## Questions about Brainstead

Ask how to do something in Brainstead ("how do I change the capture shortcut?") and the assistant answers from the app's own help, naming where things are, rather than from your vault. The help is the same as the `?` drawer on every screen.
