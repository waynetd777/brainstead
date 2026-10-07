---
title: Knowledge health
kind: guide
screens: []
order: 6
summary: Keep the wiki in good order: fix the safe issues, decide the rest, settle contradictions and let the daily check watch for you.
---
Keep the wiki accurate and well linked as it grows.

## Open Knowledge health
Go to [Knowledge health](app:health). It checks the wiki every time the vault changes. **Need a decision** is the number of issues only you can settle; click any check to see its issues, and click an issue to open its page.

## Fix the safe issues
Click **Fix safe issues** in the top bar of [Knowledge health](app:health). Brainstead adds missing links, corrects `updated:` dates, adds missing `log.md` lines and puts back a system note's lost header. Each fix can be undone with `⌘Z`.

## Decide the rest
For missing pages, click **Create** or **Link to…**; for possible duplicates, **Not duplicates** if they aren't. An issue with nothing to fix, such as an orphan page, can be left with **Ignore** until its page changes. For the others, click **Fix with Ask**: the assistant makes the fixes, each listed in [Changes](app:review) with Revert.

## Settle contradictions
Click **Contradictions** in [Knowledge health](app:health)'s top bar, then **Check · changed pages only**. Real contradictions come first. Their fixes are made and listed in [Changes](app:review); mark each one resolved or ignored on the [Contradictions](app:contradictions) screen when you're done.

## Turn on the daily check
In [Settings › Jobs & schedule](app:settings/jobs), turn on **Daily check**. Each day it looks for contradictions in the pages that changed. To have it ingest changed sources again too, turn on **Also refresh pages whose sources changed** in [Settings › AI assistants](app:settings/assistants).
