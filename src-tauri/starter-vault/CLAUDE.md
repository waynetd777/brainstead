# Vault schema

AI assistants read this file to learn how the vault is organised. Change it to suit your vault.

- Notes are at the vault root. A note's type is the prefix before the first `. ` in its name (`Meeting. `, `Project. `, `Me. `), and an optional ` - YYYY-MM-DD` at the end is its date.
- `wiki/entities/`, `wiki/concepts/` and `wiki/summaries/` hold the wiki. Every claim on a wiki page quotes its source.
- `sources/` holds what the wiki is built from. `Templates/` holds note templates. `images/` holds pasted images.
- `index.md` is the wiki's catalogue and `log.md` the record of changes, newest first.
- `Me. To Do List.md`, `Me. Scratchpad.md` and `Me. Bookmarks.md` are read by name, so don't rename them.
- Tasks are `- [ ]` lines: 📅 due, ⏳ deferred until, 🛫 start, ➕ created, ✅ done. `#context/<name>` is a context, `#followup`, `#waiting-for` and `#someday-maybe` put a task on those lists.
