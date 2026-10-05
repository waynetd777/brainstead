// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or
// later. See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// In View, a task's fields (`📅 2026-10-05`, `⏫`, `🔁 every week`…) are drawn as an icon and
// their value, with what they mean in the tooltip (src/taskFields.ts). No field shows as its
// emoji; only the display changes, and the file keeps them.

import type { ListItem, PhrasingContent, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import { visit } from "unist-util-visit";
import { FIELD_EMOJI_RE, FIELD_RE, splitTaskFields } from "../taskFields";

/** What a chip carries to the component that draws it. */
export interface DateChipData {
  id: string;
  /** A day (YYYY-MM-DD), or the field's value: "High", "every week", an id. */
  day: string;
  /** The task is ticked (a due date isn't overdue then). */
  done: boolean;
}

/** Tasks-format emoji anywhere else (prose, inline code): drawn as the field's icon too. */
export function remarkFieldEmoji() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        FIELD_EMOJI_RE,
        (e: string): PhrasingContent => ({
          type: "emphasis",
          children: [{ type: "text", value: e }],
          data: { hName: "span", hProperties: { "data-femoji": e } },
        }),
      ],
    ]);
  };
}

export function remarkTaskDates() {
  return (tree: Root) => {
    visit(tree, "listItem", (li: ListItem) => {
      // Statuses beyond `[ ]` and `[x]` (`[-]` cancelled, `[/]` in progress…) are tasks too.
      const first = li.children[0];
      const lead = first?.type === "paragraph" && first.children[0]?.type === "text" ? first.children[0] : null;
      const m = typeof li.checked !== "boolean" && lead ? /^\[([^\]])\] /.exec(lead.value) : null;
      if (m) {
        lead!.value = lead!.value.slice(m[0].length);
        li.checked = m[1] === "-" || m[1].toLowerCase() === "x";
        li.data = { ...li.data, hProperties: { ...(li.data?.hProperties ?? {}), "data-status": m[1] } };
      }
      if (typeof li.checked !== "boolean") return;
      for (const child of li.children) {
        if (child.type !== "paragraph") continue;
        findAndReplace(child, [
          [
            new RegExp(FIELD_RE.source, "gu"),
            (whole: string): PhrasingContent | false => {
              const p = splitTaskFields(whole).find((x) => typeof x !== "string");
              if (!p || typeof p === "string") return false;
              const data: DateChipData = { id: p.field.id, day: p.value, done: !!li.checked };
              return {
                type: "emphasis",
                children: [{ type: "text", value: p.value }],
                data: { hName: "span", hProperties: { "data-tdate": JSON.stringify(data) } },
              };
            },
          ],
        ]);
      }
    });
  };
}
