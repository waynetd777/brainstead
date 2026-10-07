---
title: Doc check
kind: screen
screens: [doccheck]
order: 24
summary: Check a document against a policy or standard it must follow, or check whether a revision took in your feedback.
---
Doc check reads a document against a governing document, such as a policy or standard it must follow, and lists where they differ. It uses the version your register marks as canonical (in force), and changes nothing unless you save the findings as a note. Open it from **Doc check** in a source's top bar or **Check a document…** in ⌘K.

## Set up the register
The register is the note `Me. Canonical Docs.md`: a table with one row per version of each governing document. Its columns are key, title, version, status, path and aliases. Status is canonical (in force), draft or superseded. Path is a file in the vault, a `~/…` path or a full path. If you have no register yet, **Start the register** creates it with an empty table. **Edit register** opens it.

The screen shows the register's rows, marking a file that isn't there, and any problem reading the table.

## Check a document
Choose a source beside **Check**, or **Choose a file…** to pick one from anywhere on disk. PDF, Word, PowerPoint, Excel, markdown and text files work. Then pick a mode:

- **Against the version in force**: choose the governing document. Brainstead uses its canonical row only. It won't guess the version from a file name, and it refuses when no version, or more than one, is marked canonical.
- **Against my earlier feedback**: for a revised document, the AI finds the feedback you gave on the last version in your vault and checks each point against the revision.

Click **Check**. When it can't run yet, the reason shows beside it.

## Read the findings
The verdict comes first, with a summary, the counts and which version was used (and which were left out). Each finding is a **Conflict** (both texts quoted), **Not covered**, **Superseded term**, **Beyond scope** or **Agrees**; important ones are marked **Material**. Points that agree are folded away: **Show** lists them.

**Copy findings** copies them as markdown. **Save as note** saves them as `Doc check. <name> - <date>.md`.

An assistant can check a document the same way, and gets the findings and the register in the words this screen uses; it can save its findings as a note and start the register, when you ask. The note and the register are listed in [Changes](app:review), with Revert.
