// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Handing a tab's sign-in over to Brainstead (D-20261126-02), the same in all three of Brainstead's
// extensions: teams-capture, outlook-capture and slack-capture each keep an identical copy of this
// file (an unpacked extension can't load files outside its folder), and `make check` fails when the
// copies differ (extensions/handover.test.js). Each extension says only which tabs to read, how to
// read one, and how to send what it read; everything about keeping the sign-in alive is here:
//
// - every few minutes, and when Chrome starts or the extension is (re)loaded, the tabs are read and
//   what they hold is handed to Brainstead's helper;
// - Chrome is kept from putting the tab to sleep, and a tab asleep, or one that doesn't answer
//   within 20 seconds (frozen), is reloaded;
// - the tab is reloaded when Brainstead says a sign-in was turned down and the tab has nothing
//   newer (`renew` in its answer), and before a token the sync uses runs out: a hand-over that sees
//   one running out within 25 minutes sets an alarm to reload 4 minutes before it does, since the
//   page reuses a cached token until it's within 5 minutes of running out (a reload earlier than
//   that fetches nothing new);
// - a reload is handed over a minute later, once the page has fetched fresh tokens;
// - never a tab the user is looking at or one playing sound (a call), and at most one reload in
//   20 minutes, so a page that doesn't renew on load can't cause a loop;
// - what the last hand-over did is kept in chrome.storage.local, never a token.
//
// Loaded into the service worker with importScripts, so it hangs its functions on
// `globalThis.brainsteadHandover`. The tests load it the same way.

