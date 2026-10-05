// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { lineDiff } from "./lineDiff";

describe("lineDiff", () => {
  it("marks nothing when the texts are the same", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual({ a: [false, false], b: [false, false] });
  });
  it("marks a changed line on both sides", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual({ a: [false, true, false], b: [false, true, false] });
  });
  it("marks added and removed lines on their own side", () => {
    expect(lineDiff("a\nb\nc\nd", "a\nc\nd\ne")).toEqual({ a: [false, true, false, false], b: [false, false, false, true] });
  });
  it("keeps the common lines in the middle", () => {
    expect(lineDiff("x\nkeep\ny", "p\nkeep\nq")).toEqual({ a: [true, false, true], b: [true, false, true] });
  });
});
