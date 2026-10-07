---
title: Assistants and Brainstead's tools
kind: screen
screens: []
order: 38
summary: What AI assistants can do in Brainstead through its tools, in Ask and in sessions outside the app, and what waits for you.
---
Brainstead gives AI assistants a set of tools that do what its screens do, as an MCP server (the standard way to add tools to an assistant). Ask's Claude Code, Codex and Copilot chats get them, and so does Claude Code run outside the app once you add them (the command is in [Settings › AI assistants](app:settings/assistants)).

## What happens at once
These change things straight away, as the screens do, and each is undoable with `⌘Z`; a toast in the app says an assistant made it:

- The [Weekly review](app:weekly)'s prepared suggestions: accept one (it does what the suggestion's button does) or skip it.
- Save an open [Ask](app:ask) chat to the vault as a note, as **Save** does (move it to the Trash from History to take it out again).
- The Weekly review's **Finish and save**, which writes the week's review note.
- Bookmarks, saved searches, restoring from the Trash (under another name too), adding files to Sources, Knowledge health's safe fixes, **Create** on a missing page, **Not duplicates**, moving an unused image to the Trash, and Fix a name everywhere.

These happen at once with no `⌘Z`, and only when you ask:

- The Weekly review's **Start over**: the review's progress, notes and decisions go, and it starts again from step 1. What it changed in the vault stays.
- Moving over's **Retire them** ([Settings › General](app:settings/general)): the other app's skills and scripts go to the Trash, where you can restore them, and it says what it removed.
- How long [Changes](app:review) keeps its history (**Keep the history of agent changes**): read it, or set it.
- Your tools that start Claude Code sessions ([Settings › Jobs & schedule](app:settings/jobs)): list, add or remove one.
- Knowledge health's **Ignore** for an issue with no fix, and **Show again**.
- Going through the [Weekly review](app:weekly): start it, move on a step, add to its notes.
- [Contradictions](app:contradictions): mark one resolved or ignored.
- Ask's chats: list, read, rename or move one to the Trash.
- Tasks' saved lists: save one or remove one.
- Settings: read them, or change one, such as a job's time or a switch. The vault, **Read-only** and the folders left out are yours to change.
- Find tasks and projects' suggestions: accept one (it's made as a change in [Changes](app:review), with Revert) or skip it.
- Runs, with their progress and Stop: an ingest (notes, PDFs, Office files and images), the daily or weekly summary, the weekly review's preparation, the daily check, Find tasks and projects, a contradictions check, a meeting note from a transcript, Knowledge health's **Write Current state**, bookmark triage, a drafted reply (never sent) and a doc check. They use the models set in [Settings › AI assistants](app:settings/assistants). What a run changes in the vault is listed in Changes.

## Tasks, the Inbox, projects and prose
These are made at once too, and each is listed in [Changes](app:review), where you can revert it (and `⌘Z` undoes it straight after):

- Tasks: tick or untick (a recurring task gets its next one), due, defer, start and created dates, priority, contexts, effort, project, waiting for, cancel, reopen, in progress, moving one in a list's order, adding and deleting one. Several edits to one task at once are one change.
- The Inbox: clarify an item as a next action, waiting for, someday, a new project, done, reference, an ingest, or delete it. When clarifying changes two notes (a task out of the To Do list and into a project), both are made, or both held, together.
- Projects: create one, set its status, area or outcome.
- A change to any page, a new note, a new wiki page, a rename and a move to the Trash.
- Knowledge health's **Reshape pages**: each page is one change, in one run you can revert alone or all together. **Link to…** on a missing page: each page it relinks is a change.
- A new template (always held for you), and a saved Contradictions report.

A quote that isn't in its source is flagged there, once. A change to a template, one to a system note's header (the "This is a system note" callout), one that adds code that runs when a note is shown, and a rename or move to the Trash of a template (or a rename whose link updates change a template) are always held for you to accept. An assistant in a session nobody is watching, such as a loop, can say so: its changes that fail a check are then held for you instead of made, and so are the changes of the runs it starts. See [Changes](help:review) for the checks.

An assistant can list changes and revert one when you ask it to, and reject a held one. It can accept a held change only while you're there, and only one held because a check failed: one held because it changes a template or a system note's header, adds code that runs, or comes from a job you set to hold its changes is yours to accept, on the Changes screen. An assistant nobody is watching can't accept anything, and can't start the Weekly review over or retire the other app's skills and scripts.

## What assistants can read
Search, any page or one of its sections, backlinks, which page a name means, the facts ingest checked and kept for each wiki page, sources not yet in the wiki, Knowledge health's report (as the screen shows it, while Brainstead is open) and its Page shape check, the contradictions found, Ask's chats, your settings, your tasks by list (the Deferred list included), the Inbox, projects, the daily and weekly summaries (so it can answer "what did I do yesterday?"), the Weekly review's progress and suggestions, Changes, runs, transcripts, Activity, the links around a page, whether the app is running, and this help.

Reading is kept apart from changing: each of these is a tool of its own, marked as only reading, so you can let an assistant use them without asking you first.

## When Brainstead isn't open
Reading pages, search, facts, the summaries, the health report and the Page shape check work whether the app is open or not. Every change, and tasks, the Inbox, projects, the Weekly review, Changes, runs and Activity, need the app: the assistant opens Brainstead and waits for it. An assistant can also bring Brainstead's window to the front when you ask to see something, on a screen, a Settings pane, a note or a search. While the vault is read-only ([Settings › Vault](app:settings/vault)) nothing can be changed.

## Limits
An assistant can make up to 120 tool calls a minute. Long lists (the Trash, Changes, chats, links to a page and the rest) come a page at a time, each saying how many there are, so an assistant can ask for the next page or narrow the list by words. Search, projects, Changes, Activity and the links around a page give a short line each unless the assistant asks for more detail. Antigravity takes no outside tools in the mode Ask runs it, so it reads with its own tools only.
