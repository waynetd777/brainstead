// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DvRawPage } from "../api";

const PAGES: DvRawPage[] = [
  {
    path: "Books/Dune.md",
    title: "Dune",
    size: 10,
    ctime: 0,
    mtime: 0,
    day: null,
    frontmatter: { rating: 9, author: "Frank Herbert" },
    aliases: [],
    etags: ["#book"],
    links: [],
    fields: [],
    lists: [],
  },
  {
    path: "Me. To Do List.md",
    title: "Me. To Do List",
    size: 10,
    ctime: 0,
    mtime: 0,
    day: null,
    frontmatter: {},
    aliases: [],
    etags: [],
    links: [],
    fields: [],
    lists: [
      {
        line: 3,
        lineCount: 1,
        lineText: "- [ ] Ship it 📅 2026-10-05 ⏫ 🔁 every week ➕ 2026-09-01 ^rank-1024",
        text: "Ship it 📅 2026-10-05 ⏫ 🔁 every week ➕ 2026-09-01 ^rank-1024",
        status: " ",
        parent: null,
        section: "Next",
        blockId: "rank-1024",
        tags: [],
        links: [],
        fields: [],
      },
    ],
  },
];

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "dataview_pages") return { gen: 1, all: PAGES.map((p) => p.path), changed: PAGES };
    if (cmd === "dataview_read") return null;
    if (cmd === "tasks_all") return [];
    if (cmd === "links_resolve") return [null];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { Markdown } from "./Markdown";

afterEach(cleanup);

const md = (content: string) => render(<Markdown content={content} path="Me. To Do List.md" root="/vault" scripts />);
const TASK_EMOJI = /[📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🔁🆔⛔🏁🗓]/u;

describe("dataview blocks", () => {
  it("draws a table with the document's table and a docs link", async () => {
    const { container } = md('```dataview\nTABLE author AS "Author", rating FROM #book\n```');
    await waitFor(() => expect(container.querySelector(".dvtable")).not.toBeNull());
    const cells = [...container.querySelectorAll(".dvtable td")].map((c) => c.textContent);
    expect(cells).toEqual(["Dune", "Frank Herbert", "9"]);
    expect(container.querySelector(".dvtable th")?.textContent).toBe("File (1)");
    expect(container.querySelector(".qdocs")?.textContent).toBe("Dataview docs ↗");
  });
  it("draws tasks as task rows, with icons and never emoji", async () => {
    const { container } = md(
      "```dataview\nTASK WHERE !completed SORT rank\n```\n\n```dataview\nTABLE file.tasks.text AS T WHERE file.tasks\n```",
    );
    await waitFor(() => expect(container.querySelector(".trow")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".dvtable")).not.toBeNull());
    expect(container.textContent).toContain("Ship it");
    expect(container.querySelector(".dvtable .tdate.prio")).not.toBeNull();
    expect(container.querySelector(".dvtable .tdate.repeat")?.textContent).toContain("every week");
    expect(TASK_EMOJI.test(container.textContent ?? "")).toBe(false);
  });
  it("shows Dataview's parse errors", async () => {
    const { container } = md("```dataview\nTABLE x\nWHERE (\n```");
    await waitFor(() => expect(container.querySelector(".dverr")?.textContent).toContain("PARSING FAILED"));
  });
  it("runs DataviewJS with dv, DataArrays and rendering", async () => {
    const { container } = md(
      '```dataviewjs\nconst books = dv.pages("#book");\ndv.header(3, "Books");\ndv.table(["Name", "Author"], books.map(b => [b.file.link, b.author]));\ndv.paragraph(books.file.name.join(" / "));\ndv.list(dv.array([1, 2]).map(x => x * 2));\n```',
    );
    await waitFor(() => expect(container.querySelector(".dvjs table")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".dvjs h3")?.textContent).toBe("Books"));
    await waitFor(() => expect([...container.querySelectorAll(".dvjs td")].map((c) => c.textContent)).toEqual(["Dune", "Frank Herbert"]));
    await waitFor(() => expect(container.querySelector(".dvjs p")?.textContent).toBe("Dune"));
    await waitFor(() => expect([...container.querySelectorAll(".dvjs li")].map((c) => c.textContent)).toEqual(["2", "4"]));
  });
  it("says app isn't available to scripts", async () => {
    const { container } = md("```dataviewjs\napp.vault.getFiles();\n```");
    await waitFor(() => expect(container.querySelector(".dverr")?.textContent).toContain("isn't available in Brainstead"));
  });
  it("evaluates inline queries", async () => {
    const { container } = md("Name: `= this.file.name`, sum: `= 1 + 2`, js: `$= dv.pages('#book').length`");
    await waitFor(() =>
      expect([...container.querySelectorAll(".dvinline")].map((c) => c.textContent)).toEqual(["Me. To Do List", "3", "1"]),
    );
  });
});

describe("scripts in content that isn't the user's note", () => {
  const SCRIPTS = [
    "```dataviewjs\nglobalThis.__ran = (globalThis.__ran ?? 0) + 1;\ndv.paragraph('ran');\n```",
    "Inline: `$= (globalThis.__ran = (globalThis.__ran ?? 0) + 1)`",
    "```tasks\nfilter by function (globalThis.__ran = (globalThis.__ran ?? 0) + 1) > 0\n```",
  ].join("\n\n");
  const g = globalThis as { __ran?: number };

  it("never runs scripts unless asked, and says where one was skipped", async () => {
    g.__ran = 0;
    for (const path of ["sources/Email from Maya.md", "wiki/entities/Orbit App.md", ""]) {
      const { container, unmount } = render(
        <Markdown content={`${SCRIPTS}\n\n\`\`\`dataview\nLIST FROM #book\n\`\`\``} path={path} root="/vault" />,
      );
      // DQL still answers.
      await waitFor(() => expect(container.textContent).toContain("Dune"));
      await waitFor(() => expect(container.textContent).toContain("Scripts don't run in captured or AI content"));
      expect(container.querySelector(".dvjs")).toBeNull();
      expect(container.querySelector("code.noscript")?.textContent).toContain("$=");
      expect(container.querySelectorAll(".tqmsg.faint")).toHaveLength(2);
      unmount();
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(g.__ran).toBe(0);
  });

  it("runs them in the user's own note when asked", async () => {
    g.__ran = 0;
    const { container } = md(SCRIPTS);
    await waitFor(() => expect(container.querySelector(".dvjs p")?.textContent).toBe("ran"));
    await waitFor(() => expect(g.__ran).toBeGreaterThanOrEqual(2));
  });
});
