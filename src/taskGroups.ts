// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The Tasks screen's grouping (by project, context or due date) and effort filter.

import moment from "moment";
import type { TaskRow } from "./api";
import { projectName } from "./gtd";

export type GroupBy = "none" | "project" | "context" | "due";

export interface TaskGroup {
  key: string;
  label: string;
  rows: TaskRow[];
}

const DUE_ORDER = ["overdue", "today", "week", "later", "none"] as const;
const DUE_LABEL: Record<(typeof DUE_ORDER)[number], string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No due date",
};

function dueBucket(t: TaskRow, today: string): (typeof DUE_ORDER)[number] {
  if (!t.due) return "none";
  if (t.due < today) return "overdue";
  if (t.due === today) return "today";
  const end = moment(today, "YYYY-MM-DD").isoWeekday(7).format("YYYY-MM-DD");
  return t.due <= end ? "week" : "later";
}

/** Rows in groups, each keeping the rows' own order. Named groups first (A–Z), the "none" one last. */
export function groupTasks(rows: TaskRow[], by: GroupBy, today: string): TaskGroup[] {
  if (by === "none") return [{ key: "", label: "", rows }];
  const groups = new Map<string, TaskGroup>();
  const add = (key: string, label: string, t: TaskRow) => {
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(t);
    groups.set(key, g);
  };
  for (const t of rows) {
    if (by === "project") add(t.project ?? "", t.project ? projectName(t.project) : "No project", t);
    else if (by === "context") {
      const c = t.contexts?.[0];
      add(c ?? "", c ? `@${c}` : "No context", t);
    } else {
      const b = dueBucket(t, today);
      add(b, DUE_LABEL[b], t);
    }
  }
  const out = [...groups.values()];
  if (by === "due") return out.sort((a, b) => DUE_ORDER.indexOf(a.key as never) - DUE_ORDER.indexOf(b.key as never));
  return out.sort((a, b) => ((a.key === "") !== (b.key === "") ? (a.key === "" ? 1 : -1) : a.label.localeCompare(b.label)));
}

/** The effort filter's choices, in minutes ("" for any). */
export const EFFORT_LIMITS: [string, string][] = [
  ["", "Any effort"],
  ["15", "15 min or less"],
  ["30", "30 min or less"],
  ["60", "1 hour or less"],
];

export const withinEffort = (t: TaskRow, limit: string) => !limit || (t.effortMin != null && t.effortMin <= Number(limit));

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a task matches the Tasks search: every word of `q` somewhere in its text, note, heading,
 *  project, tags or contexts, ignoring case and accents. */
export function matchesSearch(t: TaskRow, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [t.text, t.title, t.heading, t.project && projectName(t.project), ...t.tags, ...(t.contexts ?? []).map((c) => `@${c}`)]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((w) => hay.includes(w.replace(/^#/, "")));
}
