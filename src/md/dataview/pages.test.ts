// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import type { DvRawPage } from "../../api";

const page = (path: string): DvRawPage => ({
  path,
  title: path.replace(/\.md$/, ""),
  size: 1,
  ctime: 0,
  mtime: 0,
  day: null,
  frontmatter: {},
  aliases: [],
  etags: [],
  links: [],
  fields: [],
  lists: [],
});

// Each call answers when the test says, with the vault as it was when asked.
const calls: { resolve: () => void }[] = [];
let vault: string[] = ["A.md"];
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(
    (cmd: string) =>
      new Promise((resolve) => {
        if (cmd !== "dataview_pages") return resolve(null);
        const all = [...vault];
        calls.push({
          resolve: () => {
            resolve({ gen: calls.length, all, changed: all.map(page) });
          },
        });
      }),
  ),
}));

import { loadPages } from "./pages";

describe("Dataview's pages", () => {
  it("catches up when the vault changes while it's loading", async () => {
    const first = loadPages(1);
    vault = ["A.md", "B.md"];
    const second = loadPages(2);
    calls[0].resolve();
    await first;
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].resolve();
    const set = await second;
    expect([...set.byPath.keys()]).toEqual(["A.md", "B.md"]);
  });
});
