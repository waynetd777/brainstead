// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The meeting's date and start time, read from the Teams recap page, so a transcript is named
// with the day of the meeting, not the day it was captured.
//
// Injected before extractor.js (background.js passes both files to executeScript), in the same
// isolated world, so it hangs its functions on `globalThis.brainsteadMeetingDate`. It's wrapped
// in a function so a second injection into the same frame doesn't redeclare anything. The tests
// (meeting-date.test.js, run by Vitest) load it the same way.
//
// Teams shows the date in the user's locale and in more than one place (the recap header, a
// `<time datetime>`, aria-labels, the page title), and Microsoft changes the markup often, so
// this tries several places and several English formats, and gives nothing rather than a guess:
// a date in the future, or one whose weekday disagrees with it, is dropped.

(() => {
  const MONTHS = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const WEEKDAYS = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  const MONTH = `(${Object.keys(MONTHS).join("|")})\\.?`;
  const WEEKDAY = `(?:(${Object.keys(WEEKDAYS).join("|")})\\.?,?\\s+)?`;
  const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/;
  // "Friday, 2 October 2026", "2 Oct 2026, 10:00", "Fri 2 Oct"
  const DAY_MONTH_RE = new RegExp(`\\b${WEEKDAY}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i");
  // "October 2, 2026", "Friday, Oct 2"
  const MONTH_DAY_RE = new RegExp(`\\b${WEEKDAY}${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, "i");
  // "Fri 10/2/2026", "02/10/2026"
  const NUMERIC_RE = new RegExp(`\\b${WEEKDAY}(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4}|\\d{2})\\b`, "i");
  // "10:00 AM", "14:30", "10 am"
  const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?|\b(\d{1,2}):(\d{2})\b/i;

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  /** The date if it exists (no 31 February). */
  function valid(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  /** A year for a date written without one: this year, or last year when that would be in the
   *  future; the one whose weekday matches, when a weekday was given. */
  function guessYear(m, d, weekday, now) {
    const years = [now.getFullYear(), now.getFullYear() - 1];
    const ok = years.filter((y) => {
      const dt = valid(y, m, d);
      return dt && dt <= dayAfter(now) && (weekday == null || dt.getDay() === weekday);
    });
    return ok[0] ?? null;
  }

  const dayAfter = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

  function parseTime(s) {
    const t = TIME_RE.exec(s);
    if (!t) return null;
    let h, min;
    if (t[3]) {
      h = Number(t[1]) % 12;
      min = Number(t[2] ?? 0);
      if (t[3].toLowerCase() === "p") h += 12;
      if (Number(t[1]) > 12 || Number(t[1]) === 0) return null;
    } else {
      h = Number(t[4]);
      min = Number(t[5]);
    }
    if (h > 23 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }

  /**
   * The first meeting date in `text`: `{ date: "YYYY-MM-DD", start?: "HH:MM" }` (local), or null.
   * `now` bounds it (no future dates) and fills in a missing year; `monthFirst` says how to read
   * an ambiguous 10/2/2026 (en-US writes the month first) when no weekday settles it.
   */
  function parseMeetingDate(text, { now = new Date(), monthFirst = false } = {}) {
    if (typeof text !== "string" || !text.trim()) return null;
    const s = text.replace(/\s+/g, " ");
    const found = [];
    const wd = (w) => (w ? WEEKDAYS[w.toLowerCase().replace(/\.$/, "")] : null);

    let m = ISO_RE.exec(s);
    if (m) {
      const [, y, mo, d, hh, mm, zone] = m;
      if (hh && zone) {
        const dt = new Date(m[0].replace(" ", "T"));
        if (!Number.isNaN(dt.getTime())) {
          found.push({
            at: m.index,
            end: m.index + m[0].length,
            y: dt.getFullYear(),
            mo: dt.getMonth() + 1,
            d: dt.getDate(),
            start: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
          });
        }
      } else {
        found.push({ at: m.index, end: m.index + m[0].length, y: +y, mo: +mo, d: +d, start: hh ? `${hh}:${mm}` : null });
      }
    }
    m = DAY_MONTH_RE.exec(s);
    if (m)
      found.push({
        at: m.index,
        end: m.index + m[0].length,
        weekday: wd(m[1]),
        d: +m[2],
        mo: MONTHS[m[3].toLowerCase()],
        y: m[4] ? +m[4] : null,
      });
    m = MONTH_DAY_RE.exec(s);
    if (m)
      found.push({
        at: m.index,
        end: m.index + m[0].length,
        weekday: wd(m[1]),
        mo: MONTHS[m[2].toLowerCase()],
        d: +m[3],
        y: m[4] ? +m[4] : null,
      });
    m = NUMERIC_RE.exec(s);
    if (m) {
      const a = +m[2],
        b = +m[3];
      let y = +m[4];
      if (y < 100) y += 2000;
      const weekday = wd(m[1]);
      // Day first or month first: the one that is a real date with the right weekday, then the
      // locale's way.
      const orders = monthFirst
        ? [
            [b, a],
            [a, b],
          ]
        : [
            [a, b],
            [b, a],
          ];
      const pick = orders.find(([d, mo]) => {
        const dt = valid(y, mo, d);
        return dt && (weekday == null || dt.getDay() === weekday);
      });
      if (pick) found.push({ at: m.index, end: m.index + m[0].length, d: pick[0], mo: pick[1], y, weekday });
    }

    found.sort((x, y) => x.at - y.at);
    for (const f of found) {
      const y = f.y ?? guessYear(f.mo, f.d, f.weekday ?? null, now);
      if (y == null) continue;
      const dt = valid(y, f.mo, f.d);
      if (!dt || dt > dayAfter(now)) continue;
      if (f.weekday != null && dt.getDay() !== f.weekday) continue;
      const start = f.start ?? parseTime(s.slice(f.end, f.end + 40)) ?? undefined;
      const out = { date: fmt(y, f.mo, f.d) };
      if (start) out.start = start;
      return out;
    }
    return null;
  }

  /** An element's text with a space between its pieces. */
  const spaced = (node) => (node.nodeType === 3 ? node.nodeValue : Array.from(node.childNodes, spaced).join(" "));

  /**
   * The meeting's date in a page: tried in `<time datetime>`, then aria-labels and titles, then
   * short runs of text, then the page title. Elements inside `exclude` (the transcript, a message
   * list, whose times are the messages', not the meeting's) are skipped. A date with a start time
   * beats one without. `{ meetingDate, meetingStart? }` or null.
   */
  function findMeetingDate(doc, { exclude = [], now = new Date(), monthFirst = false } = {}) {
    if (!doc) return null;
    const outside = (el) => !exclude.some((x) => x && (x.contains(el) || el.contains(x)));
    const texts = [];
    for (const el of doc.querySelectorAll("time[datetime]")) {
      if (outside(el)) texts.push(el.getAttribute("datetime"), el.textContent);
    }
    for (const el of doc.querySelectorAll("[aria-label], [title]")) {
      if (!outside(el)) continue;
      for (const a of ["aria-label", "title"]) {
        const v = el.getAttribute(a);
        if (v && v.length < 200) texts.push(v);
      }
    }
    let n = 0;
    for (const el of doc.querySelectorAll("h1, h2, h3, h4, span, div, p, time")) {
      if (++n > 5000) break;
      if (el.children.length > 4 || !outside(el)) continue;
      const t = el.textContent?.trim();
      // Spans side by side ("Friday, 2 October 2026" "10:00 AM") read with a space between.
      if (t && t.length >= 6 && t.length <= 120) texts.push(spaced(el));
    }
    texts.push(doc.title);
    let dateOnly = null;
    for (const t of texts) {
      const r = parseMeetingDate(t, { now, monthFirst });
      if (!r) continue;
      if (r.start) return { meetingDate: r.date, meetingStart: r.start };
      dateOnly ??= { meetingDate: r.date };
    }
    return dateOnly;
  }

  globalThis.brainsteadMeetingDate = { parseMeetingDate, findMeetingDate };
})();
