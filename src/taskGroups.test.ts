// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { TaskRow } from "./api";
import { groupTasks, matchesSearch, withinEffort } from "./taskGroups";

const t = (text: string, x: Partial<TaskRow> = {}) =>
  ({ text, due: null, contexts: [], project: null, effortMin: null, ...x }) as unknown as TaskRow;

describe("task groups", () => {
  const rows = [
    t("a", { project: "Project. Orbit App launch.md", contexts: ["calls"], due: "2026-10-02" }),
    t("b", { due: "2026-10-03" }),
    t("c", { project: "Project. Hub migration.md", due: "2026-10-04", effortMin: 15 }),
    t("d", { contexts: ["office"], due: "2026-10-20", effortMin: 45 }),
  ];
  it("groups by project, the ones with none last", () => {
    expect(groupTasks(rows, "project", "2026-10-03").map((g) => [g.label, g.rows.map((r) => r.text)])).toEqual([
      ["Hub migration", ["c"]],
      ["Orbit App launch", ["a"]],
      ["No project", ["b", "d"]],
    ]);
  });
  it("groups by due date in time order", () => {
    // 2026-10-03 is a Saturday: Sunday the 4th is still this week.
    expect(groupTasks(rows, "due", "2026-10-03").map((g) => g.label)).toEqual(["Overdue", "Today", "This week", "Later"]);
  });
  it("groups by first context and filters by effort", () => {
    expect(groupTasks(rows, "context", "2026-10-03").map((g) => g.label)).toEqual(["@calls", "@office", "No context"]);
    expect(rows.filter((r) => withinEffort(r, "30")).map((r) => r.text)).toEqual(["c"]);
    expect(rows.filter((r) => withinEffort(r, "")).length).toBe(4);
  });
  it("searches every word in the text, note, project and contexts, ignoring case and accents", () => {
    const r = t("Call Zoë about the launch", {
      title: "Weekly sync",
      tags: ["#context/calls"],
      contexts: ["calls"],
      project: "Project. Orbit App launch.md",
    });
    expect(matchesSearch(r, "zoe LAUNCH")).toBe(true);
    expect(matchesSearch(r, "orbit sync")).toBe(true);
    expect(matchesSearch(r, "@calls")).toBe(true);
    expect(matchesSearch(r, "zoe budget")).toBe(false);
    expect(matchesSearch(r, "  ")).toBe(true);
  });
});
