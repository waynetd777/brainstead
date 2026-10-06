---
title: Settings › General
kind: screen
screens: [settings, settings/general]
order: 30
summary: The switch-over checklist, the menu bar and opening at login, the quick capture shortcut, your name and the app's appearance.
---
General holds the settings that affect the whole app. Open Settings with `⌘,`.

## Move over from another notes app
**Moving over from another notes app** is a checklist of what's left before you can stop using another app on the same vault. It shows only when that app's own files (its `scripts/` folder) are in the vault. The count beside the heading shows your progress. Brainstead ticks some items itself:

- **Brainstead can write to the vault**: read-only is off in [Settings › Vault](app:settings/vault).
- **Brainstead runs the daily and weekly summaries**: switched on in [Settings › Jobs & schedule](app:settings/jobs).
- **Your tools that start sessions are listed** (optional): **Jobs & schedule** opens the list of your tools that start Claude Code sessions, so the daily summary doesn't count their sessions as your work; the [Jobs & schedule help](help:settings-jobs) explains it.
- **The Outlook extension captures here** and **The Teams extension captures here**: a capture has arrived from each.
- **The other app's skills and scripts are retired**: its skills (`.claude/skills`) and scripts (`scripts/`) have an agent write files in the vault itself, so its changes never reach [Changes](help:review). Once you've ticked **The other app is stopped**, **Retire them** copies your name corrections out, then:
  - moves both folders to the [Trash](app:trash), where you can restore them;
  - adds a section to the vault's `CLAUDE.md` telling agents to change the vault only through Brainstead's tools.

  `⌘Z` undoes the `CLAUDE.md` section; restore the folders from the Trash. An assistant can retire them too, when you ask. The checklist stays once this is done.

The rest you tick yourself: the other app's summaries switched off, its browser extensions removed, and the app stopped.

## Start at login, and the menu bar
- **Show in the menu bar** (on by default) puts Brainstead's icon and its small window in the menu bar.
- **Only in the menu bar when the window is closed** takes Brainstead out of the Dock when you close its window.
- **Open at login** starts Brainstead when you log in. It only appears when macOS can manage it for this copy of the app (the installed app, not one run from a folder), and the menu-bar window has the same switch. It's the switch in System Settings › General › Login Items too: if macOS asks you to approve it, System Settings opens there, and until you do it shows as off.

What the two together do is in [The menu bar](help:menubar).

## Change the quick capture shortcut
The shortcut for [Quick capture](help:capture) is `⌃⌥Space` unless you change it. Click the shortcut button, then press the new keys; it needs at least one modifier key. Press `Esc` or click elsewhere to keep the old one. **Reset to ⌃⌥Space** puts it back. If macOS won't take the shortcut, a message under it says why.

## Set your name
Type your first name under **Your name**, as Teams writes it. Today greets you by it. In meeting notes made from transcripts it tells Brainstead which speaker is you, so your actions become tasks and a meeting with one other person counts as a 1-1.

## Choose light or dark
**Appearance** sets the app to **System**, **Light** or **Dark**. Changing it also sets documents back to following the app; to give notes their own light or dark, use [Settings › Notes](app:settings/notes).
