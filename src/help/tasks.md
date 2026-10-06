---
title: Tasks
kind: screen
screens: [tasks]
order: 3
summary: Every task in the vault, live from the notes it's written in, as GTD lists you can tick, date, filter and reorder.
---
A task is a `- [ ]` line in any note. Tasks lists them all, and every change you make here rewrites only that one line in its note.

## Choose a list
The lists on the left each show their count:

- **Next actions**: open tasks without `#followup`, `#waiting-for` or `#someday-maybe`. Deferred tasks stay off until their day, and tasks still waiting in the [Inbox](app:inbox) (under Other on the To Do list, with no project, context or GTD tag) until you clarify them. The sidebar count is this list.
- **Follow-ups**: tasks tagged `#followup`.
- **Waiting for**: tasks tagged `#waiting-for`.
- **Deferred**: tasks with a defer date, soonest first.
- **Someday / maybe**: tasks tagged `#someday-maybe`.
- **Done this week** and **Done last week**: ticked tasks by their done date, weeks starting on Monday.

The top bar says how many tasks the list holds. In Next actions, Follow-ups, Waiting for and Someday / maybe you can drag rows by their grip to set your own order, while the list isn't grouped. The order is saved in the note, as `^rank-1024` at the end of each line.

## Use the keys
`↑` and `↓` choose a task, going on into the next list past a list's end. `↩` puts the task's words in the pane to change, `Space` ticks or unticks it, `⌫` deletes it (`⌘Z` puts it back) and `/` goes to **Search tasks**. The same keys work on [Today](app:today), [Projects](app:projects) and the [Weekly review](app:weekly), where `↩` opens the task's note, but not in task blocks inside a note.

## Tick, defer and undo
Tick a task's box to mark it done; it gets a done date (`✅ 2026-10-03`). Untick it to take that away. ⌘Z undoes up to five task changes, even after a restart, as long as the line hasn't changed since.

Right-click a row, or click the ⋯ button at the end of every row, to open the task's menu. **Due** takes a quick choice (Today, Tomorrow, Mon, Next week) and **Defer until** another (Tomorrow, Mon, Next week, 2 weeks), or **Pick…** for a calendar, or **Clear**. A deferred task stays off Next actions until that day, then shows on [Today](app:today). **More dates…** shows the start and created dates (open already when the task has a start date). A start date doesn't hide the task: it stays in its lists, just less urgent until then.

The menu also sets the priority, context, effort and project (each with quick chips, and **Find…** or **Other…** for the rest), and has **Mark in progress** (its box then shows a dot; it's started, with no percentage) and **Back to to-do** once it is, **Reopen** on a cancelled task, **Waiting for someone**, **Cancel task**, **Open** with the note's name, and **Delete task**, which ⌘Z puts back.

## Use the task pane
Click a task to show it in the pane on the right. Click its words to change them (`↩` keeps the change, `Esc` leaves them; its dates and tags stay). There you can also tick it and set its due, defer, start and created dates, priority, context, effort and project in place; these are the same changes as the menu's. Hover the ⓘ beside any of them for what it means. Context offers the ones in use plus calls, computer, errands, office and personal, or **Other…** for a new one.

**Lives in** shows the note, line and heading the task is written in; click it to open the note there. The ⋯ button at the pane's foot has **Open note**, **Cancel task** (**Reopen** on a cancelled one) and **Delete task**, which ⌘Z undoes. **Ask about this** opens [Ask](app:ask) about the task. **Waiting for someone** adds `#waiting-for` to the task, and **No longer waiting** takes it off.

## Group, filter and save lists
**Group by** in the top bar (**None**, **Project**, **Context** or **Due**) groups the current list, with a band and count per group. Grouped lists can't be dragged.

Above the table, **Search tasks** narrows every list to the tasks with all the words you type, in their text, note, heading, project, tags or context; the counts on the left show how many match in each list, and `Esc` clears it. Beside it, context chips (**All**, `@calls`, `@office`…) show only tasks in that context; click the chip again, or **All**, to show all. The effort menu limits the list to tasks of 15 minutes, 30 minutes or an hour or less, by their effort field.

Once you've chosen a context, effort or grouping, **Save this list…** keeps the combination under a name. It shows under Saved on the left. The x beside a saved list forgets it; its tasks stay as they are.

## Find tasks in your notes
At the top of **Next actions**, **Find tasks and projects** has an assistant read your notes from the last 90 days (not the wiki, sources, templates or project notes) for things you said you'd do, or are waiting on someone for, that aren't tasks yet. It runs only when you start it, here, in [Projects](app:projects) or from `⌘K`, and the row shows its progress, with **Stop**. Each suggestion names the note it comes from: hover over it for the quote, click to open it. Brainstead checks the quote is in that note and leaves out anything that's already a task.

**Accept** adds the task to its project's Next actions, or the To Do list, and lists it in [Changes](app:review), where you can revert it. **Edit** lets you reword it first (`↩` adds it). **Skip** leaves it out. Neither comes back when you look again. The suggested projects are at the top of [Projects](app:projects). Its model is **Find tasks and projects** under Models by job in [Settings › AI assistants](app:settings/assistants).

## Add a task
**New task** opens the capture box and puts the task under Other on the To Do list. It takes the list's tag and the chosen context, so it shows where you are: `#followup` in Follow-ups, `#waiting-for` in Waiting for, `#someday-maybe` in Someday / maybe, and `#context/calls` with `@calls` chosen. With neither, it waits in the [Inbox](app:inbox). The button's tooltip says which. You can add to it as you type:

- `due:`, `defer:`, `start:` or `created:` and a word (today, tomorrow, fri, next week, +3d, 2026-10-05) become dates. `due:` on its own opens a date picker.
- `@calls` becomes the context tag `#context/calls`.
- `effort:15m` becomes `[effort:: 15m]`. Efforts read 15m, 1h, 1h30m or 2d (a day is 8 hours).
- `[[` links a note and `#` adds a tag, with suggestions from the vault.

## How tasks are written
Tasks are plain markdown, so other editors read them too. Dates are emoji before the date: `📅` due, `⏳` deferred until, `🛫` start, `➕` created, `✅` done. A context is a tag like `#context/calls`, effort a field like `[effort:: 30m]`, and a task belongs to a project when it's in the project's note or links `[[Project. Orbit App launch]]`. Rows show these as chips, not emoji. A row in its project's own note shows the project chip but not the note's name.

If the tasks can't be read, the list says **Couldn't load the tasks.** with **Retry**.

A recurring task carries a rule such as `🔁 every week`. When you tick it, the next one is added above it with its dates moved on.

Tasks inside quotes and callouts (`> - [ ] Call Maya`) are listed and edited like any other.
