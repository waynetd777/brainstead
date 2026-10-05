// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { Transcript } from "./api";
import { needsDate, noteExists, specOf } from "./Meeting";

const t = (dateCheck: boolean): Transcript => ({
  path: "sources/Teams. Transcript. Orbit App Steerco - 2026-10-03.md",
  mtime: 0,
  done: null,
  inferred: {
    filename: "Teams. Transcript. Orbit App Steerco - 2026-10-03.md",
    kind: "meeting",
    type: "Meeting",
    name: "Orbit App Steerco",
    date: "2026-10-03",
    topic: null,
    confident: !dateCheck,
    ask: [],
    suggestedFilename: null,
    existingNotes: [],
    exists: false,
    dateCheck,
  },
});

describe("meeting note date", () => {
  it("waits for the user when the date is only the capture day", () => {
    expect(needsDate(t(true))).toBe(true);
    expect(needsDate(t(true), { name: "Steerco" })).toBe(true);
    // Confirmed as it is, or changed.
    expect(needsDate(t(true), { date: "2026-10-03" })).toBe(false);
    expect(specOf(t(true), { date: "2026-10-02" }).date).toBe("2026-10-02");
    expect(needsDate(t(false))).toBe(false);
  });
});

describe("meeting note that exists already", () => {
  it("has nothing to draft until its name or date changes", () => {
    const x = { ...t(false), inferred: { ...t(false).inferred, exists: true } };
    expect(noteExists(x)).toBe(true);
    expect(noteExists(x, { date: "2026-10-03" })).toBe(true);
    expect(noteExists(x, { date: "2026-10-02" })).toBe(false);
    expect(noteExists(t(false))).toBe(false);
  });
});
