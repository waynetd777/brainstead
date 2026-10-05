// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Highlighter colours, written as the vault's other journal editor writes them: yellow as
// `==text==`, the rest as `<mark class="hl-red">text</mark>`. Painting rewrites only the
// highlights the selection touches, so the rest of the line keeps its exact text.

export type HlColour = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "grey";
export const HL_COLOURS: HlColour[] = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "grey"];

/** A highlight in a line: where it starts and ends, its text, and its colour. */
interface Span {
  from: number;
  to: number;
  inFrom: number;
  inTo: number;
  colour: HlColour;
}

const SPAN_RE = /<mark class="hl-(red|orange|yellow|green|teal|blue|purple|grey)">(.*?)<\/mark>|(?<![\\=])==(?=[^\s=])(.*?[^\s\\])==(?!=)/g;

export function spansIn(line: string): Span[] {
  const out: Span[] = [];
  for (const m of line.matchAll(SPAN_RE)) {
    const from = m.index;
    if (m[1]) {
      const inFrom = from + m[0].indexOf(">") + 1;
      out.push({ from, to: from + m[0].length, inFrom, inTo: inFrom + m[2].length, colour: m[1] as HlColour });
    } else out.push({ from, to: from + m[0].length, inFrom: from + 2, inTo: from + m[0].length - 2, colour: "yellow" });
  }
  return out;
}

/** A run of text in a colour, wrapped in its marks, with where its text starts and ends. */
const wrap = (t: string, c: HlColour | null): { out: string; at: number; end: number } => {
  const m = c ? /^(\s*)([^]*?)(\s*)$/.exec(t) : null;
  if (!m || !m[2]) return { out: t, at: 0, end: t.length };
  const open = c === "yellow" ? "==" : `<mark class="hl-${c}">`;
  const close = c === "yellow" ? "==" : "</mark>";
  const at = m[1].length + open.length;
  return { out: m[1] + open + m[2] + close + m[3], at, end: at + m[2].length };
};

/**
 * Paints [from, to) of a line in a colour (null: no highlight). A selection that's all in that
 * colour already loses it, so the button toggles. Returns the new line and the painted text's
 * new place, or null when there's nothing to paint.
 */
export function paintLine(
  line: string,
  from: number,
  to: number,
  colour: HlColour | null,
): { text: string; from: number; to: number } | null {
  const spans = spansIn(line);
  // A caret, or a selection only inside one highlight's marks: that highlight.
  const inside = spans.find(
    (s) => from >= s.from && to <= s.to && (from === to || from <= s.inFrom || to >= s.inTo || (from >= s.inFrom && to <= s.inTo)),
  );
  if (from === to) {
    if (!inside) return null;
    ({ inFrom: from, inTo: to } = inside);
  }
  const touched = spans.filter((s) => s.to > from && s.from < to);
  const lo = Math.min(from, ...touched.map((s) => s.from));
  const hi = Math.max(to, ...touched.map((s) => s.to));
  // The window's characters, each with its colour; the marks themselves dropped.
  const chars: { ch: string; c: HlColour | null; sel: boolean }[] = [];
  for (let i = lo; i < hi;) {
    const s = touched.find((t) => t.from === i);
    if (s) {
      for (let j = s.inFrom; j < s.inTo; j++) chars.push({ ch: line[j], c: s.colour, sel: j >= from && j < to });
      i = s.to;
      continue;
    }
    chars.push({ ch: line[i], c: null, sel: i >= from && i < to });
    i++;
  }
  const picked = chars.filter((x) => x.sel && x.ch.trim());
  if (!picked.length) return null;
  const to_ = picked.every((x) => x.c === colour) ? null : colour;
  for (const x of chars) if (x.sel) x.c = to_;
  let out = "";
  let selFrom = -1;
  let selTo = -1;
  for (let i = 0; i < chars.length;) {
    let j = i;
    while (j < chars.length && chars[j].c === chars[i].c) j++;
    const run = chars.slice(i, j);
    const w = wrap(run.map((x) => x.ch).join(""), chars[i].c);
    if (run.some((x) => x.sel)) {
      if (selFrom < 0) selFrom = out.length + w.at;
      selTo = out.length + w.end;
    }
    out += w.out;
    i = j;
  }
  return { text: line.slice(0, lo) + out + line.slice(hi), from: lo + selFrom, to: lo + selTo };
}
