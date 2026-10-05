// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Does the service worker own the run independently of any popup?
//
// This is the point of the background.js split (bug-162): the popup's JS context
// is destroyed the moment it loses focus, so a run driven from there died on a
// tab switch. Here the worker is loaded into a VM with a fake `chrome`, every
// progress broadcast REJECTS (which is what happens with no popup listening),
// and the run is expected to complete anyway.
//
// No browser needed: `chrome.scripting.executeScript` is the seam, so no DOM is
// involved. Run it with `node extensions/outlook-capture/test-harness/test-worker.mjs`.
import { createContext, runInContext } from "node:vm";
import { check, extensionSource, finish } from "./harness.mjs";

/** A fake `chrome` plus the loaded worker, one per scenario. */
function loadWorker({ rows = 3, failRow = null, settleFail = false, postFails = false, storageFails = false } = {}) {
  const posts = [];
  const badges = [];
  const broadcasts = [];
  let session = {};
  const listeners = [];

  const chrome = {
    storage: {
      session: {
        async get(key) {
          if (storageFails) throw new Error("Access to storage is not allowed from this context.");
          return key in session ? { [key]: session[key] } : {};
        },
        async set(obj) {
          Object.assign(session, obj);
        },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      // No popup is listening: Chrome rejects. The run must not care.
      sendMessage: async (msg) => {
        broadcasts.push(msg);
        throw new Error("Could not establish connection. Receiving end does not exist.");
      },
      // Brainstead's native messaging host.
      sendNativeMessage: async (host, body) => {
        posts.push({ host, body });
        if (postFails) return { ok: false, message: "boom" };
        const filename = body.threads
          ? `Email. Threads. ${body.label ?? "batch"} - 2026-08-19.md`
          : `Email. Thread. ${body.title} - 2026-08-19.md`;
        return { ok: true, filename, path: `sources/${filename}` };
      },
    },
    action: {
      setBadgeText: ({ text }) => badges.push(text),
      setBadgeBackgroundColor: () => {},
    },
    tabs: {
      get: async (id) => ({ id, url: "https://outlook.office.com/mail/inbox" }),
      query: async () => [{ id: 7, url: "https://outlook.office.com/mail/inbox" }],
    },
    scripting: {
      executeScript: async (opts) => {
        if (opts.files?.[0] === "list-extractor.js") {
          return [
            {
              result: {
                rows: Array.from({ length: rows }, (_, i) => ({
                  convid: `conv-${i}`,
                  senders: `Sender ${i}`,
                  subject: `Subject ${i}`,
                  label: `Subject ${i}`,
                  scrollTop: i * 100,
                })),
                ariaCount: rows,
                scanned: true,
                passes: 2,
              },
            },
          ];
        }
        if (opts.files?.[0] === "extractor.js") {
          const i = opts.__callIndex ?? 0;
          return [
            {
              result: {
                url: "https://outlook.office.com/mail/inbox/id/AAQk",
                title: `Subject ${i}`,
                titleSource: "quoted-chain",
                kind: "thread",
                messages: [{ sender: "Alice Smith", body: "Body" }],
              },
            },
          ];
        }
        if (opts.func?.name === "openRowAndSettle") {
          const convid = opts.args?.[0];
          if (settleFail || convid === failRow) return [{ result: { ok: false, reason: "row-not-found" } }];
          return [{ result: { ok: true, signature: `sig-${convid}`, hasPaneText: true } }];
        }
        return [{ result: "" }]; // currentPaneSignature
      },
    },
  };

  const ctx = createContext({ chrome, console, setTimeout, clearTimeout, Date, Promise, URL, JSON, Math, Number });
  runInContext(extensionSource("background.js"), ctx, { filename: "background.js" });

  /** Deliver a message the way chrome.runtime does, returning the response. */
  const send = (msg) =>
    new Promise((resolve) => {
      let answered = false;
      for (const fn of listeners) {
        const kept = fn(msg, {}, (r) => {
          answered = true;
          resolve(r);
        });
        if (!kept && !answered) resolve(undefined);
      }
    });

  const state = async () => await send({ type: "owa:get-state" });
  const settle = async () => {
    // Let the worker's promise chain drain.
    for (let i = 0; i < 400; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return {
    send,
    state,
    settle,
    posts,
    badges,
    broadcasts,
    session: () => session,
    setSession: (s) => {
      session = s;
    },
  };
}

// ---- a batch run completes with no popup listening at all -------------------
{
  const w = loadWorker({ rows: 3 });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 10 } });
  await w.settle();
  const s = await w.state();
  check("run finishes with no popup attached", s.status === "done", `status=${s.status}`);
  check("every broadcast rejected (i.e. no popup)", w.broadcasts.length > 0);
  check("one POST per thread", w.posts.length === 3, `posts=${w.posts.length}`);
  check("all three counted as ok", s.ok === 3 && s.failed === 0, `ok=${s.ok} failed=${s.failed}`);
  check("log has a line per thread", (s.lines ?? []).length === 3, String((s.lines ?? []).length));
  check("badge tracked progress then finished", w.badges.includes("1/3") && w.badges.at(-1) === "✓", w.badges.join(","));
}

