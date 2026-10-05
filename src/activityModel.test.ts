// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { LogEntry } from "./api";
import { actionLabel, actionsIn, addDays, buildGrid, cellTip, filterLog, level, linkTarget } from "./activityModel";

const e = (date: string, action: string, title: string, description = ""): LogEntry => ({ date, time: null, action, title, description });

describe("activity", () => {
  it("counts days across months and years", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("builds whole weeks, Monday first, up to this week", () => {
    const g = buildGrid([{ date: "2026-09-29", notes: 2, wiki: 1, sources: 0 }], "2026-10-03", 4);
    expect(g.weeks).toHaveLength(4);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks[0][0].date).toBe("2026-09-07"); // a Monday
    const last = g.weeks[3];
    expect(last[0].date).toBe("2026-09-28");
    expect(last[6].date).toBe("2026-10-04");
    expect(last[6].future).toBe(true);
    expect(last[1]).toMatchObject({ total: 3, level: 4 });
    expect(g.months).toEqual([{ week: 3, label: "Oct", year: "2026" }]);
    expect(cellTip(last[1])).toContain("2 notes, 1 wiki page");
  });

  it("reaches back to the earliest change", () => {
    const g = buildGrid([{ date: "2025-01-15", notes: 1, wiki: 0, sources: 0 }], "2026-10-03", 4);
    expect(g.weeks[0].some((c) => c.date === "2025-01-15")).toBe(true);
    // The year on the first month shown and on each January.
    expect(g.months.filter((m) => m.year).map((m) => `${m.label} ${m.year}`)).toEqual(["Feb 2025", "Jan 2026"]);
  });

  it("shades by quarters of the busiest day", () => {
    expect([0, 1, 25, 26, 50, 100, 400].map((n) => level(n, 100))).toEqual([0, 1, 1, 2, 2, 4, 4]);
  });

  it("filters the log by action, day and words", () => {
    const log = [
      e("2026-09-30", "update", "Orbit App", "Launch date"),
      e("2026-09-30", "ingest", "Roadmap"),
      e("2026-09-29", "update", "Hub Platform"),
    ];
    expect(actionsIn(log)).toEqual(["update", "ingest"]);
    expect(filterLog(log, { action: "update", day: null, q: "" })).toHaveLength(2);
    expect(filterLog(log, { action: null, day: "2026-09-30", q: "launch" }).map((x) => x.title)).toEqual(["Orbit App"]);
    expect(filterLog(log, { action: null, day: null, q: "ingested" })).toHaveLength(1);
    expect(actionLabel("lint-fix")).toBe("Health fix");
    expect(actionLabel("odd-thing")).toBe("Odd thing");
    expect(linkTarget("[[Orbit App|the app]]")).toBe("Orbit App");
  });
});

describe("activity search", () => {
  it("ranks title matches first, newest first within", async () => {
    const { rankLog, marks } = await import("./activityModel");
    const log = [
      e("2026-09-30", "update", "Hub Platform", "orbit launch"),
      e("2026-09-29", "update", "Orbit App"),
      e("2026-09-28", "create", "Orbit App launch"),
    ];
    expect(rankLog(log, "orbit launch").map((x) => x.title)).toEqual(["Orbit App launch", "Orbit App", "Hub Platform"]);
    expect(marks("Orbit App launch", "launch orbit")).toEqual([
      { text: "Orbit", hit: true },
      { text: " App ", hit: false },
      { text: "launch", hit: true },
    ]);
    expect(marks("Plain", "")).toEqual([{ text: "Plain", hit: false }]);
  });
});
