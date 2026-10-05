// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// `==highlight==` in View, as the editor parses it (src/editor/highlightSyntax.ts): a `==` with
// text after it opens, one with text before it closes, and what's between (bold, links and all)
// becomes a <mark>. Never inside code, which has no children to look at.

import type { Parent, PhrasingContent, Root, Text } from "mdast";

type Item = PhrasingContent | { type: "eq"; open: boolean; close: boolean };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

function split(children: PhrasingContent[]): Item[] {
  const out: Item[] = [];
  children.forEach((child, i) => {
    if (child.type !== "text" || !child.value.includes("==")) return void out.push(child);
    const v = child.value;
    let last = 0;
    for (const m of v.matchAll(/=+/g)) {
      if (m[0].length !== 2) continue;
      const at = m.index;
      // Text just outside the node counts: `**bold**==` closes after the bold.
      const before = at > 0 ? v[at - 1] : i > 0 ? "x" : undefined;
      const after = at + 2 < v.length ? v[at + 2] : i < children.length - 1 ? "x" : undefined;
      if (at > last) out.push({ type: "text", value: v.slice(last, at) });
      out.push({ type: "eq", open: !isSpace(after), close: !isSpace(before) });
      last = at + 2;
    }
    if (last < v.length) out.push({ type: "text", value: v.slice(last) });
  });
  return out;
}

function pair(items: Item[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let open = -1;
  for (const it of items) {
    if (it.type !== "eq") {
      out.push(it);
    } else if (open >= 0 && it.close && out.length > open) {
      const inner = out.splice(open);
      out.push({ type: "emphasis", children: inner, data: { hName: "mark", hProperties: { className: ["hl"] } } });
      open = -1;
    } else if (it.open) {
      if (open >= 0) out.splice(open, 0, { type: "text", value: "==" });
      open = out.length;
    } else {
      out.push({ type: "text", value: "==" });
    }
  }
  if (open >= 0) out.splice(open, 0, { type: "text", value: "==" });
  // Join the text the splitting left in pieces.
  return out.reduce<PhrasingContent[]>((acc, n) => {
    const prev = acc[acc.length - 1];
    if (prev?.type === "text" && n.type === "text") acc[acc.length - 1] = { type: "text", value: (prev as Text).value + n.value };
    else acc.push(n);
    return acc;
  }, []);
}

function walk(node: Root | Parent) {
  for (const c of node.children) if ("children" in c) walk(c as Parent);
  if (
    node.type === "root" ||
    node.type === "list" ||
    node.type === "listItem" ||
    node.type === "blockquote" ||
    node.type === "table" ||
    node.type === "tableRow"
  )
    return;
  if (!node.children.some((c) => c.type === "text" && c.value.includes("=="))) return;
  node.children = pair(split(node.children as PhrasingContent[])) as Parent["children"];
}

export function remarkHighlights() {
  return (tree: Root) => walk(tree);
}
