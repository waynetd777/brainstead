---
title: Contradictions
kind: screen
screens: [contradictions]
order: 20
summary: Find places where wiki pages disagree about the same thing, and settle them.
---
Contradictions finds wiki pages that say different things about the same fact, such as two launch dates for Orbit App. Open it from **Contradictions** in [Knowledge health](app:health)'s top bar.

## Run a check
Click **Check · changed pages only**. Brainstead reads the claims on each wiki page that changed since the last check, adds the facts ingest kept for those pages (the **Facts** card on a wiki page), and the AI judges the claims that disagree. **Stop** ends a check part way and keeps what it has read for next time.

The daily check in [Settings › Jobs & schedule](app:settings/jobs) can run this for you each day.

## Read a clash
The list puts real contradictions first, by severity, then unclear and unjudged ones. Each clash is labelled with the judge's verdict: **Real** (with its severity), **Newer supersedes older**, **Not a conflict**, **Unclear** or **Not judged yet**, and **Resolved** or **Ignored** once you've dealt with it.

Select one to see each page's claim side by side, with the quote it rests on and its "as of" date. Click a page's name to open it. **Judge's view** says what the fix should be and which page is right.

## Settle it
When the judge has a fix, it is made to the page that's wrong, and listed in [Changes](app:review) with Revert; from the daily check, a fix that fails a check is held there for you instead. **The fix is in Changes** takes you there. Out-of-date pages get a fix too. Once a fix is applied, the page no longer counts as contradicting another, so later changes to it aren't flagged for it (revert the fix and it counts again). A fix that couldn't be made or held (the vault read-only, say) is in Brainstead's log, and the daily check's line says how many and why.

**Mark resolved** when you've dealt with it, or **Ignore** when it isn't a real contradiction, so it stops being flagged.

## Keep a record
**Save report as note** saves the findings as a new note, `Contradictions - <date>.md`, with each clash's claims, verdict and fix.

An assistant can read the findings (those still to decide, or all of them), mark one resolved or ignored, and save the report, when you ask; its saved report is listed in [Changes](app:review).
