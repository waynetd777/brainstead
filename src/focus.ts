// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Focus mode (⌘.), as Two-edged Sword's: the open note, wiki page or source across the window,
// with only Read aloud, Text size and Exit focus above it. Esc, or leaving the document, ends it.

import { place } from "./nav";
import { Store } from "./store";

export const focusMode = new Store(false);

/** Leaves focus mode whenever the window shows something other than a document. */
export function startFocus(): () => void {
  return place.subscribe(() => {
    if (place.get().place.screen !== "doc") focusMode.set(false);
  });
}
