// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Date shorthand on tasks: `due:`, `defer:`, `start:` and `created:` followed by a word become the
// Tasks-format dates 📅, ⏳, 🛫 and ➕ (the file keeps the emoji; the screens draw icons).
// The previous app only opened a date picker for `due:` / `defer:`; Brainstead also understands
// today, tomorrow, weekdays, next week, +3d, +2w, "5 oct" and dates written out.

import { localToday } from "./taskQuery";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The shorthand keywords and the Tasks-format emoji each one writes. */
export type ShorthandKind = "due" | "defer" | "start" | "created";
export const SHORTHAND_EMOJI: Record<ShorthandKind, string> = { due: "📅", defer: "⏳", start: "🛫", created: "➕" };
export const shorthandEmoji = (kind: string) => SHORTHAND_EMOJI[kind.toLowerCase() as ShorthandKind] ?? "📅";

const iso = (d: Date) => localToday(d);

/** The date a word means, counted from `today` (YYYY-MM-DD), or null. A weekday is the next one
 *  after today (Monday on a Monday is a week ahead). */
export function resolveDateWord(word: string, today: string): string | null {
  const w = word.trim().toLowerCase().replace(/\.$/, "");
  const base = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const plus = (n: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (w === "today" || w === "tod") return plus(0);
  if (w === "tomorrow" || w === "tom" || w === "tmr") return plus(1);
  if (w === "yesterday") return plus(-1);
  if (w === "next week" || w === "nextweek" || w === "nw") return plus((8 - base.getDay()) % 7 || 7);
  const rel = /^\+(\d{1,3})([dw])$/.exec(w);
  if (rel) return plus(+rel[1] * (rel[2] === "w" ? 7 : 1));
  const day = DAYS.findIndex(
    (d) =>
      w.startsWith(d) &&
      (w.length === 3 || "monday tuesday wednesday thursday friday saturday sunday tues weds thur thurs".split(" ").includes(w)),
  );
  if (day >= 0) return plus((day - base.getDay() + 7) % 7 || 7);
  // "5 oct", "oct 5", "5 october 2027": this year's, or next year's once this year's has passed.
  const dm = /^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/.exec(w) ?? null;
  const md = dm ? null : /^([a-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(w);
  if (dm || md) {
    const [dayN, mon, yr] = dm ? [+dm[1], dm[2], dm[3]] : [+md![2], md![1], md![3]];
    const mi = MONTHS.indexOf(mon.slice(0, 3));
    const long = mi >= 0 ? new Date(2000, mi, 1).toLocaleDateString("en-GB", { month: "long" }).toLowerCase() : "";
    if (!long.startsWith(mon) && mon !== "sept") return null;
    if (mi < 0 || dayN < 1 || dayN > 31) return null;
    const y = yr ? +yr : base.getFullYear();
    let d = new Date(y, mi, dayN);
    if (d.getMonth() !== mi) return null;
    if (!yr && d < base) d = new Date(y + 1, mi, dayN);
    return iso(d);
  }
  return null;
}

const SHORTHAND = /(^|[\s(])(due|defer|start|created):\s*(next week|\+\d{1,3}[dw]|\d{4}-\d{2}-\d{2}|[A-Za-z]+)(?=$|[\s),.;])/gi;

/** Every `due: word` (and defer:, start:, created:) that names a date, replaced by its emoji and
 *  the date. Words that aren't dates are left as they are. */
export function applyShorthand(text: string, today: string): string {
  return text.replace(SHORTHAND, (m, pre: string, kind: string, word: string) => {
    const d = resolveDateWord(word, today);
    if (!d) return m;
    return `${pre}${shorthandEmoji(kind)} ${d}`;
  });
}

/** A shorthand keyword right before the caret with nothing after it: open the date picker. */
export function pendingShorthand(beforeCaret: string): ShorthandKind | null {
  const m = /(^|[\s(])(due|defer|start|created):$/i.exec(beforeCaret);
  return m ? (m[2].toLowerCase() as ShorthandKind) : null;
}

/** "Mon 5 Oct" for a date chip. */
export function fmtShortDate(d: string): string {
  const dt = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
