// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Templater's tags coloured in the template editor (Edit and Source): the `<%` `%>` delimiters
// (with their `*` `+` `#` `-` `_`), and the JavaScript between them highlighted as code (keywords,
// strings, numbers, names), by the JavaScript parser and the same colours as code blocks. A template
// is small, so the whole document is scanned on each change; tags can span lines.

import { javascriptLanguage } from "@codemirror/lang-javascript";
import { Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";

const TAG = /(<%[_-]?[*+#]?[_-]?)([\s\S]*?)([_-]?%>)/g;
const delim = Decoration.mark({ class: "cm-tp-tag" });
const code = Decoration.mark({ class: "cm-tp-code" });
const comment = Decoration.mark({ class: "cm-tp-comment" });

/** The ranges to colour: [from, to, kind]. */
export function templaterRanges(text: string): [number, number, "tag" | "code" | "comment"][] {
  const out: [number, number, "tag" | "code" | "comment"][] = [];
  for (const m of text.matchAll(TAG)) {
    const a = m.index;
    const b = a + m[1].length;
    const c = b + m[2].length;
    out.push([a, b, "tag"]);
    if (m[2]) out.push([b, c, m[1].includes("#") ? "comment" : "code"]);
    out.push([c, c + m[3].length, "tag"]);
  }
  return out;
}

/** The code's tokens as classes (`tok-keyword`, `tok-string`…), at offsets in the code. */
export function codeTokens(code: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  highlightTree(javascriptLanguage.parser.parse(code), classHighlighter, (from, to, cls) => void out.push([from, to, cls]));
  return out;
}

const marks = new Map<string, Decoration>();
const mark = (cls: string) => marks.get(cls) ?? marks.set(cls, Decoration.mark({ class: cls })).get(cls)!;

function build(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const ds: Range<Decoration>[] = [];
  for (const [from, to, kind] of templaterRanges(text)) {
    if (to <= from) continue;
    ds.push((kind === "tag" ? delim : kind === "code" ? code : comment).range(from, to));
    if (kind === "code") for (const [a, b, cls] of codeTokens(text.slice(from, to))) ds.push(mark(cls).range(from + a, from + b));
  }
  return Decoration.set(ds, true);
}

export const templaterSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Text for inline HTML in markdown: HTML escaped, and markdown's own characters (emphasis, code,
 *  links, maths, tags, wikilinks) as entities so the parser leaves them as written. */
const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[*_`[\]~\\$#=|!]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One tag as HTML in the editor's classes: delimiters, then the code's tokens. Line breaks become
 *  <br>, so a block over several lines stays one piece of inline HTML. Each token says where it
 *  starts in the template (`data-tp`, `at` being where the code starts), so View can explain it on
 *  hover as the editor does. */
function tagHtml(open: string, code: string, close: string, at: number): string {
  const br = (t: string) => esc(t).replace(/\r?\n/g, "<br>");
  let inner = "";
  if (open.includes("#")) inner = `<span class="cm-tp-comment">${br(code)}</span>`;
  else {
    let done = 0;
    for (const [a, b, cls] of codeTokens(code)) {
      if (a < done) continue;
      inner += br(code.slice(done, a)) + `<span class="${cls}" data-tp="${at + a}">${br(code.slice(a, b))}</span>`;
      done = b;
    }
    inner = `<span class="cm-tp-code">${inner}${br(code.slice(done))}</span>`;
  }
  return `<span class="cm-tp"><span class="cm-tp-tag">${esc(open)}</span>${inner}<span class="cm-tp-tag">${esc(close)}</span></span>`;
}

/** A template's markdown with each tag drawn as coloured code, for View: outside fenced code. */
export function templaterHtml(md: string): string {
  let start = 0;
  return md
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$)/m)
    .map((part, i) => {
      const from = start;
      start += part.length;
      return i % 2
        ? part
        : part.replace(TAG, (_m, open: string, code: string, close: string, off: number) =>
            tagHtml(open, code, close, from + off + open.length),
          );
    })
    .join("");
}
