# Brainstead

A home for everything on your mind: tasks, notes and a wiki that writes itself, over a folder of plain markdown.

Brainstead is a Mac app for [Getting Things Done](https://gettingthingsdone.com), writing notes and keeping a wiki, all in one folder of markdown files, your vault, which other markdown editors can open too. Your tasks are `- [ ]` lines in your notes, gathered into GTD lists you can tick, date and reorder. AI assistants you already have on your Mac (Claude Code, Codex, Copilot, Antigravity) answer from the vault, build wiki pages from your sources with every claim quoted, and make changes for you, each listed with Revert.

## Download

For a Mac with Apple silicon (M1 or later) and macOS 14 or later.

1. Download [Brainstead.dmg](https://github.com/waynetd777/brainstead/releases/latest/download/Brainstead.dmg) from the [latest release](https://github.com/waynetd777/brainstead/releases/latest).
2. Open it and drag **Brainstead** onto **Applications**.
3. Open Brainstead from Applications. macOS says it can't check the app for malicious software, because it isn't notarised by Apple. Click **Done**.
4. Open System Settings › Privacy & Security, scroll down and click **Open Anyway** beside Brainstead, then **Open Anyway** again and enter your password.
5. The first screen asks for Full Disk Access. A vault in a cloud-synced folder (OneDrive, iCloud Drive, Dropbox) needs it, or macOS asks for each folder; you can skip it. Then choose your vault folder, or click **Create a new vault** for a new one with a few example notes to try things on.

Brainstead opens a vault you choose read-only (a new one it makes for you opens writable). When you're ready for it to change files (ticking tasks, saving notes), turn off **Read-only** in Settings › Vault. See [First run](docs/features.md#first-run). To build it yourself instead, see [Building it](#building-it).

<a href="docs/images/index.md#the-readme"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/today-dark.png"><img alt="Today: overdue, due and deferred tasks, what you're waiting for, the capture box, and where you left off" src="docs/images/today-light.png"></picture></a>

## What it does

- **Today and [GTD](https://gettingthingsdone.com).** Today shows what's overdue, due and back from deferral, and what you're waiting for. Quick capture (⌃⌥Space) catches a task or a thought from any app; the Inbox clarifies it; Tasks, Projects and a guided weekly review do the rest, and Find tasks and projects reads your recent notes for what you meant to do. [Tasks and GTD](docs/tasks.md)
- **Notes.** Read in View, write in Edit (markdown shown as you'd read it) or Source. Wikilinks, tags, callouts, KaTeX, Mermaid, Tasks queries, Dataview and Templater all work, and templates are quick to write: the editor suggests and explains Templater's functions as you type. Saving never reformats what you didn't change, and refuses to overwrite a file changed elsewhere. Notes and wiki pages can be read aloud in macOS's voices. [Notes](docs/notes.md)
- **A wiki built from your sources.** Emails and Teams chats captured from the browser, PDFs, Office files and images: ingest them, and the assistant writes wiki pages with every claim quoted from its source, and Brainstead checks each quote. Knowledge health and a contradictions check keep it in order. [The wiki and sources](docs/wiki.md)
- **Ask.** Chat with Claude Code, Codex, Copilot or Antigravity about your vault, signed in with your own account. Your assistants can also drive Brainstead from Terminal. Either way, an assistant can do almost anything you can do in the app: tick tasks, clarify the Inbox, start ingests and reviews. Every change is listed in Changes, where you can revert it; a scheduled run's change that fails a check waits there for you, and so does any change to a template, a system note's header or code that runs. [Ask and assistants](docs/ask.md)
- **Day to day.** A menu-bar icon with today at a glance, scheduled daily and weekly summaries, a nightly check of the wiki, and help on every screen (`?`). [Day to day](docs/day-to-day.md)

[Features](docs/features.md) has the first run, the window and the keys.

## Licence

Brainstead is free software under the [GNU General Public License](LICENSE), version 3 or later: you may use, share and change it, and anything you pass on must stay free under the same licence. See [Licence and credits](docs/features.md#licence-and-credits).

## Building it

Needs Rust, Node.js and Xcode's command-line tools.

```sh
npm install
make dev          # run it with hot reload
make install-app  # build it and put it in /Applications
```

[Development](docs/development.md) has the rest: signing, the checks, the MCP server, evals, screenshots and where things live.
