// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A task as the query language sees it: the fields of its line (fields.ts), where it is, its
// urgency, and the scripting properties `filter/sort/group by function` use (the Tasks plugin's
// docs, Scripting/Task Properties).

import moment, { Moment } from "moment";
import type { TaskRow } from "../api";
import { DateField, isDoneType, parseTask, PRIORITY_NUMBER, PriorityName, Status, statusOf, TaskFields } from "./fields";

export const PRIORITY_LABEL: Record<PriorityName, string> = {
  highest: "Highest",
  high: "High",
  medium: "Medium",
  none: "Normal",
  low: "Low",
  lowest: "Lowest",
};

/** A day as the scripting API hands it out (TasksDate there). */
export class TasksDate {
  readonly moment: Moment | null;
  constructor(
    raw: string | undefined,
    private today: Moment,
  ) {
    this.moment = raw ? moment(raw, "YYYY-MM-DD", true) : null;
  }
  formatAsDate(fallBack = "") {
    return this.format("YYYY-MM-DD", fallBack);
  }
  formatAsDateAndTime(fallBack = "") {
    return this.format("YYYY-MM-DD HH:mm", fallBack);
  }
  format(fmt: string, fallBack = "") {
    return this.moment ? this.moment.format(fmt) : fallBack;
  }
  toISOString(keepOffset?: boolean) {
    return this.moment ? this.moment.toISOString(keepOffset) : "";
  }
  get category() {
    const m = this.moment;
    let name: string, sortOrder: number;
    if (!m) [name, sortOrder] = ["Undated", 4];
    else if (!m.isValid()) [name, sortOrder] = ["Invalid date", 0];
    else if (m.isBefore(this.today, "day")) [name, sortOrder] = ["Overdue", 1];
    else if (m.isSame(this.today, "day")) [name, sortOrder] = ["Today", 2];
    else [name, sortOrder] = ["Future", 3];
    return { name, sortOrder, groupText: `%%${sortOrder}%% ${name}` };
  }
  get fromNow() {
    const m = this.moment;
    if (!m || !m.isValid()) return { name: "", sortOrder: 0, groupText: "" };
    const name = m.from(this.today);
    const sortOrder = +`${m.isBefore(this.today, "day") ? 1 : 3}${m.format("YYYYMMDDHHmm")}`;
    return { name, sortOrder, groupText: `%%${sortOrder}%% ${name}` };
  }
}

export interface QTask extends TaskFields {
  row: TaskRow;
  statusInfo: Status;
  isDone: boolean;
  /** The day as YYYY-MM-DD, or "invalid" when it isn't a real day. */
  day: (f: DateField) => string | null;
  isValid: (f: DateField) => boolean;
  priorityNumber: number;
  urgency: number;
  path: string;
  filename: string;
  folder: string;
  root: string;
  heading: string | null;
  lineNumber: number;
  isSubItem: boolean;
  descriptionWithoutTags: string;
}

const validDay = (d: string | undefined) => !!d && moment(d, "YYYY-MM-DD", true).isValid();

/** Tasks' urgency (Advanced/Urgency there): due, priority, scheduled and start, summed. */
export function urgency(f: TaskFields, today: Moment): number {
  let u = 0;
  const due = f.dates.due;
  if (validDay(due)) {
    const overdue = today.clone().startOf("day").diff(moment(due, "YYYY-MM-DD"), "days");
    const frac = overdue >= 7 ? 1 : overdue <= -14 ? 0.2 : ((overdue + 14) * 0.8) / 21 + 0.2;
    u += frac * 12;
  }
  u += { highest: 9, high: 6, medium: 3.9, none: 1.95, low: 0, lowest: -1.8 }[f.priority];
  const sch = f.dates.scheduled;
  if (validDay(sch) && !moment(sch, "YYYY-MM-DD").isAfter(today, "day")) u += 5;
  const st = f.dates.start;
  if (validDay(st) && moment(st, "YYYY-MM-DD").isAfter(today, "day")) u -= 3;
  return u;
}

