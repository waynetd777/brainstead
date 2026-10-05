// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The example templates in the starter vault (src-tauri/starter-vault/Templates/) run in the
// engine and make sensible notes, with every question answered as someone would.

import { describe, expect, it } from "vitest";
import { Ask, checkTemplate, Env, runTemplate, tfile } from "./templater";

const RAW = import.meta.glob<string>("../../src-tauri/starter-vault/Templates/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [k.replace("../../src-tauri/starter-vault/", ""), v]),
);
const TEMPLATES = Object.keys(FILES).filter((p) => p.endsWith(".md"));
const SCRIPTS = Object.entries(FILES)
  .filter(([p]) => /^Templates\/scripts\/.*\.js$/.test(p))
  .map(([p, source]) => ({ name: tfile(p).basename, source }));

const now = new Date(2026, 9, 2, 9, 30); // Friday 2 October 2026, 09:30

/** Answers a prompt by its question, and picks the first choice of a list. */
const ANSWERS: Record<string, string> = {
  "Project name": "Orbit App: training",
  "What does done look like?": "Every team has had a training session",
  Area: "Work",
  "The very next action": "Book the training room",
  Title: "Thinking in Systems",
  Author: "Donella Meadows",
  "Link to it": "https://example.com/stocks-and-flows",
};

async function render(path: string, pick = 0) {
  const asked: Ask[] = [];
  const made: Record<string, string> = {};
  const env: Env = {
    root: "/vault",
    files: [...Object.keys(FILES), "Start here.md"],
    read: async (p) => {
      if (!(p in FILES)) throw new Error(`no ${p}`);
      return FILES[p];
    },
    create: async (p, c) => void (made[p] = c),
    clipboard: async () => "",
    ask: (async (q: Ask) => {
      asked.push(q);
      if (q.kind === "prompt") return ANSWERS[q.text] ?? q.value;
      return [pick];
    }) as Env["ask"],
    scripts: SCRIPTS,
    templateFile: tfile(path),
    now,
  };
  return { ...(await runTemplate(FILES[path], env)), asked, made };
}

describe("the starter vault's templates", () => {
  it("are all there, each saying it's an example", () => {
    expect(TEMPLATES.sort()).toEqual([
      "Templates/1-1.md",
      "Templates/Daily note.md",
      "Templates/Meeting.md",
      "Templates/Project.md",
      "Templates/Reading note.md",
      "Templates/Snippets/End of day.md",
      "Templates/Weekly plan.md",
    ]);
    expect(SCRIPTS.map((s) => s.name)).toEqual(["quarter"]);
    for (const p of Object.keys(FILES)) expect(FILES[p], p).toContain("Example template");
  });

  it.each(TEMPLATES)("%s compiles and makes a clean note", async (path) => {
    expect(checkTemplate(FILES[path])).toBeNull();
    const r = await render(path);
    for (const bad of ["<%", "%>", "undefined", "null", "[object", "NaN", "Example template"]) {
      expect(r.content, `${path}: ${bad}`).not.toContain(bad);
    }
    expect(r.content.trim()).not.toBe("");
    expect(r.made).toEqual({});
  });

  it("makes a daily note linked to the days either side, with the snippet in it", async () => {
    const r = await render("Templates/Daily note.md");
    expect(r.path).toBe("Daily. Friday - 2026-10-02.md");
    expect(r.content).toContain("# Friday 2 October 2026");
    expect(r.content).toContain("[[Daily. Thursday - 2026-10-01]] · [[Daily. Saturday - 2026-10-03]]");
    expect(r.content).toMatch(/## Notes\n\n## End of day\n\n- Got done: /);
    expect(r.content.slice(r.cursor!)).toMatch(/^\n\n## Notes/);
  });

  it("makes a 1-1 with the person picked, and a follow-up for them", async () => {
    const r = await render("Templates/1-1.md", 1);
    expect(r.asked[0]).toMatchObject({ kind: "suggest", labels: ["Maya", "Lena", "Theo"] });
    expect(r.path).toBe("1-1. Lena - 2026-10-02.md");
    expect(r.content).toMatch(/^# 1-1 with Lena\n/);
    expect(r.content).toContain("- [ ]  #followup/Lena");
    await expect(
      runTemplate(FILES["Templates/1-1.md"], {
        ...({} as Env),
        root: "/vault",
        files: [],
        ask: (async () => null) as Env["ask"],
        templateFile: tfile("Templates/1-1.md"),
      }),
    ).rejects.toThrow(/Cancelled/);
  });

  it("makes a project Projects reads", async () => {
    const r = await render("Templates/Project.md");
    expect(r.path).toBe("Project. Orbit App training.md");
    expect(r.content).toBe(
      "---\nstatus: active\narea: Work\noutcome: Every team has had a training session\n---\n\n## Next actions\n\n- [ ] Book the training room\n\n## Waiting for\n\n## Notes\n\n\n",
    );
  });

  it("plans the week, a day at a time, with the user script's line", async () => {
    const r = await render("Templates/Weekly plan.md");
    expect(r.path).toBe("Plan. Week 40 - 2026-09-28.md");
    expect(r.content).toMatch(/^# Week 40: 28 Sept? to 2 Oct\n\nQ3 2026: 3 days left in the quarter\.\n/);
    const days = [...r.content.matchAll(/^## (\w+day) /gm)].map((x) => x[1]);
    expect(days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect((await render("Templates/Weekly plan.md", 1)).path).toBe("Plan. Week 41 - 2026-10-05.md");
  });

  it("files a reading note in Reading, with its properties", async () => {
    const book = await render("Templates/Reading note.md");
    expect(book.path).toBe("Reading/Reading. Thinking in Systems.md");
    expect(book.content).toMatch(
      /^---\nkind: book\ntitle: Thinking in Systems\nauthor: Donella Meadows\nstatus: reading\nstarted: 2026-10-02\ntags: \[reading\]\n---\n\n# Thinking in Systems\n\nBy Donella Meadows\.\n\n## Why/,
    );
    const article = await render("Templates/Reading note.md", 1);
    expect(article.asked.map((q) => q.text)).toEqual(["Book or article?", "Title", "Author", "Link to it"]);
    expect(article.content).toContain("author: Donella Meadows\nlink: https://example.com/stocks-and-flows\nstatus");
  });
});
