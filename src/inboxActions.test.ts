// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (_cmd: string, _a?: Record<string, unknown>): Promise<unknown> => ({ line: 0, lineText: "", undo: "Done" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (c: string, a?: Record<string, unknown>) => invoke(c, a),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import type { InboxItem } from "./api";
import { doneNow } from "./inboxActions";

const item = (lineText: string): InboxItem =>
  ({ kind: "task", path: "Me. To Do List.md", line: 4, lineText, text: lineText.replace(/^- \[ \] /, "") }) as InboxItem;

describe("Done now in the Inbox", () => {
  it("adds a recurring task's next occurrence, as everywhere else", async () => {
    invoke.mockClear();
    await doneNow(item("- [ ] Water the plants 🔁 every week 📅 2026-10-01"));
    const [cmd, a] = invoke.mock.calls[0];
    expect(cmd).toBe("task_replace");
    const lines = a!.lines as string[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \[ \] Water the plants 🔁 every week 📅 2026-10-08$/);
    expect(lines[1]).toMatch(/^- \[x\] Water the plants 🔁 every week 📅 2026-10-01 ✅ \d{4}-\d\d-\d\d$/);
  });

  it("ticks a plain task", async () => {
    invoke.mockClear();
    await doneNow(item("- [ ] Call Sam"));
    expect(invoke.mock.calls[0][0]).toBe("task_toggle");
  });
});
