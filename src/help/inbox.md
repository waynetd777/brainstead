---
title: Inbox
kind: screen
screens: [inbox]
order: 2
summary: Clarify what you've captured: decide what each item is, and Brainstead writes it where it belongs.
---
The Inbox is the clarify step of GTD. It lists everything captured but not yet decided, and for each item you choose what it becomes. Nothing changes until you choose, and ⌘Z undoes each choice.

## What lands in the Inbox
The list has a band per source, in this order:

- **Captures**: emails and Teams chats or transcripts captured from the browser with the capture extensions. They stay until you clarify them here.
- **Scratchpad**: each thought captured to the Scratchpad (a `## 2026-10-03 09:15` block). It leaves when you clarify it, and its block is removed.
- **To Do list › Other**: tasks under `#### Other` on the To Do list, where Quick capture puts them. A task leaves the Inbox once it has a project, a context or one of `#waiting-for`, `#someday-maybe` or `#followup`, or its box isn't empty any more (done, cancelled or in progress). Until then it stays off Next actions in [Tasks](app:tasks).

The sidebar shows how many items are waiting.

## Clarify an item
Click an item, or move with `J` and `K` (or `↑` and `↓`), to open it on the right. Then choose with a button or its key:

- `N` **Next action**: opens a form for the text, project, context, effort and due date. A next action needs a project or a context, so it lands on a list: on the To Do list with neither, it would be back in the Inbox. Until it has one, the form says so and **Save** stays off.
- `P` **New project**: opens New project with the item as its name.
- `W` **Waiting for**: the same form; the task gets `#waiting-for`.
- `2` **Done now (under 2 min)**: you did it now; a task is ticked (a recurring one gets its next occurrence, as everywhere else), a thought removed, a capture taken out of the Inbox.
- `S` **Someday / maybe**: becomes a task tagged `#someday-maybe`.
- `R` **File as reference**: adds the text as a bullet at the end of a note you find, or makes a new note.
- `⌫` **Delete**.

After each choice the next item opens, and a toast offers Undo.

## Where clarified items go
A next action or waiting-for with a project is written under that project note's `## Next actions` or `## Waiting for` heading, with a link to the project. Without a project it goes on the To Do list. The form shows the line before you save.

A task under Other that you clarify in place keeps its line, rewritten with what you chose, so it simply drops out of the Inbox.

## Clarify captured emails and chats
On a capture from Outlook or Teams, `R` and `⌫` change and three more choices appear; **Open the capture** shows the whole file:

- `I` **Ingest into the wiki**: the AI reads it into the wiki; its changes are listed in [Changes](app:review).
- `M` **Make a meeting note**, for a Teams meeting transcript: written, ingested and the transcript trashed in one step when Brainstead is sure of the note, or [Meeting note from a transcript](app:meeting) opens to ask.
- `D` **Draft a reply**, for an email thread or chat; opens [Draft reply](app:reply).
- `R` **Keep in Sources** takes it out of the Inbox and leaves the file in [Sources](app:sources).
- `⌫` **Move to the Trash** moves the file to the vault's Trash.

As a task, a capture starts as `Follow up on [[the capture]]`.

## Let the AI suggest
**Suggest** on an open item asks the AI what it should become, with a project, context, effort, due date and why. **Suggest for all** in the top bar asks about the first 20 items at once (it reads **Suggest for all (first 20)** when there are more). Nothing happens until you accept; the row says what it suggests. Press `↩` or **Accept suggestion** to do it, which opens the form first for a next action or waiting-for. The model used is set in [Settings › AI assistants](app:settings/assistants), under Models by job. An assistant can ask for the same suggestions, and accepts one only by clarifying the item as it says. As the form, it makes a next action only with a project or a context, and only in an active project.

When the [Weekly review](app:weekly) has been prepared for this week, its suggestions for Inbox items show on those items here too, until you click **Suggest** on one again.
