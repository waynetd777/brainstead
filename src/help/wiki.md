---
title: Wiki
kind: screen
screens: [wiki]
order: 11
page: Read a wiki page
summary: Browse and edit the wiki, the pages about people, products and ideas that are built from your sources.
---
The wiki is the `wiki/` folder of your vault: one page per entity (a person, team, product or company) or concept (an idea, process or topic), each citing the sources it rests on. Go to it with `⌥⌘9`. A page can also hold live `tasks` and `dataview` queries, such as a project's open tasks; see [Task and Dataview queries](help:queries).

## Find a page
The list shows every wiki page with its type, how many sources it cites, its health and its tags. Aliases show under the title as "also …". Narrow it down in three ways:

- The tag tree on the left: **All pages**, **Untagged**, or one tag.
- The type chips above the list, such as entity, concept or summary. Click a chip again to show every type.
- **Search the wiki**, which searches the pages' text as well as their names.

Click a column heading to sort by it.

## Read the health column
Each page has a health chip, taken from Knowledge health and Changes; hover one for what it means:

- **Held**: a change to the page is held for you in [Changes](app:review).
- **Stale**: a source changed since the page was written, or Knowledge health flags its date or calls it stale.
- **Check**: another check in [Knowledge health](app:health) lists it.
- **Healthy**: nothing to do.

## Make a new page
Click **New wiki page**, type a name, choose **Concept** or **Entity** and press `↩`. The page is created in `wiki/concepts/` or `wiki/entities/` with its properties filled in, and opens for you to write. It is your own page, so it isn't listed in Changes.

## Read a wiki page
Entity and concept pages share one layout: the opening text, **Current state**, the page's topics, a **Timeline** of dated entries (newest first, each naming the note it came from on a **Source** line), then **See also**. [Knowledge health](app:health) lists pages laid out another way, and **Reshape pages** there puts them in the shape.

Under the title a line gives the page's aliases, its `updated:` date and how many sources it has. A link in the text to one of its sources, or to any file in `sources/`, is drawn as a small number: click it to open the source at the passage cited. The **Sources** card beside **Linked from** lists the sources in the same numbered order.

The **Facts** card lists what ingest checked against the sources and kept with the page: the latest value of each fact, with its "as of" date and what it replaced. Point at one to see the quote it rests on; click it to open the source. Facts are kept from the first ingest that checks them, so an older page may have none yet. Reverting the ingest's change in [Changes](app:review) takes its facts back too.

If another wiki page says something different about the same thing, a banner at the top says what disagrees. **See it** opens [Contradictions](app:contradictions).

The top bar has **Ask**, which starts a chat about the page, **Refresh from sources**, which ingests the page's sources again, and the graph button, which opens the [Graph](app:graph) centred on the page.

## Edit a page's details
In Edit and Source, **Page details** sits above the text:

- **Aliases** and **Tags** as chips. Type one and press `↩` or a comma to add it; click its cross to remove it.
- **Description**: one line saying what the page is.
- **Sources**: the files the page rests on. Type in **Add a source** to find a source or note, then click it.

Each change goes into the page's text like any other edit. While it is unsaved a banner offers **Save** (`⌘S`) and **Discard**.

## Changes from the assistants
Ingest, Ask and Knowledge health make their changes at once; each is listed in [Changes](app:review), where you can revert it. A few are held there for you instead: a scheduled run's change that fails a check, and any change to a template, to a system note's header or that adds code that runs.
