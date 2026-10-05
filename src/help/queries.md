---
title: Task and Dataview queries
kind: screen
screens: []
order: 8
summary: Put a live list of tasks or notes in any note, with a tasks or dataview code block, and build one without writing it.
---
A query is a code block in a note that Brainstead runs when the note is in View. It lists tasks or notes from across the vault, and stays up to date as they change. The block is plain markdown, so the same note works in other markdown apps that run Tasks and Dataview queries.

## Put a query in a note
In Edit or Source, write a code block whose first line says which kind it is, then the query, then a closing line of three backticks:

````
```tasks
not done
due before next week
sort by due
```
````

Wiki pages and templates can hold queries too. Switch to View to see the results. Tasks in the results can be ticked there, and the change is saved to the note the task lives in.

The easiest way in is the builder: click **Insert a query** on the editor's toolbar, or **Build query…** on the first line of a block you've written. Pick what to show in the form and the preview below it updates as you go. **Insert** puts the block in at the caret, or **Update** rewrites the block you opened it on. A line the form can't show (such as filters joined with AND or OR) is kept as written, and the builder says so. In a template, a tag in the form can hold a Templater tag, such as `#followup/<% name %>`.

While you type inside a block, the editor suggests what can come next, with a line on each and a link to its docs, and underlines a line it can't read with the reason.

## Task queries
A `tasks` block lists tasks, one instruction a line, as the Tasks plugin writes them:

- **Filters**: `not done`, `done`, `due before tomorrow`, `scheduled on or after 2026-10-01`, `happens this week`, `tags include #followup`, `tags do not include #someday-maybe`, `path includes Projects`, `heading includes Actions`, `description includes Lena`, `priority is above medium`, `is recurring`. Dates take words (`today`, `next week`, `this month`) as well as dates.
- **Combine them** with brackets and AND, OR or NOT: `(due before today) OR (priority is high)`.
- **Order and group**: `sort by due`, `sort by priority reverse`, `group by filename`, `group by tags`. Brainstead adds `sort by rank`, the order you drag tasks into on the task lists.
- **How much and how**: `limit 10`, `short mode`, `hide backlink`, `hide due date`, and `explain` to show how the query was read.

## Dataview queries
A `dataview` block lists notes or tasks, as the Dataview plugin writes them:

```
TABLE file.mtime AS "Changed", status
FROM #project AND "Projects"
WHERE status != "done"
SORT file.mtime DESC
LIMIT 20
```

- **What to show**: `LIST`, `TABLE` with columns (`AS "Name"` names one, `WITHOUT ID` drops the file column), `TASK` for tasks you can tick, or `CALENDAR file.day`.
- **FROM**: a `#tag`, a `"folder"`, `[[a note]]` (the notes linking to it) or `outgoing([[a note]])`, joined with AND or OR, and `-` to leave one out.
- **Then**: `WHERE` to filter (`!completed`, `contains(tags, "#followup")`, `file.mtime > date(today) - dur(7 days)`), `SORT`, `GROUP BY`, `FLATTEN` and `LIMIT`.
- **Fields**: a note's properties, inline fields written `key:: value`, and the file's own (`file.name`, `file.mtime`, `file.tags`, `file.day`…).

Inline queries go in the text: `` `= this.file.name` `` writes a value in place.

## Scripts in queries
`dataviewjs` blocks, inline `` `$= …` `` and Tasks' `filter by function` run JavaScript, but only in your own notes. They don't run in sources, wiki pages, saved chats, the summary notes, or notes an assistant wrote, which carry `created-by: assistant` (delete that property to trust one). There a quiet note stands where the script would run, and plain queries still work.

An assistant's change that adds a script, or any change to `Templates/`, is always held for you in [Changes](help:review).
