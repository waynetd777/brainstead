// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { planTables } from "./printTables";

/** A table at `top` with `n` rows of `h` px under a 20px header. */
const table = (top: number, n: number, h = 20) => ({
  top,
  head: 20,
  rows: Array.from({ length: n }, (_, i) => ({ top: top + 20 + i * h, bottom: top + 20 + (i + 1) * h })),
});

describe("repeating table headers in print", () => {
  it("leaves a table that fits alone", () => {
    expect(planTables([table(100, 10)], 1000, 20)).toEqual([{ breakBefore: false, splits: [] }]);
  });

  it("splits where a row would cross the page's foot, and again on each later page", () => {
    // Rows end at 140 + 20i; the first page ends at 980 (1000 less the slack): rows 0–42 fit.
    const [p] = planTables([table(100, 120)], 1000, 20);
    // A continuation page holds the header (20) and then 48 rows before 1980.
    expect(p.splits).toEqual([43, 91]);
  });

  it("moves a table that starts too low to the next page", () => {
    const [p] = planTables([table(975, 5)], 1000, 20);
    expect(p.breakBefore).toBe(true);
    expect(p.splits).toEqual([]);
  });

  it("counts the pages added by an earlier table for the next one", () => {
    // The first table's continuation starts page 2 after a repeated header, so everything after
    // it prints 40px lower than measured (20 for the header, 20 left at page 1's foot).
    const [a, b] = planTables([table(100, 60), table(1700, 12)], 1000, 20);
    expect(a.splits).toEqual([43]);
    // Measured, the second table ends at 1960 (fits before 1980); printed, at 2000, so it splits.
    expect(b.splits).toEqual([11]);
  });
});
