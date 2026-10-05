// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { oneOnOne, outline } from "./SideCards";

describe("cards beside a note", () => {
  it("outlines the headings outside frontmatter and code", () => {
    const md = "---\ntitle: x\n# not a heading\n---\n# Title\n\n## Notes ##\n```\n# code\n```\n### Actions\n";
    expect(outline(md)).toEqual([
      [1, "Title"],
      [2, "Notes"],
      [3, "Actions"],
    ]);
  });
  it("reads a 1-1's person and date", () => {
    expect(oneOnOne("1-1. Maya Chen - 2026-09-23.md")).toEqual(["Maya Chen", "2026-09-23"]);
    expect(oneOnOne("folder/1-1. Lena - 2026-09-01.md")).toEqual(["Lena", "2026-09-01"]);
    expect(oneOnOne("Meeting. Steerco - 2026-09-30.md")).toBeNull();
  });
});
