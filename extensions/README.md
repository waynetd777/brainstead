# Capture extensions

Chrome (and Edge, Brave, Chromium) extensions for Brainstead. Two send what's open in Outlook on the web or Microsoft Teams to Brainstead, which writes it into the vault's `sources/` folder, ready to ingest; the third hands the open Slack tab's sign-in over for Slack sync. Microsoft Graph isn't used.

- [`outlook-capture/`](outlook-capture/README.md): the open email thread, or the threads ticked in the message list (one file each, or one combined file).
- [`teams-capture/`](teams-capture/README.md): the open chat or channel thread, or a meeting's Recap → Transcript, named with the meeting's day when the recap page shows it.
- [`slack-capture/`](slack-capture/README.md): Slack sync's sign-in, handed over from an open Slack tab; it captures nothing itself.

They reach Brainstead by Chrome native messaging: Chrome starts Brainstead's helper (the app's own program, `com.wayned.brainstead`), which writes the file through the same safe write as the app. It works while Brainstead is closed and opens no port. Brainstead registers the helper with each installed browser when it starts, allowing only these three extensions, whose IDs are fixed by the public key in their manifests.

**Keeping the sign-in alive** is the same in all three (`handover.js`, one file kept identical in each extension folder; `make check` fails when the copies differ, D-20261126-02). Each hands its tab's sign-in over on a timer and when the browser starts or the extension is reloaded; stops Chrome putting the tab to sleep; reloads a tab that is asleep or doesn't answer within 20 seconds; reloads it when Brainstead says the sign-in was turned down and the tab has nothing newer, or (Teams and Outlook) 4 minutes before a token the sync uses runs out (a hand-over that sees one running out within 25 minutes sets an alarm for then: the page reuses a cached token until it's within 5 minutes of running out, so an earlier reload fetches nothing new); and hands over again a minute after a reload. It never reloads a tab you're looking at or one playing sound (a call), and at most once in 20 minutes. What the last hand-over did is kept in the extension's storage (`signin-last-handover`, or `slack-last-handover`), never a token. Only a real sign-out needs you: sign in again in that tab.

Install: open Brainstead once, then load each folder unpacked on `chrome://extensions` with Developer mode on. Settings › Capture extensions shows whether each is connected and its last capture. After an update, open that page (it refreshes the folder) and click reload on the extension's card in `chrome://extensions`.

Tests: `extensions/**/*.test.js` run under Vitest with the app's (`make check`); `outlook-capture/test-harness/` runs with `node`.
