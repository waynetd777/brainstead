// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A hint under an open task: while the caret is in a `- [ ] ` task's text, a small tooltip lists
// the date shorthand and the GTD tags. It stays while the task is edited, pinned to where the
// text starts, steps aside while a suggestion list is open, and goes when the caret leaves the
// task. Clicking an item types it at the caret (a date keyword then opens the date picker).

import { completionStatus } from "@codemirror/autocomplete";
import { EditorState, StateField } from "@codemirror/state";
import { showTooltip, Tooltip } from "@codemirror/view";

const OPEN_TASK = /^(?:[ \t]{0,3}>[ \t]?)*\s*[-*+] \[ \] ?/;

/** The items, as [what's typed, what it means]. */
export const TASK_HINTS: [string, string][] = [
  ["due:", "deadline"],
  ["defer:", "hide until"],
  ["start:", "can start"],
  ["created:", "written"],
  ["#followup", "chase up"],
  ["#waiting-for", "someone else"],
  ["#someday-maybe", "not now"],
];

/** Where the hint goes: the start of the task's text, while the caret is in it. */
export function openTaskAt(state: EditorState): number | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const m = OPEN_TASK.exec(line.text);
  if (!m || sel.head < line.from + m[0].length) return null;
  if (completionStatus(state) !== null) return null;
  return line.from + m[0].length;
}

function tooltip(state: EditorState): Tooltip | null {
  const at = openTaskAt(state);
  if (at === null) return null;
  return {
    pos: at,
    above: false,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-taskhint";
      dom.setAttribute("role", "note");
      for (const [text, meaning] of TASK_HINTS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = text.startsWith("#") ? "tag" : "key";
        const k = document.createElement("span");
        k.className = "k";
        k.textContent = text;
        const m = document.createElement("span");
        m.className = "m";
        m.textContent = meaning;
        b.append(k, m);
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          const head = view.state.selection.main.head;
          const before = view.state.sliceDoc(head - 1, head);
          const pad = !before || before === " " ? "" : " ";
          const insert = pad + (text.startsWith("#") ? `${text} ` : text);
          // As typed, so a date keyword opens the date picker.
          view.dispatch({ changes: { from: head, insert }, selection: { anchor: head + insert.length }, userEvent: "input.type" });
          view.focus();
        });
        dom.append(b);
      }
      const tip = document.createElement("div");
      tip.className = "t";
      tip.textContent = "Then a word: tomorrow, fri, +3d, 5 oct";
      dom.append(tip);
      return { dom };
    },
  };
}

/** The hint, as an editor extension. */
export const taskHint = StateField.define<Tooltip | null>({
  create: tooltip,
  // The same tooltip while it stays at the same place, so it isn't redrawn on every keystroke.
  update: (v, tr) => {
    const at = openTaskAt(tr.state);
    if (at === null) return null;
    return v && v.pos === at ? v : tooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});
