// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { FixNameRow } from "./api";
import { chosenRows } from "./FixName";

const row = (file: string, action: string): FixNameRow => ({ file, layer: "note", inFilename: false, count: 1, lines: [], action });

describe("fix name", () => {
  it("changes only ticked rewrites and the alias", () => {
    const rows = [
      row("a.md", "rewrite"),
      row("b.md", "rewrite"),
      row("wiki/entities/Lena.md", "alias"),
      row("sources/t.md", "leave"),
      row("1-1. Lina Park.md", "guarded"),
    ];
    expect(chosenRows(rows, new Set(["b.md"])).map((r) => r.file)).toEqual(["a.md", "wiki/entities/Lena.md"]);
  });
});
