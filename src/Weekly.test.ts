// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { hasProgress, keepsPaused, reviewWeek, scheduleLabel } from "./Weekly";
import type { WeeklyState } from "./api";

const saved = (week: string): WeeklyState => ({ week, step: 2, done: [0, 1], log: [], notes: "", startedAt: 0 });

describe("the weekly review's week", () => {
  it("is last week on a Monday or Tuesday, otherwise this week, as the weekly summary", () => {
    expect(reviewWeek("2026-10-02")).toBe("2026-W40"); // Friday
    expect(reviewWeek("2026-10-04")).toBe("2026-W40"); // Sunday
    expect(reviewWeek("2026-10-05")).toBe("2026-W40"); // Monday
    expect(reviewWeek("2026-10-06")).toBe("2026-W40"); // Tuesday
    expect(reviewWeek("2026-10-07")).toBe("2026-W41"); // Wednesday
    expect(reviewWeek("2027-01-04")).toBe("2026-W53"); // a Monday across the year
  });
  it("is the paused review's own week until the next week's review is due", () => {
    expect(keepsPaused(null, "2026-10-03")).toBe(false);
    expect(keepsPaused(saved("2026-W40"), "2026-10-06")).toBe(true);
    expect(keepsPaused(saved("2026-W40"), "2026-10-09")).toBe(true);
    expect(keepsPaused(saved("2026-W40"), "2026-10-13")).toBe(true);
    expect(keepsPaused(saved("2026-W40"), "2026-10-14")).toBe(false);
    expect(keepsPaused(saved("2026-W38"), "2026-10-03")).toBe(false);
  });
});

describe("the start page's schedule", () => {
  it("says the review's day and time, Friday 16:00 by default", () => {
    expect(scheduleLabel("mon", "09:30")).toBe("Mondays at 09:30");
    expect(scheduleLabel(undefined, undefined)).toBe("Fridays at 16:00");
    expect(scheduleLabel("fri", "4pm")).toBe("Fridays at 16:00");
  });
});

describe("starting the review over", () => {
  const blank: WeeklyState = { week: "2026-W40", step: 0, done: [], log: [], notes: "", startedAt: 0 };
  it("asks first only when there's progress to lose", () => {
    expect(hasProgress(blank)).toBe(false);
    expect(hasProgress({ ...blank, notes: "  " })).toBe(false);
    expect(hasProgress(saved("2026-W40"))).toBe(true);
    expect(hasProgress({ ...blank, notes: "Call Lena" })).toBe(true);
    expect(hasProgress({ ...blank, log: ["Dropped Orbit App"] })).toBe(true);
    expect(hasProgress({ ...blank, handled: { s1: "skipped" } })).toBe(true);
  });
});
