// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { highlightTerms, lineText, termsRegex } from "./highlight";

describe("highlight terms", () => {
  it("follows the previous app's rules", () => {
    expect(highlightTerms("orbit app")).toEqual(["orbit", "app"]);
    expect(highlightTerms('"soft launch" -customers tag:x a')).toEqual(["soft launch", "launch", "soft"]);
    expect(highlightTerms("x NOT hidden AND +shown")).toEqual(["shown"]);
    expect(highlightTerms("App app APP")).toEqual(["App"]);
  });
  it("escapes regex characters", () => {
    expect("cost (q4)".match(termsRegex(highlightTerms("(q4)"))!)?.[0]).toBe("(q4)");
  });
});

describe("lineText", () => {
  it("reads a markdown line as View shows it", () => {
    expect(lineText("- **Owner**: [[Maya Patel|Maya]], see [the plan](plan.md)")).toBe("owner: maya, see the plan");
    expect(lineText("  2. [ ] Launch is on `14 November`")).toBe("launch is on 14 november");
    expect(lineText("Owner:   Maya\n  and Lena")).toBe("owner: maya and lena");
  });
});
