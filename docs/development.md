# Development

Tauri 2, with a React 19 and TypeScript frontend (Vite) and a Rust backend. `src-tauri/core/` (the `brainstead-core` crate) holds the vault parsing, the SQLite index and search, tasks, safe writes, agent changes, ingest, the reviews and Knowledge health, with no knowledge of Tauri. `src-tauri/mcp/` (`brainstead-mcp`) is the MCP server. `src-tauri/src/` is the app: commands, the watcher, the jobs, the menu bar, the bridge for MCP actions, and everything that differs between operating systems in `platform/`. `src-tauri/evals/` runs the workflows against real models. The frontend, `src/`, is everything you see.

The build plan that took Brainstead through its ten stages is complete and kept out of the repository (in an untracked `archive/` folder). The decisions made along the way are in `_sift/decisions.jsonl`; `python3 _sift/bin/sift.py decisions` reads them.

## Commands

| Command | What it does |
|---|---|
| `make dev` | Run the app with hot reload (Vite on localhost:1440) |
| `make help` | List the targets |
| `make check` | The core's, the MCP server's and the app's Rust tests, the TypeScript check, Vitest, then `make lint` |
| `make test` | The same as `make check` |
| `make lint` | rustfmt, Clippy (warnings are errors), Prettier, ESLint, stylelint, ruff, a licence header on every source file and a tooltip on every button; checks only |
| `make fmt` | Reformat everything, and add the licence header where it's missing |
| `make evals` | The workflow evals with real models on a copy of the fixture vault (`EVALS="help --model …"` picks); writes `src-tauri/target/evals/report.md`. Not part of `check` |
| `make app` | Bump the version and build the .app, signed with the identity in `signing.local` if there is one |
| `make install-app` | Build it at the current version (no bump: only `make app` for a release bumps it) and replace the copy in /Applications (quits a running Brainstead first) |
| `make dmg` | Pack the built app into the release DMG (`src-tauri/target/release/bundle/dmg/Brainstead.dmg`) |
| `make screenshots` | Retake the screenshots in `docs/images/` |
| `make icons` | Redraw the icon artwork and regenerate the icon set |
| `make sign-check` | Show who signed the installed app, and fail unless it's the identity in `signing.local` |

- `make check` must pass before every commit.
- Quit the installed Brainstead before `make dev` if both would use the same app data folder: two would both run the scheduled jobs. `BRAINSTEAD_DATA` points either at another folder.
- Tests never touch a real vault: they copy `tests/fixtures/vault/` to a temporary folder.
- The capture extensions' pure functions have Vitest tests beside them (`extensions/**/*.test.js`), run by `make check`. A changed extension has its `manifest.json` version bumped; users pick it up by opening Settings › Capture extensions and clicking reload on `chrome://extensions`.
- The evals use cheap models by default (Haiku under test, Sonnet judging); the ingest scenarios name Sonnet, as they need it.

To publish a release: `make app`, `make dmg`, commit and push, then `gh release create v<version> src-tauri/target/release/bundle/dmg/Brainstead.dmg`. The README's download link points at the latest release's `Brainstead.dmg`, so keep that name. `tools/dmg/make_dmg.py` draws the window's background from `tools/dmg/background.html` (rendered by WebKit) and has Finder lay out the icons, so the first run asks to let the terminal control Finder.

## Rules

- The vault is the only source of truth and is edited by other apps too. Never reformat markdown the user didn't change. Writes are atomic and refuse to save over a file changed since it was read.
- No model writes to the vault directly: an assistant or a run asks the app, which makes the change through the safe write and records it in Changes (decided 2026-10-05, `src-tauri/src/changes.rs`). Changes the user started are made at once; a scheduled run's change that fails a check is held, as is any change to `Templates/` (renames and trashes of templates too), one that adds code that runs, or one that changes a system note's header.
- Keep operating-system code inside `src-tauri/src/platform/`, so Windows and Linux stay possible.
- Update `docs/`, `README.md` and the screen's help (`src/help/*.md`) in the same change as the behaviour, and support it in the MCP server in the same change too. `CLAUDE.md` has the full list.
- The repository uses invented names only (Orbit App, Maya, Lena, Acme…) in fixtures, docs, comments and UI text.

