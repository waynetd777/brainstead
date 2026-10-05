// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "tasks_all" ? [] : null)),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

import { QueryBuilder } from "./QueryBuilder";
import { setVaultVocabForTest } from "./queryVocab";

setVaultVocabForTest({ tags: ["#work"], folders: ["Clients"], notes: [], fields: [] });
afterEach(cleanup);

describe("the query builder", () => {
  it("opens on a block's query, follows the form, and writes back what it shows", () => {
    const apply = vi.fn();
    render(<QueryBuilder req={{ lang: "tasks", text: "not done\nsort by due", apply }} />);
    const box = screen.getByLabelText("Query text") as HTMLTextAreaElement;
    expect(box.value).toBe("not done\nsort by due");
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(box.value).toBe("done\nsort by due");
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(apply).toHaveBeenCalledWith("done\nsort by due", "tasks");
  });
  it("starts a new Dataview table, and says when the text is edited by hand", () => {
    const apply = vi.fn();
    render(<QueryBuilder req={{ lang: "dataview", kind: "TABLE", text: "", apply }} />);
    const box = screen.getByLabelText("Query text") as HTMLTextAreaElement;
    expect(box.value).toBe('TABLE file.mtime AS "Changed"');
    fireEvent.change(box, { target: { value: "LIST" } });
    expect(screen.getByText(/edited by hand/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(apply).toHaveBeenCalledWith("LIST", "dataview");
  });
});
