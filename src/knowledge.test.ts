// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { ChangeRow, LintReport } from "./api";
import { filedPage } from "./Ask";
import {
  byRun,
  decisions,
  fixWithAskPrompt,
  held,
  originLabel,
  pageName,
  runLabel,
  safeFixes,
  trendLabels,
  trendPoints,
  trendShown,
} from "./knowledge";

const row = (p: Partial<ChangeRow>): ChangeRow => ({
  id: "1",
  created: "2026-10-02T09:00:00",
  origin: { kind: "chat", chat: "Chat. Launch.md" },
  model: "claude:sonnet",
  page: "wiki/entities/Orbit App.md",
  kind: "edit",
  title: "Launch date",
  reason: "",
  status: "applied",
  decided: null,
  flags: [],
  warnings: [],
  group: "Chat. Launch.md",
  revertable: true,
  ...p,
});

const report: LintReport = {
  wikiPages: 4,
  sources: 3,
  ms: 10,
  checks: [
    {
      id: "missing-pages",
      title: "Missing pages",
      classic: true,
      items: [{ text: "[[Steerco Charter]]", name: "Steerco Charter", safe: false }],
    },
    {
      id: "missing-crossrefs",
      title: "Missing cross-links",
      classic: true,
      items: [{ text: "wiki/entities/Northwind.md: 'Orbit App'", page: "wiki/entities/Northwind.md", name: "Orbit App", safe: true }],
    },
    {
      id: "stale-pages",
      title: "Stale pages",
      classic: false,
      items: [{ text: "Orbit App", page: "wiki/entities/Orbit App.md", safe: false }],
    },
  ],
};

describe("changes", () => {
  it("lists the held ones and groups by run", () => {
    const rows = [
      row({ id: "a", status: "held", group: "nightly-1", origin: { kind: "ingest", label: "Ingest of Steerco", run: "nightly-1" } }),
      row({ id: "b", group: "nightly-1", origin: { kind: "lint", label: "Wiki catalogue", run: "nightly-1" } }),
      row({ id: "c" }),
    ];
    expect(held(rows).map((r) => r.id)).toEqual(["a"]);
    const g = byRun(rows);
    expect(g.map((x) => [x.group, x.label, x.rows.length])).toEqual([
      ["nightly-1", "Daily check", 2],
      ["Chat. Launch.md", "Ask", 1],
    ]);
  });

  it("says where a change came from", () => {
    expect(originLabel(row({}))).toBe("Ask");
    expect(originLabel(row({ origin: { kind: "lint" } }))).toBe("Knowledge health");
    expect(originLabel(row({ origin: { kind: "chat", label: "Terminal session" } }))).toBe("Terminal session");
    expect(originLabel(row({ origin: { kind: "review", label: "daily-summary 2026-10-02" } }))).toBe("Daily summary 2026-10-02");
    expect(originLabel(row({ origin: { kind: "review", label: "weekly-summary 2026-W40" } }))).toBe("Weekly summary 2026-W40");
    // From before the rename.
    expect(originLabel(row({ origin: { kind: "review", label: "daily-review 2026-10-02" } }))).toBe("Daily summary 2026-10-02");
    expect(runLabel(row({ origin: { kind: "contradiction", run: "contradictions-1" } }))).toBe("Contradiction check");
    expect(pageName("wiki/entities/Orbit App.md")).toBe("Orbit App");
  });
});

describe("knowledge health", () => {
  it("counts what needs a decision, leaving out stale pages and safe fixes", () => {
    expect(decisions(report)).toBe(1);
    expect(decisions(null)).toBe(0);
    expect(safeFixes(report)).toEqual([
      { check: "missing-crossrefs", page: "wiki/entities/Northwind.md", name: "Orbit App", detail: undefined },
    ]);
  });

  it("asks Ask about the issues that need judgement only", () => {
    const p = fixWithAskPrompt(report);
    expect(p).toContain("edit_page");
    expect(p).toContain("[[Steerco Charter]]");
    expect(p).not.toContain("Northwind");
    expect(p).not.toContain("Stale pages");
  });

  it("draws the trend from the oldest day to the newest", () => {
    expect(trendPoints([["2026-10-01", { decisions: 4 }]], 100, 40)).toBe("");
    const pts = trendPoints(
      [
        ["2026-10-01", { decisions: 4 }],
        ["2026-10-02", { decisions: 0 }],
      ],
      100,
      40,
    ).split(" ");
    expect(pts).toEqual(["0.0,4.0", "100.0,36.0"]);
  });

  it("shows the trend only when a day needed a decision, with labelled ends", () => {
    const flat: [string, { decisions: number }][] = [
      ["2026-10-01", { decisions: 0 }],
      ["2026-10-02", { decisions: 0 }],
    ];
    expect(trendShown(flat)).toBe(false);
    const h: [string, { decisions: number }][] = [
      ["2026-10-01", { decisions: 4 }],
      ["2026-10-02", { decisions: 6 }],
      ["2026-10-03", { decisions: 1 }],
    ];
    expect(trendShown(h)).toBe(true);
    expect(trendLabels(h)).toEqual({
      from: "1 Oct: 4",
      to: "3 Oct: 1",
      tip: "Issues needing a decision each day, 1 Oct to 3 Oct. Highest: 6.",
    });
  });

  it("files an answer as a page with properties and its current state", () => {
    expect(filedPage("Launch readiness", "concept", "  Ready by November.\n")).toBe(
      "---\ntype: concept\nname: Launch readiness\ndescription: \nsources: []\n---\n\n## Current state\n\nReady by November.\n",
    );
  });
});
