// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs in the popup. Starts the capture in the service worker and renders the
// state the worker has stored — it does no capture work itself.
//
// Chrome destroys this context the moment the popup loses focus, so a capture
// running here died on a tab switch. Long channel threads and meeting
// transcripts take multiple scroll passes, which made that easy to hit and
// expensive: the page-side work completed and the result was then discarded with
// the popup. `background.js` owns the run now, and this file renders it.

const goButton = /** @type {HTMLButtonElement} */ (document.getElementById("go"));
const statusEl = /** @type {HTMLDivElement} */ (document.getElementById("status"));

let run = { status: "idle", message: null };

goButton.addEventListener("click", () => void start());

// Live updates while the popup is open. When it's closed the worker still
// records progress and paints the toolbar badge.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "teams:progress") return;
  run = msg.state;
  render();
});

void init();

async function init() {
  try {
    run = (await getState()) ?? run;
    render();
    if (run.status === "done") void chrome.runtime.sendMessage({ type: "teams:clear-badge" });
  } catch (err) {
    reportWorkerFailure(err);
  }
}

async function start() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({ type: "teams:start", tabId: tab?.id });
    run = (await getState()) ?? run;
    render();
  } catch (err) {
    reportWorkerFailure(err);
  }
}

/** Read the worker's run state, turning both failure shapes - a rejected
 *  `sendMessage` and an `{ error }` reply - into one thrown Error. */
async function getState() {
  const reply = await chrome.runtime.sendMessage({ type: "teams:get-state" });
  if (reply?.error) throw new Error(reply.error);
  return reply;
}

/**
 * The background worker did not answer, so the capture never started. Fired
 * from `void init()` / `void start()`, an unhandled rejection here leaves the
 * popup completely blank, which gives the user nothing to act on.
 */
function reportWorkerFailure(err) {
  statusEl.textContent =
    `Couldn't reach the extension's background worker (${
      err instanceof Error ? err.message : String(err)
    }). Open your browser's extensions page (chrome://extensions, or ` +
    `edge://extensions), click Reload on this extension, then try again.`;
  statusEl.className = "error";
  goButton.disabled = true;
}

function render() {
  goButton.disabled = run.status === "running";
  statusEl.textContent = run.message?.text ?? "";
  statusEl.className = run.message?.kind ?? "";
}
