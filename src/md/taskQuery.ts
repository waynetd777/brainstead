// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Day arithmetic shared by the task views. (The `tasks` and `dataview` query languages are in
// src/tasksq/ and src/md/dataview/.)

/** The local date as YYYY-MM-DD, for "this week". */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days from today to a YYYY-MM-DD date (negative: past). */
export function daysUntil(date: string, today = localToday()): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(date) - t(today)) / 86_400_000);
}
