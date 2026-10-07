// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The menu bar's Note menu (src-tauri/src/menu.rs). Its items arrive as `menu` events; the open
// document registers what to do with them, and the note's items are enabled only while it does.

import { api } from "./api";
import { openNewNote } from "./notes/dialogs";

export type NoteMenuAction =
  | "save"
  | "view"
  | "edit"
  | "source"
  | "focus"
  | "copy-markdown"
  | "copy-rich"
  | "copy-path"
  | "copy-title"
  | "export-pdf"
  | "read-aloud"
  | "rename"
  | "reveal"
  | "discard-draft"
  | "trash";

let handler: ((a: NoteMenuAction) => void) | null = null;

/** The open document's handler, or null when it closes. */
export function setNoteMenu(h: ((a: NoteMenuAction) => void) | null) {
  handler = h;
  void api.menuNoteOpen(!!h).catch(() => {});
}

/** Listens for the menu once, at startup. */
export function startNoteMenu() {
  return api.onMenu((id) => {
    if (!id.startsWith("note:")) return;
    const a = id.slice(5);
    if (a === "new") openNewNote();
    else handler?.(a as NoteMenuAction);
  });
}
