// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { splitTaskDates, TASK_DATES } from "./taskDates";

describe("task dates", () => {
  it("splits dates out of task text, but not out of code", () => {
    const parts = splitTaskDates("call 🛫 2026-10-05 then ➕️ 2026-10-01 `📅 2026-10-09`");
    expect(parts.map((p) => (typeof p === "string" ? p : `${p.date.id}=${p.day}`))).toEqual([
      "call ",
      "start=2026-10-05",
      " then ",
      "created=2026-10-01",
      " `📅 2026-10-09`",
    ]);
  });
  it("explains every date, with the shorthand that sets it", () => {
    for (const d of TASK_DATES) {
      expect(d.explain.length).toBeGreaterThan(10);
      if (d.shorthand) expect(d.explain).toContain(d.shorthand.replace(":", ""));
    }
  });
});
