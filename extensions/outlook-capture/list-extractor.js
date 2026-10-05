// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs as a content script in the active OWA tab via chrome.scripting.executeScript.
// Reads the message LIST (not the reading pane) and returns the threads the
// user has checked, so the popup can walk them one at a time.
//
// Returns { rows: [{ convid, senders, subject, label, scrollTop }],
//           ariaCount, rendered, scanned, passes, setSize }.
//
// What the OWA list DOM actually looks like (verified 2026-08-19, the
// outlook.office.com build):
//
//   <div role="option"
//        id="AQAABTomoxgBAAAFsO0M8wAAAAA="
//        data-convid="AAQkAGMyZDJlNTY4…"        ← stable per conversation
//        aria-selected="true"                    ← set on every checked row
//        aria-label="Unread Collapsed Replied <senders> <subject> 08:18 <preview…>"
//        data-focusable-row="true">
//
// Three things worth knowing before changing any of this:
//
// 1. `aria-selected="true"` is the checked-row signal, but it is ALSO set on
//    the single conversation that is merely open in the reading pane. So one
//    selected row means "nothing is really multi-selected", and the popup treats
//    that as the ordinary single-thread case.
// 2. `aria-posinset` is unreliable (the build above reports `1`, `0`, `0` for
//    three consecutive rows), so ordering comes from DOM order instead.
// 3. **The list is virtualised.** Rows scrolled out of view are removed from
//    the DOM entirely, so reading the document once only ever sees a screenful.
//    A selection made across a scroll silently lost everything below the fold.
//    So this scans: it walks the scroll container top to bottom collecting
//    checked rows, then puts the scroll position back where the user had it.
//    Each row records the `scrollTop` it was found at, which the popup later
//    uses to scroll that row back into existence before clicking it.
//
// The aria-label is a single unpunctuated run of flags + senders + subject +
// time + preview, which makes parsing a subject out of it hopeless. innerText
// is line-broken though, so the first two non-empty lines give senders and
// subject, which is good enough for a progress label — and, when the reading
// pane yields no usable heading, for the filename too. The real subject
// otherwise comes from the reading pane later, via extractor.js.

(async () => {
  const ROW_SELECTORS = ['[role="option"][data-convid]', '[role="option"][data-focusable-row]', 'div[role="option"]'];

  const CHECKBOX_SELECTORS = [
    '[role="checkbox"][aria-checked="true"]',
    'input[type="checkbox"]:checked',
    '[data-testid="checkbox"][aria-checked="true"]',
  ];

  /** Bound on the scan so a runaway list (or OWA lazy-loading more pages as we
   *  approach the bottom) can't spin forever. 60 passes at ~80% of a viewport
   *  each covers a very long list. */
  const MAX_PASSES = 60;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Let the virtualiser render the rows for the new scroll position. */
  async function afterScroll() {
    await new Promise((r) => requestAnimationFrame(() => r()));
    await sleep(140);
  }

  /** Rows in DOM (= list) order, de-duplicated across the fan-out selectors. */
  function listRows() {
    const seen = new Set();
    const rows = [];
    for (const sel of ROW_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        rows.push(el);
      }
    }
    // Restore document order: the selector fan-out interleaves it.
    rows.sort((a, b) => {
      const rel = a.compareDocumentPosition(b);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return rows;
  }

  function isChecked(row) {
    if (row.getAttribute("aria-selected") === "true") return true;
    for (const sel of CHECKBOX_SELECTORS) {
      if (row.querySelector(sel)) return true;
    }
    return false;
  }

  /** First two non-empty innerText lines: senders, then subject. */
  function describe(row) {
    const lines = (row.innerText || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return { senders: lines[0] ?? "", subject: lines[1] ?? "" };
  }

  /**
   * The element that actually scrolls the message list. Walks up from a row
   * rather than guessing a selector, since the class names are generated.
   */
  function scrollParent(el) {
    let node = el?.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  const found = new Map(); // convid -> row info, in first-seen (= list) order
  let ariaCount = null;
  let setSize = null;
  let renderedMax = 0;

  /** Harvest the checked rows currently in the DOM. */
  function collect(scrollTop) {
    const rows = listRows();
    renderedMax = Math.max(renderedMax, rows.length);
    for (const row of rows) {
      // OWA appends "N conversations selected" to the focused row's aria-label
      // when a multi-selection is live. It is the only place the true total is
      // exposed, so it doubles as the scan's early-exit target and as the
      // cross-check the popup warns on.
      const aria = row.getAttribute("aria-label") || "";
      const m = aria.match(/(\d+)\s+conversations?\s+selected/i);
      if (m) ariaCount = Number(m[1]);
      const size = Number(row.getAttribute("aria-setsize"));
      if (Number.isFinite(size) && size > 0) setSize = Math.max(setSize ?? 0, size);

      if (!isChecked(row)) continue;
      const convid = row.getAttribute("data-convid");
      if (!convid || found.has(convid)) continue;
      const { senders, subject } = describe(row);
      found.set(convid, {
        convid,
        senders,
        subject,
        label: subject || senders || convid.slice(0, 12),
        scrollTop,
      });
    }
  }

  const container = scrollParent(listRows()[0]);
  let passes = 0;

  if (!container) {
    // No scroller found (short list, or the DOM moved): read what's there.
    collect(0);
  } else {
    const originalScrollTop = container.scrollTop;
    container.scrollTop = 0;
    await afterScroll();
    while (passes < MAX_PASSES) {
      passes++;
      collect(container.scrollTop);
      // Stop as soon as we've accounted for every row OWA says is selected.
      if (ariaCount !== null && found.size >= ariaCount) break;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      if (atBottom) break;
      const step = Math.max(container.clientHeight * 0.8, 200);
      const before = container.scrollTop;
      container.scrollTop = before + step;
      await afterScroll();
      // Scroll didn't move (some other element is the real scroller): give up
      // rather than loop on the same rows.
      if (container.scrollTop === before) break;
    }
    // Put the user's view back exactly where it was.
    container.scrollTop = originalScrollTop;
    await afterScroll();
  }

  return {
    rows: [...found.values()],
    ariaCount,
    setSize,
    rendered: renderedMax,
    scanned: Boolean(container),
    passes,
  };
})();
