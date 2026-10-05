// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { daysUntil } from "./taskQuery";

describe("dates", () => {
  it("counts days", () => {
    expect(daysUntil("2026-10-02", "2026-10-02")).toBe(0);
    expect(daysUntil("2026-10-05", "2026-10-02")).toBe(3);
    expect(daysUntil("2026-09-30", "2026-10-02")).toBe(-2);
  });
});
