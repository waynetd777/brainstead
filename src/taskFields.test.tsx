// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// No task field is ever shown as its emoji: View, Edit (away from the cursor's line) and the task
// lists draw every one as an icon with its value. The file keeps them.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}`, invoke: vi.fn(async () => []) }));

import type { TaskRow } from "./api";
import { CMEditor } from "./editor/cm";
import { Markdown } from "./md/Markdown";
import { FIELD_EMOJI, fieldsAsWords, splitTaskFields, withoutFields } from "./taskFields";
import { TaskList } from "./TaskList";

const LINES = [
  "- [ ] Every field ⏫ 🔁 every week when done 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-03 ➕ 2026-09-20 🆔 a1 ⛔ b2, c3 🏁 delete #x",
  "- [x] Done one 🔽 ✅ 2026-10-01",
  "- [-] Cancelled one 🔺 ❌ 2026-09-30",
  "- [/] Half way ⏬ 📆 2026-10-09",
  "1. [ ] Numbered 🔼 ⌛ 2026-10-04",
];
const noEmoji = (text: string) => FIELD_EMOJI.filter((e) => text.includes(e));

afterEach(cleanup);

describe("task fields are never shown as emoji", () => {
  it("splits every field out of task text", () => {
    const parts = splitTaskFields("Do it ⏫ 🔁 every day 📅 2026-10-03 🆔 x ⛔ y, z 🏁 keep `📅 2026-10-09`");
    expect(parts.filter((p) => typeof p !== "string").map((p) => typeof p !== "string" && [p.field.id, p.value])).toEqual([
      ["priority", "High"],
      ["recurrence", "every day"],
      ["due", "2026-10-03"],
      ["id", "x"],
      ["dependsOn", "y,z"],
      ["onCompletion", "keep"],
    ]);
    expect(withoutFields("Do it ⏫ 📅 2026-10-03 #tag")).toBe("Do it #tag");
  });

  it("in View", () => {
    const { container } = render(<Markdown content={LINES.join("\n")} path="A.md" root="/vault" />);
    expect(noEmoji(container.textContent ?? "")).toEqual([]);
    expect(container.querySelectorAll(".tdate").length).toBeGreaterThan(12);
    expect(container.querySelectorAll("input[type=checkbox]").length).toBe(5);
  });

  it("in the task lists", () => {
    const rows = LINES.map(
      (l, i) =>
        ({
          path: "A.md",
          title: "A",
          line: i,
          lineText: l,
          text: l.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s+/, ""),
          status: /\[(.)\]/.exec(l)![1],
          done: /\[[xX-]\]/.test(l),
          due: null,
          scheduled: null,
          start: null,
          doneOn: null,
          created: null,
          rank: null,
          tags: [],
          heading: null,
        }) as TaskRow,
    );
    const { container } = render(<TaskList rows={rows} manual={false} display={{ hidden: new Set(), short: false, urgency: true }} />);
    expect(noEmoji(container.textContent ?? "")).toEqual([]);
    const short = render(<TaskList rows={rows} manual={false} display={{ hidden: new Set(), short: true, urgency: false }} />);
    expect(noEmoji(short.container.textContent ?? "")).toEqual([]);
  });

  it("in Edit, away from the cursor's line", () => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const ed = new CMEditor(parent, {}, "live");
    ed.load(`# Tasks\n\n${LINES.join("\n")}\n\nend`);
    ed.view.dispatch({ selection: { anchor: ed.view.state.doc.length } });
    expect(noEmoji(ed.view.contentDOM.textContent ?? "")).toEqual([]);
    expect(ed.getMarkdown()).toContain("⏫ 🔁 every week when done");
    ed.destroy();
  });
});

describe("fields as words", () => {
  it("says a quoted task's fields in words, for a tooltip", () => {
    expect(fieldsAsWords("Delete “Call Maya #waiting-for ✅ 2026-10-04”")).toBe("Delete “Call Maya #waiting-for Done 2026-10-04”");
    expect(fieldsAsWords("No fields here")).toBe("No fields here");
  });
});
