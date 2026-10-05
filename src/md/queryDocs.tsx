// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Where each query language is documented, and the link shown at the top right of a query block
// in View (TaskBlock, Dataview) and on its opening fence in Edit (src/editor/live.ts).

import { openUrl } from "@tauri-apps/plugin-opener";

export const QUERY_DOCS: Record<string, [label: string, url: string]> = {
  tasks: ["Tasks query docs", "https://publish.obsidian.md/tasks/Queries/About+Queries"],
  dataview: ["Dataview docs", "https://blacksmithgu.github.io/obsidian-dataview/"],
  dataviewjs: ["Dataview docs", "https://blacksmithgu.github.io/obsidian-dataview/api/intro/"],
};

export function QueryDocsLink({ lang }: { lang: string }) {
  const d = QUERY_DOCS[lang];
  if (!d) return null;
  return (
    <a
      href={d[1]}
      className="qdocs"
      onClick={(e) => {
        e.preventDefault();
        void openUrl(d[1]);
      }}
    >
      {d[0]} ↗
    </a>
  );
}
