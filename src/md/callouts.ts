// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Callouts: a quote whose first line is `[!type]`, with an optional title after it and `+` or `-`
// to make it fold (open or closed), as other markdown editors draw them. The plugin marks the
// quote (`data-callout`, `data-fold`) and turns the first line into its own title paragraph
// (`data-callout-title`); `Callout` in Markdown.tsx draws the box. Types and their aliases follow
// the common set; an unknown type is drawn as a note.

import type { Blockquote, Paragraph, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

const MARK = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

/** Each type's look: its colour family and icon. Aliases share their type's look. */
export const CALLOUT_LOOK: Record<string, { tone: string; icon: string }> = {
  note: { tone: "blue", icon: "pencil" },
  abstract: { tone: "teal", icon: "clipboard" },
  info: { tone: "blue", icon: "info" },
  todo: { tone: "blue", icon: "done" },
  tip: { tone: "teal", icon: "flame" },
  success: { tone: "green", icon: "check" },
  question: { tone: "amber", icon: "help" },
  warning: { tone: "amber", icon: "alert" },
  failure: { tone: "red", icon: "x" },
  danger: { tone: "red", icon: "zap" },
  bug: { tone: "red", icon: "bug" },
  example: { tone: "pink", icon: "list" },
  quote: { tone: "grey", icon: "quote" },
};

const ALIAS: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

/** The look a type is drawn with: its own, its alias's, or a note's. */
export function calloutLook(type: string) {
  const t = type.toLowerCase();
  return CALLOUT_LOOK[ALIAS[t] ?? t] ?? CALLOUT_LOOK.note;
}

/** The title shown when none is written: the type, capitalised. */
export const defaultTitle = (type: string) => type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (bq: Blockquote) => {
      const p = bq.children[0];
      if (p?.type !== "paragraph") return;
      const first = p.children[0];
      if (first?.type !== "text") return;
      const m = MARK.exec(first.value);
      if (!m) return;
      // The title is the rest of the first line; what follows it stays as the body's first paragraph.
      const inline: PhrasingContent[] = [{ ...first, value: first.value.slice(m[0].length) }, ...p.children.slice(1)];
      const title: PhrasingContent[] = [];
      let rest: PhrasingContent[] = [];
      for (let i = 0; i < inline.length; i++) {
        const c = inline[i];
        if (c.type === "break") {
          rest = inline.slice(i + 1);
          break;
        }
        if (c.type === "text" && c.value.includes("\n")) {
          const k = c.value.indexOf("\n");
          if (k) title.push({ type: "text", value: c.value.slice(0, k) });
          const after = c.value.slice(k + 1);
          rest = [...(after ? [{ type: "text" as const, value: after }] : []), ...inline.slice(i + 1)];
          break;
        }
        title.push(c);
      }
      const last = title[title.length - 1];
      if (last?.type === "text") last.value = last.value.trimEnd();
      const titleP: Paragraph = {
        type: "paragraph",
        children: title.filter((c) => c.type !== "text" || c.value),
        data: { hProperties: { dataCalloutTitle: "" } },
      };
      const body: Paragraph[] = rest.length ? [{ ...p, children: rest }] : [];
      bq.children.splice(0, 1, titleP, ...body);
      bq.data = { ...bq.data, hProperties: { dataCallout: m[1].toLowerCase(), dataFold: m[2] } };
    });
  };
}
