// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Which note dialog is open (New note, Rename), so any screen or menu can open one and
// NoteDialogs, mounted once in App, shows it.

import { Store } from "../store";

export type NoteDialog =
  | { kind: "new"; template?: string }
  | { kind: "rename"; path: string; /** A new title to start from (screenshot scenes). */ title?: string };

export const noteDialog = new Store<NoteDialog | null>(null);

export const openNewNote = (template?: string) => noteDialog.set({ kind: "new", template });
export const closeNoteDialog = () => noteDialog.set(null);

/** Where the caret goes in a note just made from a template (tp.file.cursor), read once by the editor. */
const cursors = new Map<string, number>();
export const setNewNoteCursor = (path: string, at: number) => cursors.set(path, at);
export function takeNewNoteCursor(path: string): number | null {
  const at = cursors.get(path);
  cursors.delete(path);
  return at ?? null;
}
