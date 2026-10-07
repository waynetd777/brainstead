---
title: Inbox
kind: screen
screens: [inbox]
order: 2
summary: Clarify what you've captured: decide what each item is, and Brainstead writes it where it belongs.
---
The Inbox is GTD's clarify step: everything captured but not yet decided. For each item you choose what it becomes. Nothing changes until you choose, and ⌘Z undoes each choice.

## What lands in the Inbox
There's a band per source:

- **Captures**: emails, Teams chats and transcripts from the browser capture extensions. They stay until you clarify them.
- **Scratchpad**: each thought in the Scratchpad (a `## 2026-10-03 09:15` block). Clarifying it removes the block.
- **To Do list › Other**: tasks under `#### Other` on the To Do list, where Quick capture puts them. A task leaves once it has a project, a context, `#waiting-for`, `#someday-maybe` or `#followup`, or its box isn't empty (done, cancelled or in progress). Until then it stays off Next actions in [Tasks](app:tasks).

The sidebar shows how many items are waiting.

## Clarify an item
Click an item, or move with `J` and `K` (or `↑` and `↓`), to open it. Then choose with a button or its key:

- `N` **Next action**: a form for the text, project, context, effort and due date. It needs a project or a context, or it would land back in the Inbox; until then **Save** stays off.
- `P` **New project**: opens New project with the item as its name.
- `W` **Waiting for**: the same form; the task gets `#waiting-for`.
- `2` **Done now (under 2 min)**: a task is ticked (a recurring one gets its next occurrence), a thought removed, a capture taken out of the Inbox.
- `S` **Someday / maybe**: becomes a task tagged `#someday-maybe`.
- `R` **File as reference**: adds the text as a bullet at the end of a note, or makes a new note.
- `⌫` **Delete**.

After each choice the next item opens, and a toast offers Undo.

## Where clarified items go
A next action or waiting-for with a project goes under the project note's `## Next actions` or `## Waiting for` heading, with a link to the project. Without a project it goes on the To Do list. The form shows the line before you save.

A task under Other keeps its line, rewritten with what you chose, and drops out of the Inbox.

## Clarify captured emails and chats
On a capture from Outlook or Teams, `R` and `⌫` change and three more choices appear. **Open the capture** shows the whole file.

- `I` **Ingest into the wiki**, with its changes listed in [Changes](app:review).
- `M` **Make a meeting note**, for a Teams transcript. When Brainstead is sure of the note, it writes and ingests it and trashes the transcript in one step; otherwise [Meeting note from a transcript](app:meeting) opens to ask.
- `D` **Draft a reply**, for an email thread or chat; opens [Draft reply](app:reply).
- `R` **Keep in Sources** takes it out of the Inbox and leaves the file in [Sources](app:sources).
- `⌫` **Move to the Trash** moves the file to the vault's Trash.

As a task, a capture starts as `Follow up on [[the capture]]`.

## Let the AI suggest
**Suggest** on an open item asks the AI what it should become, with a project, context, effort, due date and why. **Suggest for all** asks about the first 20 items at once. Nothing happens until you accept: press `↩` or **Accept suggestion** (a next action or waiting-for opens the form first). The model is set under Models by job in [Settings › AI assistants](app:settings/assistants).

An assistant can ask for the same suggestions and accept one by clarifying the item. Like the form, it makes a next action only with a project or a context, and only in an active project.

When this week's [Weekly review](app:weekly) is prepared, its Inbox suggestions show here too, until you click **Suggest** again.
