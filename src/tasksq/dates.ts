// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Dates in queries, as the Tasks plugin reads them (Queries/Filters, "Searching for dates"): an
// absolute day, two of them as a range, `last|this|next week|month|quarter|year`, numbered ranges
// (`2026-W14`, `2026-10`, `2026-Q4`, `2026`), or words via chrono, as there. Weeks run Monday
// to Sunday.

import * as chrono from "chrono-node";
import moment, { Moment } from "moment";

export interface DayRange {
  start: Moment;
  end: Moment;
  /** A range, as opposed to one day (worded differently by `explain`). */
  isRange: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string) => moment(s, "YYYY-MM-DD", true);

/** The day or range `text` names, relative to `today`, or null when it isn't a date. */
export function parseDateRange(text: string, today: Moment): DayRange | null {
  const t = text.trim();
  const words = t.split(/\s+/);
  if (words.length === 2 && ISO.test(words[0]) && ISO.test(words[1])) {
    const [a, b] = [day(words[0]), day(words[1])];
    if (a.isValid() && b.isValid()) return a.isAfter(b) ? { start: b, end: a, isRange: true } : { start: a, end: b, isRange: true };
    const one = a.isValid() ? a : b.isValid() ? b : null;
    return one ? { start: one, end: one.clone(), isRange: false } : null;
  }
  const rel = /^(last|this|next) (week|month|quarter|year)$/i.exec(t);
  if (rel) {
    const unit = rel[2].toLowerCase() as "week" | "month" | "quarter" | "year";
    const u = unit === "week" ? "isoWeek" : unit;
    const n = { last: -1, this: 0, next: 1 }[rel[1].toLowerCase() as "last"];
    const base = today.clone().add(n, unit === "week" ? "weeks" : unit === "quarter" ? "quarters" : unit === "month" ? "months" : "years");
    return { start: base.clone().startOf(u), end: base.clone().endOf(u).startOf("day"), isRange: true };
  }
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-W(\d{2})$/.exec(t))) {
    const s = moment().isoWeekYear(+m[1]).isoWeek(+m[2]).startOf("isoWeek");
    return { start: s, end: s.clone().endOf("isoWeek").startOf("day"), isRange: true };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(t))) {
    const s = moment(`${m[1]}-${m[2]}-01`, "YYYY-MM-DD", true);
    if (s.isValid()) return { start: s, end: s.clone().endOf("month").startOf("day"), isRange: true };
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(t))) {
    const s = moment(`${m[1]}-01-01`, "YYYY-MM-DD").quarter(+m[2]).startOf("quarter");
    return { start: s, end: s.clone().endOf("quarter").startOf("day"), isRange: true };
  }
  if ((m = /^(\d{4})$/.exec(t))) {
    const s = moment(`${m[1]}-01-01`, "YYYY-MM-DD");
    return { start: s, end: s.clone().endOf("year").startOf("day"), isRange: true };
  }
  if (ISO.test(t)) {
    const d = day(t);
    return d.isValid() ? { start: d, end: d.clone(), isRange: false } : null;
  }
  const parsed = chrono.parseDate(t, today.toDate(), { forwardDate: false });
  if (!parsed) return null;
  const d = moment(parsed).startOf("day");
  return { start: d, end: d.clone(), isRange: false };
}

/** "2022-10-22 (Saturday 22nd October 2022)", as `explain` shows a day. */
export const explainDay = (d: Moment) => `${d.format("YYYY-MM-DD")} (${d.format("dddd Do MMMM YYYY")})`;
