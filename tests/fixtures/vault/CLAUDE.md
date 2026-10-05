# Vault schema

This is the home of your personal LLM wiki. Replace this stub with the
schema and conventions your wiki should follow — Claude reads this file
on every chat turn to learn how your vault is organised.

The app expects (at minimum):

- Journal files at the vault root. A note's *type* is the freeform prefix
  before the first `". "` in its filename — any value (e.g. `Me. *.md`,
  `1-1. *.md`, `Meeting. *.md`, `Workshop. *.md`); a file with no prefix is
  untyped. An optional ` - YYYY-MM-DD` (or ` - YYYY-MM`) suffix is the note's date.
- `wiki/{concepts,entities,summaries}/` for the synthesised wiki.
- `sources/` for raw imports (PDF / DOCX / MD / …).
- `images/` for embedded assets pasted from the editor.
- `templates/` for Templater scripts used by the New Note dialog.
- `index.md`, `log.md` at the vault root.
- Pinned notes at the vault root that the app and its skills read by exact
  name, so none of them should be renamed: `Me. To Do List.md`,
  `Me. Scratchpad.md`, `Me. Bookmarks.md`, `Me. Smart Lists.md`, and
  `Me. Canonical Docs.md` — the last being the registry of which version of
  each governing document is in force, which `/doc-check` resolves against
  rather than guessing from a filename.
