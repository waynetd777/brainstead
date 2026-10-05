// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Find and replace in a note (the find bar, src/notes/FindBar.tsx). In Edit and Source, through
// CodeMirror's own search, its panel kept hidden so the bar is the one place to type (its matches
// are only drawn while the panel is open); a replace is an editor change, so ⌘Z undoes it. In View,
// the matches are drawn with the CSS Custom Highlight API, so the note's DOM isn't touched.

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

export interface Found {
  /** Matches in all. */
  count: number;
  /** Which one is current, from 1; 0 when none is. */
  at: number;
}

/** Where the selection sits among the matches. */
function where(view: EditorView): Found {
  const q = getSearchQuery(view.state);
  if (!q.valid) return { count: 0, at: 0 };
  const sel = view.state.selection.main;
  const c = q.getCursor(view.state);
  let count = 0;
  let at = 0;
  for (let r = c.next(); !r.done; r = c.next()) {
    count++;
    if (r.value.from === sel.from && r.value.to === sel.to) at = count;
    if (count > 9999) break;
  }
  return { count, at };
}

/** Sets what's looked for (and the replacement), keeping CodeMirror's panel open but out of sight. */
export function editorFind(view: EditorView, search: string, replace: string, caseSensitive = false): Found {
  openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, replace, caseSensitive, literal: true })) });
  return where(view);
}

export function editorStep(view: EditorView, op: "next" | "prev" | "replace" | "all"): Found {
  if (op === "next") findNext(view);
  else if (op === "prev") findPrevious(view);
  else if (op === "replace") replaceNext(view);
  else replaceAll(view);
  return where(view);
}

export function editorFindClose(view: EditorView) {
  closeSearchPanel(view);
}

// ── View: boxes over the drawn note ──────────────────────────────────────────────────────────
// Drawn as boxes in a layer over the text (WebKit didn't paint ::highlight() here), placed from
// each match's client rects, so the note's DOM isn't touched.

/** Every match of `q` (case ignored) in the element's text, as ranges, within one text node each. */
export function rangesIn(root: HTMLElement, q: string): Range[] {
  const want = q.toLowerCase();
  if (!want) return [];
  const out: Range[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const t = n.data.toLowerCase();
    for (let i = t.indexOf(want); i >= 0; i = t.indexOf(want, i + want.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + want.length);
      out.push(r);
      if (out.length > 9999) return out;
    }
  }
  return out;
}

const LAYER = "findlayer";

/** Draws the matches over `root` (the current one apart) and scrolls to the current one. */
export function paintView(ranges: Range[], at: number, root?: HTMLElement | null) {
  const host = root ?? (ranges[0]?.startContainer.parentElement?.closest(".docbody") as HTMLElement | null);
  clearView();
  if (!host || !ranges.length) return;
  const layer = document.createElement("div");
  layer.className = LAYER;
  layer.dataset.noPrint = "";
  const base = host.getBoundingClientRect();
  ranges.forEach((r, i) => {
    for (const b of Array.from(r.getClientRects())) {
      const d = document.createElement("div");
      d.className = i === at - 1 ? "findbox cur" : "findbox";
      d.style.left = `${b.left - base.left + host.scrollLeft}px`;
      d.style.top = `${b.top - base.top + host.scrollTop}px`;
      d.style.width = `${b.width}px`;
      d.style.height = `${b.height}px`;
      layer.appendChild(d);
    }
  });
  host.appendChild(layer);
  const cur = ranges[at - 1];
  cur?.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

export function clearView() {
  document.querySelectorAll(`.${LAYER}`).forEach((l) => l.remove());
}
