// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The editor as the rest of the app sees it (§5.1): load markdown, get it back unchanged where the
// user didn't type, hear about changes. The implementation (CodeMirror 6, `cm.ts`) can be swapped.

import type { Extension } from "@codemirror/state";
import type { ShorthandKind } from "../md/dates";

export type EditorMode = "live" | "source";

/** One autocomplete choice: what the list shows and what replaces the typed `[[partial` / `#partial`. */
export interface Suggestion {
  label: string;
  insert: string;
  detail?: string;
}

export interface EditorHooks {
  /** `[[` and `#` completions. */
  suggest?: (kind: "link" | "tag", q: string) => Promise<Suggestion[]>;
  /** `due:`, `defer:`, `start:` or `created:` typed on a task line with nothing after it: ask for
   *  a date, then insert it. */
  pickDate?: (kind: ShorthandKind, at: { left: number; top: number; bottom: number }, insert: (date: string) => void) => void;
  /** A URL for an image the note embeds (`![[pic.png]]`, `![](images/pic.png)`), or null. */
  imageUrl?: (src: string) => Promise<string | null>;
  /** An image's expand button: show it full size. */
  openImage?: (url: string, alt: string) => void;
  /** ⌘-click on a link: a wikilink target (`Note#Heading`) or a URL. */
  openLink?: (target: string, wiki: boolean) => void;
  /** Images pasted into the editor; resolves to the markdown to insert. */
  pasteImages?: (files: File[]) => Promise<string>;
  /** Today, YYYY-MM-DD, for ✅ dates and date words. */
  today?: () => string;
  /** More CodeMirror extensions, as Templater's colouring in a template. */
  extensions?: Extension[];
}

export interface Editor {
  /** Replaces the document; this is the clean state, so it doesn't count as a change. */
  load(markdown: string): void;
  /** The document, byte for byte as loaded wherever it wasn't edited (line endings included). */
  getMarkdown(): string;
  /** Called after every edit the user (or a tick) makes; returns a function to stop listening. */
  onChange(f: (markdown: string) => void): () => void;
  insertAtCursor(text: string): void;
  /** Inserts at a point on screen (a drop), else at the cursor. */
  insertAt(text: string, coords: { x: number; y: number } | null): void;
  focus(): void;
  setMode(mode: EditorMode): void;
  /** The element the editor draws into. */
  readonly dom: HTMLElement;
  destroy(): void;
}
