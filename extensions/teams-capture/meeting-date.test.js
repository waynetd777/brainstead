// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The meeting date the Teams extension reads from a recap page (meeting-date.js), over invented
// snippets. Vitest runs it with the app's tests (`make check`).

import { beforeAll, describe, expect, it } from "vitest";

let parse, find;
beforeAll(async () => {
  await import("./meeting-date.js");
  ({ parseMeetingDate: parse, findMeetingDate: find } = globalThis.brainsteadMeetingDate);
});

const now = new Date(2026, 9, 4, 9, 0); // Sunday 4 October 2026, 09:00

describe("parseMeetingDate", () => {
  it("reads English formats", () => {
    expect(parse("Friday, 2 October 2026", { now })).toEqual({ date: "2026-10-02" });
    expect(parse("Friday, 2 October 2026 10:00 AM - 10:30 AM", { now })).toEqual({ date: "2026-10-02", start: "10:00" });
    expect(parse("Fri 10/2/2026 10:00 AM", { now })).toEqual({ date: "2026-10-02", start: "10:00" });
    expect(parse("2 Oct 2026, 10:00", { now })).toEqual({ date: "2026-10-02", start: "10:00" });
    expect(parse("October 2, 2026 at 2:30 PM", { now })).toEqual({ date: "2026-10-02", start: "14:30" });
    expect(parse("Thu 1st Oct 2026 16:05", { now })).toEqual({ date: "2026-10-01", start: "16:05" });
    expect(parse("2026-10-02T10:00:00", { now })).toEqual({ date: "2026-10-02", start: "10:00" });
    expect(parse("2026-10-02", { now })).toEqual({ date: "2026-10-02" });
  });

  it("turns a zoned ISO time into the local day and time", () => {
    const at = new Date("2026-10-02T08:00:00Z");
    const want = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    expect(parse("2026-10-02T08:00:00Z", { now })?.date).toBe(want);
  });

  it("reads 10/2 by the weekday, then by the locale", () => {
    expect(parse("Fri 10/2/2026", { now })?.date).toBe("2026-10-02");
    expect(parse("Tue 10/2/2026", { now })?.date).toBe("2026-02-10");
    expect(parse("10/2/2026", { now, monthFirst: true })?.date).toBe("2026-10-02");
    expect(parse("10/2/2026", { now })?.date).toBe("2026-02-10");
    expect(parse("25/09/2026", { now, monthFirst: true })?.date).toBe("2026-09-25");
  });

  it("fills in a missing year without going into the future", () => {
    expect(parse("Friday, October 2", { now })?.date).toBe("2026-10-02");
    expect(parse("Tuesday 18 November", { now })?.date).toBe("2025-11-18");
  });

  it("gives nothing rather than a guess", () => {
    expect(parse("", { now })).toBeNull();
    expect(parse("Orbit App steerco", { now })).toBeNull();
    expect(parse("Marketing 2 sync", { now })).toBeNull();
    expect(parse("Monday, 2 October 2026", { now })).toBeNull(); // 2 October is a Friday
    expect(parse("Friday, 6 November 2026", { now })).toBeNull(); // in the future
    expect(parse("31 February 2026", { now })).toBeNull();
  });
});

describe("findMeetingDate", () => {
  const page = (html) =>
    new DOMParser().parseFromString(`<html><head><title>Recap | Microsoft Teams</title></head><body>${html}</body></html>`, "text/html");

  it("reads the recap header's date and start", () => {
    const doc = page(`
      <div class="header"><span title="Orbit App steerco">Orbit App steerco</span>
        <div><span>Friday, 2 October 2026</span><span>10:00 AM - 10:30 AM</span></div></div>`);
    expect(find(doc, { now })).toEqual({ meetingDate: "2026-10-02", meetingStart: "10:00" });
  });

  it("reads a <time datetime>", () => {
    const doc = page(`<p>Meeting held <time datetime="2026-09-30T14:00:00">Wed</time></p>`);
    expect(find(doc, { now })).toEqual({ meetingDate: "2026-09-30", meetingStart: "14:00" });
  });

  it("reads an aria-label", () => {
    const doc = page(`<button aria-label="Meeting details, Thursday, 1 October 2026, 9:15 AM">Details</button>`);
    expect(find(doc, { now })).toEqual({ meetingDate: "2026-10-01", meetingStart: "09:15" });
  });

  it("skips the transcript and the messages", () => {
    const doc = page(`
      <div id="t"><span>Maya: we said 3 Oct 2026, 11:00 last time</span><time datetime="2026-10-03T11:00:00">x</time></div>
      <h2>Tuesday, 29 September 2026</h2>`);
    expect(find(doc, { now, exclude: [doc.getElementById("t")] })).toEqual({ meetingDate: "2026-09-29" });
  });

  it("finds nothing on a page without a date", () => {
    expect(find(page(`<div><span>Lena</span><span>Ready?</span></div>`), { now })).toBeNull();
  });
});
