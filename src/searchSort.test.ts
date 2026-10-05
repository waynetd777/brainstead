// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { SearchHit } from "./api";
import { sinceOf, sortHits } from "./Search";

const hit = (path: string, date: string | null, mtime: number) => ({ file: { path, date, mtime } }) as unknown as SearchHit;

describe("search order and range", () => {
  it("sorts by the file's date, else the day it changed", () => {
    const hs = [hit("a", "2026-09-01", 0), hit("b", null, Date.parse("2026-10-02T10:00:00Z")), hit("c", "2026-09-20", 0)];
    expect(sortHits(hs, "newest").map((h) => h.file.path)).toEqual(["b", "c", "a"]);
    expect(sortHits(hs, "oldest").map((h) => h.file.path)).toEqual(["a", "c", "b"]);
    expect(sortHits(hs, "best")).toBe(hs);
  });
  it("counts the range back from today", () => {
    expect(sinceOf("7", new Date(2026, 9, 3))).toBe("2026-09-26");
    expect(sinceOf("31", new Date(2026, 0, 15))).toBe("2025-12-15");
  });
});
