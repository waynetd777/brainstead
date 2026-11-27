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
      get: async (name) => (st.alarms[name]?.when ? { name, scheduledTime: st.alarms[name].when } : undefined),
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

  it("reloads the tab when a token is within four minutes of running out, or missing", async () => {
    const now = Date.now() / 1000;
    let { st, go } = setUp({ ok: true }, [{ name: "chats", expires: now + 200 }]);
    await go();
    expect(st.reloaded).toEqual([7]);
    ({ st, go } = setUp({ ok: true }, [{ name: "chats", expires: null }]));
    await go();
    expect(st.reloaded).toEqual([7]);
  });

  it("sets an alarm to reload four minutes before a token runs out, not sooner: the page would reuse it", async () => {
    const now = Date.now() / 1000;
    const { st, go } = setUp({ ok: true }, [
      { name: "transcripts", expires: now + 13 * 60 },
      { name: "chats", expires: now + 20 * 60 },
    ]);
    await go();
    expect(st.reloaded).toEqual([]);
    const when = st.alarms["brainstead-test-renew"].when / 1000;
    expect(Math.abs(when - (now + 9 * 60))).toBeLessThan(5);
    expect(st.storage.last.notes.join()).toMatch(/due: transcripts, chats; reloading at \d\d:\d\d/);
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

  it("never reloads a tab you're looking at or one in a call, and tries again in a few minutes", async () => {
    let { st, go } = setUp({ ok: true, renew: ["chats"] });
    st.tabs[0].active = true;
    st.focused = true;
    await go();
    expect(st.reloaded).toEqual([]);
    const soon = (name) => (st.alarms[name].when - Date.now()) / 60_000;
    expect(soon("brainstead-test-retry")).toBeCloseTo(H.RETRY_MIN, 1);
    expect(st.storage.last.notes.join()).toMatch(/you're looking at it; trying again at \d\d:\d\d/);
    ({ st, go } = setUp({ ok: true, renew: ["chats"] }));
    st.tabs[0].audible = true;
    await go();
    expect(st.reloaded).toEqual([]);
    expect(soon("brainstead-test-retry")).toBeCloseTo(H.RETRY_MIN, 1);
  });

  it("reloads another tab of the app when the one read is in view", async () => {
    const { st, go } = setUp({ ok: true, renew: ["chats"] });
    st.tabs[0].active = true;
    st.focused = true;
    st.tabs.push({ id: 9, windowId: 2, active: false, audible: false, discarded: false });
    await go();
    expect(st.reloaded).toEqual([9]);
  });

  it("reloads at most once in 20 minutes for the same reason, but a token running out isn't held up by a refusal's reload", async () => {
    const { st, go } = setUp({ ok: true, renew: ["chats"] });
    await go();
    await go();
    expect(st.reloaded).toEqual([7]);
    expect(st.storage.last.notes.join()).toContain("reloaded for this in the last 20 minutes; trying again at");
    // Not every few minutes: when the 20 minutes are up.
    expect((st.alarms["brainstead-test-retry"].when - Date.now()) / 60_000).toBeCloseTo(20, 0);
    // Same browser storage, a token now running out: a reason of its own.
    const now = Date.now() / 1000;
    const due = H.start({
      name: "test2",
      every: 15,
      lastKey: "last2",
      tabs: async () => st.tabs,
      read: () => null,
      usable: (p) => !!p?.ats?.length,
      send: async () => ({ ok: true }),
      due: () => [{ name: "transcripts", expires: now + 100 }],
    });
    await due();
    expect(st.reloaded).toEqual([7, 7]);
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
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  /** A page's token entry: a JWT saying its audience, scopes and when it was issued and runs out. */
  const at = (aud, scp, inMin, issuedMinAgo = 30) => ({
    target: `${aud}/${scp}`,
    expiresOn: String(now + inMin * 60),
    secret: `${b64({ alg: "RS256" })}.${b64({ aud, scp, iat: now - issuedMinAgo * 60, exp: now + inMin * 60 })}.sig`,
  });
  const TEAMS = [
    { name: "chats", test: (c) => c.aud === "https://api.spaces.skype.com" },
    { name: "transcripts", test: (c) => c.aud === "https://substrate.office.com" },
  ];
  const MAIL = [{ name: "mail", test: (c) => c.aud === "https://outlook.office.com" && c.scp.includes("Mail.Read") }];
  const fresh = [
    at("https://api.spaces.skype.com/", "Authorization.ReadWrite", 600),
    at("https://outlook.office.com", "Mail.ReadWrite Calendars.Read", 600),
    at("https://substrate.office.com", "SubstrateSearch-Internal.ReadWrite", 50),
  ];

  it("reads a token's audience and scopes from the token itself, as Brainstead does", () => {
    expect(H.claims(fresh[0].secret).aud).toBe("https://api.spaces.skype.com");
    expect(H.claims("not a jwt")).toEqual({ aud: "", scp: "" });
  });

  it("is nothing while every token has a while to run", () => {
    expect(H.due(fresh, now, TEAMS)).toEqual([]);
    expect(H.due(fresh, now, MAIL)).toEqual([]);
  });

  it("names a token that runs out within a whole hand-over plus Brainstead's margin, or has run out", () => {
    const next = [at("https://api.spaces.skype.com", "x", 20), ...fresh.slice(1)];
    expect(H.due(next, now, TEAMS)).toEqual([{ name: "chats", expires: now + 20 * 60 }]);
    const gone = [fresh[0], at("https://outlook.office.com", "Mail.Read", -30), fresh[2]];
    expect(H.due(gone, now, MAIL)).toEqual([{ name: "mail", expires: now - 30 * 60 }]);
  });

  it("goes by the newest token, as Brainstead chooses, not the longest-lived, and counts a missing one as due", () => {
    // An old long-lived one (perhaps turned down) beside the one the page renewed: the renewed one counts.
    const old = at("https://api.spaces.skype.com", "x", 20 * 60, 4 * 60);
    const renewed = at("https://api.spaces.skype.com", "x", 10, 5);
    expect(H.due([old, renewed, fresh[2]], now, TEAMS)).toEqual([{ name: "chats", expires: now + 10 * 60 }]);
    expect(H.due([], now, TEAMS).map((e) => e.name)).toEqual(["chats", "transcripts"]);
    // A mail-reading token by its scopes, not a calendar-only one.
    expect(H.due([at("https://outlook.office.com", "Calendars.Read", 600)], now, MAIL)).toEqual([{ name: "mail", expires: null }]);
  });

  it("reloads four minutes before the first runs out, or now when one is missing or nearly out", () => {
    expect(
      H.renewAt(
        [
          { name: "a", expires: now + 600 },
          { name: "b", expires: now + 900 },
        ],
        now,
      ),
    ).toBe(now + 600 - H.RENEW_SECS);
    expect(H.renewAt([{ name: "a", expires: now + 100 }], now)).toBe(now);
    expect(H.renewAt([{ name: "a", expires: null }], now)).toBe(now);
  });
});