// ---- combined mode posts once, with every thread ----------------------------
{
  const w = loadWorker({ rows: 4 });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "combined", label: "My batch", limit: 10 } });
  await w.settle();
  const s = await w.state();
  check("combined mode makes exactly one POST", w.posts.length === 1, `posts=${w.posts.length}`);
  check("as a batch", w.posts[0]?.body.type === "outlook-batch");
  check("carrying all four threads", w.posts[0]?.body.threads.length === 4);
  check("and the label", w.posts[0]?.body.label === "My batch");
  check("finished clean", s.status === "done" && s.failed === 0);
}

// ---- the cap is enforced in the worker, not just the popup ------------------
{
  const w = loadWorker({ rows: 20 });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 3 } });
  await w.settle();
  check("limit honoured", w.posts.length === 3, `posts=${w.posts.length}`);
}

// ---- one bad row doesn't abort the rest -------------------------------------
{
  const w = loadWorker({ rows: 3, failRow: "conv-1" });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 10 } });
  await w.settle();
  const s = await w.state();
  check("the other two still captured", w.posts.length === 2, `posts=${w.posts.length}`);
  check("failure counted", s.failed === 1 && s.ok === 2, `ok=${s.ok} failed=${s.failed}`);
  check(
    "and explained in the log",
    (s.lines ?? []).some((l) => l.kind === "error" && l.text.includes("never reappeared")),
    JSON.stringify(s.lines?.map((l) => l.text)),
  );
}

// ---- Brainstead refusing is reported, not swallowed --------------------------
{
  const w = loadWorker({ rows: 2, postFails: true });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 10 } });
  await w.settle();
  const s = await w.state();
  check("both rows recorded as failures", s.failed === 2 && s.ok === 0, `ok=${s.ok} failed=${s.failed}`);
  check(
    "with the reason in the log",
    (s.lines ?? []).every((l) => l.text.includes("Brainstead refused: boom")),
    JSON.stringify(s.lines?.map((l) => l.text)),
  );
  check("badge shows the failure count", w.badges.at(-1) === "2!", w.badges.at(-1));
}

// ---- a second start while running is ignored -------------------------------
{
  const w = loadWorker({ rows: 3 });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 10 } });
  await w.send({ type: "owa:batch", tabId: 7, options: { mode: "separate", limit: 10 } });
  await w.settle();
  check("no double run", w.posts.length === 3, `posts=${w.posts.length}`);
}

// ---- a run killed with the worker is reported as interrupted ----------------
{
  const w = loadWorker();
  w.setSession({
    run: {
      status: "running",
      kind: "batch",
      total: 9,
      index: 4,
      ok: 4,
      failed: 0,
      lines: [],
      message: { text: "Opening 5/9…" },
      startedAt: Date.now() - 300_000,
      lastBeatAt: Date.now() - 120_000, // long cold
    },
  });
  const s = await w.state();
  check("a cold heartbeat reads as interrupted, not running", s.status === "done", `status=${s.status}`);
  check("and says how far it got", s.message.text.includes("4 of 9"), s.message.text);
  check("pointing at what was written", s.message.text.includes("sources/"), s.message.text);
}

// ---- a fresh heartbeat still reads as running -------------------------------
{
  const w = loadWorker();
  w.setSession({
    run: {
      status: "running",
      total: 9,
      index: 4,
      ok: 4,
      failed: 0,
      lines: [],
      message: { text: "Opening 5/9…" },
      lastBeatAt: Date.now() - 2_000,
    },
  });
  const s = await w.state();
  check("a warm run is left alone", s.status === "running", `status=${s.status}`);
}

// ---- get-state always answers, even when reading state throws --------------
//
// A user's report: the popup sat on "Checking the message list…" forever and
// looked like it could not see his checked threads. It had never got as far as
// reading them. `owa:get-state` was `void readState().then(respond)` with no
// rejection path, so any failure left `respond` uncalled after the listener had
// already returned `true`. Chrome then closes the channel and the popup's
// `sendMessage` rejects; `void init()` swallowed that and never ran the scan.
//
// The race is the assertion: before the fix this send never settles at all.
{
  const w = loadWorker({ storageFails: true });
  const timeout = new Promise((r) => setTimeout(() => r("__never_answered__"), 1_000));
  const reply = await Promise.race([w.send({ type: "owa:get-state" }), timeout]);
  check("get-state answers instead of leaving the channel open", reply !== "__never_answered__", String(reply));
  check("and the answer carries the reason", typeof reply?.error === "string" && reply.error.includes("storage"), JSON.stringify(reply));
}

finish();
