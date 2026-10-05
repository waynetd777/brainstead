// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const file = (path: string, layer: string, title: string) => ({ path, layer, title, type: null, date: null, size: 1, mtime: 0, tags: [] });
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "files_list")
      return [file("Templates/Meeting.md", "template", "Meeting"), file("Templates/Person.md", "template", "Person")];
    if (cmd === "doc_read") return { content: '<% tp.file.rename("x") %>', meta: {}, root: "", version: "1" };
    return null;
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

import { NewNoteDialog, templateSummary } from "./NewNote";

afterEach(cleanup);

const flush = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

describe("New note", () => {
  it("keeps choosing templates with the arrows after the typed-in field goes", async () => {
    render(<NewNoteDialog />);
    await waitFor(() => expect(screen.getByText("Meeting")).toBeTruthy());
    const chosen = () => screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")?.textContent;
    const title = screen.getByLabelText(/title/i, { selector: "input" });
    title.focus();
    fireEvent.keyDown(title, { key: "ArrowDown" });
    await flush();
    expect(chosen()).toContain("Meeting");
    // The title field went with Blank note; the keys still reach the dialog.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await flush();
    expect(chosen()).toContain("Person");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    await flush();
    expect(chosen()).toContain("Meeting");
  });

  it("says what a template asks without running it", () => {
    const src = `<% const who = await tp.system.prompt("Who is it with?") %>
<% const p = await tp.system.suggester(["A", "B"], ["A", "B"]) %>
<% await tp.system.prompt('Maya\\'s topic', "x") %><% await tp.file.rename(who) %>`;
    expect(templateSummary(src)).toEqual({ questions: ["Who is it with?", "Maya's topic"], lists: 1, names: true });
    expect(templateSummary("# Plain")).toEqual({ questions: [], lists: 0, names: false });
  });
});
