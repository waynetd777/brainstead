---
title: Templates
kind: screen
screens: [templates]
order: 9
page: Write a template
summary: The note templates in the vault's Templates folder, to write, test and make notes from.
---
Templates lists the files in the vault's `Templates/` folder. New note offers each one, and runs its Templater tags when it makes the note. **Use <% and <%* tags** below explains the tags; [Task and Dataview queries](help:queries) covers the query blocks a template can hold.

## Make a note from a template
Press `⌘N`, or click **New note** on [Notes](app:notes). Pick a template on the left (`↑` and `↓` choose); it shows as a summary of the questions it asks, the lists it offers and whether it names the note, with **Show code** for the code. Click **Create** or press `⌘↩`.

The template's questions appear in the dialog as the run reaches them. Answer and press `↩`. **Cancel** skips a question and the template carries on; **Stop** ends the run and makes nothing. A template that doesn't name its note makes `Untitled.md`. The new note opens in Edit, with the caret at `tp.file.cursor()`.

## Write a template
Click **New template**, type a name and click **Create**. It's made as `Templates/<name>.md`, starting with the note's title as its heading, and opens in Edit. A template an assistant makes waits in [Changes](app:review) for you to accept, since a template can run code.

A template can hold [query blocks](help:queries) too, which every note made from it runs.

An assistant's change to a template, or a rename or move to the Trash of one, is always held for you in [Changes](help:review).

Open any template from the list to change it. In Edit and Source the `<% %>` tags stand out and the script inside them is coloured as code (keywords, strings, numbers, names), and a banner says when the template doesn't compile.

Inside a tag the editor completes the script as you type (keywords, your own names, `tp` and its functions, `tR` and `moment`), each with its arguments and a **Docs ↗** link, and `⌃Space` opens the list anywhere in a tag.

Hover over a name in a tag, or put the caret on it, to see what it is: a keyword such as `await`, a `tp` function, `tR`, `moment`, a JavaScript name such as `Math.floor`, or one your template declares. With the caret on it the list opens with that name chosen. In View, hovering a name explains it the same way; move onto the box to click its **Docs ↗** link.

## Test a template
On an open template, click **Test run**. It runs the template as New note would, asking its questions, and shows the note it would make, its name, where the caret would go and any other notes it would create. Nothing is written to the vault.

In the list, a template that doesn't compile is marked **Doesn't run**; hover the mark for the error. New note shows the same mark, with the reason, and won't run it.

## Use <% and <%* tags
Templates use Templater's tags, and all the tags in a template are one script:

- `<% … %>` writes the value of what's inside into the note: `<% tp.date.now() %>` puts in today's date.
- `<%* … %>` runs code and writes nothing itself: for declaring names, asking questions and deciding things. It writes only what it adds with `tR += "…"`.
- `<%# … %>` is a comment, left out of the note.
- A `-` or `_` inside the marks (`<%-`, `-%>`) trims the line break, or all the spaces, beside the tag.

A name declared in a `<%*` tag can be used in any tag after it:

```
<%* const who = await tp.system.prompt("Who is it with?") -%>
# Meeting with <% who %>
```

## Know what templates can do
Inside the tags: `tR`, `moment`, and `tp.date`, `tp.file`, `tp.frontmatter`, `tp.config`, `tp.hooks` and `tp.system` (prompts, pick lists and the clipboard). `tp.file.include` runs another template, or one heading or block of it.

`tp.user` runs your own `.js` scripts from a vault folder, `Templates/scripts` unless you choose another in [Settings › Notes](app:settings/notes). Not available: `tp.web` (no internet) and calls into another app's internals; a template that uses them stops with an error naming the call.

## Start from the examples
A new vault comes with example templates: **Meeting**, **Daily note**, **1-1**, **Project**, **Weekly plan** and **Reading note**, with a snippet in `Templates/Snippets/` and a script in `Templates/scripts/`. Each one's first line says which features it shows. To get them in a vault without them, click **Add the example notes** in [Settings › Vault](app:settings/vault); it adds only the ones that are missing.
