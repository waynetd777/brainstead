// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Documents opened lately, for Today's "continue where you left off". Kept in settings (so in
// Rust's settings.json), not localStorage, which dev and release builds don't share.

import { settings } from "./store";

export interface Recent {
  path: string;
  title: string;
  at: number;
}

const MAX = 12;

export function recentDocs(): Recent[] {
  return (settings.get().recent as Recent[] | undefined) ?? [];
}

export function noteOpened(path: string, title: string) {
  const next = [{ path, title, at: Date.now() }, ...recentDocs().filter((r) => r.path !== path)].slice(0, MAX);
  settings.update({ recent: next });
}
