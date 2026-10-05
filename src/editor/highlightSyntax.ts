// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// `==highlight==` for the editor's markdown grammar, parsed the way GFM parses `~~strike~~`:
// a `==` run opens when text follows it and closes when text comes before it. View draws the
// same marks through src/md/marks.ts.

import type { MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

const Delim = { resolve: "Highlight", mark: "HighlightMark" };
const EQ = 61;

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: tags.special(tags.content) },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQ || cx.char(pos + 1) !== EQ || cx.char(pos + 2) === EQ || cx.char(pos - 1) === EQ) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /^$|\s/.test(before);
        const spaceAfter = /^$|\s/.test(after);
        return cx.addDelimiter(Delim, pos, pos + 2, !spaceAfter, !spaceBefore);
      },
      after: "Emphasis",
    },
  ],
};
