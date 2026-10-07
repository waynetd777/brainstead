---
title: Knowledge health
kind: screen
screens: [health]
order: 15
summary: Checks the wiki for missing pages, broken links, stale dates and other problems, and fixes the safe ones for you.
---
Knowledge health checks the wiki and its sources whenever the vault changes. The number under **Need a decision** is the issues only you can settle; the sidebar and Today's **Wiki issues to decide** show the same count. The sparkline beside it shows the trend from the second day on, once a day has needed a decision: its ends give the first and latest day's count, and hovering it gives the highest. An assistant reading the report gets the same count, what's safe to fix, and the trend.

## Read the checks
The checks come in two groups.

- **Wiki checks**: missing pages (linked but never written), broken sources, orphan pages (nothing links them), missing cross-links, stale `updated:` dates, unlogged writes (pages changed after `log.md` was last written), sources not yet ingested, and images nothing uses.
- **More checks**: possible duplicates, stale pages others rely on, sources changed since they were cited, pages not in the page shape, pages with no Current state, claims with no citation (found by the [contradictions](app:contradictions) check), and system notes missing their header.

A system note's header is the "This is a system note" callout at the top of the To Do list, the summaries' notes and the rest, which other parts of Brainstead look for. **Fix** puts it back as Brainstead last saw it.

Stale pages, claims with no citation and pages with no Current state are worth a look but aren't counted; their icon is grey rather than amber. Claims with no citation are listed by page, one row a page with each line that makes a claim; click it to open the page with all those lines highlighted, and **Ignore** ignores them all.

Hover a check's name for what it looks for. Click a check to see its issues, and click an issue to open its page. **Check now** runs every check again.

## Fix the safe issues
Some issues have one right answer, and Brainstead can fix them without asking: adding a missing `[[ ]]` link at the first mention, setting `updated:` to the file's date, adding a missing line to `log.md`, and putting back a system note's header as it was. Click **Fix** on one issue, or **Fix safe issues** in the top bar for all of them. Each fix can be undone with `⌘Z`.

## Deal with the rest
- **Missing pages**: **Create** makes the page in `wiki/entities/` (from `Templates/Wiki page.md` if you have one) and opens it; **Link to…** points the missing link at an existing page, on each page that links it (listed in Changes, with Revert).
- **Possible duplicates**: **Open the other** compares them; **Not duplicates** stops the pair being flagged.
- **Anything else** (an orphan page, a stale page, a broken source…): **Ignore** stops listing it, and counting it, until its page changes (a claim with no citation, until its own line changes). The check then says how many it's ignoring; **Show again** lists them again.
- **Images nothing uses**: **Move to the Trash**, after asking. You can restore them from the Trash.
- **Sources not yet ingested**: ingest them from [Sources](app:sources). **Ingest** here starts the same ingest; its page changes are listed in [Changes](app:review). A source ingest can't read, such as an SVG or a zip file, shows **Can't ingest** instead.

## Put pages in the page shape
Every entity and concept page has the same layout: the opening text, **Current state**, its topics (such as Architecture), a **Timeline**, then **See also**. Each Timeline entry is a heading starting with its date, newest first, with a line under it naming the note it came from:

```
### 2026-10-02 — Steerco: launch moves to 28 November
Source: [[Meeting. Orbit App Steerco - 2026-10-02]]
```

**Pages not in the page shape** lists the pages laid out some other way. **Reshape pages** puts every page it can in the shape by itself, after asking: sections move whole, a dated heading such as "2 Oct 2026 — Steerco" becomes "2026-10-02 — Steerco", a summing-up section such as Status (Apr 2026) becomes Current state with "As of Apr 2026." under it, two entries from the same note on the same date become one, the dated summing-up sections of a page leave the newest as Current state and the rest in the Timeline, and two See also lists become one. **Reshape** on a page's row does that page alone. No text is lost, and the result is checked before anything is written. Each page is one change in [Changes](app:review), in one run you can revert page by page or with **Revert all**.

A page that needs you says why: a heading whose year it can't tell, two summing-up sections, two entries citing the same note on different dates, or text in the Timeline that isn't an entry. Fix what it says (usually a heading) and the page reshapes by itself; or **Reshape anyway** to take the proposed result as it is, which you can check and revert in Changes.

## Write the missing Current states
**Pages with no Current state** lists pages that have a Timeline but no Current state. It isn't counted as needing a decision. **Write 5** has the assistant's cheap model write a Current state for five of them, to look at in [Changes](app:review) first; **Write all** does the rest. The model sees only the page's opening text and its newest Timeline entries, and a link it makes to a page that doesn't exist is left as plain text. Each page is one change in one run, with **Revert all**; a page it has nothing current to say about is left as it is. It writes four pages at a time; **Stop** ends the run after the pages it is on.

## Fix with Ask
**Fix with Ask** starts a chat that lists the issues needing judgement and asks the assistant to fix them. Prose fixes are made and listed in [Changes](app:review), where you can revert them; safe fixes are made at once and `⌘Z` undoes them. The button is greyed out when nothing needs a decision.

## Side cards and contradictions
On the right, **Wiki pages by type** and **Wiki pages by tag** are pie charts of the wiki; click a slice or its row to open the [Wiki](app:wiki) filtered to that type or tag (the "other tags" slice isn't a link). Below them, **Pending sources** lists sources not yet cited and those changed since. **Contradictions** in the top bar opens the report of wiki pages that disagree.

## The daily check
In [Settings › Jobs & schedule](app:settings/jobs), turn on **Daily check** to have Brainstead look for contradictions in the pages that changed and bring the list of pages in `index.md` up to date, at the time you set (09:00 to start). It catches up after the computer sleeps. **Also refresh pages whose sources changed**, in [Settings › AI assistants](app:settings/assistants), has it ingest those sources again. Its notification also says how many wiki pages aren't in the page shape any more (edited in another app, say), for **Reshape pages** here. **Run now** runs it straight away and becomes **Stop** while it runs.
