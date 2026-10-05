// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs as a content script in the active OWA tab via chrome.scripting.executeScript.
// Returns { url, title, titleSource, kind, messages: [{ sender, to?, cc?, date?, body }] }.
//
// `kind` is "thread" for a normal structured capture, or "reading-pane" when
// there is no message DOM to read and we fall back to the reading pane's
// visible text. Not every row in a mail list is a conversation: meeting
// invitations render a calendar card, and SharePoint / OneDrive "shared with
// you" mails render an actionable-message card. Both used to come back empty.
//
// `titleSource` tells the caller how much to trust the title. It matters
// because document.title is a poor last resort in some OWA builds: this one
// sets it to "Inbox - <mailbox> - Outlook" rather than the open subject, so a
// mail with no quoted reply chain produced files all named "Inbox - <mailbox>".
// The batch flow overrides the title with the list row's subject when
// titleSource is "document-title".
//
// outlook.cloud.microsoft structure for a 17-message thread:
//
// 1. One [aria-label="Email message"] wrapper at the top, holding the
//    *focused* (most-recent) message — full structured DOM, plus a
//    [aria-label="Message body"] that contains JUST that message's body.
//
// 2. After a "Hide message history" toggle inside the same wrapper, a
//    second [aria-label="Message body"] holds the ENTIRE reply chain as a
//    quoted text blob — `<b>From:</b> X<br><b>Date:</b> Y<br>…` header
//    strips interleaved with body paragraphs, wrapped recursively in
//    <div id="x_mail-editor-reference-message-container"> blocks. There's
//    no structured DOM for each historical message here — splitting the
//    rendered text by "From: " markers is the only reliable approach.
//
// 3. Below the wrapper, 16 collapsed cards (.GjFKx) — these only carry
//    sender + date + a ~30-word preview, so they're useless for full
//    capture. Ignored.
//
// If outlook.live.com / office365.com / older builds put older messages
// in their own structured wrappers, add their selectors to MESSAGE_SELECTORS
// and the same code path will pick them up. Fan-out, don't replace.