## Writing the docs

These pages are the user guide; the in-app help goes deeper on each screen. Keep them short: what a feature does, how to use it, the keys. Short sentences in plain British English, a `##` section per topic, invented names in every example.

## Where things live

| What | Where |
|---|---|
| Settings | `~/Library/Application Support/Brainstead/settings.json` (`BRAINSTEAD_DATA` overrides the folder) |
| The index (SQLite, FTS5) | `index.db` there, rebuilt from the vault when its schema changes |
| Drafts, undo, extracted PDF and Office text | `drafts/`, `undo.json`, `text/` |
| Agent changes | `changes/<id>.json`, with the pages' texts before and after compressed in `changes/text/`, kept 90 days or 500 MB (Settings › AI assistants). `proposals-backup/` is the old review queue, moved in once and kept for one release |
| Runs (ingest, the daily and weekly summaries, the daily check, contradictions, Write Current state) | `runs/`, `summaries/`, `daily-check.json`, `contradictions/`, `current-state.json` |
| Knowledge health's not-duplicates and daily counts | `health.json` |
| Weekly review in progress | `weekly.json` |
| The weekly review's prepared suggestions, by week, and its runs | `weekly-prep/` |
| Chats not yet saved to the vault; a saved chat's turns while the vault is read-only, under its vault name; Antigravity's working folder | `chats/`, `chats-pending/`, `ask/agy/` |
| The capture extensions' copy that Show in Finder reveals | `extensions/` |
| The latest captures from the browser, which the app watches | `captures.json` |
| Captures waiting in the Inbox | `captures-inbox.json` |
| Captures already clarified from the Inbox | `inbox-captures.json` |
| Fix name's remembered corrections | `substitutions.json` |
| Find tasks and projects' suggestions, what's been accepted or skipped, and its last run | `find/state.json` |
| When each bookmark was last kept in triage | `bookmarks-kept.json` |
| Your tools that start Claude Code sessions, kept out of the summaries (Settings › Jobs & schedule) | `summaries/automated.json` |
| MCP actions waiting for the app | `bridge/` |
| The app's own logs | `logs/` |

## The MCP server

