// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The notes with unsaved drafts (kept in the app data folder by the editor), for the lists' marker.

import { useEffect, useState } from "react";
import { api } from "./api";
import { openSession } from "./editor/session";
import { place } from "./nav";
import { useVaultVersion } from "./state";
import { useStore } from "./store";

/** Paths with an unsaved draft; looked at again on each move and vault change. */
export function useDraftPaths(): Set<string> {
  const [paths, setPaths] = useState<Set<string>>(new Set());
  const v = useVaultVersion();
  const here = useStore(place).place;
  useEffect(() => {
    let live = true;
    void api
      .draftsList()
      .then((d) => live && setPaths(new Set(d.map((x) => x.path))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [v, here]);
  return paths;
}

/** Renames or trashes `path` with its unsaved edits kept: they go into its draft first, and the open
 *  editor (if it's this note) lets go of the file without asking about them. After a rename the
 *  draft follows the note to `to`; after trashing it goes with the note into the trash, and comes back if it's restored. If `act`
 *  fails, the editor takes the file back. */
export async function withDraftHandedOver<T>(path: string, act: () => Promise<T>, to?: (r: T) => string): Promise<T> {
  const s = openSession(path);
  await s?.detach();
  let r: T;
  try {
    r = await act();
  } catch (e) {
    s?.reattach();
    throw e;
  }
  const dest = to?.(r);
  if (dest && dest !== path) {
    const d = await api.draftRead(path).catch(() => null);
    if (d) {
      await api.draftWrite({ ...d, path: dest }).catch(() => {});
      await api.draftDiscard(path).catch(() => {});
    }
  }
  return r;
}