export function toQTask(row: TaskRow, today: Moment): QTask | null {
  const f = parseTask(row.lineText);
  if (!f) return null;
  const s = statusOf(f.status);
  const slash = row.path.lastIndexOf("/");
  const folder = slash < 0 ? "/" : `${row.path.slice(0, slash)}/`;
  const first = row.path.indexOf("/");
  return {
    ...f,
    row,
    statusInfo: s,
    isDone: isDoneType(s.type),
    day: (k) => {
      const d = f.dates[k];
      if (!d) return null;
      return validDay(d) ? d : "invalid";
    },
    isValid: (k) => validDay(f.dates[k]),
    priorityNumber: PRIORITY_NUMBER[f.priority],
    urgency: urgency(f, today),
    path: row.path,
    filename: slash < 0 ? row.path : row.path.slice(slash + 1),
    folder,
    root: first < 0 ? "/" : `${row.path.slice(0, first)}/`,
    heading: row.heading,
    lineNumber: row.line,
    isSubItem: f.indent.length > 0,
    descriptionWithoutTags: f.description
      .replace(/(^|\s)#[^\s#]+/gu, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

/** The object `filter/sort/group by function` see as `task`. */
export function scriptTask(t: QTask, today: Moment, all: () => QTask[]) {
  const d = (k: DateField) => new TasksDate(t.dates[k], today);
  const noExt = (p: string) => p.replace(/\.md$/i, "");
  const file = {
    path: t.path,
    pathWithoutExtension: noExt(t.path),
    filename: t.filename,
    filenameWithoutExtension: noExt(t.filename),
    folder: t.folder,
    root: t.root,
    hasProperty: () => false,
    property: () => null,
    outlinks: [],
    outlinksInBody: [],
    outlinksInProperties: [],
  };
  const happens = [t.dates.start, t.dates.scheduled, t.dates.due].filter(validDay).sort()[0];
  return {
    status: {
      name: t.statusInfo.name,
      symbol: t.statusInfo.symbol,
      nextSymbol: t.statusInfo.nextSymbol,
      type: t.statusInfo.type,
      typeGroupText: `%%${statusOrderKey(t)}%%${t.statusInfo.type}`,
    },
    description: t.description,
    descriptionWithoutTags: t.descriptionWithoutTags,
    priorityNumber: t.priorityNumber,
    priorityName: PRIORITY_LABEL[t.priority],
    priorityNameGroupText: `%%${t.priorityNumber}%%${PRIORITY_LABEL[t.priority]} priority`,
    urgency: t.urgency,
    created: d("created"),
    start: d("start"),
    scheduled: d("scheduled"),
    due: d("due"),
    cancelled: d("cancelled"),
    done: d("done"),
    happens: new TasksDate(happens, today),
    isDone: t.isDone,
    isRecurring: !!t.recurrence,
    recurrenceRule: t.recurrence ?? "",
    onCompletion: t.onCompletion ?? "",
    tags: t.tags,
    originalMarkdown: t.row.lineText,
    lineNumber: t.lineNumber,
    listMarker: t.listMarker,
    heading: t.heading,
    hasHeading: !!t.heading,
    file,
    id: t.id ?? "",
    dependsOn: t.dependsOn,
    isBlocked: (tasks: QTask[] = all()) => isBlocked(t, tasks),
    isBlocking: (tasks: QTask[] = all()) => isBlocking(t, tasks),
    outlinks: [],
  };
}

const statusOrderKey = (t: QTask) => ({ IN_PROGRESS: 1, TODO: 2, ON_HOLD: 3, DONE: 4, CANCELLED: 5, NON_TASK: 6 })[t.statusInfo.type];

/** Waiting on a task that isn't done yet (Getting Started/Task Dependencies there). */
export function isBlocked(t: QTask, all: QTask[]): boolean {
  if (t.isDone || !t.dependsOn.length) return false;
  return t.dependsOn.some((id) => all.some((o) => o.id === id && !o.isDone));
}

/** Not done, and some other not-done task waits on it. */
export function isBlocking(t: QTask, all: QTask[]): boolean {
  if (t.isDone || !t.id) return false;
  return all.some((o) => !o.isDone && o.dependsOn.includes(t.id!));
}
