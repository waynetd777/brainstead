// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs as a content script in the active Teams tab via chrome.scripting.executeScript.
// Returns { url, title, messages: [{ sender, date?, body }] }.
//
// Teams web (teams.microsoft.com/v2) renders the conversation as a
// virtualised list — only the messages currently in the viewport are in
// the DOM. The extension captures *what is visible* at click time; scroll
// up first if you need older history. That matches the OWA pattern's
// "single user action per ingest" stance.
//
// DOM shape, modern Teams (May 2026):
//   - Conversation lives inside <main> / [role="main"] / [data-tid="message-pane-list"].
//   - Each message is a [data-tid="chat-pane-message"] (1:1 / group chat) or
//     a [data-tid="threaded-thread-item"] (channel thread reply).
//   - Inside, author + timestamp + body each carry their own data-tid.
//   - The conversation title sits in a header bar above the list, usually
//     [data-tid="title-text"] or [data-tid="chat-pane-title"].
//
// Selectors fan out — if Microsoft ships a UI update and one variant
// stops matching, the rest still pick up the message. Update the lists
// here when that happens; the README documents the workflow.

(async () => {
  // Diagnostic marker — lets us verify (via DevTools console in the
  // frame's context) that the extractor actually ran in this frame and
  // how many times. Helpful when an iframe-hosted recap page isn't
  // receiving the injection.
  window.__teamsIngestRan = (window.__teamsIngestRan || 0) + 1;
  window.__teamsIngestHref = location.href;

  const MESSAGE_SELECTORS = [
    '[data-tid="chat-pane-message"]',
    '[data-tid="threaded-thread-item"]',
    '[data-tid="threaded-channel-item"]',
    '[id^="messageRendererBlock_"]',
    'div[role="listitem"][aria-label]',
  ];

  const AUTHOR_SELECTORS = [
    '[data-tid="message-author-name"]',
    '[data-tid="messageAuthorName"]',
    '[data-tid="messageMyAuthorName"]',
    '[data-tid="message-sender-name"]',
    '[data-tid="message-author"]',
    '[id^="author-"]',
    '[id^="message-author-"]',
    '[id*="-author-"]',
    'span[class*="authorName" i]',
    'span[class*="messageAuthor" i]',
  ];

  const TIMESTAMP_SELECTORS = ['[data-tid="message-timestamp"]', '[data-tid="messageTimestamp"]', "time[datetime]", '[id*="timestamp"]'];

  const BODY_SELECTORS = [
    '[data-tid="messageBodyContent"]',
    '[data-tid="message-body-content"]',
    'div[id^="content-"]',
    'div[class*="messageBody" i]',
  ];

  // Title selectors run document-wide — scoping to [role="main"] doesn't
  // help, because Teams also puts the message-list region heading inside
  // main (with accessible name "Message list"). Generic role="heading"
  // selectors are intentionally NOT here — they catch UI chrome like
  // "Message list", "Conversation actions", etc. We rely entirely on
  // specific data-tid attributes, plus a chrome-string blacklist on
  // whatever matches.
  const TITLE_SELECTORS = [
    '[data-tid="chat-title"]', // canonical h2 in modern Teams entity-header
    '[data-tid="title-text"]',
    '[data-tid="chat-pane-title"]',
    '[data-tid="chat-pane-title-button"]',
    '[data-tid="chat-pane-banner-title-text"]',
    '[data-tid="chat-banner-title"]',
    '[data-tid="conversation-name"]',
    '[data-tid="conversation-title"]',
    '[data-tid="conversation-header-title"]',
    '[data-tid="conversation-list-item-header-title"]',
    '[data-tid="threadHeaderTitle"]',
    '[data-tid="thread-header-title"]',
    '[data-tid="chat-header-title"]',
    '[data-tid="channel-name"]',
    '[data-tid="topic-text"]',
    '[data-tid="topic-title"]',
    // Meeting / calling chat headers (likely the case for "<ticket#> - <name>"
    // style chats that come in via integration or recurring-meeting wiring).
    '[data-tid="meetingTitle"]',
    '[data-tid="meeting-chat-title"]',
    '[data-tid="meeting-title"]',
    '[data-tid="meetingChatHeaderTitle"]',
    '[data-tid="callingMeetingTitle"]',
    // Generic title-ish elements inside the conversation banner / header.
    '[role="banner"] [data-tid*="title" i]',
    '[role="banner"] [data-tid*="name" i]',
    'button[aria-label^="Open chat"]',
    'button[aria-label^="Open this chat"]',
    'button[aria-label^="Chat info"]',
    'button[aria-label$="profile"]',
  ];

  // Strings that some "title-ish" selectors return but are actually UI
  // chrome, not the conversation name. Reject these and try the next
  // selector / fall through to the sender-derived name.
  const UI_CHROME_RE =
    /^(message list|conversation actions|new conversation|reply|more options|files|chat|teams|calendar|activity|apps|navigation pane|folder pane|search results|search|filter|inbox|focused|other|new|recent|pinned|hidden|new chat|new message|chat list|reading pane)$/i;

  /** Pick the first selector that yields a non-empty innerText. */
  function pick(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const txt = el.innerText?.trim();
      if (txt) return txt;
    }
    return undefined;
  }

  /** Read a timestamp value off a single element, preferring [datetime] (ISO). */
  function readTimestamp(el) {
    const iso = el.getAttribute("datetime");
    if (iso) return iso;
    const txt = el.innerText?.trim() || el.getAttribute("title")?.trim();
    return txt || undefined;
  }

  /**
   * Build a document-ordered index of every timestamp element. Same
   * rationale as buildAuthorIndex — Teams shows ONE timestamp per
   * message-group header (next to the author), not one per message; for
   * follow-up messages in a group we need the group header's timestamp.
   */
  function buildTimestampIndex() {
    const seen = new Set();
    const all = [];
    for (const sel of TIMESTAMP_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const txt = readTimestamp(el);
        if (txt) all.push({ el, txt });
      }
    }
    all.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return all;
  }

  /** Extract a time-looking token from a comma-separated aria-label. */
  function extractTimeFromAria(aria) {
    const parts = aria.split(/,\s*/);
    // Skip the first part (author). Scan the next few for something
    // time-shaped: "09:40", "9:40 AM", "Yesterday 09:40", "Mon 09:40".
    for (let i = 1; i < Math.min(parts.length, 4); i++) {
      const t = parts[i].trim();
      if (/\d{1,2}:\d{2}/.test(t)) return t;
      if (/\b(today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(t) && /\d/.test(t)) return t;
    }
    return undefined;
  }

  /** Closest timestamp at or before this wrapper in document order. */
  function findTimestampFor(wrapper, timestampIndex) {
    // 1. Direct descendant.
    for (const sel of TIMESTAMP_SELECTORS) {
      const el = wrapper.querySelector(sel);
      if (el) {
        const txt = readTimestamp(el);
        if (txt) return txt;
      }
    }
    // 2. aria-label on the wrapper.
    const aria = wrapper.getAttribute("aria-label") ?? "";
    const t = extractTimeFromAria(aria);
    if (t) return t;
    // 3. Closest preceding entry in the index.
    let best;
    for (const a of timestampIndex) {
      const pos = a.el.compareDocumentPosition(wrapper);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        best = a.txt;
      } else if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
        break;
      } else if (wrapper.contains(a.el)) {
        return a.txt;
      }
    }
    return best;
  }

  /**
   * Build a document-ordered index of every author-header element. Teams
   * renders the author name on a *parent* "message group" container, NOT
   * inside each individual message wrapper, so `wrapper.querySelector(AUTHOR)`
   * misses it. The index lets us look up the closest author header that
   * appears BEFORE a given message in document order — which is correct,
   * because the author header always precedes the messages it labels.
   */
  function buildAuthorIndex() {
    const seen = new Set();
    const all = [];
    for (const sel of AUTHOR_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const txt = el.innerText?.trim();
        if (txt) all.push({ el, txt });
      }
    }
    all.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return all;
  }

  /** Closest author header at or before this wrapper in document order. */
  function findAuthorFor(wrapper, authorIndex) {
    // 1. Direct descendant — fastest path when author IS inside the wrapper.
    for (const sel of AUTHOR_SELECTORS) {
      const el = wrapper.querySelector(sel);
      if (el) {
        const txt = el.innerText?.trim();
        if (txt) return txt;
      }
    }
    // 2. aria-label on the wrapper. Teams accessibility labels often
    //    include the author and timestamp, e.g.
    //    "Maya Patel, Yesterday 09:40 AM, Message from Maya Patel, ...".
    const aria = wrapper.getAttribute("aria-label") ?? "";
    const m = aria.match(/^(?:Message\s+from\s+|From\s+|Reply\s+from\s+)?([A-Z][\w'.\-]+(?:\s+[A-Z][\w'.\-]+){0,4})(?:,|\s+said|\s+wrote)/);
    if (m) return m[1].trim();
    // 3. Closest preceding entry in the author index. Walk forward
    //    through the document-ordered list; the last one seen before the
    //    wrapper is the one labelling it.
    let best;
    for (const a of authorIndex) {
      const pos = a.el.compareDocumentPosition(wrapper);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
        best = a.txt;
      } else if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
        break;
      } else if (wrapper.contains(a.el)) {
        // Already handled in step 1, but defend against ordering quirks.
        return a.txt;
      }
    }
    return best;
  }

  /**
   * Stable per-message id used to dedupe across scroll passes. Tries DOM
   * id, then data-mid, then walks one level into the wrapper for known
   * patterns, then falls back to a 32-bit hash of sender + date + body
   * prefix (stable enough that re-capturing the same message produces
   * the same key).
   */
  function getMessageId(wrapper, msg) {
    if (wrapper.id) return wrapper.id;
    const mid = wrapper.getAttribute("data-mid");
    if (mid) return mid;
    const child = wrapper.querySelector('[id^="messageBlock_"], [id^="messageRendererBlock_"], [data-mid]');
    if (child?.id) return child.id;
    const childMid = child?.getAttribute("data-mid");
    if (childMid) return childMid;
    return synthHash(`${msg.sender}|${msg.date ?? ""}|${msg.body.slice(0, 200).replace(/\s+/g, " ").trim()}`);
  }

  function synthHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return `synth_${(h >>> 0).toString(16)}`;
  }

  /** Extract messages currently rendered in the DOM. Called per scroll pass. */
  function extractVisibleMessages() {
    const seen = new Set();
    const wrappers = [];
    for (const sel of MESSAGE_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (!seen.has(el)) {
          seen.add(el);
          wrappers.push(el);
        }
      }
    }
    // Preserve visual (top-to-bottom) order.
    wrappers.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const authorIndex = buildAuthorIndex();
    const timestampIndex = buildTimestampIndex();
    const out = [];
    let lastSender;
    let lastDate;
    for (const wrapper of wrappers) {
      const body = pick(wrapper, BODY_SELECTORS);
      if (!body) continue;
      let sender = findAuthorFor(wrapper, authorIndex);
      // Final fallback: carry the previous sender forward (Teams collapses
      // consecutive messages from the same author).
      if (!sender) sender = lastSender ?? "(unknown)";
      lastSender = sender;
      let date = findTimestampFor(wrapper, timestampIndex);
      if (!date) date = lastDate;
      if (date) lastDate = date;
      const msg = { sender, body };
      if (date) msg.date = date;
      msg.id = getMessageId(wrapper, msg);
      out.push(msg);
    }
    return out;
  }

  /** Find the scrollable element that owns the message list. */
  function findScrollContainer() {
    const candidates = [
      '[data-tid="message-pane-list"]',
      '[data-tid="chat-pane-list"]',
      '[data-tid="threaded-thread-list"]',
      '[role="region"][aria-label="Message list"]',
      '[role="region"][aria-label="Messages"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (isScrollable(el)) return el;
      const ancestor = findScrollableAncestor(el);
      if (ancestor) return ancestor;
    }
    // Last resort: walk up from the first message wrapper.
    const firstMsg = document.querySelector(MESSAGE_SELECTORS.join(", "));
    if (firstMsg) return findScrollableAncestor(firstMsg);
    return null;
  }

  function isScrollable(el) {
    const overflow = getComputedStyle(el).overflowY;
    return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1;
  }

  function findScrollableAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (isScrollable(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Labels Teams (and other Microsoft chat surfaces) use for the
  // "fetch more history" button shown when scrollTop reaches the top of
  // the currently-loaded buffer. We click any we find before treating
  // a pass as "nothing more to load" — many builds gate the network
  // fetch on this button, not on scrollTop alone.
  const LOAD_OLDER_LABELS = [
    "Load earlier messages",
    "Load previous messages",
    "Show earlier messages",
    "Show older messages",
    "Show more messages",
    "Older messages",
    "Earlier messages",
    "Load more",
    "Show more",
  ];

  function clickLoadOlder() {
    let clicked = 0;
    for (const label of LOAD_OLDER_LABELS) {
      const escaped = label.replace(/"/g, '\\"');
      for (const btn of document.querySelectorAll(
        `button[aria-label="${escaped}"], button[title="${escaped}"], [role="button"][aria-label="${escaped}"]`,
      )) {
        btn.click();
        clicked++;
      }
    }
    // Also match by visible text — some builds put the label as innerText, not aria-label.
    if (clicked === 0) {
      for (const btn of document.querySelectorAll('button, [role="button"]')) {
        const txt = btn.innerText?.trim().toLowerCase();
        if (!txt || txt.length > 40) continue;
        if (LOAD_OLDER_LABELS.some((l) => txt === l.toLowerCase())) {
          btn.click();
          clicked++;
        }
      }
    }
    return clicked > 0;
  }

  /**
   * Synthesize a wheel-up gesture on the scroll container. Some Teams
   * builds bind their history-fetch observer to wheel events rather than
   * to scrollTop changes, so programmatic scrollTop assignment alone
   * doesn't trigger the fetch.
   */
  function dispatchWheelUp(container) {
    const event = new WheelEvent("wheel", {
      deltaY: -container.clientHeight,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
  }

  /** Best-effort progress beacon to the popup. Silent if popup is closed. */
  function reportProgress(detail) {
    try {
      chrome.runtime.sendMessage({ type: "teams-ingest-progress", ...detail });
    } catch {
      /* popup closed; ignore */
    }
  }

  /**
   * Scroll up in viewport-sized chunks, capturing what's visible at each
   * step and merging by stable message id. Stops when:
   *   - scrollTop hits 0 (we hit the top of the chat)
   *   - two passes in a row reveal no new messages
   *   - a wall-clock timeout fires (defensive)
   *   - MAX_PASSES exceeded (also defensive)
   *
   * Returns { messages, passes, atTop } — messages in chronological order
   * (oldest first).
   */
  async function captureAllPasses() {
    const container = findScrollContainer();
    const idIndex = new Map();
    const orderedIds = [];

    /**
     * Merge a pass's messages into the running ordered list.
     * - Already-seen ids: upgrade attribution if the new pass has better data
     *   (e.g. unknown→named sender, missing→present date).
     * - New ids: insert before the closest already-seen id later in the pass;
     *   if none, batch as "unanchored" and prepend (we're scrolling up, so
     *   unanchored messages are older than everything we have).
     */
    function ingest(passMessages) {
      let inserted = 0;
      const unanchored = [];
      for (let i = 0; i < passMessages.length; i++) {
        const msg = passMessages[i];
        const id = msg.id;
        if (idIndex.has(id)) {
          const existing = idIndex.get(id);
          if (existing.sender === "(unknown)" && msg.sender !== "(unknown)") existing.sender = msg.sender;
          if (!existing.date && msg.date) existing.date = msg.date;
          continue;
        }
        idIndex.set(id, msg);
        let anchor = -1;
        for (let j = i + 1; j < passMessages.length; j++) {
          const idx = orderedIds.indexOf(passMessages[j].id);
          if (idx !== -1) {
            anchor = idx;
            break;
          }
        }
        if (anchor === -1) unanchored.push(id);
        else orderedIds.splice(anchor, 0, id);
        inserted++;
      }
      if (unanchored.length > 0) {
        if (orderedIds.length === 0) orderedIds.push(...unanchored);
        else orderedIds.unshift(...unanchored);
      }
      return inserted;
    }

    // Initial pass — whatever's on screen right now.
    ingest(extractVisibleMessages());
    reportProgress({ pass: 0, captured: idIndex.size, atTop: false });

    if (!container) {
      return { messages: orderedIds.map((id) => idIndex.get(id)), passes: 1, atTop: true };
    }

    const startedAt = Date.now();
    const WALL_TIMEOUT_MS = 300_000;
    const MAX_PASSES = 300;
    let consecutiveEmpty = 0;
    let pass = 0;

    while (pass < MAX_PASSES) {
      if (Date.now() - startedAt > WALL_TIMEOUT_MS) break;
      const beforeTop = container.scrollTop;
      const beforeHeight = container.scrollHeight;

      // Scroll up. Even when we're already at scrollTop=0 we keep going
      // for a few more passes — Teams may load history triggered by the
      // wheel event or by the "Load earlier" button rather than by the
      // scrollTop change.
      container.scrollTop = Math.max(0, beforeTop - container.clientHeight * 0.8);
      // Tiny settle so any "Load earlier messages" button can render.
      await sleep(150);
      const buttonClicked = clickLoadOlder();
      dispatchWheelUp(container);
      // 700 ms is a reasonable compromise between Teams' history-fetch
      // latency and total capture time. Tune up if older messages come
      // through truncated; tune down if it feels sluggish.
      await sleep(700);

      const afterTop = container.scrollTop;
      const afterHeight = container.scrollHeight;
      const inserted = ingest(extractVisibleMessages());
      // "Did anything change" combines three signals: did scrollTop
      // actually move, did the container grow taller (new content
      // prepended above), or did we ingest at least one new message id.
      // Teams sometimes prepends content without scrollTop moving (it
      // adjusts scrollTop to keep the viewport stable), so scrollHeight
      // growth is the most reliable signal.
      const progress = inserted > 0 || afterHeight > beforeHeight || afterTop < beforeTop;
      pass++;
      reportProgress({ pass, captured: idIndex.size, atTop: afterTop <= 0 });

      if (!progress && !buttonClicked) {
        consecutiveEmpty++;
        // Tolerate 3 consecutive empty passes — gives Teams a beat to
        // honour the wheel event / button click before we bail.
        if (consecutiveEmpty >= 3) break;
      } else {
        consecutiveEmpty = 0;
      }
    }

    return {
      messages: orderedIds.map((id) => idIndex.get(id)),
      passes: pass + 1,
      atTop: container.scrollTop <= 0,
      scrollContainerDesc: describeElement(container),
    };
  }

  /** Compact element descriptor for diagnostics. */
  function describeElement(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const dataTid = el.getAttribute("data-tid");
    const role = el.getAttribute("role");
    const aria = el.getAttribute("aria-label");
    const attrs = [dataTid && `[data-tid="${dataTid}"]`, role && `[role="${role}"]`, aria && `[aria-label="${aria.slice(0, 40)}"]`]
      .filter(Boolean)
      .join("");
    return `${tag}${id}${attrs}`;
  }

  /**
   * Fallback that reads the currently-selected chat/channel in the left
   * rail. When the title selectors fail (meeting chats, integration-created
   * chats with unusual headers), the sidebar's selected-item name is
   * usually still the same chat title.
   */
  function findSelectedSidebarName() {
    const candidates = [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[aria-selected="true"]',
      '[data-tid="chat-list-item"][class*="selected" i]',
      '[data-tid*="chat-list" i][class*="selected" i]',
      '[data-tid*="channel-list" i][class*="selected" i]',
    ];
    for (const sel of candidates) {
      for (const el of document.querySelectorAll(sel)) {
        // Prefer a title-ish descendant if one exists.
        const titleChild = el.querySelector('[data-tid*="title" i], [data-tid*="name" i], [class*="title" i]');
        let txt = titleChild?.innerText?.trim();
        if (!txt) txt = el.innerText?.trim().split("\n")[0]?.trim();
        if (txt && txt.length > 1 && txt.length < 200 && !UI_CHROME_RE.test(txt)) {
          return txt;
        }
      }
    }
    return null;
  }

  /**
   * Extract the conversation title. Priority:
   *   1. A TITLE_SELECTORS match anywhere in the document, filtered
   *      against UI_CHROME_RE so generic strings like "Message list" /
   *      "Conversation actions" don't win even if they match a title-ish
   *      selector. innerText is preferred; aria-label is the fallback
   *      (some Teams title buttons have empty innerText but expose the
   *      name via "Open <Name> profile" / "Open <Name>" aria-labels).
   *   2. The currently-selected item in the left-rail chat / channel
   *      list — that name is always the conversation we're viewing.
   *   3. Derive from the senders ("Chat with Jane Doe", "Chat with Jane,
   *      Bob, Alice") so the file is at least named after the participants.
   *   4. document.title (Teams sets this to "Microsoft Teams" — last resort).
   */
  function getConversationTitle(messages) {
    for (const sel of TITLE_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        let txt = el.innerText?.trim();
        if (!txt) {
          const aria = el.getAttribute("aria-label") ?? "";
          const m = aria.match(/^(?:Open\s+)?(.+?)(?:\s+(?:profile|chat|conversation))?$/i);
          if (m) txt = m[1].trim();
        }
        if (txt && txt.length > 1 && txt.length < 200 && !UI_CHROME_RE.test(txt)) {
          return txt;
        }
      }
    }
    const sidebar = findSelectedSidebarName();
    if (sidebar) return sidebar;
    const others = [...new Set(messages.map((m) => m.sender).filter((s) => s && s !== "(unknown)"))];
    if (others.length === 1) return `Chat with ${others[0]}`;
    if (others.length > 1 && others.length <= 5) return `Chat with ${others.join(", ")}`;
    if (others.length > 5) return `Chat with ${others.slice(0, 4).join(", ")} and ${others.length - 4} others`;
    return document.title || "";
  }

  // ──────────────────────────────────────────────────────────────────────
  // Transcript mode (Recap → Transcript tab)
  // ──────────────────────────────────────────────────────────────────────
  //
  // The chat path above scrolls UP (older history) through Teams' virtualised
  // message list. Meeting transcripts are the mirror image: oldest utterance
  // first, newest at the bottom, scroll DOWN to capture history. Different
  // DOM shape, different scroll container — kept as a parallel code path
  // rather than refactoring captureAllPasses, to minimise risk to the
  // working chat flow.
  //
  // Detection is DOM-based. Teams uses client-side routing without updating
  // the URL bar on the recap → transcript navigation (`location.href` stays
  // pinned at `/v2/`), so a URL pattern check is unreliable on its own.
  // The transcript view's scroll container has a stable id +
  // data-testid; presence of either is the signal.

  const TRANSCRIPT_SCROLL_SELECTORS = ["#scrollToTargetTargetedFocusZone", '[data-testid="scroll-to-target-targeted-focus-zone"]'];

  /**
   * Teams loads the meeting Recap → Transcript tab into an `about:blank`
   * iframe (`#xplatIframe` / `name="RecapxPlatIframe"`) with a sandbox
   * attribute that, despite including `allow-same-origin`, blocks the
   * parent from reading `contentDocument` (confirmed empirically — the
   * extension's isolated world sees `null`). The popup works around this
   * by injecting the extractor into every frame's frameId enumerated via
   * `chrome.webNavigation.getAllFrames`, so this extractor runs once
   * per frame and just queries its own `document` directly. */

  // Per-utterance group. Stable id prefix (vs hashed FluentUI classes).
  // The class fallback uses `[class*=]` because Microsoft suffixes the class
  // with a build-version number (`baseEntry-373`); the prefix is stable.
  const TRANSCRIPT_ROW_SELECTOR = '[id^="entry-"], [class*="baseEntry-"][role="group"]';
  const TRANSCRIPT_BODY_SELECTOR = '[id^="sub-entry-"], [class*="entryText-"]';
  const TRANSCRIPT_TIME_SELECTOR = '[id^="Header-timestamp-"], [class*="baseTimestamp-"]';
  const TRANSCRIPT_SPEAKER_SELECTOR = '[class*="itemDisplayName-"]';
  // Rows that announce "X started transcription" / "Recording started" sit
  // in the same list but have a different inner structure (eventSpeakerName /
  // eventText classes instead of itemDisplayName / entryText). Filter them.
  const TRANSCRIPT_EVENT_MARKER = '[class*="eventSpeakerName-"], [class*="eventText-"]';

  function isTranscriptPage() {
    for (const sel of TRANSCRIPT_SCROLL_SELECTORS) {
      if (document.querySelector(sel)) return true;
    }
    // Defensive backup: any entry row with a sub-entry body is transcript-shape.
    for (const row of document.querySelectorAll('[id^="entry-"]')) {
      if (row.querySelector('[id^="sub-entry-"]')) return true;
    }
    return false;
  }

  function findTranscriptScrollContainer() {
    for (const sel of TRANSCRIPT_SCROLL_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /** Condense "1 minute 2 seconds" / "2 minutes 45 seconds" → "1:02" / "2:45".
   *  Adds hours when present ("1 hour 5 minutes 0 seconds" → "1:05:00"). */
  function condenseTimeFromAria(human) {
    const h = /\b(\d+)\s+hour/i.exec(human);
    const m = /\b(\d+)\s+minute/i.exec(human);
    const s = /\b(\d+)\s+second/i.exec(human);
    const hours = h ? parseInt(h[1], 10) : 0;
    const minutes = m ? parseInt(m[1], 10) : 0;
    const seconds = s ? parseInt(s[1], 10) : 0;
    if (!h && !m && !s) return human.trim(); // unparseable → pass through
    const pad = (n) => String(n).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  function extractTranscriptRow(row) {
    if (row.querySelector(TRANSCRIPT_EVENT_MARKER)) return null;
    const bodyEl = row.querySelector(TRANSCRIPT_BODY_SELECTOR);
    const body = bodyEl?.innerText?.trim();
    if (!body) return null;

    // Initial row of a speaker turn: header sibling carries the display name
    // and the visible short-form time ("0:14"). Continuation rows have no
    // header — same speaker, just a new utterance.
    let speaker = "";
    let time = "";
    const rightColumn = row.closest('[id^="rightColumn-"]');
    if (rightColumn) {
      const nameEl = rightColumn.querySelector(TRANSCRIPT_SPEAKER_SELECTOR);
      if (nameEl) speaker = nameEl.innerText?.trim() || "";
      const timeEl = rightColumn.querySelector(TRANSCRIPT_TIME_SELECTOR);
      if (timeEl) time = timeEl.innerText?.trim() || "";
    }
    // Fallback: parse from the row's own aria-label, which is ALWAYS present
    // and is the only attribution source for continuation rows. Format:
    //   "Speaker Name (Suffix) <N hours? N? minutes? N? seconds?>"
    if (!speaker || !time) {
      const aria = row.getAttribute("aria-label") || "";
      const m =
        aria.match(/^(.+?)\s+((?:\d+\s+hours?\s+)?(?:\d+\s+minutes?\s+)?\d+\s+seconds?)\s*$/i) ||
        aria.match(/^(.+?)\s+((?:\d+\s+hours?\s+)?\d+\s+minutes?)\s*$/i) ||
        aria.match(/^(.+?)\s+(\d+\s+hours?)\s*$/i);
      if (m) {
        if (!speaker) speaker = m[1].trim();
        if (!time) time = condenseTimeFromAria(m[2].trim());
      }
    }

    return {
      speaker: speaker || "(unknown)",
      time,
      body,
      id: row.id || synthHash(`${speaker}|${time}|${body.slice(0, 200)}`),
    };
  }

  /** Meeting title sits in the recap header in the *parent* Teams shell,
   *  OUTSIDE the transcript iframe. There's no `data-tid` to anchor on,
   *  so heuristic-match against FluentUI's pattern of putting the full
   *  text in both `innerText` and a `title=` attribute (used for tooltip
   *  on truncation). Pick the longest such span. We scan both our own
   *  document AND the top frame's document because the extractor runs
   *  inside the recap iframe — the title element is only in the parent.
   *  Same-origin (the iframe is `about:blank` and inherits the parent's
   *  origin), so the cross-frame read is allowed. */
  /** Meeting title sits in the parent Teams shell. When the extractor
   *  runs inside the recap iframe, our own document doesn't have it —
   *  reach into the parent frame's document via `window.top`. The
   *  iframe's `allow-same-origin` sandbox lets us read the parent's DOM
   *  even though the parent can't read ours. */
  function getMeetingTitle() {
    const scroll = findTranscriptScrollContainer();
    const docs = [document];
    try {
      if (window.top && window.top !== window && window.top.document) {
        docs.push(window.top.document);
      }
    } catch {
      // Cross-origin top frame — skip it.
    }
    let best = null;
    for (const doc of docs) {
      const candidates = doc.querySelectorAll('span[title][class*="fui-StyledText"]');
      for (const el of candidates) {
        if (scroll && scroll.contains(el)) continue;
        const title = el.getAttribute("title")?.trim();
        const text = el.textContent?.trim();
        if (!title || title.length < 2) continue;
        if (title !== text) continue;
        if (UI_CHROME_RE.test(title)) continue;
        if (!best || title.length > best.length) best = title;
      }
    }
    if (best) return best;
    // Last resort: strip the Teams chrome suffix off the document title.
    // (When in the iframe, `document.title` is empty — fall back to
    // `window.top.document.title` if accessible.)
    let docTitle = document.title;
    try {
      if (!docTitle && window.top && window.top !== window) {
        docTitle = window.top.document.title || "";
      }
    } catch {
      /* cross-origin */
    }
    return (
      docTitle
        .replace(/\s*[-–—|]\s*Microsoft\s+Teams$/i, "")
        .replace(/^Recap:\s*/i, "")
        .trim() || ""
    );
  }

  function extractTranscriptVisibleRows() {
    const seen = new Set();
    const out = [];
    for (const row of document.querySelectorAll(TRANSCRIPT_ROW_SELECTOR)) {
      if (seen.has(row)) continue;
      seen.add(row);
      const r = extractTranscriptRow(row);
      if (r) out.push(r);
    }
    // Numeric ids (`entry-0`, `entry-1`, …) give us a deterministic timeline
    // order even if document order ever drifts inside FluentUI's virtualised
    // list. Fall back to doc-order when the id isn't numeric.
    out.sort((a, b) => {
      const ai = parseInt((a.id || "").replace(/^entry-/, ""), 10);
      const bi = parseInt((b.id || "").replace(/^entry-/, ""), 10);
      if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
      return 0;
    });
    return out;
  }

  /** Scroll DOWN in viewport-sized chunks (mirror of captureAllPasses).
   *  Stops at the bottom of the list, after N consecutive empty passes,
   *  or on a wall-clock timeout. */
  async function captureTranscriptAllPasses() {
    const container = findTranscriptScrollContainer();
    const idIndex = new Map();
    const orderedIds = [];

    function ingestDown(passRows) {
      let inserted = 0;
      const unanchored = [];
      for (let i = 0; i < passRows.length; i++) {
        const r = passRows[i];
        const id = r.id;
        if (idIndex.has(id)) {
          const existing = idIndex.get(id);
          if (existing.speaker === "(unknown)" && r.speaker !== "(unknown)") {
            existing.speaker = r.speaker;
          }
          if (!existing.time && r.time) existing.time = r.time;
          continue;
        }
        idIndex.set(id, r);
        // Look backward for an anchor we've already placed. Scrolling DOWN,
        // the anchor is an older sibling (lower index in this pass).
        let anchor = -1;
        for (let j = i - 1; j >= 0; j--) {
          const idx = orderedIds.indexOf(passRows[j].id);
          if (idx !== -1) {
            anchor = idx;
            break;
          }
        }
        if (anchor === -1) unanchored.push(id);
        else orderedIds.splice(anchor + 1, 0, id);
        inserted++;
      }
      if (unanchored.length > 0) {
        // No anchor in this pass — these are newer than anything we have.
        orderedIds.push(...unanchored);
      }
      return inserted;
    }

    ingestDown(extractTranscriptVisibleRows());
    reportProgress({ pass: 0, captured: idIndex.size, atBottom: false });

    if (!container) {
      return {
        messages: orderedIds.map((id) => idIndex.get(id)),
        passes: 1,
        atBottom: true,
        scrollContainerDesc: null,
      };
    }

    const startedAt = Date.now();
    const WALL_TIMEOUT_MS = 300_000;
    const MAX_PASSES = 300;
    let consecutiveEmpty = 0;
    let pass = 0;

    while (pass < MAX_PASSES) {
      if (Date.now() - startedAt > WALL_TIMEOUT_MS) break;
      const beforeTop = container.scrollTop;
      const beforeHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      container.scrollTop = Math.min(container.scrollHeight, beforeTop + clientHeight * 0.8);
      await sleep(150);
      container.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: clientHeight,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          bubbles: true,
          cancelable: true,
        }),
      );
      await sleep(700);

      const afterTop = container.scrollTop;
      const afterHeight = container.scrollHeight;
      const inserted = ingestDown(extractTranscriptVisibleRows());
      const progress = inserted > 0 || afterHeight > beforeHeight || afterTop > beforeTop;
      pass++;
      const atBottom = afterTop + container.clientHeight >= afterHeight - 1;
      reportProgress({ pass, captured: idIndex.size, atBottom });

      if (!progress) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
      } else {
        consecutiveEmpty = 0;
      }
      if (atBottom && consecutiveEmpty >= 1) break;
    }

    return {
      messages: orderedIds.map((id) => idIndex.get(id)),
      passes: pass + 1,
      atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 1,
      scrollContainerDesc: describeElement(container),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Top-level dispatch
  // ──────────────────────────────────────────────────────────────────────

  /** When the extractor runs inside the recap iframe, `location.href`
   *  is `about:blank`. Reach into the parent (allowed by the iframe's
   *  same-origin sandbox) for the real Teams URL. */
  function getPageUrl() {
    try {
      if (window.top && window.top !== window) {
        const href = window.top.location.href;
        if (href && href !== "about:blank") return href;
      }
    } catch {
      // Cross-origin top frame — fall through.
    }
    return location.href;
  }

  /** The Teams shell with a meeting recap open (its transcript iframe). */
  function isRecapShell() {
    return !!document.querySelector('iframe[name="RecapxPlatIframe"], #xplatIframe');
  }

  /** The meeting's date and start (meeting-date.js, injected before this file), from this
   *  frame's document and, when it can be read, the top frame's, where the recap header is. The
   *  transcript and the message lists are left out: their times aren't the meeting's. */
  function getMeetingDate() {
    const md = globalThis.brainsteadMeetingDate;
    if (!md) return null;
    const monthFirst = /^en-US$/i.test(navigator.language || "");
    const docs = [document];
    try {
      if (window.top && window.top !== window && window.top.document) docs.push(window.top.document);
    } catch {
      // Cross-origin top frame — skip it.
    }
    for (const doc of docs) {
      const exclude = [
        findTranscriptScrollContainer(),
        doc.querySelector('[data-tid="message-pane-list"]'),
        ...doc.querySelectorAll(MESSAGE_SELECTORS.join(",")),
      ].filter(Boolean);
      try {
        const found = md.findMeetingDate(doc, { exclude, monthFirst });
        if (found) return found;
      } catch (err) {
        console.warn("[teams-ingest] couldn't read the meeting date:", err);
      }
    }
    return null;
  }

  if (isTranscriptPage()) {
    const tCapture = await captureTranscriptAllPasses();
    const messages = tCapture.messages.map((r) => {
      const m = { sender: r.speaker, body: r.body };
      if (r.time) m.date = r.time;
      return m;
    });
    if (messages.length === 0) {
      const selection = window.getSelection()?.toString().trim();
      const fallback = selection || document.body.innerText.slice(0, 50000);
      if (fallback) {
        messages.push({ sender: "(unstructured capture)", body: fallback });
      }
    }
    return {
      url: getPageUrl(),
      title: getMeetingTitle() || "Meeting transcript",
      messages,
      kind: "transcript",
      ...getMeetingDate(),
      passes: tCapture.passes,
      atBottom: tCapture.atBottom,
      scrollContainerDesc: tCapture.scrollContainerDesc ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Chat mode (default)
  // ──────────────────────────────────────────────────────────────────────

  const capture = await captureAllPasses();
  const messages = capture.messages;
  // The id field is internal to the multi-pass dedup; Brainstead ignores it
  // anyway, but explicit removal keeps the payload tidy.
  for (const m of messages) delete m.id;

  // Fall back to whatever the user has selected, or the document text.
  if (messages.length === 0) {
    const selection = window.getSelection()?.toString().trim();
    const fallback = selection || document.body.innerText.slice(0, 50000);
    if (fallback) {
      messages.push({ sender: "(unstructured capture)", body: fallback });
    }
  }

  return {
    url: location.href,
    title: getConversationTitle(messages),
    messages,
    kind: "chat",
    // On a recap page the top frame reads as a chat while the transcript is in an iframe that
    // can't see the recap header; background.js lends this frame's meeting date to it.
    ...(isRecapShell() ? getMeetingDate() : null),
    passes: capture.passes,
    atTop: capture.atTop,
    scrollContainerDesc: capture.scrollContainerDesc ?? null,
  };
})();
