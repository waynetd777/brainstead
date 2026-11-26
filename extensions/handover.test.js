// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The sign-in hand-over all three extensions share (handover.js, D-20261126-02), over a stand-in for
// Chrome's extension API and invented tokens. Vitest runs it with the app's tests (`make check`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Vitest runs from the repo's root.
const read = (p) => readFileSync(join(process.cwd(), "extensions", p), "utf8");

describe("the copies", () => {
  it("are the same file in every extension, so a fix reaches all three", () => {
    const teams = read("teams-capture/handover.js");
    expect(read("outlook-capture/handover.js")).toBe(teams);
    expect(read("slack-capture/handover.js")).toBe(teams);
    expect(read("outlook-capture/sign-in-reader.js")).toBe(read("teams-capture/sign-in-reader.js"));
  });

  it("are what every extension uses to hand over", () => {
    for (const ext of ["teams-capture", "outlook-capture", "slack-capture"]) {
      const bg = read(`${ext}/background.js`);
      expect(bg, ext).toMatch(/importScripts\("handover\.js"/);
      expect(bg, ext).toContain("brainsteadHandover.start(");
      expect(bg, ext).not.toMatch(/RELOAD_GAP|function renewSignIn|function inTime/);
    }
  });
});

// ── A stand-in for Chrome ───────────────────────────────────────────

let chromeState;
function fakeChrome() {
  const st = {
    storage: {},
    alarms: {},
    listeners: [],
    reloaded: [],
    focused: false,
    tabs: [],
    page: { ats: [{ target: "x" }] },
    readError: null,
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: st.storage[k] }),
        set: async (o) => Object.assign(st.storage, o),
      },
    },
    alarms: {
      create: (name, o) => (st.alarms[name] = o),
      onAlarm: { addListener: (f) => st.listeners.push(f) },
    },
    runtime: {
      getManifest: () => ({ version: "9.9.9" }),
      onStartup: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    tabs: {
      update: async () => {},
      reload: async (id) => st.reloaded.push(id),
    },
    windows: { get: async () => ({ focused: st.focused }) },
    scripting: {
      executeScript: async () => {
        if (st.readError) throw new Error(st.readError);
        return [{ result: structuredClone(st.page) }];
      },
    },
  };
  return st;
}

let H;
beforeAll(async () => {
  fakeChrome();
  await import("./teams-capture/handover.js");
  H = globalThis.brainsteadHandover;
});

/** Starts a hand-over whose Brainstead answers `answer`, with a token due when `soon` says so. */
function setUp(answer, soon = []) {
  const st = (chromeState = fakeChrome());
  st.tabs = [{ id: 7, windowId: 1, active: false, audible: false, discarded: false }];
  const go = H.start({
    name: "test",
    every: 15,
    lastKey: "last",
    tabs: async () => st.tabs,
    read: () => null,
    usable: (p) => !!p?.ats?.length,
    send: async () => (typeof answer === "function" ? answer() : answer),
    due: () => soon,
  });
  return { st, go };
}

describe("a hand-over", () => {
  beforeEach(() => {
    chromeState = null;
  });

  it("hands over and keeps a record, with no reload when all is well", async () => {
    const { st, go } = setUp({ ok: true });
    expect(await go()).toBe("handed over");
    expect(st.reloaded).toEqual([]);
    expect(st.storage.last).toMatchObject({ outcome: "handed over", result: "handed over", version: "9.9.9" });
    expect(st.alarms["brainstead-test-handover"]).toEqual({ periodInMinutes: 15 });
  });

  it("reloads the tab when Brainstead says the sign-in was turned down, and hands over a minute later", async () => {
    const { st, go } = setUp({ ok: true, renew: ["mail"] });
    await go();
    expect(st.reloaded).toEqual([7]);
    expect(st.alarms["brainstead-test-after-reload"]).toEqual({ delayInMinutes: 1 });
    expect(st.storage.last.notes.join()).toContain("turned down: mail; reloaded");
  });

  it("reloads the tab before a token runs out", async () => {
    const { st, go } = setUp({ ok: true }, ["chats"]);
    await go();
    expect(st.reloaded).toEqual([7]);
  });

  it("reloads a tab Chrome put to sleep or froze", async () => {
    let { st, go } = setUp({ ok: true });
    st.tabs[0].discarded = true;
    expect(await go()).toBe("no tab had a sign-in to hand over");
    expect(st.reloaded).toEqual([7]);
    ({ st, go } = setUp({ ok: true }));
    st.readError = "Frame was frozen";
    await go();
    expect(st.reloaded).toEqual([7]);
  });

  it("never reloads a tab you're looking at or one in a call, and at most once in 45 minutes", async () => {
    let { st, go } = setUp({ ok: true, renew: ["chats"] });
    st.tabs[0].active = true;
    st.focused = true;
    await go();
    expect(st.reloaded).toEqual([]);
    ({ st, go } = setUp({ ok: true, renew: ["chats"] }));
    st.tabs[0].audible = true;
    await go();
    expect(st.reloaded).toEqual([]);
    ({ st, go } = setUp({ ok: true, renew: ["chats"] }));
    await go();
    await go();
    expect(st.reloaded).toEqual([7]);
    expect(st.storage.last.notes.join()).toContain("reloaded in the last 45 minutes");
  });

  it("says when Brainstead couldn't be reached, or there was nothing to send", async () => {
    const { st, go } = setUp(() => {
      throw new Error("host not found");
    });
    expect(await go()).toContain("Brainstead unreachable");
    st.tabs = [];
    expect(await go()).toBe("no tab open");
    expect(chromeState.reloaded).toEqual([]);
  });
});

describe("due", () => {
  const now = 1_800_000_000;
  const at = (target, inMin) => ({ target, expiresOn: String(now + inMin * 60) });
  const TEAMS = [
    { name: "chats", test: (t) => t.includes("api.spaces.skype.com") },
    { name: "transcripts", test: (t) => t.includes("substrate.office.com") },
  ];
  const MAIL = [{ name: "mail", test: (t) => t.includes("outlook.office.com") && t.includes("mail.read") }];
  const fresh = [
    at("https://api.spaces.skype.com//Authorization.ReadWrite", 600),
    at("https://outlook.office.com//Mail.ReadWrite https://outlook.office.com//Calendars.Read", 600),
    at("https://substrate.office.com//SubstrateSearch-Internal.ReadWrite", 50),
  ];

  it("is nothing while every token has a while to run", () => {
    expect(H.due(fresh, now, TEAMS)).toEqual([]);
    expect(H.due(fresh, now, MAIL)).toEqual([]);
  });

  it("names a token that runs out within a whole hand-over plus Brainstead's margin, or has run out", () => {
    const next = fresh.map((a) => (a.target.includes("spaces") ? at(a.target, 20) : a));
    expect(H.due(next, now, TEAMS)).toEqual(["chats"]);
    const gone = fresh.map((a) => (a.target.includes("outlook") ? at(a.target, -30) : a));
    expect(H.due(gone, now, MAIL)).toEqual(["mail"]);
  });

  it("goes by the longest-lived token, and counts a missing one as due", () => {
    expect(H.due([...fresh, at("https://api.spaces.skype.com//x", -100)], now, TEAMS)).toEqual([]);
    expect(H.due([], now, TEAMS)).toEqual(["chats", "transcripts"]);
  });
});
