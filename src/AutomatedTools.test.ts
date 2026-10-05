// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { AutomationSuggestion } from "./api";
import { covers, fromSuggestion, toSave } from "./AutomatedTools";

const g = (cwd: string): AutomationSuggestion => ({ cwd, count: 4, total: 4, last: "" });

describe("tools from sessions", () => {
  it("lists a suggested folder as a tool named after it", () => {
    expect(fromSuggestion(g("/work/digest"))).toEqual({ label: "digest", cwd_contains: "/work/digest", opening: "" });
  });

  it("hides a folder a listed tool takes in", () => {
    const t = { label: "Digest", cwd_contains: "digest", opening: "" };
    expect(covers(t, g("/work/digest"))).toBe(true);
    expect(covers(t, g("/work/orbit"))).toBe(false);
    expect(covers({ label: "x", cwd_contains: "", opening: "summarise" }, g("/a"))).toBe(false);
  });
});

describe("saving the tools", () => {
  it("saves nothing while the saved list hasn't loaded", () => {
    expect(toSave(null)).toBeNull();
  });

  it("leaves out a half-typed row", () => {
    const done = { label: "Digest", cwd_contains: "digest", opening: "" };
    expect(toSave([done, { label: "x", cwd_contains: "", opening: "" }])).toEqual([done]);
    expect(toSave([])).toEqual([]);
  });
});
