---
title: Trash
kind: screen
screens: [trash]
order: 17
summary: Files moved to the vault's Trash, to put back or delete for good.
---
Files you move to the Trash go to the vault's `.trash` folder, not the macOS Trash. They stay there until you empty it, so sync clients and other apps that use the folder see them too.

## Move a file to the Trash
Right-click a file in a list and choose **Move to the Trash**, or use **Move to the Trash** on an open note's ⋯ menu or the **Note** menu in the menu bar. From `⌘K`, **Move this note to the Trash** does it for the open note. A message offers **Undo** straight away.

System notes can't be moved to the Trash or renamed. They are the To Do list, the Scratchpad, the bookmarks, the saved searches, the canonical documents register, the daily and weekly summaries' notes, and the vault's `CLAUDE.md`, `index.md` and `log.md`; their menu items are greyed out. Any other note that opens with a "This is a system note" callout is one too: its menu items aren't greyed, but Brainstead refuses when you try. [A note](help:note) says how their header is locked.

Unsaved changes in a trashed note go into the Trash with it, and come back as its draft if you restore it.

## Find something in the Trash
The newest deletions are first. Each row shows the layer, name, the folder it **Was in**, when it was deleted and its size. Type in **Search the Trash** to filter by name or folder. The **Show** switch in the top bar limits the list to notes, wiki pages, sources or templates.

Click the eye button, or select one item and press `Space`, to look at a file with Quick Look before you restore it.

## Put files back
Click **Restore** on a row to put the file back where it was. To restore several, tick their boxes (the box in the header ticks everything shown) and click **Restore** in the bar above the list.

**Restore as…** on any row restores to a path you type; use it when a file now exists at the old path, which the row then points out.

## Delete for good
Tick files and click **Delete forever**, or click **Empty the Trash** in the top bar to delete everything, which also says how much space it frees. Both ask first. The files are then removed from the vault's `.trash` folder, and no other app can restore them either. This can't be undone.
