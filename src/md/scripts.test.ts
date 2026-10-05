// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { scriptsAllowed } from "./scripts";

describe("where scripts run", () => {
  it("runs them in the user's own notes only", () => {
    expect(scriptsAllowed("Meeting. Orbit App Steerco - 2026-09-30.md", { type: "meeting" })).toBe(true);
    expect(scriptsAllowed("sources/Email. Thread. Pilot - 2026-09-30.md")).toBe(false);
    expect(scriptsAllowed("wiki/entities/Orbit App.md")).toBe(false);
    expect(scriptsAllowed("Templates/scripts/x.js")).toBe(false);
  });

  it("doesn't run them in notes an assistant wrote", () => {
    expect(scriptsAllowed("Meeting. Orbit App Steerco - 2026-09-30.md", { "created-by": "assistant" })).toBe(false);
    expect(scriptsAllowed("Chat. Launch readiness.md", { type: "chat" })).toBe(false);
    expect(scriptsAllowed("Me. Daily Summaries - 2026-10.md", null)).toBe(false);
    expect(scriptsAllowed("Me. Weekly Summaries - 2026-10.md", null)).toBe(false);
    expect(scriptsAllowed("Me. Daily Reviews - 2026-10.md", null)).toBe(false);
    expect(scriptsAllowed("Me. To Do List.md", null)).toBe(true);
  });
});
