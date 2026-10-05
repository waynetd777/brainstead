// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { applyShorthand, pendingShorthand, resolveDateWord } from "./dates";

// Friday 2 October 2026.
const FRI = "2026-10-02";

describe("date words", () => {
  it("resolves words from today", () => {
    expect(resolveDateWord("today", FRI)).toBe("2026-10-02");
    expect(resolveDateWord("tomorrow", FRI)).toBe("2026-10-03");
    expect(resolveDateWord("mon", FRI)).toBe("2026-10-05");
    expect(resolveDateWord("Monday", FRI)).toBe("2026-10-05");
    expect(resolveDateWord("fri", FRI)).toBe("2026-10-09");
    expect(resolveDateWord("next week", FRI)).toBe("2026-10-05");
    expect(resolveDateWord("+3d", FRI)).toBe("2026-10-05");
    expect(resolveDateWord("+2w", FRI)).toBe("2026-10-16");
    expect(resolveDateWord("2026-12-01", FRI)).toBe("2026-12-01");
    expect(resolveDateWord("month", FRI)).toBeNull();
    expect(resolveDateWord("monk", FRI)).toBeNull();
    // Across a month and a year end.
    expect(resolveDateWord("+1d", "2026-12-31")).toBe("2027-01-01");
  });
  it("rewrites shorthand in text", () => {
    expect(applyShorthand("Ask Maya #followup due: mon", FRI)).toBe("Ask Maya #followup 📅 2026-10-05");
    expect(applyShorthand("Pay bills defer: +3d due:fri", FRI)).toBe("Pay bills ⏳ 2026-10-05 📅 2026-10-09");
    expect(applyShorthand("Due: soon, really", FRI)).toBe("Due: soon, really");
    expect(applyShorthand("overdue: no", FRI)).toBe("overdue: no");
  });
  it("spots a bare shorthand before the caret", () => {
    expect(pendingShorthand("Call Sam due:")).toBe("due");
    expect(pendingShorthand("defer:")).toBe("defer");
    expect(pendingShorthand("overdue:")).toBeNull();
    expect(pendingShorthand("due: mon")).toBeNull();
  });
  it("writes start and created dates too", () => {
    expect(applyShorthand("Plan it start: mon created: today", "2026-10-02")).toBe("Plan it 🛫 2026-10-05 ➕ 2026-10-02");
    expect(pendingShorthand("Plan start:")).toBe("start");
    expect(pendingShorthand("created:")).toBe("created");
  });
  it("reads dates written out", () => {
    expect(resolveDateWord("5 oct", "2026-10-02")).toBe("2026-10-05");
    expect(resolveDateWord("oct 5", "2026-10-02")).toBe("2026-10-05");
    expect(resolveDateWord("1 october", "2026-10-02")).toBe("2027-10-01");
    expect(resolveDateWord("3 sept 2027", "2026-10-02")).toBe("2027-09-03");
    expect(resolveDateWord("31 feb", "2026-10-02")).toBeNull();
    expect(resolveDateWord("5 octopus", "2026-10-02")).toBeNull();
  });
});
