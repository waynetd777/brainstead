// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The formatting toolbar's commands (src/editor/Toolbar.tsx). Each is an ordinary edit of the
// markdown around the selection, so it touches only the lines it formats and undoes with ⌘Z.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Line } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HlColour, paintLine, spansIn } from "./paint";

export type Mark = "bold" | "italic" | "strike" | "code" | "highlight";
const MARKS: Record<Mark, string> = { bold: "**", italic: "*", strike: "~~", code: "`", highlight: "==" };

/** Wraps the selection (or the word at the caret) in a mark, or takes the mark off if it's there. */
export function toggleMark(view: EditorView, mark: Mark): boolean {
  const m = MARKS[mark];
  const { state } = view;
  const tr = state.changeByRange((r) => {
    let { from, to } = r;
    if (from === to) {
      const w = state.wordAt(from);
      if (w) ({ from, to } = w);
    }
    const before = state.sliceDoc(from - m.length, from);
    const after = state.sliceDoc(to, to + m.length);
    // For italics, a `*` that's half of a bold `**` doesn't count.
    const lone = m !== "*" || (state.sliceDoc(from - 2, from - 1) !== "*" && state.sliceDoc(to + 1, to + 2) !== "*");
    if (before === m && after === m && lone) {
      return {
        changes: [
          { from: from - m.length, to: from },
          { from: to, to: to + m.length },
        ],
        range: EditorSelection.range(r.anchor - m.length, r.head - m.length),
      };
    }
    const text = state.sliceDoc(from, to);
    if (text.length > 2 * m.length && text.startsWith(m) && text.endsWith(m)) {
      return {
        changes: { from, to, insert: text.slice(m.length, -m.length) },
        range: EditorSelection.range(from, to - 2 * m.length),
      };
    }
    if (from === to) return { changes: { from, insert: m + m }, range: EditorSelection.cursor(from + m.length) };
    return {
      changes: [
        { from, insert: m },
        { from: to, insert: m },
      ],
      range: EditorSelection.range(from + m.length, to + m.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const out: Line[] = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(state.doc.line(n));
      }
    }
  }
  return out;
}

function editLines(view: EditorView, f: (text: string, i: number, all: Line[]) => string) {
  const lines = selectedLines(view.state);
  const changes = lines
    .map((l, i) => ({ from: l.from, to: l.to, insert: f(l.text, i, lines) }))
    .filter((c, i) => c.insert !== lines[i].text);
  if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: "input.format" });
  view.focus();
}

const HEADING = /^(\s*)#{1,6}\s+/;

/** The selected lines as a heading of `level` (0: body text). */
export function setHeading(view: EditorView, level: number): boolean {
  editLines(view, (t) => {
    const body = t.replace(HEADING, "$1");
    return level ? `${"#".repeat(level)} ${body.trimStart()}` : body;
  });
  return true;
}

export type Block = "bullet" | "number" | "task" | "quote";
const PREFIX: Record<Block, RegExp> = {
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\]\s)/,
  number: /^(\s*)\d+[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
  quote: /^(\s*)>\s?/,
};
const ANY_LIST = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

