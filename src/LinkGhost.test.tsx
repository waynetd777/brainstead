// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: [string, Record<string, unknown>][] = [];
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (cmd === "files_list")
      return [
        { path: "wiki/entities/Orbit App.md", layer: "wiki", type: "entity", title: "Orbit App", date: null, size: 1, mtime: 2, tags: [] },
        { path: "wiki/entities/Maya.md", layer: "wiki", type: "entity", title: "Maya", date: null, size: 1, mtime: 1, tags: [] },
        {
          path: "wiki/concepts/Soft Launch.md",
          layer: "wiki",
          type: "concept",
          title: "Soft Launch",
          date: null,
          size: 1,
          mtime: 3,
          tags: [],
        },
      ];
    if (cmd === "health_link_ghost") return 2;
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { LinkGhost } from "./Health";
import { health } from "./knowledge";

afterEach(cleanup);

describe("Link to…", () => {
  it("lists the wiki's pages as you type, and links the one picked", async () => {
    const onClose = vi.fn();
    render(<LinkGhost item={{ name: "Orbit", pages: ["wiki/concepts/Soft Launch.md"] } as never} onClose={onClose} />);
    const box = screen.getByRole("combobox", { name: "The page to link to" });
    await waitFor(() => expect(calls.some(([c]) => c === "files_list")).toBe(true));
    fireEvent.change(box, { target: { value: "orb" } });
    const opts = await screen.findAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual(["Orbit Appentities"]);
    fireEvent.change(box, { target: { value: "a" } });
    // A word starting with it first (App), then names containing it, newest first.
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Orbit Appentities", "Soft Launchconcepts", "Mayaentities"]),
    );
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect((box as HTMLInputElement).value).toBe("Soft Launch");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    // Busy, with its spinner, until the checks report again.
    await waitFor(() => expect(calls.some(([c]) => c === "health_link_ghost")).toBe(true));
    expect(screen.getByRole("button", { name: "Link them" }).querySelector(".spin")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    health.set({} as never);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find(([c]) => c === "health_link_ghost")?.[1]).toMatchObject({ to: "wiki/concepts/Soft Launch.md" });
  });
});
