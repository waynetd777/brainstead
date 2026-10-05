// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { fold } from "./Glance";

describe("pie slices", () => {
  const c = (name: string, n: number) => ({ name, n });
  it("keeps the top five named and folds the rest, and no type, into Other", () => {
    const f = fold([c("Idea", 6), c("", 4), c("Me", 5), c("Spec", 3), c("1-1", 2), c("Project", 2), c("Recipe", 1)], (n, rest) => ({
      label: `Other ${rest}`,
      tip: `${n}`,
    }));
    expect(f.top.map((x) => x.name)).toEqual(["Idea", "Me", "Spec", "1-1", "Project"]);
    expect(f.other).toMatchObject({ key: "other", n: 5, label: "Other 2" });
  });
  it("has no Other when everything fits", () => {
    expect(fold([c("concept", 1), c("entity", 1)], () => ({ label: "Other", tip: "" })).other).toBeNull();
  });
});
