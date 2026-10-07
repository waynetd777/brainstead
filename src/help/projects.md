---
title: Projects
kind: screen
screens: [projects]
order: 4
summary: Every project note by status and area, with its next actions, waiting-fors and a flag when one is stuck.
---
A project is a note named `Project. <name>.md`. Its properties hold its status, area and outcome, and its tasks are those written in it plus any task elsewhere that links it. The area also decides where the daily and weekly summaries put the project's work: area Personal under **Personal**, any other area under **Work done**, done projects included.

## Find a project
**Active**, **On hold**, **Someday** and **Completed** in the top bar switch between projects by status, each with its count, even 0. The table groups projects by area (projects with no area last) and shows for each: **Next** (open next actions), **Waiting**, and **Last change** (when its note or any of its tasks last changed). With no active projects, the tab says a project is a note named “Project. …”.

An active project is flagged **Stuck** (red) when it has no next action, and **Quiet** (amber) when nothing has changed for two weeks; an assistant listing your projects sees the same flags. The sidebar shows how many projects are active, and shows the count in a blue badge when any has no next action.

## Work on a project
Click a project to open it on the right. **Done looks like** (the outcome) and **Area** are edited in place: click, type and press `↩`.

**Next actions** lists its open tasks, without the project's own chip. Tick them, drag them into order (an assistant can move one in this order too), use each task's ⋯ menu, or use the task-list keys. Type in **Add a next action** and press `↩` to add one under the note's `## Next actions` heading; `@calls`, `effort:15m` and `due:fri` work there as in capture. **Waiting for** and **Someday / maybe** list those tasks when there are any, and each waiting-for has **Draft nudge**, which asks [Ask](app:ask) for a follow-up to copy into Outlook or Teams.

The side shows the project note, notes that link it, wiki pages it links, recent activity and what's done; a cancelled task there is struck through and marked Cancelled.

## Change its status
The buttons under the tasks change the note's status property and nothing else:

- **Mark complete** moves it to Completed (an assistant's change says Mark complete too).
- **Put on hold** moves an active project to On hold.
- **Someday** parks it on Someday.
- **Make active** brings it back to Active.

**Ask about this project** opens [Ask](app:ask) with the project note attached. **Move to the Trash** says how many tasks are in the note and how many tasks in other notes link it, then moves the note to the [Trash](app:trash). **Undo** in the toast, or restoring it from the Trash, brings it back; until then, tasks elsewhere keep a link to a missing note.

## Find projects in your notes
At the top of the **Active** projects, **Find tasks and projects** has an assistant read your notes from the last 90 days and suggest pieces of work they keep coming back to that aren't projects yet: a name, what done looks like, the notes it rests on and up to three first next actions. Suggested tasks show at the top of [Tasks](app:tasks). **Accept** makes the project note with its first actions (revertable in [Changes](app:review)), **Edit** changes its name or outcome first (a name can't have `/ \ : * ? " < > | [ ] # ^` in it or start with a dot, as it's the note's file name), and **Skip** leaves it out for good.

## Start a new project
**New project** in the top bar asks for a **Name**, what **Done looks like** and an **Area** (areas already in use are offered). **Make project** writes `Project. <name>.md` with the properties and `## Next actions`, `## Waiting for` and `## Notes` headings, and selects it here. ⌘Z undoes it.

You can also start one from ⌘K (New project), or from an item in the [Inbox](app:inbox) with `P`.

## Link tasks to a project
To link a task from anywhere, add the project's link to its line, as in `- [ ] Draft the launch post [[Project. Orbit App launch]]`, or use the Project row in its ⋯ menu or the Project field in the task pane on [Tasks](app:tasks). Task rows show the project as a chip; click it to open the project here.
