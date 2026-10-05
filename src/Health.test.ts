// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { act } from "./Health";

describe("health actions", () => {
  it("runs once while busy, then again when done", async () => {
    let runs = 0;
    let finish: () => void = () => {};
    const run = () =>
      new Promise<void>((r) => {
        runs++;
        finish = r;
      });
    act("fix:x", run, () => {}, false);
    act("fix:x", run, () => {}, false);
    expect(runs).toBe(1);
    finish();
    await new Promise((r) => setTimeout(r, 0));
    act("fix:x", run, () => {}, false);
    expect(runs).toBe(2);
  });
});
