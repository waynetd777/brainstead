<%# Example template: a note on a book or an article. It shows prompts that fill the note's properties, a suggester, if blocks that write a line only when it's needed (the dash in a closing tag trims the line break after it), and tp.file.move, which puts the note in a Reading folder. Delete it when you're done. -%>
<%* const kind = await tp.system.suggester(["Book", "Article"], ["book", "article"], true, "Book or article?") -%>
<%* const title = (await tp.system.prompt("Title", "", true)).trim() -%>
<%* const author = ((await tp.system.prompt("Author")) ?? "").trim() -%>
<%* const link = kind === "article" ? ((await tp.system.prompt("Link to it")) ?? "").trim() : "" -%>
<%* const yaml = (s) => (/^[\w][\w ,.()-]*$/.test(s) ? s : JSON.stringify(s)) -%>
<%* await tp.file.move("Reading/Reading. " + (title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled")) -%>
---
kind: <% kind %>
title: <% yaml(title) %>
author: <% yaml(author) %>
<%* if (link) { -%>
link: <% link %>
<%* } -%>
status: reading
started: <% tp.date.now() %>
tags: [reading]
---

# <% title %>
<%* if (author) { -%>

By <% author %>.
<%* } -%>

## Why I'm reading it

<% tp.file.cursor() %>

## Key ideas

## Quotes

## What I'll do with it
