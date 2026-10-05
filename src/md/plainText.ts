// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A line of markdown as plain text, for a search snippet or a "Linked from" line: links become
// their text, emphasis and task boxes go, inline fields and Templater code are dropped, and a URL
// is cut to its domain.

/** Marks where a search hit starts and ends while a snippet is made plain. */
const ON = "",
  OFF = "";

export function plainText(md: string): string {
  return (
    md
      // Templater code, and a block cut off before its end.
      .replace(/<%[\s\S]*?%>/g, "")
      .replace(/<%[\s\S]*$/, "")
      // Inline fields: [effort:: 3] and (due:: 2026-10-01).
      .replace(/\[[^[\]]*?::[^\]]*\]/g, "")
      .replace(/\([^()]*?::[^)]*\)/g, "")
      // Task boxes, list bullets, headings and quotes at the start of a line.
      .replace(/(^|\s)[-*+]\s+\[.\]\s+/gm, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?(\[![^\]]*\][-+]?\s*)?/gm, "")
      // Embeds and wikilinks: the alias, or the page's name.
      .replace(/!?\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_, t: string, a?: string) => a ?? (t.split("#")[0] || t.replace(/^#/, "")))
      // Images and links: their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // A bare URL: its domain.
      .replace(/<?https?:\/\/(?:www\.)?([^/\s)\]>]+)[^\s)\]>]*>?/g, "$1")
      // Emphasis, highlights, strikethrough and code.
      .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s](?:[^*_]*?[^*_\s])?)[*_](?![\w*])/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      // Leftovers cut in half by the snippet's ends, HTML tags and block ids.
      .replace(/\*\*|~~|==/g, "")
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/\s\^[\w-]+$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** A search hit's passage made plain, keeping which parts matched. */
export function plainSegments(segs: { text: string; hit: boolean }[]): { text: string; hit: boolean }[] {
  const joined = segs.map((s) => (s.hit ? `${ON}${s.text}${OFF}` : s.text)).join("");
  const out: { text: string; hit: boolean }[] = [];
  let hit = false,
    cur = "";
  for (const ch of plainText(joined)) {
    if (ch === ON || ch === OFF) {
      if (cur) out.push({ text: cur, hit });
      cur = "";
      hit = ch === ON;
    } else cur += ch;
  }
  if (cur) out.push({ text: cur, hit });
  return out;
}
