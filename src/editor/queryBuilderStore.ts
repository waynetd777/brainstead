// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Which query builder is open (src/editor/QueryBuilder.tsx, mounted once in App), so the editor's
// help, its fence links, the toolbar and the palette can all open one.

import type { EditorView } from "@codemirror/view";
import { Store } from "../store";

export interface QueryBuilderRequest {
  lang: "tasks" | "dataview";
  /** The block's query, when it's opened on one; "" for a new block. */
  text: string;
  /** For a new Dataview block: TABLE, LIST, TASK or CALENDAR to start from. */
  kind?: string;
  /** Writes the result: into the block it was opened on, or as a new block at the caret. */
  apply: (query: string, lang: "tasks" | "dataview") => void;
}

export const queryBuilder = new Store<QueryBuilderRequest | null>(null);
export const openQueryBuilder = (r: QueryBuilderRequest) => queryBuilder.set(r);
export const closeQueryBuilder = () => queryBuilder.set(null);

/** The editor showing the open note, for the palette's "Insert a query". */
let active: EditorView | null = null;
export const setActiveEditor = (v: EditorView | null) => {
  active = v;
};
export const activeEditor = () => active;