(() => {
  /** How long reading a tab or Brainstead's answer may take: a tab Chrome has frozen never answers. */
  const STEP_MS = 20_000;
  /** At most one reload in this long. */
  const RELOAD_GAP_MS = 20 * 60 * 1000;
  const LAST_RELOAD_KEY = "signin-last-reload";
  /** How soon before a token runs out the tab is reloaded, in seconds: longer than the 15 minutes
   *  between hand-overs plus the 5 minutes' margin Brainstead keeps, so the hand-over before a
   *  token runs out always sees it coming. */
  const SOON_SECS = 25 * 60;
  /** How long before a token runs out the reload is made: inside the 5 minutes in which the page
   *  renews a token rather than reuse it, with time for the hand-over a minute later. Brainstead
   *  uses a token until 2 minutes before it runs out. */
  const RENEW_SECS = 4 * 60;

  /** `p`, or a rejection saying `what` took too long. */
  function inTime(p, what, ms = STEP_MS) {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms);
    });
    return Promise.race([p, late]).finally(() => clearTimeout(timer));
  }

  /** Each service's longest-lived token expiry (seconds since 1970), or null when there's none.
   *  `services`: `{ name, test(target) }`, target being the token's scopes, lower-cased. */
  function expiries(ats, services) {
    return services.map((s) => {
      const times = (ats || [])
        .filter((a) => s.test(String(a.target || "").toLowerCase()))
        .map((a) => Number(a.expiresOn))
        .filter((n) => Number.isFinite(n) && n > 0);
      return { name: s.name, expires: times.length ? Math.max(...times) : null };
    });
  }

  /** The services whose token is missing or runs out within SOON_SECS of `nowSecs`, each with
   *  when it does (null when missing). */
  function due(ats, nowSecs, services) {
    return expiries(ats, services).filter((e) => e.expires === null || e.expires < nowSecs + SOON_SECS);
  }

  /** When to reload for the `soon` tokens (seconds since 1970): now (`nowSecs`) once one is
   *  missing or within RENEW_SECS of running out, otherwise RENEW_SECS before the first does. */
  function renewAt(soon, nowSecs) {
    const first = Math.min(...soon.map((e) => (e.expires === null ? nowSecs : e.expires)));
    return Math.max(nowSecs, first - RENEW_SECS);
  }

  const clock = (secs) => new Date(secs * 1000).toTimeString().slice(0, 5);

  /** Reloads a background tab so the page fetches a fresh sign-in, then hands it over a minute
   *  later (`after`, an alarm's name). Says what it did. */
  async function renew(tab, after) {
    if (tab.audible) return "not reloaded: playing sound (a call?)";
    if (tab.active) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win?.focused) return "not reloaded: you're looking at it";
    }
    const last = (await chrome.storage.local.get(LAST_RELOAD_KEY))[LAST_RELOAD_KEY] || 0;
    if (Date.now() - last < RELOAD_GAP_MS) return "not reloaded: reloaded in the last 20 minutes";
    await chrome.storage.local.set({ [LAST_RELOAD_KEY]: Date.now() });
    try {
      await chrome.tabs.reload(tab.id);
      chrome.alarms.create(after, { delayInMinutes: 1 });
      return "reloaded";
    } catch {
      return "not reloaded: the tab went away";
    }
  }

  /**
   * Starts an extension's hand-over and returns the function that hands over now (for a popup's
   * button). `o`:
   * - `name`: names its alarms (`brainstead-<name>-handover`);
   * - `every`: minutes between hand-overs;
   * - `lastKey`: where the record of the last hand-over is kept;
   * - `tabs()`: the tabs to read;
   * - `read`: the function run in a tab (chrome.scripting) that returns what it holds;
   * - `usable(page)`: whether a tab's answer has a sign-in in it;
   * - `all`: gather every tab's answer (Slack, one tab per workspace) rather than the first usable;
   * - `send(pages)`: hands the answers over; resolves to Brainstead's answer `{ ok, message?,
   *   renew? }`, or `{ outcome }` when there was nothing to send, with `extra` for the record;
   * - `due(page, nowSecs)`: optional, the services whose token in the page runs out soon, as
   *   `due()` gives them.
   */
  function start(o) {
    const alarm = `brainstead-${o.name}-handover`;
    const after = `brainstead-${o.name}-after-reload`;
    const timed = `brainstead-${o.name}-renew`;

    async function run(notes, keep) {
      let tabs;
      try {
        tabs = await o.tabs();
      } catch (e) {
        return `couldn't list tabs: ${e?.message || e}`;
      }
      if (!tabs.length) return "no tab open";
      const found = [];
      for (const tab of tabs) {
        // Keep Chrome's Memory Saver from putting the tab to sleep: a sleeping tab can't be read.
        chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
        if (tab.discarded) {
          notes.push(`tab ${tab.id} asleep: ${await renew(tab, after)}`);
          continue;
        }
        let page;
        try {
          const [r] = await inTime(chrome.scripting.executeScript({ target: { tabId: tab.id }, func: o.read }), "reading the tab");
          page = r?.result;
        } catch (e) {
          // Still loading, not scriptable, or frozen by Chrome: a reload wakes a frozen one.
          notes.push(`tab ${tab.id} couldn't be read: ${e?.message || e}; ${await renew(tab, after)}`);
          continue;
        }
        if (page?.seen) notes.push(`tab ${tab.id} keeps ${JSON.stringify(page.seen)}`);
        if (page && "seen" in page) delete page.seen;
        for (const p of page?.problems || []) notes.push(`tab ${tab.id}: ${p}`);
        if (o.usable(page)) {
          found.push({ tab, page });
          if (!o.all) break;
        } else {
          notes.push(`tab ${tab.id} has no sign-in to hand over`);
        }
      }
      if (!found.length) return "no tab had a sign-in to hand over";
      let reply;
      try {
        reply = await inTime(o.send(found.map((f) => f.page)), "Brainstead's answer");
      } catch (e) {
        // Brainstead not running or not registered yet: tried again at the next hand-over.
        return `Brainstead unreachable: ${e?.message || e}`;
      }
      if (reply?.extra) keep(reply.extra);
      if (reply?.outcome) return reply.outcome;
      const outcome = reply?.ok ? "handed over" : `Brainstead refused: ${reply?.message || "no answer"}`;
      const tab = found[0].tab;
      // Turned down, and the tab had nothing newer: reload it so the page fetches fresh tokens.
      if (reply?.ok && reply.renew?.length) {
        notes.push(`turned down: ${reply.renew.join(", ")}; ${await renew(tab, after)}`);
        return outcome;
      }
      // About to run out: reload when the page will renew it (a page only renews a token when it
      // next needs it, and reuses a cached one until it's nearly out), now or by an alarm.
      const now = Date.now() / 1000;
      const soon = o.due ? o.due(found[0].page, now) : [];
      if (soon.length) {
        const names = soon.map((e) => e.name).join(", ");
        const at = renewAt(soon, now);
        if (at <= now) {
          notes.push(`due: ${names}; ${await renew(tab, after)}`);
        } else {
          chrome.alarms.create(timed, { when: at * 1000 });
          notes.push(`due: ${names}; reloading at ${clock(at)}`);
        }
      }
      return outcome;
    }

    async function handOver() {
      const notes = [];
      const at = new Date().toISOString();
      const version = chrome.runtime.getManifest().version;
      const save = (outcome, extra) =>
        chrome.storage.local.set({ [o.lastKey]: { at, version, outcome, result: outcome, notes, ...extra } }).catch(() => {});
      await save("started");
      let extra = {};
      const outcome = await run(notes, (x) => (extra = x)).catch((e) => `failed: ${e?.message || e}`);
      await save(outcome, extra);
      return outcome;
    }

    chrome.alarms.create(alarm, { periodInMinutes: o.every });
    chrome.alarms.onAlarm.addListener((a) => {
      if (a.name === alarm || a.name === after || a.name === timed) void handOver();
    });
    chrome.runtime.onStartup.addListener(() => void handOver());
    chrome.runtime.onInstalled.addListener(() => void handOver());
    return handOver;
  }

  globalThis.brainsteadHandover = { start, due, renewAt, expiries, inTime, renew, STEP_MS, SOON_SECS, RENEW_SECS, RELOAD_GAP_MS };
})();
