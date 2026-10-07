---
title: Settings › Jobs & schedule
kind: screen
screens: [settings/jobs]
order: 34
summary: The weekly review's day and time and its preparation, the scheduled daily and weekly summaries, the daily check, and recent runs.
---
The page has two parts. **Your weekly review** is something you do: the guided review of your week. **Summaries Brainstead writes** are done for you: an assistant writes what you did each day and each week. The weekly summary is shown beside your weekly review's steps.

## Set when you do the weekly review
**Weekly review**, at the top, is the day and time you do the guided [Weekly review](app:weekly), Friday 16:00 unless you change it. It isn't a job: [Today](app:today) reminds you from then until the end of the next day.

## Prepare the weekly review ahead of time
**Prepare the weekly review**, under it, reads the week and saves suggestions for each step of the review. It runs 4 hours before the review time on its day.

It runs on schedule only while **Brainstead runs the daily and weekly summaries** is on, and only if the week has changed since it was last prepared. Its switch turns the schedule off. Starting the review prepares it too if needed.

The row shows the last run and the next, with **Open** for the last run's chat, and **Run now** (or **Stop**). Its model is **Weekly review preparation** under Models by job in [Settings › AI assistants](app:settings/assistants). Its runs aren't in Recent runs.

## When jobs run
Jobs run while Brainstead is running, even with its window closed. A run missed while the app was closed or the computer asleep catches up when Brainstead next runs. Times use this computer's clock, as 24-hour HH:MM.

## Let Brainstead write the daily and weekly summaries
Only one app should write them, so Brainstead runs them only when **Brainstead runs the daily and weekly summaries** is on. If another app also runs them, switch them off there.

Until it's on, the **Daily summary** and **Weekly summary** rows are greyed, and a line above them says why. Then switch on **Daily summary** (every day at 06:30 unless you change it) and **Weekly summary** (Friday at 16:00 unless you change it). The weekly summary is the AI-written block for the week; the [Weekly review](app:weekly) is the screen you go through yourself. Each row shows the last run and the next. Brainstead gathers the notes, tasks and Claude Code sessions for the summary, the model writes the block from them, and Brainstead puts it at the top of the month's summaries note. While the vault is read-only, a scheduled summary is held for you in [Changes](app:review); **Run now** needs Read-only off in [Settings › Vault](app:settings/vault).

## Hold the summaries for you
With **Hold the summaries for me** on, each one is held in [Changes](app:review) until you accept it. With it off, they're written straight away, undoable in Recent runs and revertable in Changes. A scheduled one that fails a check (the note is open with unsaved edits, or the vault is read-only) is held in Changes instead. One that would change the note's system-note header is always held.

## Run a job now or stop it
**Run now** runs one whether or not it's scheduled, and opens its chat in [Ask](app:ask). The daily summary covers yesterday; click the day after **for** to pick an earlier one in the date picker, and **×** to go back to yesterday. A dated note, such as a meeting note, counts on its own date, not the day it was written up. While a job runs its button becomes **Stop**. Stopping the daily check keeps what it has read so far for next time.

## Check the wiki every day
**Daily check** (09:00 unless you change it) checks the wiki pages that changed since the last run for contradictions, making the fixes (held in [Changes](app:review) when a check fails), and brings the list of pages in `index.md` up to date. A bar shows its progress while it runs.

To have it also ingest again the sources that changed, and to ingest new sources as they arrive, use the **Ingest** switches in [Settings › AI assistants](app:settings/assistants).

## Look back at recent runs
**Recent runs** lists the last eight daily and weekly summary runs, scheduled or run now. **Open** shows the run's chat in Ask, **Show** opens the note it wrote, and **Undo** puts the note back as it was, as long as it hasn't been edited since (the line in `log.md` stays, as a record). Each run's summary is also a change in [Changes](app:review): reverting it there undoes the run the same way, and Recent runs then marks it undone.

## Keep your tools' sessions out of the summaries
The summaries put each project's work under **Work done** or **Personal** by the project's area: a project with the area Personal is personal, one with any other area is work, done projects included. A session counts for a project when its folder is named after it (`orbit-app` for Orbit App) or its messages are plainly about it. To move a project's work across, change its area on [Projects](app:projects).

The daily summary writes up your Claude Code sessions as your work. A tool of yours that starts Claude Code sessions itself (a script, another app) would show there too. List it under **Your tools that start Claude Code sessions**, and its sessions are counted as automated instead.

Each tool has a **Name** and what its sessions have in common. **Folder contains** matches a session whose working folder's path contains it. **First message starts with** matches a session whose first message opens with those words, ignoring case. Give one or both: with both, a session must match both. A row is saved once it has a name and one of the two; the **×** takes a tool off. If your saved tools couldn't be loaded, it says so with **Retry**, and nothing can be changed until they load, so the saved list isn't overwritten.

**Folders that look like a tool's** lists folders where, in the last two weeks, at least three sessions ran and nearly all of them were one prompt and done, as a tool runs Claude Code; a folder you work in yourself, with conversations, isn't listed, and nor are your vault (where Ask's chats run) or temporary folders. **It's a tool** adds a folder as a tool, named after it; rename it if you like. Brainstead's own jobs are recognised without being listed.
