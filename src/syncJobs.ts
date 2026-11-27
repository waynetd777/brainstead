// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

/** Sync runs started by hand (src-tauri/src/sync/jobs.rs): Sync now, Fetch again and an assistant's
 *  pull start in the background and answer at once with their run; these wait on one, for the
 *  buttons that show it going and for the MCP tools' short wait before they answer (D-20261127-11). */

import { api, SyncJob } from "./api";

/** How often a run is looked at while it goes. */
export const POLL_MS = 1000;

/** The run `id` once it's finished, or as it is after `ms` (null when it's gone from the list). */
export async function waitJob(id: string, ms = Infinity): Promise<SyncJob | null> {
  const until = Date.now() + ms;
  for (;;) {
    const j = (await api.syncJobs()).find((x) => x.id === id) ?? null;
    if (!j || j.status !== "running" || Date.now() >= until) return j;
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(POLL_MS, until - Date.now()))));
  }
}

/** The Sync now or Fetch again going now, if one was started by hand (by a button or an assistant). */
export async function passGoing(): Promise<SyncJob | null> {
  return (await api.syncJobs().catch(() => [] as SyncJob[])).find((j) => j.status === "running" && j.kind !== "pull") ?? null;
}
