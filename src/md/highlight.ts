// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Marking a search's words in a document, as the previous app does (ui/src/lib/search-query.ts,
// highlight-rehype.ts): excluded words, operators and tag: filters are left out; a phrase marks
// itself and its words; words shorter than 2 characters are dropped; matching is by substring.

import type { Element, ElementContent, Root, Text } from "hast";

export function highlightTerms(q: string): string[] {
  const out: string[] = [];
  const toks = q.match(/"[^"]*"?|\S+/g) ?? [];
  let skipNext = false;
  for (const raw of toks) {
    if (raw.startsWith('"')) {
      const p = raw.replace(/^"|"$/g, "").trim();
      if (p) out.push(p, ...p.split(/\s+/));
      skipNext = false;
      continue;
    }
    const up = raw.toUpperCase();
    if (up === "AND" || up === "OR") continue;
    if (up === "NOT") {
      skipNext = true;
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (raw.startsWith("-")) continue;
    const w = raw.replace(/^\+/, "");
    if (/^tag:/i.test(w)) continue;
    out.push(w);
  }
  const seen = new Set<string>();
  return out
    .filter((t) => t.length >= 2)
    .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
    .sort((a, b) => b.length - a.length);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function termsRegex(terms: string[]): RegExp | null {
  return terms.length ? new RegExp(terms.map(esc).join("|"), "gi") : null;
}

/** A rehype plugin wrapping matches in <mark class="search-hit">, outside code. */
export function rehypeSearchHighlight(q: string | undefined) {
  return () => (tree: Root) => {
    const re = q ? termsRegex(highlightTerms(q)) : null;
    if (!re) return;
    const walk = (node: Root | Element) => {
      const next: ElementContent[] = [];
      for (const child of node.children as ElementContent[]) {
        if (child.type === "element") {
          if (!["code", "pre", "mark", "script", "style"].includes(child.tagName)) walk(child);
          next.push(child);
        } else if (child.type === "text") {
          next.push(...split(child, re));
        } else next.push(child);
      }
      node.children = next as typeof node.children;
    };
    walk(tree);
  };
}

function split(t: Text, re: RegExp): ElementContent[] {
  const out: ElementContent[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (const m of t.value.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: "text", value: t.value.slice(last, i) });
    out.push({ type: "element", tagName: "mark", properties: { className: ["search-hit"] }, children: [{ type: "text", value: m[0] }] });
    last = i + m[0].length;
  }
  if (!out.length) return [t];
  if (last < t.value.length) out.push({ type: "text", value: t.value.slice(last) });
  return out;
}