(async () => {
  const MESSAGE_SELECTORS = ['[aria-label="Email message"]', 'div[role="document"][aria-labelledby]', 'article[role="article"]'];

  const SENDER_SELECTORS = [
    '[aria-label^="From:"]',
    '[id$="_FROM"]',
    'div[role="button"][aria-label*="From"]',
    '[data-testid="message-sender"]',
    'span[class*="senderName"]',
    'span[class*="SenderName"]',
  ];

  const TO_SELECTORS = [
    '[aria-label^="To:"]',
    '[id$="_TO"] [aria-label^="To:"]',
    '[aria-label*="To recipients"]',
    '[data-testid="message-recipients"]',
  ];

  const CC_SELECTORS = ['[aria-label^="Cc:"]', '[id$="_CC"] [aria-label^="Cc:"]'];

  const DATE_SELECTORS = [
    '[data-testid="SentReceivedSavedTime"]',
    '[id$="_DATETIME"]',
    'span[class*="messageHeaderDate"]',
    'span[data-testid="message-date"]',
    "time",
  ];

  // The reading-pane container, used for two things: scoping the subject
  // heading search, and as the source of the text fallback for items with no
  // message DOM. Fan-out, most specific first.
  const READING_PANE_SELECTORS = [
    '[aria-label="Reading Pane"]',
    'div[id="ReadingPaneContainerId"]',
    '[data-app-section="ConversationContainer"]',
    '[data-app-section="ReadingPane"]',
    'div[role="main"]',
  ];

  const BODY_SELECTORS = [
    '[aria-label="Message body"]',
    'div[id^="UniqueMessageBody"]',
    'div[role="document"][aria-live="polite"]',
    '[class*="messageBody"]',
  ];

  // Subject heading selectors, scoped *inside a message wrapper only* — never
  // run document-wide, because OWA's sidebar has its own role="heading"
  // elements ("Navigation pane", "Folder pane", "Favorites", etc.) that
  // would otherwise win. These selectors are intentionally narrow; a thread
  // with no matching heading falls through to document.title, which OWA
  // reliably sets to the focused-thread subject (with "(N) " / " - Outlook"
  // decoration Brainstead strips).
  const SUBJECT_SELECTORS = [
    '[data-testid="ConversationItemHeaderTitle"]',
    '[id$="_SUBJECT"]',
    '[aria-label^="Subject:"]',
    'h1[class*="subject" i]',
    'h2[class*="subject" i]',
    'div[class*="ConversationHeader"] [class*="title" i]',
  ];

  /**
   * Try a list of selectors. If the matched element has an aria-label of
   * the form "From: …" / "To: …" / "Cc: …", return the captured value.
   * Otherwise return innerText.
   */
  function pick(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const aria = el.getAttribute("aria-label");
      if (aria) {
        const m = aria.match(/^(?:From|To|Cc):\s*(.+)$/i);
        if (m) return m[1].trim();
      }
      const txt = el.innerText?.trim();
      if (txt) return txt;
    }
    return undefined;
  }

  /**
   * Extract the thread subject, and report which source it came from so the
   * caller knows how far we had to fall. Priority:
   *   1. `quoted-chain`: a "Subject:" line from the quoted-chain headers,
   *      present in any reply/forward thread. Most reliable, tried first.
   *   2. `message-heading`: a heading inside the focused message wrapper, via
   *      SUBJECT_SELECTORS scoped to that wrapper (not document-wide, to avoid
   *      picking up sidebar chrome like "Navigation pane").
   *   3. `pane-heading`: the first short heading in the reading pane. Covers a
   *      single-message mail, a meeting invite or a card-only mail, none of
   *      which have a quoted chain to read a Subject out of.
   *   4. `document-title`: last resort, and a WEAK one. It was documented here
   *      as "the focused-thread subject", which is not true of every build:
   *      the outlook.office.com build sets it to "Inbox - <mailbox> - Outlook",
   *      so this yields a name with no subject in it at all. Callers that know
   *      the subject from elsewhere (the batch flow reads it off the list row)
   *      should override the title when the source is this.
   * Returns { title, source }; title is "" if every source comes up empty.
   */
  function getThreadSubject(quotedSubject) {
    if (quotedSubject) return { title: quotedSubject, source: "quoted-chain" };

    for (const wrapper of document.querySelectorAll(MESSAGE_SELECTORS.join(", "))) {
      for (const sel of SUBJECT_SELECTORS) {
        const el = wrapper.querySelector(sel);
        if (!el) continue;
        const aria = el.getAttribute("aria-label");
        if (aria) {
          const m = aria.match(/^Subject:\s*(.+)$/i);
          if (m && m[1].trim()) return { title: m[1].trim(), source: "message-heading" };
        }
        const txt = el.innerText?.trim();
        if (txt && txt.length > 1) return { title: txt, source: "message-heading" };
      }
    }

    // Nothing in a message wrapper: try the first heading inside the reading
    // pane. Scoped to the pane on purpose, because document-wide OWA's sidebar
    // headings ("Navigation pane", "Favorites") would win. This is what
    // rescues a single-message mail, a meeting invite or a card-only mail,
    // none of which carry a quoted "Subject:" line.
    const pane = pickReadingPane();
    if (pane) {
      for (const el of pane.querySelectorAll('[role="heading"], h1, h2')) {
        const txt = el.innerText?.trim();
        // Long "headings" are usually a card's body text, not a subject.
        if (txt && txt.length > 1 && txt.length <= 200) {
          return { title: txt, source: "pane-heading" };
        }
      }
    }

    return { title: document.title || "", source: "document-title" };
  }

  /** First reading-pane container that exists and has visible text. */
  function pickReadingPane() {
    for (const sel of READING_PANE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && (el.innerText || "").trim()) return el;
    }
    return null;
  }

  /**
   * Strip leading reply/forward prefixes: "Re:", "Fw:", "Fwd:", "Forward:",
   * and locale variants "Aw:" (German Antwort), "Wg:" (Weitergeleitet).
   * Repeats so stacked prefixes like "Re: Fw: Re: Subject" collapse to
   * just "Subject".
   */
  function stripReplyPrefixes(s) {
    return s.replace(/^(?:\s*(?:re|fw|fwd|forward|aw|wg)\s*:\s*)+/i, "").trim();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Click "Show message history" (and the older equivalents) so the quoted
   * reply chain is rendered into the DOM. Idempotent — we only click SHOW
   * variants, never "Hide message history" (which would collapse it again).
   */
  async function expandMessageHistory() {
    const SHOW_LABELS = ["Show message history", "Show all messages", "Show trimmed content", "Expand message"];
    for (let pass = 0; pass < 4; pass++) {
      let clicked = false;
      for (const label of SHOW_LABELS) {
        for (const b of document.querySelectorAll(`button[aria-label="${label}"]`)) {
          b.click();
          clicked = true;
        }
      }
      if (!clicked) break;
      await sleep(600);
    }
  }

  /** The currently-expanded message — extract via structured DOM. */
  function extractStructuredMessages() {
    const out = [];
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
    for (const wrapper of wrappers) {
      const sender = pick(wrapper, SENDER_SELECTORS);
      // First [aria-label="Message body"] under this wrapper is the focused
      // message's body. The second one (if present) is the history quoted
      // chain — we handle that separately.
      const bodyEls = wrapper.querySelectorAll(BODY_SELECTORS.join(", "));
      const bodyEl = bodyEls[0];
      const body = bodyEl?.innerText?.trim();
      if (!sender || !body) continue;
      const m = { sender, body };
      const to = pick(wrapper, TO_SELECTORS);
      if (to) m.to = to;
      const cc = pick(wrapper, CC_SELECTORS);
      if (cc) m.cc = cc;
      const date = pick(wrapper, DATE_SELECTORS);
      if (date) m.date = date;
      out.push(m);
    }
    return out;
  }

  /** Parse the quoted reply chain inside the message-history body. */
  function extractQuotedChainMessages() {
    // Find every "history" body — second-or-later [aria-label="Message body"]
    // within each message wrapper. Older OWA builds may not have history
    // bodies at all (single-message threads), in which case nothing to do.
    const out = [];
    const wrappers = document.querySelectorAll(MESSAGE_SELECTORS.join(", "));
    for (const wrapper of wrappers) {
      const bodies = wrapper.querySelectorAll(BODY_SELECTORS.join(", "));
      for (let i = 1; i < bodies.length; i++) {
        out.push(...parseQuotedChain(bodies[i]));
      }
    }
    return out;
  }

  function parseQuotedChain(historyEl) {
    const text = historyEl.innerText || "";
    // Find every line that starts with "From: " — those are the message-
    // boundary markers in the quoted chain.
    const positions = [];
    for (const m of text.matchAll(/^From:\s/gm)) {
      positions.push(m.index);
    }
    const out = [];
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i];
      const end = i + 1 < positions.length ? positions[i + 1] : text.length;
      const parsed = parseQuotedBlock(text.slice(start, end));
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /**
   * A quoted block looks like:
   *   From: Name <email>
   *   Sent: <date>
   *   To: Name <email>; Name <email>
   *   Cc: Name <email>; …
   *   Subject: <subject>
   *
   *   Body paragraph 1
   *   Body paragraph 2
   *   …
   *
   * Sometimes "Date:" instead of "Sent:". Sometimes the header is
   * preceded by attribution garbage we don't care about (we start at the
   * "From: " marker, so it's already trimmed). Email addresses inside <>
   * are stripped so we keep display names clean.
   */
  function dedupeMessages(messages) {
    const seen = new Set();
    const out = [];
    for (const m of messages) {
      const bodyKey = m.body.slice(0, 200).replace(/\s+/g, " ").trim();
      const key = `${m.sender}|${bodyKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }

  function parseQuotedBlock(block) {
    const lines = block.split("\n");
    const result = {};
    let lastHeaderLine = -1;
    let bodyStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^\s*(From|Date|Sent|To|Cc|Subject):\s*(.+?)\s*$/);
      if (m) {
        const key = m[1].toLowerCase();
        const value = m[2].replace(/\s*<[^>]+>/g, "").trim();
        if (key === "from" && !result.sender) result.sender = value;
        else if ((key === "date" || key === "sent") && !result.date) result.date = value;
        else if (key === "to" && !result.to) result.to = value;
        else if (key === "cc" && !result.cc) result.cc = value;
        // Subject only goes here so the caller can read it off the message —
        // it's not part of the message Brainstead reads and is ignored
        // there, but we surface it as a thread-subject fallback when the
        // focused message DOM has no heading we can lock onto.
        else if (key === "subject" && !result.subject) result.subject = value;
        lastHeaderLine = i;
        continue;
      }
      if (lastHeaderLine >= 0 && line.trim() === "") {
        // Blank line — could be inside or just after the header. Keep going.
        continue;
      }
      if (lastHeaderLine >= 0) {
        bodyStart = i;
        break;
      }
    }
    if (!result.sender) return null;
    result.body = bodyStart >= 0 ? lines.slice(bodyStart).join("\n").trim() : "";
    return result;
  }

  await expandMessageHistory();

  // OWA renders the same message multiple ways once history is expanded:
  // the immediately-prior message gets its own structured wrapper AND
  // appears as a "From: …" entry in the quoted chain, with the chain text
  // duplicated inside each wrapper. Dedupe on sender + body prefix so each
  // physical email shows up exactly once. (Date format alone isn't a
  // reliable key — the same email surfaces in both `Mon 18/05/2026 09:40`
  // and `Monday, 18 May 2026 at 09:40` formats.)
  const raw = [...extractStructuredMessages(), ...extractQuotedChainMessages()];
  // Pick the first non-empty Subject seen in the quoted chain — every
  // historical message carries one, so even when the focused-message DOM
  // has no heading to lock onto, this finds the thread subject reliably.
  const quotedSubject = raw.find((m) => m.subject)?.subject ?? null;
  const messages = dedupeMessages(raw);

  // No structured messages. Either this isn't a conversation at all (meeting
  // invitation, card-only mail) or the message selectors have gone stale.
  // Capture the reading pane's text rather than document.body.innerText, which
  // would drag in the navigation pane, folder list and every row of the message
  // list around it.
  let kind = "thread";
  if (messages.length === 0) {
    kind = "reading-pane";
    const pane = pickReadingPane();
    const selection = window.getSelection()?.toString().trim();
    const fallback = (pane?.innerText || "").trim() || selection || document.body.innerText;
    if (fallback) {
      messages.push({
        sender: pane ? "(reading pane)" : "(unstructured capture)",
        body: fallback.slice(0, 50000),
      });
    }
  }

  const subject = getThreadSubject(quotedSubject);
  return {
    url: location.href,
    title: stripReplyPrefixes(subject.title),
    titleSource: subject.source,
    kind,
    messages,
  };
})();
