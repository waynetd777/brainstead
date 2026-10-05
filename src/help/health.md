---
title: Knowledge health
kind: screen
screens: [health]
order: 15
summary: Checks the wiki for missing pages, broken links, stale dates and other problems, and fixes the safe ones for you.
---
Knowledge health checks the wiki and its sources whenever the vault changes. The number under **Need a decision** is the issues only you can settle; the sidebar and Today's **Wiki issues to decide** show the same count. The sparkline beside it shows the trend from the second day on.

## Read the checks
The checks come in two groups.

- **Wiki checks**: missing pages (linked but never written), broken sources, orphan pages (nothing links them), missing cross-links, stale `updated:` dates, unlogged writes (pages changed after `log.md` was last written), sources not yet ingested, and images nothing uses.
- **More checks**: possible duplicates, stale pages others rely on, sources changed since they were cited, claims with no citation, and system notes missing their header.

A system note's header is the "This is a system note" callout at the top of the To Do list, the summaries' notes and the rest, which other parts of Brainstead look for. **Fix** puts it back as Brainstead last saw it.

Stale pages and claims with no citation are worth a look but aren't counted.

Hover a check's name for what it looks for. Click a check to see its issues, and click an issue to open its page. **Check now** runs every check again.

## Fix the safe issues
Some issues have one right answer, and Brainstead can fix them without asking: adding a missing `[[ ]]` link at the first mention, setting `updated:` to the file's date, and adding a missing line to `log.md`. Click **Fix** on one issue, or **Fix safe issues** in the top bar for all of them. Each fix can be undone with `⌘Z`.

## Deal with the rest
- **Missing pages**: **Create** makes the page in `wiki/entities/` (from `Templates/Wiki page.md` if you have one) and opens it; **Link to…** points the missing link at an existing page, on each page that links it (listed in Changes, with Revert).
- **Possible duplicates**: **Open the other** compares them; **Not duplicates** stops the pair being flagged.
- **Images nothing uses**: **Move to the Trash**, after asking. You can restore them from the Trash.
- **Sources not yet ingested**: ingest them from [Sources](app:sources). **Ingest** here starts the same ingest; its page changes are listed in [Changes](app:review). A source ingest can't read, such as an SVG or a zip file, shows **Can't ingest** instead.

## Fix with Ask
**Fix with Ask** starts a chat that lists the issues needing judgement and asks the assistant to fix them. Prose fixes are made and listed in [Changes](app:review), where you can revert them; safe fixes are made at once and `⌘Z` undoes them. The button is greyed out when nothing needs a decision.

## Side cards and contradictions
On the right, **Wiki pages by type** and **Wiki pages by tag** are pie charts of the wiki; click a slice or its row to open the [Wiki](app:wiki) filtered to that type or tag (the "other tags" slice isn't a link). Below them, **Pending sources** lists sources not yet cited and those changed since. **Contradictions** in the top bar opens the report of wiki pages that disagree.

## The nightly check
In [Settings › Jobs & schedule](app:settings/jobs), turn on **Nightly check** to have Brainstead look for contradictions in the pages that changed and bring the list of pages in `index.md` up to date, at the time you set (02:10 to start). It catches up after the computer sleeps. **Also refresh pages whose sources changed**, in [Settings › AI assistants](app:settings/assistants), has it ingest those sources again. **Run now** runs it straight away and becomes **Stop** while it runs.