The app's binary runs as Brainstead's MCP server with `--mcp` (and `--data <folder>`, `--chat <id>`, `--model <id>` from Ask), speaking newline-delimited JSON-RPC over stdio, protocol versions 2024-11-05 to 2025-06-18. `brainstead-mcp` builds on its own too, for a terminal. To add it to Claude Code (Settings › AI assistants has Codex, Copilot and Antigravity's commands too):

```sh
claude mcp add -s user brainstead -- "/Applications/Brainstead.app/Contents/MacOS/Brainstead" --mcp
```

- It reads the vault from disk and the index read-only, and writes nothing itself. A change (`edit_page`, `create_note`, a task, a rename…) is checked here, then sent to the app as `change.submit`, which makes or holds it.
- Every other action (ticking a task, clarifying the Inbox, starting a run, reverting a change) is a request file in the app data folder's `bridge/`. The running app takes it up and hands it to the window, which runs it with the same functions its screens call (`src/mcpActions.ts`), so undo, `log.md`, the read-only switch and Templater behave as on screen.
- The server opens the app when it isn't running.
- Tools have titles and the four MCP hints, and what only reads is a tool of its own (`list_changes` beside `changes`, `list_trash` beside `restore_from_trash`…), marked read-only, so a client can let it run unasked. A read tool sends the same app action as its change tool, held to the read actions in `acting`.
- An unknown tool is a JSON-RPC error; arguments a tool can't take, and a tool that can't do it, are the tool's error (`isError`), saying why, so the model can correct its call. Calls are limited to 120 a minute.
- The listing tools have an `outputSchema` and give their rows as `structuredContent` too: an action in `src/mcpActions.ts` returns `listed(...)`'s `{ text, structured }`, and `act` passes both on. `search`, `list_projects`, `list_changes`, `activity` and `graph` give a short line a row unless `detail`.
- The server's instructions stay under 2,000 characters (Claude Code keeps no more; a test checks), and every parameter has a description (a test checks that too).
- A new screen action gets an action in `src/mcpActions.ts`, a tool in `src-tauri/mcp/src/lib.rs` and its name in `ask::MCP_TOOLS` (`src-tauri/core/src/ask.rs`). A test in `src-tauri/mcp`, run by `make check`, keeps the server's tools and that list in step.

## Read aloud

Notes are read through macOS's AVSpeechSynthesizer, not WebKit's `speechSynthesis`, which hides the Premium and Enhanced voices people download and pauses unreliably.

- `src-tauri/src/platform/speech.rs`: the synthesiser, on the main thread with its delegate kept alive (it holds the delegate weakly).
- `src-tauri/src/speech.rs`: the `tts_*` commands, synchronous on purpose so a stop and the next speak arrive in order.
- `src/speech/player.ts`: gives each utterance its generation as its id and ignores anything older, holds a paused utterance, and remembers the next block when a pause lands as a block ends. It says the title and date before the first block and "That concludes …" after the last, outside the block's word positions so the highlight ignores them.
- `src/speech/blocks.ts`: makes the spoken text and the highlight's character map in one walk over the rendered note (offsets are UTF-16 at both ends).
- `platform/now_playing.rs`: the media keys, through Now Playing, cleared on stop. `caffeinate` keeps the screen awake while playing.
- `src/speech/*.test.*`: cover the extraction and the playback races with a fake synthesiser.

## Signing and permissions

Ad-hoc builds make macOS forget Brainstead's Full Disk Access after every rebuild. To stop that:

1. Create a self-signed code-signing certificate named `Brainstead Dev` (`signing.local.example` says how); don't share one between apps.
2. Copy `signing.local.example` to `signing.local` (untracked) and put the certificate's name in it.
3. Give the installed app Full Disk Access once.

Open at login works only in the installed app, not under `make dev`.

## Help

The `?` drawer's topics are the markdown files in `src/help/`, one per screen and Settings pane, plus the getting-started guides and the keyboard list. The window imports them and Rust embeds them (`core/build.rs`), so Ask's assistants answer from the same text through the MCP server's `help` tool. `src/help/help.test.ts` checks every screen has a topic, links point at real screens, and no emoji or real names creep in.

The example notes a new vault is made with are in `src-tauri/starter-vault/`, embedded the same way (`core/src/starter.rs`). `{{date}}`, `{{date+N}}`, `{{date-N}}` and `{{now}}` in a file's name or text become dates when it's written, so the example tasks aren't overdue. Its tests check every example says it's one and every link resolves.

## Screenshots

`make screenshots` retakes every scene in `tools/screenshots/scenes.json`, in both themes, from demo data it makes in `.demo/` (gitignored): the fixture vault plus a few demo files, with the app's home folder set to the demo's, so paths show as `~/Notes` and nothing outside `.demo/` is read or written. `--fresh` remakes the demo, `--docs` takes only the scenes the docs show, and `-j N` sets how many apps run side by side (4 by default, each with its own copy of the demo's app data). `--release` runs the app `make app` built instead of the dev build, for what only a release shows (its Content Security Policy). A scene's `caret` puts the caret in the editor where `|` marks the text, or with `hover` rests the mouse there, to check the editor's popups. `BRAINSTEAD_SCENE` is the screenshot mode: the window is invisible and takes no focus, so nothing flashes on screen (WebKit is told not to treat it as hidden, so animation frames and CodeMirror's popups still run), the text in images isn't read (text already kept is used), and the app saves its webview's snapshot to the file in `BRAINSTEAD_SNAPSHOT`; the script draws the window's buttons and rounded corners back on, and keeps a shot only once it has settled: it matches the scene's saved image or a second capture a few seconds later, so a blank or half-loaded shot is taken again. It needs Pillow.

Scenes the docs show have `"docs": true` and are written to `docs/images/`, which is committed; the rest, for checking a screen while building, go to `tools/screenshots/out/`, which isn't. Give a scene `"width"` to keep its own size (the menu-bar window is 720, its natural 2× size). The docs show each screenshot in the reader's theme with a `<picture>` element, linked to `docs/images/index.md`, which lists them all. A new screenshot in the docs gets `"docs": true` and a line in that list.
