// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// What the spell checker shouldn't see in a note, blanked to spaces of the same length so every
// offset still points at the same character: frontmatter, fenced code and math, inline code,
// wikilinks, a link's address, bare URLs, tags, HTML, comments, task fields and dates, block ids.

const BLANK = (m: string) => " ".repeat(m.length);

const INLINE: RegExp[] = [
  /`[^`\n]*`/g, // inline code
  /%%.*?%%/g, // comments
  /\$[^$\n]+\$/g, // inline math
  /!?\[\[[^\]\n]*\]\]/g, // wikilinks and embeds
  /\]\([^)\n]*\)/g, // a link's address (its label stays)
  /<[^>\n]+>/g, // HTML tags
  /\b(?:https?:\/\/|www\.)\S+/g, // bare addresses
  /(^|(?<=\s))#[\p{L}\p{N}_/-]+/gu, // tags
  /\[[\w-]+::[^\]\n]*\]/g, // inline fields
  /[🔺⏫🔼🔽⏬📅📆🗓⏳⌛🛫➕✅❌🔁🏁⛔🆔]️?(?:\s*(?:\d{4}-\d{2}-\d{2}|every [^📅⏳🛫➕✅❌🏁⛔🆔\n]*|[\w,]+(?=\s|$)))?/gu, // task fields
  /\s\^[\w-]+\s*$/g, // block id
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email addresses
];

/** Each line with what isn't prose blanked out. */
export function maskLines(lines: string[]): string[] {
  const out: string[] = [];
  let fm = lines[0]?.trim() === "---";
  let fence: string | null = null;
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (fm) {
      out.push(BLANK(l));
      if (i > 0 && l.trim() === "---") fm = false;
      continue;
    }
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence) {
      out.push(BLANK(l));
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      out.push(BLANK(l));
      continue;
    }
    if (l.trim() === "$$") {
      math = !math;
      out.push(BLANK(l));
      continue;
    }
    if (math) {
      out.push(BLANK(l));
      continue;
    }
    let m = l;
    for (const re of INLINE) m = m.replace(re, BLANK);
    out.push(m);
  }
  return out;
}
