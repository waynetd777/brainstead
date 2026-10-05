// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { maskLines } from "./spellMask";

describe("what spelling skips", () => {
  it("keeps offsets and blanks frontmatter, code and math", () => {
    const lines = ["---", "tags: [projct]", "---", "Real txt", "```js", "cnst x", "```", "$$", "\\frac", "$$", "Aftr"];
    const m = maskLines(lines);
    expect(m.map((l, i) => l.length === lines[i].length)).toEqual(lines.map(() => true));
    expect(m.filter((l) => l.trim())).toEqual(["Real txt", "Aftr"]);
  });

  it("blanks links, tags, code, fields and dates but keeps link labels", () => {
    const l = "- [ ] Call Mya about [[Orbit Ap]] see [the plnn](https://x.io/a) #projct/orbit `cde` 📅 2026-10-03 [effort:: 15m] ^blk1";
    const [m] = maskLines([l]);
    expect(m.length).toBe(l.length);
    expect(m.replace(/\s+/g, " ").trim()).toBe("- [ ] Call Mya about see [the plnn");
    expect(maskLines(["mail maya@acme.example now"])[0].replace(/\s+/g, " ")).toBe("mail now");
  });
});
