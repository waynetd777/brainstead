// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { IngestRun, SourceRow } from "./api";
import { isActive, meetingNoteMade, merge, queueOffer } from "./Ingest";
import { ingestable, sourceStatus } from "./Lists";

const run = (id: string, status = "running"): IngestRun => ({
  id,
  source: "sources/x.pdf",
  started: "2026-10-02T10:00:00",
  finished: null,
  model: "claude:sonnet",
  status,
  steps: [],
  proposals: [],
  dropped: [],
  pages: [],
  error: null,
});

describe("ingest runs", () => {
  it("updates a run in place, adds a new one on top", () => {
    const l = merge([run("a"), run("b")], run("b", "done"));
    expect(l.map((r) => [r.id, r.status])).toEqual([
      ["a", "running"],
      ["b", "done"],
    ]);
    expect(merge(l, run("c"))[0].id).toBe("c");
    expect(isActive(run("q", "queued"))).toBe(true);
    expect(isActive(run("d", "failed"))).toBe(false);
  });

  it("source status: changed beats ingested", () => {
    const row = (path: string, ingested: boolean) => ({ path, ingested }) as SourceRow;
    const changed = new Set(["sources/b.md"]);
    expect(sourceStatus(row("sources/a.md", false), changed)).toBe("new");
    expect(sourceStatus(row("sources/b.md", true), changed)).toBe("changed");
    expect(sourceStatus(row("sources/c.md", true), changed)).toBe("ingested");
  });

  it("ingests notes, text, PDFs, Office files and images, but not SVG", () => {
    for (const p of ["sources/a.md", "sources/a.pdf", "sources/a.xlsx", "sources/Whiteboard photo.png", "sources/b.HEIC", "sources/c.jpeg"])
      expect(ingestable(p), p).toBe(true);
    for (const p of ["sources/diagram.svg", "sources/a.zip", "sources/clip.mp4"]) expect(ingestable(p), p).toBe(false);
  });
});

describe("after a meeting note", () => {
  const step = (detail: string) => ({ name: "Make the note", status: "done", detail, ms: 1 });
  it("is offered only when the note was made, not held in Changes", () => {
    expect(meetingNoteMade({ ...run("m", "done"), steps: [step("Made: ingest it, and trash the transcript")] })).toBe(true);
    expect(meetingNoteMade({ ...run("m", "done"), steps: [step("Held in Changes")] })).toBe(false);
    expect(meetingNoteMade(run("m", "done"))).toBe(false);
  });

  it("queues one offer per note", () => {
    const a = { note: "Meeting. Orbit App - 2026-10-05.md", transcript: "t/a.vtt" };
    const b = { note: "Meeting. Maya - 2026-10-05.md", transcript: "t/b.vtt" };
    const q = queueOffer(queueOffer([], a), b);
    expect(q).toEqual([a, b]);
    expect(queueOffer(q, a)).toBe(q);
  });
});
