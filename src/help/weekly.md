---
title: Weekly review
kind: screen
screens: [weekly]
order: 5
summary: A guided GTD weekly review over your real lists, step by step, saved in the week's own review note when you finish.
---
The weekly review walks you through eleven steps in GTD's three phases, each over the real lists from the vault, so you can act on what you see without leaving the screen.

## Start or carry on a review
From the weekly review's time on its day until the end of the next day, the To process card on [Today](app:today) shows **Weekly review day** with **Start**. You can also start it any time from ⌘K with "Start the weekly review". The day and time are the **Weekly review** row in [Settings › Jobs & schedule](app:settings/jobs), Friday 16:00 unless you change them.

**Weekly review** in the sidebar, under Projects, opens its start page first. It shows the week the review is for, when it's scheduled (with **Change**, to Settings › Jobs & schedule), how its suggestions stand (ready, being prepared, or when they'll be prepared), and a link to this week's review note if you've finished it. **Start the review** goes to step 1. Opening the start page doesn't prepare anything.

**Pause** in the top bar goes back to Today and keeps your progress. While a review is paused, the To process card shows **Carry on**, and the start page shows which step you're on, with **Carry on** and **Start over** (which drops the progress, notes and decisions and starts again from step 1, after asking first when there's progress to lose). A new review covers the week the weekly summary would: on a Monday or Tuesday the week just ended, otherwise this week. A paused review keeps its own week until the next week's review is due; then a fresh one starts.

## Go through the steps
The steps are listed on the left by phase; click any to jump to it. Jumping marks the step you were on done (the list's tooltip says so). **Next** marks the current step done and goes on, and **Back** returns (it isn't shown on step 1). The top bar shows the step, about how long is left and a progress bar.

- **Get clear**: Collect loose ends (a capture box), Empty the inbox (its count and Open the Inbox), Process this week's notes (notes whose name carries a date in this week, such as `Idea. Pricing - 2026-10-01`, other than meetings; older notes you only edited aren't listed).
- **Get current**: Next actions (tick or change them in place), Look back: this week's meetings (meeting, 1-1 and interview notes dated this week), Look ahead: check your calendar, Projects, Waiting for.
- **Get creative**: Someday / maybe, Links to pages not written yet, New ideas (a capture box).

## Suggestions prepared from your week
With an AI assistant set up, Brainstead reads the week ahead of the review and prepares suggestions for the steps. Starting the review prepares them only if the week has none yet; working through the review doesn't start it over. Without an assistant the steps work as before.

A line under the step's title says when the suggestions were prepared, with **Prepare again** for a fresh set. While they're being prepared a bar shows it's working; if it fails you see why, with **Retry**. If the model's answer stops part way, the suggestions before the stop are kept. When none can be read, the run's chat in Ask shows what the model wrote.

In [Ask](app:ask) you can also ask for help with the review, such as "go through this week's suggestions with me". The assistant can read them and accept or skip one for you.

Each step shows its suggestions above its usual content, one row each: what's suggested, the note it came from (hover for the quote, click to open it), a button for the action (**Add task**, **Tick**, **Defer to** a date, **Waiting for**, **Someday**, **Change wording**, **Clarify as…** or **Link**) and **Skip**. Collect loose ends and New ideas show prompts to think about instead, with nothing to click.

Nothing changes until you click. An accepted suggestion does the same undoable thing as elsewhere in the app, with Undo on the message; a new task goes under Other on the To Do list, or into its project; a link is made too, listed in [Changes](app:review) with Revert. What you accept or skip is kept with your progress, so it stays hidden after a pause, and what you accept is added to the review's log. The [Inbox](app:inbox) shows the prepared inbox suggestions as its own.

## Act on what you find
Each step lists the real items with their usual actions:

- **Projects** shows active projects with no next action or nothing for two weeks. Type a next action to add it, or click **Someday** or **Done** to change the project's status.
- **Waiting for** lists those tasks; **Draft nudges in Ask** asks [Ask](app:ask) to draft a follow-up for each, to copy into Outlook or Teams. Nothing is sent.
- **Someday / maybe** lists those tasks, and someday projects with **Start now**.
- **Links to pages not written yet** lists links to pages that don't exist yet, with a way to [Knowledge health](app:health) to create or link them.

Brainstead can't read your calendar, so Look ahead asks you to open Outlook yourself and capture what you find.

## Finish and save
Type anything worth keeping in **Notes for this week's review** at any step; they're kept with your progress. On the last step, **Finish and save** writes the week's own note, `Me. Weekly Review - 2026-W40` for week 40, in the vault's top folder. It has a title, the week's dates and when you finished, how many steps you did, the actions you took (next actions added, projects moved, suggestions accepted) and your notes. You go back to Today, and **Open** on the message shows the note. ⌘Z undoes the save, and it's noted in the log.

The note is yours: edit it, move it or delete it. Anything you write under its **Added later** heading stays if you finish the same week's review again, which rewrites everything above that heading. If you take the heading out, finishing again keeps the whole old note under a new **Added later**. The scheduled weekly summary reads the note when it sums up the week; it never writes to it.

The pane on the right shows this week's block from the weekly summaries note, if the scheduled weekly summary has written it, with how many notes and meetings are dated this week, and **Your review: open** once you've finished this week's review. If there's no block yet, it says "This week's summary isn't written yet."
