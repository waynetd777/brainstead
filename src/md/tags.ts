// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// `#tags` in View, as the editor marks them (src/editor/live.ts): a `#` after a space or the
// start of the text, then letters, digits, `_`, `-` and `/`, not all digits. Not in code or links.

import type { PhrasingContent, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";

const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

export function remarkTags() {
  return (tree: Root) => {
    findAndReplace(
      tree,
      [
        [
          TAG,
          (_m: string, pre: string, name: string): PhrasingContent[] => [
            ...(pre ? [{ type: "text" as const, value: pre }] : []),
            {
              type: "emphasis",
              children: [{ type: "text", value: `#${name}` }],
              data: { hName: "span", hProperties: { "data-tag": name } },
            },
          ],
        ],
      ],
      { ignore: ["link", "linkReference", "inlineCode", "code"] },
    );
  };
}
