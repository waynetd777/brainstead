// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { parseWikilink, wikiLabel } from "./wikilinks";

describe("wikilinks", () => {
  it("reads every shape the index reads", () => {
    expect(parseWikilink(false, "Orbit App")).toEqual({ target: "Orbit App", embed: false, alias: undefined });
    expect(parseWikilink(false, "Orbit App|the app")?.alias).toBe("the app");
    expect(parseWikilink(false, "Orbit App#Current state")?.heading).toBe("Current state");
    expect(parseWikilink(false, "Orbit App#^q3")?.block).toBe("q3");
    expect(parseWikilink(true, "pic.png")).toMatchObject({ target: "pic.png", embed: true });
    expect(parseWikilink(false, "#Local")).toMatchObject({ target: "", heading: "Local" });
    expect(parseWikilink(false, "A\\|b")?.alias).toBe("b");
    expect(parseWikilink(false, " ")).toBeNull();
  });
  it("labels links as other editors show them", () => {
    expect(wikiLabel({ target: "wiki/Orbit App", embed: false })).toBe("Orbit App");
    expect(wikiLabel({ target: "Orbit App", heading: "State", embed: false })).toBe("Orbit App › State");
    expect(wikiLabel({ target: "", heading: "Local", embed: false })).toBe("Local");
    expect(wikiLabel({ target: "X", alias: "shown", embed: false })).toBe("shown");
  });
});
