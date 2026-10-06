// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The dates a task line can carry (the Tasks format's emoji, kept in the file) and how Brainstead
// shows them: an icon from src/icons.tsx, a label and a sentence for the tooltip.

export type TaskDateId = "due" | "scheduled" | "start" | "created" | "done";

export interface TaskDate {
  id: TaskDateId;
  /** In the file, before the date. */
  emoji: string;
  icon: string;
  label: string;
  /** What it means, for tooltips. */
  explain: string;
  /** The shorthand that sets it as you type, if any. */
  shorthand: string | null;
}

export const TASK_DATES: TaskDate[] = [
  {
    id: "due",
    emoji: "📅",
    icon: "calendar",
    label: "Due",
    explain: "The day it must be done by; shown amber when close and red when overdue. Type due: tomorrow to set it.",
    shorthand: "due:",
  },
  {
    id: "scheduled",
    emoji: "⏳",
    icon: "defer",
    label: "Deferred until",
    explain: "Hidden from Next actions and Today until this day, then it shows on Today. Type defer: mon to set it.",
    shorthand: "defer:",
  },
  {
    id: "start",
    emoji: "🛫",
    icon: "start",
    label: "Starts",
    explain:
      "The first day you can work on it. Unlike Deferred, it doesn't hide the task: it stays in its lists, just less urgent until then. Type start: next week to set it.",
    shorthand: "start:",
  },
  {
    id: "created",
    emoji: "➕",
    icon: "created",
    label: "Created",
    explain: "When it was written down. Type created: today to set it.",
    shorthand: "created:",
  },
  {
    id: "done",
    emoji: "✅",
    icon: "done",
    label: "Done",
    explain: "The day it was ticked; set for you when you tick it, and removed when you untick it.",
    shorthand: null,
  },
];

export const taskDate = (id: TaskDateId) => TASK_DATES.find((d) => d.id === id)!;
export const taskDateByEmoji = (e: string) => TASK_DATES.find((d) => d.emoji === e.replace(/️/g, ""));

/** One tooltip explaining every task date. */

/** An emoji and its date in task text: `📅 2026-10-05` (the emoji may carry a variation selector). */
export const TASK_DATE_RE = /([📅⏳🛫➕✅])️?\s*(\d{4}-\d{2}-\d{2})/gu;

export type TaskTextPart = string | { date: TaskDate; day: string };

/** Splits task text into plain text and dates, leaving `code` spans alone. */
export function splitTaskDates(text: string): TaskTextPart[] {
  const out: TaskTextPart[] = [];
  const push = (s: string) => {
    if (!s) return;
    if (typeof out[out.length - 1] === "string") out[out.length - 1] += s;
    else out.push(s);
  };
  for (const [i, part] of text.split(/(`[^`\n]*`)/).entries()) {
    if (i % 2) {
      push(part);
      continue;
    }
    let last = 0;
    for (const m of part.matchAll(TASK_DATE_RE)) {
      const date = taskDateByEmoji(m[1]);
      if (!date) continue;
      push(part.slice(last, m.index));
      out.push({ date, day: m[2] });
      last = m.index! + m[0].length;
    }
    push(part.slice(last));
  }
  return out;
}
