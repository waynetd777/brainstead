// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "links_resolve") return (args.targets as string[]).map(() => "wiki/entities/Orbit App.md");
    if (cmd === "tasks_query" || cmd === "tasks_all") return [];
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), openPath: vi.fn() }));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) } }));

import { Markdown } from "../md/Markdown";
import { querySummary, speechBlocks, spokenIntro, wordRange } from "./blocks";

afterEach(cleanup);

const NOTE = `# Orbit App launch

Soft launch with [[Orbit App|the app]] is set, see #project/orbit for more.

- [ ] Call Lena 📅 2026-10-06
- [x] Send the pack
- Parent item
  - Child item

> [!warning] Mind the date
> It may move.

> [!tip]- Folded
> Hidden text.

| Who | What |
|---|---|
| Maya | Comms |

\`\`\`js
const notRead = 1;
\`\`\`

Inline \`code\` is read. Nice 🎉 work.
`;

async function blocksOf(md: string) {
  const { container } = render(<Markdown content={md} path="Note.md" root="/v" />);
  await waitFor(() => expect(container.querySelector("a.wl")).toBeTruthy());
  return speechBlocks(container as HTMLElement);
}

describe("what a note says aloud", () => {
  it("reads blocks in order, for the ear", async () => {
    const texts = (await blocksOf(NOTE)).map((b) => b.text);
    expect(texts).toEqual([
      "Orbit App launch",
      "Soft launch with the app is set, see project orbit for more.",
      expect.stringMatching(/^Call Lena due /),
      "Done. Send the pack",
      "Parent item",
      "Child item",
      "Mind the date.",
      "It may move.",
      "Folded.",
      "Who, What",
      "Maya, Comms",
      "Inline code is read. Nice work.",
    ]);
  });

  it("maps every spoken character back to the page, so the word highlight lands on it", async () => {
    const blocks = await blocksOf(NOTE);
    const b = blocks[1];
    for (let k = 0; k < b.text.length; k++) {
      const at = b.at[k];
      if (!at || b.text[k] === " ") continue;
      expect(at[0].data[at[1]], `char ${k}`).toBe(b.text[k]);
    }
    const r = wordRange(b, b.text.indexOf("app"));
    expect(r?.toString()).toBe("app");
    // A word added for the ear has no place on the page.
    const done = blocks[3];
    expect(wordRange(done, 0)).toBeNull();
    expect(wordRange(done, done.text.indexOf("pack"))?.toString()).toBe("pack");
  });

  it("starts with the title and the date, said as words", () => {
    expect(spokenIntro("Orbit App Steerco", "2026-09-30")).toBe("Orbit App Steerco. 30 September 2026.");
    expect(spokenIntro("Daily Reviews", "2026-10")).toBe("Daily Reviews. October 2026.");
    expect(spokenIntro("Orbit App", null)).toBe("Orbit App.");
  });

  it("sums up a query block instead of reading it", () => {
    const el = (html: string) => Object.assign(document.createElement("div"), { innerHTML: html });
    expect(querySummary(el(`<div class="tqmsg">No matching tasks.</div>`))).toBe("No tasks listed");
    expect(querySummary(el(`<div class="trow"></div>`))).toBe("1 task listed");
    expect(querySummary(el(`<div class="trow"></div><div class="trow"></div><div class="trow"></div><div class="trow"></div>`))).toBe(
      "4 tasks listed",
    );
    expect(querySummary(el(`<table class="dvtable"><tbody><tr></tr><tr></tr></tbody></table>`))).toBe("2 rows listed");
    expect(querySummary(el(`<ul class="dvlist"></ul>`))).toBe("No items listed");
    expect(querySummary(el(`<div class="dvcal"></div>`))).toBe("A calendar");
  });
});
