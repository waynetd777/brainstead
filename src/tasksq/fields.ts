// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A task line's fields, read as the Tasks plugin's default format reads them
// (src/TaskSerializer/DefaultTaskSerializer.ts there): from the end of the line backwards, each
// emoji field in any order, with tags among them; the description is what's left. Brainstead's
// own `^rank-N` (the previous app's manual order) comes off first.

export type DateField = "due" | "scheduled" | "start" | "created" | "done" | "cancelled";
export type PriorityName = "highest" | "high" | "medium" | "none" | "low" | "lowest";

export interface TaskFields {
  /** Indentation before the list marker. */
  indent: string;
  /** `-`, `*`, `+`, or `1.` for a numbered list. */
  listMarker: string;
  /** The character between the brackets. */
  status: string;
  /** The text with the fields at its end taken off (tags among them kept). */
  description: string;
  priority: PriorityName;
  dates: Partial<Record<DateField, string>>;
  recurrence: string | null;
  onCompletion: string | null;
  id: string | null;
  dependsOn: string[];
  /** `^block-id` at the very end, if any. */
  blockLink: string | null;
  rank: number | null;
  /** Every #tag on the line, with its `#`. */
  tags: string[];
}

export const PRIORITY_EMOJI: Record<string, PriorityName> = { "🔺": "highest", "⏫": "high", "🔼": "medium", "🔽": "low", "⏬": "lowest" };
export const PRIORITY_NUMBER: Record<PriorityName, number> = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 };
export const DATE_EMOJI: Record<DateField, string[]> = {
  due: ["📅", "📆", "🗓"],
  scheduled: ["⏳", "⌛"],
  start: ["🛫"],
  created: ["➕"],
  done: ["✅"],
  cancelled: ["❌"],
};

const VS = "\\uFE0F?";
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const END = "\\s*$";
const rx = (s: string) => new RegExp(s + END, "u");
const FIELD_RES: [RegExp, (m: RegExpMatchArray, f: TaskFields) => void][] = [
  [rx(`([🔺⏫🔼🔽⏬])${VS}`), (m, f) => (f.priority = PRIORITY_EMOJI[m[1]])],
  ...(Object.entries(DATE_EMOJI) as [DateField, string[]][]).map(
    ([k, es]) =>
      [rx(`(?:${es.join("|")})${VS} *${DATE}`), (m: RegExpMatchArray, f: TaskFields) => (f.dates[k] = m[1])] as [
        RegExp,
        (m: RegExpMatchArray, f: TaskFields) => void,
      ],
  ),
  [rx(`🔁${VS} ?([a-zA-Z0-9, !]+)`), (m, f) => (f.recurrence = m[1].trim())],
  [rx(`🏁${VS} *([a-zA-Z]+)`), (m, f) => (f.onCompletion = m[1].toLowerCase())],
  [
    rx(`⛔${VS} *([a-zA-Z0-9-_]+( *, *[a-zA-Z0-9-_]+ *)*)`),
    (m, f) =>
      (f.dependsOn = m[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)),
  ],
  [rx(`🆔${VS} *([a-zA-Z0-9-_]+)`), (m, f) => (f.id = m[1])],
];
const TRAILING_TAG = /(^|\s)(#[^\s#!@$%^&*(),.?":{}|<>[\]\\/]+(?:\/[^\s#!@$%^&*(),.?":{}|<>[\]\\]+)*)\s*$/u;
export const TAG = /(?:^|\s)#([^\s#!@$%^&*(),.?":{}|<>[\]\\']+)/gu;
export const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[([^\]])\]\s+(.*)$/;
/** A quote's or callout's markers at the start of a line: `> `, `> > `. */
export const QUOTE = /^(?:[ \t]{0,3}>[ \t]?)+/;
const RANK = /\s*\^rank-(\d+)\s*$/;
const BLOCK = /\s\^([a-zA-Z0-9-]+)\s*$/;

/** Every #tag in text, with its `#`, not in code. */
export function tagsIn(text: string): string[] {
  const out: string[] = [];
  for (const [i, part] of text.split(/(`[^`\n]*`)/).entries()) {
    if (i % 2) continue;
    for (const m of part.matchAll(TAG)) if (!/^\d+$/.test(m[1])) out.push(`#${m[1]}`);
  }
  return out;
}

/** A line's quote or callout markers and the rest, as Rust's `tasks::split_quote`: a task inside a
 *  quote is still a task, and every edit puts the markers back in front. */
export function splitQuote(line: string): [string, string] {
  const n = QUOTE.exec(line)?.[0].length ?? 0;
  return [line.slice(0, n), line.slice(n)];
}

/** The fields of a task line (inside any quote markers), or null when it isn't one. */
export function parseTask(line: string): TaskFields | null {
  const m = TASK.exec(splitQuote(line)[1]);
  if (!m) return null;
  let rest = m[4];
  let rank: number | null = null;
  const r = RANK.exec(rest);
  if (r) {
    rank = +r[1];
    rest = rest.slice(0, r.index);
  }
  const f: TaskFields = {
    indent: m[1],
    listMarker: m[2],
    status: m[3],
    description: "",
    priority: "none",
    dates: {},
    recurrence: null,
    onCompletion: null,
    id: null,
    dependsOn: [],
    blockLink: null,
    rank,
    tags: tagsIn(rest),
  };
  const b = BLOCK.exec(rest);
  if (b) {
    f.blockLink = b[1];
    rest = rest.slice(0, b.index);
  }
  // Fields come off the end one at a time; tags between them are kept for the description.
  let trailingTags = "";
  for (let guard = 0; guard < 40; guard++) {
    rest = rest.trimEnd();
    let hit = false;
    for (const [re, set] of FIELD_RES) {
      const fm = re.exec(rest);
      if (fm) {
        set(fm, f);
        rest = rest.slice(0, fm.index);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    // Tags among the fields come off too, and go back on the end of the description.
    const t = TRAILING_TAG.exec(rest);
    if (t) {
      trailingTags = ` ${t[2]}${trailingTags}`;
      rest = rest.slice(0, t.index);
      continue;
    }
    break;
  }
  f.description = (rest.trim() + trailingTags).trim();
  return f;
}

export interface Status {
  symbol: string;
  name: string;
  type: "TODO" | "IN_PROGRESS" | "ON_HOLD" | "DONE" | "CANCELLED" | "NON_TASK";
  nextSymbol: string;
}

/** The default status set: the core two, In progress and Cancelled; `X` done, as the previous app
 *  treats it; anything else Unknown, a to-do. */
export function statusOf(symbol: string): Status {
  switch (symbol) {
    case " ":
      return { symbol, name: "Todo", type: "TODO", nextSymbol: "x" };
    case "x":
    case "X":
      return { symbol, name: "Done", type: "DONE", nextSymbol: " " };
    case "/":
      return { symbol, name: "In Progress", type: "IN_PROGRESS", nextSymbol: "x" };
    case "-":
      return { symbol, name: "Cancelled", type: "CANCELLED", nextSymbol: " " };
    default:
      return { symbol, name: "Unknown", type: "TODO", nextSymbol: "x" };
  }
}

export const STATUS_ORDER: Record<Status["type"], number> = { IN_PROGRESS: 1, TODO: 2, ON_HOLD: 3, DONE: 4, CANCELLED: 5, NON_TASK: 6 };
export const isDoneType = (t: Status["type"]) => t === "DONE" || t === "CANCELLED" || t === "NON_TASK";
