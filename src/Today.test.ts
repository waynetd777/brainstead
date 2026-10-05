// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { greeting, isReviewDay } from "./Today";

describe("Today's greeting", () => {
  it("follows the hour", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(12)).toBe("Good afternoon");
    expect(greeting(18)).toBe("Good evening");
  });
  it("adds the first name from Settings when there is one", () => {
    expect(greeting(9, "Maya Patel")).toBe("Good morning, Maya");
    expect(greeting(9, "  ")).toBe("Good morning");
    expect(greeting(20, undefined)).toBe("Good evening");
  });
});

describe("the weekly review reminder", () => {
  // 2026-10-02 is a Friday.
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
  it("shows from the review's time on its day and all the next day", () => {
    expect(isReviewDay("fri", "16:00", at(2, 15, 59))).toBe(false);
    expect(isReviewDay("fri", "16:00", at(2, 16, 0))).toBe(true);
    expect(isReviewDay("fri", "16:00", at(3, 0, 5))).toBe(true);
    expect(isReviewDay("fri", "16:00", at(3, 23, 59))).toBe(true);
    expect(isReviewDay("fri", "16:00", at(4, 9, 0))).toBe(false);
    expect(isReviewDay("fri", "16:00", at(1, 17, 0))).toBe(false);
  });
  it("follows another day and time, and defaults to Friday 16:00", () => {
    expect(isReviewDay("sun", "09:30", at(4, 9, 30))).toBe(true);
    expect(isReviewDay("sun", "09:30", at(5, 20, 0))).toBe(true);
    expect(isReviewDay("sun", "09:30", at(3, 20, 0))).toBe(false);
    expect(isReviewDay(undefined, undefined, at(2, 16, 30))).toBe(true);
    expect(isReviewDay(undefined, undefined, at(2, 10, 0))).toBe(false);
  });
});
