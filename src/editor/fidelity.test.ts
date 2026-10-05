// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The acceptance test for the editor (§5.1): every note in the fixture vault opens and comes back
// byte for byte, and editing one line changes only that line.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CMEditor } from "./cm";

const VAULT = join(__dirname, "../../tests/fixtures/vault");

function notes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return notes(p);
    return /\.(md|txt)$/.test(n) ? [p] : [];
  });
}

let ed: CMEditor | null = null;
// A lint that started before an editor was destroyed can still finish and dispatch: let it,
// while the test window is still there. The query lint waits 400ms before it runs
// (src/editor/queryAssist.ts), so this waits longer than that.
afterAll(() => new Promise((r) => setTimeout(r, 800)));

afterEach(() => {
  ed?.destroy();
  ed = null;
});

const open = (text: string, mode: "live" | "source" = "live") => {
  ed = new CMEditor(document.createElement("div"), {}, mode);
  ed.load(text);
  return ed;
};

/** Edits line `n` (0-based) through a transaction, as typing would. */
function editLine(e: CMEditor, n: number, insert: string) {
  const l = e.view.state.doc.line(n + 1);
  e.view.dispatch({ changes: { from: l.to, insert }, userEvent: "input.type" });
}

/** The lines (split on LF, endings kept) that differ between a and b. */
function changedLines(a: string, b: string): number[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const out: number[] = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
  return out;
}

const files = notes(VAULT);

describe("fidelity on the fixture vault", () => {
  it("has notes to test", () => expect(files.length).toBeGreaterThan(10));

  for (const f of files) {
    const name = f.slice(VAULT.length + 1);
    const text = readFileSync(f, "utf8");
    it(`${name}: opens and comes back unchanged`, () => {
      for (const mode of ["live", "source"] as const) expect(open(text, mode).getMarkdown()).toBe(text);
    });
    it(`${name}: one edited line is the only change`, () => {
      const lines = text.split("\n");
      // A line in the middle with text on it, else the first.
      const mid = Math.floor(lines.length / 2);
      const n = lines.findIndex((l, i) => i >= mid && l.trim()) ?? 0;
      const at = n < 0 ? 0 : n;
      const e = open(text);
      editLine(e, at, " edited");
      const out = e.getMarkdown();
      expect(changedLines(text, out)).toEqual([at]);
      expect(out.split("\n")[at].replace(/\r$/, "")).toBe(lines[at].replace(/\r$/, "") + " edited");
    });
  }
});

describe("line endings", () => {
  it("keeps CRLF and writes CRLF for new lines", () => {
    const t = "# Title\r\n\r\n- [ ] one\r\n- [ ] two\r\n";
    const e = open(t);
    expect(e.getMarkdown()).toBe(t);
    editLine(e, 2, " more");
    expect(e.getMarkdown()).toBe("# Title\r\n\r\n- [ ] one more\r\n- [ ] two\r\n");
    e.insertAtCursor("a\nb");
    expect(e.getMarkdown()).not.toMatch(/[^\r]\n/);
  });

  it("keeps a file of mixed endings as it is", () => {
    const t = "a\r\nb\nc\r\n\rd";
    const e = open(t);
    expect(e.getMarkdown()).toBe(t);
    editLine(e, 1, "!");
    expect(e.getMarkdown()).toBe("a\r\nb!\nc\r\n\rd");
  });

  it("keeps a byte order mark and no final newline", () => {
    const t = "﻿---\ntitle: x\n---\nbody";
    expect(open(t).getMarkdown()).toBe(t);
  });

  it("pasted CRLF text joins an LF file with LF", () => {
    const e = open("one\n");
    e.view.dispatch({ changes: { from: 3, insert: "\r\ntwo\r\nthree" }, userEvent: "input.paste" });
    expect(e.getMarkdown()).toBe("one\ntwo\nthree\n");
  });
});