/** Turns the selected lines into a list or quote, or back into plain lines if they all are one. */
export function toggleBlock(view: EditorView, kind: Block): boolean {
  const lines = selectedLines(view.state).filter((l) => l.text.trim() || selectedLines(view.state).length === 1);
  const all = lines.length > 0 && lines.every((l) => PREFIX[kind].test(l.text));
  let n = 0;
  editLines(view, (t, _i, ls) => {
    if (!t.trim() && ls.length > 1) return t;
    if (all) return t.replace(PREFIX[kind], "$1");
    if (kind === "quote") return `> ${t}`;
    const base = t.replace(ANY_LIST, "$1");
    const indent = /^\s*/.exec(base)![0];
    const rest = base.slice(indent.length);
    n++;
    return indent + (kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${n}. `) + rest;
  });
  return true;
}

/** Puts `text` on lines of its own at the caret (a table, a divider), with the caret at `caret`
 *  within it. */
export function insertBlock(view: EditorView, text: string, caret = text.length): boolean {
  const { state } = view;
  const at = state.selection.main.head;
  const line = state.doc.lineAt(at);
  const pre = line.text.trim()
    ? at === line.to
      ? "\n\n"
      : "\n"
    : line.from > 0 && state.doc.lineAt(line.from - 1).text.trim()
      ? "\n"
      : "";
  // After a line with text in it; in place of an empty one.
  const from = line.text.trim() ? line.to : line.from;
  view.dispatch({
    changes: { from, to: line.to, insert: `${pre}${text}\n` },
    selection: EditorSelection.cursor(from + pre.length + caret),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

/** A code block around the selected lines, or an empty one. */
export function codeBlock(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (r.empty) return insertBlock(view, "```\n\n```", 4);
  const a = state.doc.lineAt(r.from);
  const b = state.doc.lineAt(r.to);
  view.dispatch({
    changes: [
      { from: a.from, insert: "```\n" },
      { from: b.to, insert: "\n```" },
    ],
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

export const TABLE = "| Column | Column |\n| --- | --- |\n|  |  |";

/** A markdown link around the selection, with "url" selected to type over. */
export function link(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to) || "link";
  const insert = `[${text}](url)`;
  const urlAt = r.from + text.length + 3;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: EditorSelection.range(urlAt, urlAt + 3),
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

/** `[[` at the caret (around the selection, if any), so the link picker opens. */
export function wikilink(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text ? `[[${text}]]` : "[[]]" },
    selection: EditorSelection.cursor(r.from + 2 + text.length),
    userEvent: "input.type",
  });
  view.focus();
  return true;
}

export interface Active {
  heading: number;
  marks: Set<Mark>;
  block: Block | null;
}

/** What the caret is in, for the toolbar's pressed buttons. */
export function activeAt(state: EditorState): Active {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const h = /^#{1,6}(?=\s)/.exec(line.text);
  const block = (["task", "bullet", "number", "quote"] as Block[]).find((k) => PREFIX[k].test(line.text)) ?? null;
  const marks = new Set<Mark>();
  for (let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(head, -1); n; n = n.parent) {
    if (n.name === "StrongEmphasis") marks.add("bold");
    else if (n.name === "Emphasis") marks.add("italic");
    else if (n.name === "Strikethrough") marks.add("strike");
    else if (n.name === "InlineCode") marks.add("code");
    else if (n.name === "Highlight") marks.add("highlight");
  }
  const at = head - line.from;
  if (spansIn(line.text).some((s) => at > s.inFrom - 1 && at <= s.inTo)) marks.add("highlight");
  return { heading: h ? h[0].length : 0, marks, block };
}

/** Paints the selection, or the highlight at the caret, in a highlighter colour (null: none). */
export function paint(view: EditorView, colour: HlColour | null): boolean {
  const { state } = view;
  const tr = state.changeByRange((r) => {
    const a = state.doc.lineAt(r.from);
    const b = state.doc.lineAt(r.to);
    const changes = [];
    let range = r;
    for (let n = a.number; n <= b.number; n++) {
      const l = state.doc.line(n);
      let from = Math.max(r.from, l.from) - l.from;
      let to = Math.min(r.to, l.to) - l.from;
      if (r.empty) {
        const w = state.wordAt(r.from);
        if (w && !spansIn(l.text).some((s) => r.from - l.from >= s.from && r.from - l.from <= s.to))
          ({ from, to } = { from: w.from - l.from, to: w.to - l.from });
      }
      const p = paintLine(l.text, from, to, colour);
      if (!p) continue;
      changes.push({ from: l.from, to: l.to, insert: p.text });
      if (a.number === b.number) range = EditorSelection.range(l.from + p.from, l.from + p.to);
    }
    // Across lines: the same lines, from the first's start to the last's new end.
    const grown = changes.reduce((d, c) => d + c.insert.length - (c.to - c.from), 0);
    if (a.number !== b.number) range = EditorSelection.range(r.from, r.to + grown);
    return { changes, range };
  });
  if (tr.changes.empty) return false;
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}
