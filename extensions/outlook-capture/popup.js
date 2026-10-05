// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs in the popup. Sends commands to the service worker and renders whatever
// state the worker has stored — it does no capture work itself.
//
// That split exists because Chrome destroys this context the moment the popup
// loses focus. When the loop lived here, switching tabs mid-run killed the
// capture (and in combined mode discarded every thread captured so far, since
// the POST happens at the end). Now the run belongs to `background.js`: closing
// the popup, switching tabs, or switching windows makes no difference to it, and
// reopening the popup shows the run still in progress rather than nothing.
//
// The corollary is that this file must never hold run state of its own. The
// worker's `chrome.storage.session` record is the single source of truth, and
// everything below is a pure render of it.

/** Keep in sync with MAX_BATCH_THREADS in brainstead-core's webcapture.rs. */
const MAX_BATCH_THREADS = 25;

const goButton = /** @type {HTMLButtonElement} */ (document.getElementById("go"));
const batchButton = /** @type {HTMLButtonElement} */ (document.getElementById("go-batch"));
const statusEl = /** @type {HTMLDivElement} */ (document.getElementById("status"));
const logEl = /** @type {HTMLDivElement} */ (document.getElementById("log"));
const selectionEl = /** @type {HTMLDivElement} */ (document.getElementById("selection"));
const limitInput = /** @type {HTMLInputElement} */ (document.getElementById("limit"));
const labelInput = /** @type {HTMLInputElement} */ (document.getElementById("label"));
const labelRow = /** @type {HTMLDivElement} */ (document.getElementById("label-row"));

/** Latest scan result, so the batch button knows how many rows it would take. */
let scanned = { tabId: null, rows: [], listing: null };
/** Latest worker state. */
let run = { status: "idle", lines: [], message: null };

limitInput.max = String(MAX_BATCH_THREADS);

goButton.addEventListener("click", () => void start("owa:single"));
batchButton.addEventListener("click", () => void start("owa:batch"));
limitInput.addEventListener("change", () => renderSelection());
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", syncModeUi);
}

// Live progress while the popup happens to be open. When it isn't, the worker
// still records everything and paints the toolbar badge.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "owa:progress") return;
  run = msg.state;
  renderRun();
});

void init();

async function init() {
  syncModeUi();
  try {
    run = (await getState()) ?? run;
    renderRun();
    // A finished run's badge has served its purpose once the popup is open.
    if (run.status === "done") void chrome.runtime.sendMessage({ type: "owa:clear-badge" });
    // Don't disturb a live run by scrolling its list out from under it.
    if (run.status === "running") {
      selectionEl.textContent = "A capture is in progress.";
      return;
    }
    await scan();
  } catch (err) {
    reportWorkerFailure(err);
  }
}

/** Read the worker's run state, turning both failure shapes - a rejected
 *  `sendMessage` and an `{ error }` reply - into one thrown Error. */
async function getState() {
  const reply = await chrome.runtime.sendMessage({ type: "owa:get-state" });
  if (reply?.error) throw new Error(reply.error);
  return reply;
}

/**
 * The background worker did not answer, so nothing below this point ran.
 *
 * This needs saying out loud rather than being swallowed. `init()` is fired as
 * `void init()`, so a rejection here used to vanish and leave the popup on its
 * static "Checking the message list…" placeholder - which is indistinguishable
 * from the extension having looked at the list and found no selection. That is
 * exactly how it got reported: "doesn't seem to pick up that I'm selecting
 * threads", when in truth it never got as far as reading them.
 */
function reportWorkerFailure(err) {
  selectionEl.textContent =
    "Couldn't reach the extension's background worker, so the message list was " +
    "never read - this is not a problem with your selection. Open your browser's " +
    "extensions page (chrome://extensions, or edge://extensions), click Reload on " +
    "this extension, then reopen this popup.";
  statusEl.textContent = err instanceof Error ? err.message : String(err);
  statusEl.className = "error";
  // Both buttons go through the worker, so neither can work right now.
  goButton.disabled = true;
  batchButton.disabled = true;
}

function selectedMode() {
  const checked = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="mode"]:checked'));
  return checked?.value === "combined" ? "combined" : "separate";
}

function syncModeUi() {
  labelRow.hidden = selectedMode() !== "combined";
}

function readLimit() {
  const n = Number(limitInput.value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_BATCH_THREADS);
}

/** Ask the worker to read the checked rows out of the message list. */
async function scan() {
  selectionEl.textContent = "Scanning the message list for checked threads…";
  const reply = await chrome.runtime.sendMessage({ type: "owa:scan" });
  if (!reply || reply.error) {
    scanned = { tabId: null, rows: [], listing: null };
    selectionEl.textContent = reply?.error ?? "Couldn't read the message list.";
    batchButton.disabled = true;
    return;
  }
  scanned = { tabId: reply.tabId, rows: reply.listing.rows ?? [], listing: reply.listing };
  renderSelection();
}

function renderSelection() {
  const rows = scanned.rows;
  if (rows.length < 2) {
    selectionEl.textContent = "No multi-selection found. Tick the checkboxes on two or more threads in the list, then reopen this popup.";
    batchButton.disabled = true;
    batchButton.textContent = "Ingest selected threads";
    return;
  }
  const limit = Math.min(readLimit(), rows.length);
  const capped = limit < rows.length ? `, capturing the first ${limit}` : "";
  // The scan walks the whole virtualised list, so this should agree with OWA's
  // own count. If it doesn't, say so rather than quietly capturing fewer.
  const ariaCount = scanned.listing?.ariaCount;
  const missing =
    typeof ariaCount === "number" && ariaCount > rows.length
      ? ` OWA reports ${ariaCount} selected but the scan found ${rows.length}. Scroll the list so the rest render at least once, then reopen this popup.`
      : "";
  selectionEl.textContent = `${rows.length} threads selected${capped}.${missing}`;
  batchButton.textContent = `Ingest ${limit} selected thread${limit === 1 ? "" : "s"}`;
  batchButton.disabled = run.status === "running";
}

async function start(type) {
  const payload =
    type === "owa:batch"
      ? {
          type,
          tabId: scanned.tabId,
          options: { mode: selectedMode(), label: labelInput.value, limit: readLimit() },
        }
      : { type, tabId: scanned.tabId };
  try {
    await chrome.runtime.sendMessage(payload);
    run = (await getState()) ?? run;
    renderRun();
  } catch (err) {
    reportWorkerFailure(err);
  }
}

function renderRun() {
  const busy = run.status === "running";
  goButton.disabled = busy;
  batchButton.disabled = busy || scanned.rows.length < 2;

  if (run.message) {
    statusEl.textContent = run.message.text;
    statusEl.className = run.message.kind ?? "";
  } else {
    statusEl.textContent = "";
    statusEl.className = "";
  }

  logEl.textContent = "";
  for (const line of run.lines ?? []) {
    const el = document.createElement("div");
    el.textContent = line.text;
    if (line.kind) el.className = line.kind;
    logEl.append(el);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
