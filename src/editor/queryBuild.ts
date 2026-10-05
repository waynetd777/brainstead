// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The query builder's forms and the query text they make, and back: a block's query read into the
// form where it can be (lines the form can't show are kept, and the builder says so).

// ── Tasks ────────────────────────────────────────────────────────────────────────────────────

export type TaskDateField = "due" | "scheduled" | "starts" | "created" | "done" | "happens";
export type DateOp = "before" | "after" | "on" | "in" | "on or before" | "on or after";

export interface TasksForm {
  status: "not done" | "done" | "any";
  dates: { field: TaskDateField; op: DateOp; value: string }[];
  tagsInclude: string[];
  tagsExclude: string[];
  folders: string[];
  heading: string;
  description: string;
  priority: { op: "is" | "is above" | "is below"; value: string } | null;
  recurring: "any" | "yes" | "no";
  sort: { key: string; reverse: boolean }[];
  group: { key: string; reverse: boolean }[];
  limit: number | null;
  shortMode: boolean;
  hide: string[];
  explain: boolean;
  /** Lines the form doesn't show, kept as they are. */
  extra: string[];
}

export const emptyTasksForm = (): TasksForm => ({
  status: "not done",
  dates: [],
  tagsInclude: [],
  tagsExclude: [],
  folders: [],
  heading: "",
  description: "",
  priority: null,
  recurring: "any",
  sort: [],
  group: [],
  limit: null,
  shortMode: false,
  hide: [],
  explain: false,
  extra: [],
});

export function tasksText(f: TasksForm): string {
  const out: string[] = [];
  if (f.status !== "any") out.push(f.status);
  for (const d of f.dates) if (d.value.trim()) out.push(`${d.field} ${d.op} ${d.value.trim()}`);
  for (const t of f.tagsInclude) if (t.trim()) out.push(`tags include ${tag(t)}`);
  for (const t of f.tagsExclude) if (t.trim()) out.push(`tags do not include ${tag(t)}`);
  for (const p of f.folders) if (p.trim()) out.push(`path includes ${p.trim()}`);
  if (f.heading.trim()) out.push(`heading includes ${f.heading.trim()}`);
  if (f.description.trim()) out.push(`description includes ${f.description.trim()}`);
  if (f.priority?.value) out.push(`priority ${f.priority.op} ${f.priority.value}`);
  if (f.recurring !== "any") out.push(f.recurring === "yes" ? "is recurring" : "is not recurring");
  out.push(...f.extra);
  for (const s of f.sort) if (s.key) out.push(`sort by ${s.key}${s.reverse ? " reverse" : ""}`);
  for (const g of f.group) if (g.key) out.push(`group by ${g.key}${g.reverse ? " reverse" : ""}`);
  if (f.limit) out.push(`limit ${f.limit}`);
  if (f.shortMode) out.push("short mode");
  for (const h of f.hide) out.push(`hide ${h}`);
  if (f.explain) out.push("explain");
  return out.join("\n");
}

const tag = (t: string) => (t.trim().startsWith("#") ? t.trim() : `#${t.trim()}`);

/** Templater tags (`<% name %>`), which a template's query may hold in a value. */
const TP_TAG = /<%[\s\S]*?%>/g;

/** One filter in brackets, `(tags include #x)`, as Tasks allows, without them; a line that
 *  combines filters (AND, OR, NOT, or more brackets) is left as it is. Brackets inside a
 *  Templater tag don't count. */
export function unwrap(l: string): string {
  const m = /^\((.*)\)$/.exec(l);
  if (!m) return l;
  const bare = m[1].replace(TP_TAG, "");
  if (/[()]/.test(bare) || /\b(AND|OR|NOT|XOR)\b/.test(bare)) return l;
  return m[1].trim();
}

/** A tag in a filter: no spaces, except inside a Templater tag (`#followup/<% name %>`). */
const TAG_VALUE = String.raw`((?:<%[\s\S]*?%>|\S)+)`;

/** A tasks query read into the form. Lines it can't show go to `extra`, in order. */

export function parseTasksForm(text: string): TasksForm {
  const f = emptyTasksForm();
  f.status = "any";
  let m: RegExpExecArray | null;
  for (const raw of text.split("\n")) {
    const l = unwrap(raw.trim());
    if (!l) continue;
    const low = l.toLowerCase();
    if (low === "not done" || low === "done") f.status = low;
    else if ((m = /^(due|scheduled|starts|created|done|happens) (on or before|on or after|before|after|on|in) (.+)$/i.exec(l)))
      f.dates.push({ field: m[1].toLowerCase() as TaskDateField, op: m[2].toLowerCase() as DateOp, value: m[3] });
    else if ((m = new RegExp(`^tags include ${TAG_VALUE}$`, "i").exec(l))) f.tagsInclude.push(m[1]);
    else if ((m = new RegExp(`^tags do not include ${TAG_VALUE}$`, "i").exec(l))) f.tagsExclude.push(m[1]);
    else if ((m = /^path includes (.+)$/i.exec(l))) f.folders.push(m[1]);
    else if ((m = /^heading includes (.+)$/i.exec(l)) && !f.heading) f.heading = m[1];
    else if ((m = /^description includes (.+)$/i.exec(l)) && !f.description) f.description = m[1];
    else if ((m = /^priority (is above|is below|is) (\w+)$/i.exec(l)) && !f.priority)
      f.priority = { op: m[1].toLowerCase() as "is" | "is above" | "is below", value: m[2].toLowerCase() };
    else if (low === "is recurring") f.recurring = "yes";
    else if (low === "is not recurring") f.recurring = "no";
    else if ((m = /^sort by (\S+)( reverse)?$/i.exec(l)) && !/^function$/i.test(m[1]))
      f.sort.push({ key: m[1].toLowerCase(), reverse: !!m[2] });
    else if ((m = /^group by (\S+)( reverse)?$/i.exec(l)) && !/^function$/i.test(m[1]))
      f.group.push({ key: m[1].toLowerCase(), reverse: !!m[2] });
    else if ((m = /^limit (?:to )?(\d+)(?: tasks?)?$/i.exec(l))) f.limit = +m[1];
    else if (low === "short mode" || low === "short") f.shortMode = true;
    else if ((m = /^hide (.+)$/i.exec(l))) f.hide.push(m[1].toLowerCase());
    else if (low === "explain") f.explain = true;
    else f.extra.push(l);
  }
  return f;
}

// ── Dataview ─────────────────────────────────────────────────────────────────────────────────

export type DvType = "TABLE" | "LIST" | "TASK" | "CALENDAR";
export type DvOp = "=" | "!=" | "<" | ">" | "<=" | ">=" | "contains" | "does not contain" | "is true" | "is false";

export interface DvForm {
  type: DvType;
  withoutId: boolean;
  /** TABLE columns; LIST takes the first one's expression; CALENDAR its date field. */
  fields: { expr: string; alias: string }[];
  from: { kind: "tag" | "folder" | "note" | "outgoing"; value: string; not: boolean }[];
  fromJoin: "and" | "or";
  where: { field: string; op: DvOp; value: string }[];
  whereJoin: "AND" | "OR";
  sort: { field: string; dir: "ASC" | "DESC" }[];
  groupBy: string;
  flatten: string;
  limit: number | null;
  /** Lines the form doesn't show. */
  extra: string[];
}

export const emptyDvForm = (type: DvType = "TABLE"): DvForm => ({
  type,
  withoutId: false,
  fields: type === "TABLE" ? [{ expr: "file.mtime", alias: "Changed" }] : type === "CALENDAR" ? [{ expr: "file.day", alias: "" }] : [],
  from: [],
  fromJoin: "and",
  where: [],
  whereJoin: "AND",
  sort: [],
  groupBy: "",
  flatten: "",
  limit: null,
  extra: [],
});

/** A value as written in a condition: numbers, dates, links and quoted text as they are, other
 *  text quoted. */
export function dvLiteral(v: string): string {
  const t = v.trim();
  if (
    /^-?\d+(\.\d+)?$/.test(t) ||
    /^(date|dur|link|this)\b/.test(t) ||
    /^".*"$/.test(t) ||
    /^\[\[.*\]\]$/.test(t) ||
    /^(true|false|null)$/.test(t)
  )
    return t;
  if (/^#[\w/-]+$/.test(t)) return `"${t}"`;
  return JSON.stringify(t);
}

function source(s: DvForm["from"][number]): string {
  const v = s.value
    .trim()
    .replace(/^["#]|"$/g, "")
    .replace(/^\[\[|\]\]$/g, "");
  const body = s.kind === "tag" ? `#${v}` : s.kind === "folder" ? `"${v}"` : s.kind === "note" ? `[[${v}]]` : `outgoing([[${v}]])`;
  return s.not ? `-${body}` : body;
}

export function dvText(f: DvForm): string {
  const out: string[] = [];
  const id = f.withoutId && f.type !== "TASK" && f.type !== "CALENDAR" ? " WITHOUT ID" : "";
  const cols = f.fields.filter((c) => c.expr.trim());
  if (f.type === "TABLE")
    out.push(
      `TABLE${id}${cols.length ? ` ${cols.map((c) => (c.alias.trim() ? `${c.expr.trim()} AS ${JSON.stringify(c.alias.trim())}` : c.expr.trim())).join(", ")}` : ""}`,
    );
  else if (f.type === "LIST") out.push(`LIST${id}${cols[0] ? ` ${cols[0].expr.trim()}` : ""}`);
  else if (f.type === "CALENDAR") out.push(`CALENDAR ${cols[0]?.expr.trim() || "file.day"}`);
  else out.push("TASK");
  const src = f.from.filter((s) => s.value.trim());
  if (src.length) out.push(`FROM ${src.map(source).join(` ${f.fromJoin} `)}`);
  const conds = f.where.filter((w) => w.field.trim());
  if (conds.length)
    out.push(
      `WHERE ${conds
        .map((w) =>
          w.op === "is true"
            ? w.field.trim()
            : w.op === "is false"
              ? `!${w.field.trim()}`
              : w.op === "contains"
                ? `contains(${w.field.trim()}, ${dvLiteral(w.value)})`
                : w.op === "does not contain"
                  ? `!contains(${w.field.trim()}, ${dvLiteral(w.value)})`
                  : w.value.trim()
                    ? `${w.field.trim()} ${w.op} ${dvLiteral(w.value)}`
                    : w.field.trim(),
        )
        .join(` ${f.whereJoin} `)}`,
    );
  out.push(...f.extra);
  const sorts = f.sort.filter((s) => s.field.trim());
  if (sorts.length) out.push(`SORT ${sorts.map((s) => `${s.field.trim()} ${s.dir}`).join(", ")}`);
  if (f.groupBy.trim()) out.push(`GROUP BY ${f.groupBy.trim()}`);
  if (f.flatten.trim()) out.push(`FLATTEN ${f.flatten.trim()}`);
  if (f.limit) out.push(`LIMIT ${f.limit}`);
  return out.join("\n");
}

/** Splits on `sep` outside brackets and quotes. */
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let q = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    if (!q && "([{".includes(c)) depth++;
    if (!q && ")]}".includes(c)) depth--;
    if (!q && depth === 0) {
      const m = sep.exec(s.slice(i));
      if (m && m.index === 0) {
        out.push(cur);
        cur = "";
        i += m[0].length - 1;
        continue;
      }
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const unquote = (s: string) => (/^".*"$/.test(s) ? (JSON.parse(s) as string) : s);

/** A dataview query read into the form; the rest goes to `extra`. */
export function parseDvForm(text: string): DvForm {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const head = /^(TABLE|LIST|TASK|CALENDAR)\b(\s+WITHOUT\s+ID)?\s*(.*)$/i.exec(lines[0] ?? "");
  const f = emptyDvForm((head?.[1].toUpperCase() as DvType) ?? "TABLE");
  f.fields = [];
  if (!head) {
    f.extra = lines;
    return f;
  }
  f.withoutId = !!head[2];
  const rest = head[3];
  if (f.type === "TABLE" && rest)
    f.fields = splitTop(rest, /^,/).map((c) => {
      const a = /^(.*?)\s+AS\s+(".*"|\S+)$/i.exec(c);
      return a ? { expr: a[1].trim(), alias: unquote(a[2]) } : { expr: c, alias: "" };
    });
  else if (rest) f.fields = [{ expr: rest, alias: "" }];
  let m: RegExpExecArray | null;
  for (const l of lines.slice(1)) {
    if ((m = /^FROM\s+(.+)$/i.exec(l)) && !f.from.length) {
      const join = /\s+or\s+/i.test(m[1]) ? "or" : "and";
      const parts = splitTop(m[1], join === "or" ? /^\s+or\s+/i : /^\s+and\s+/i);
      const read = parts.map((p) => {
        const not = p.startsWith("-");
        const v = not ? p.slice(1) : p;
        const o = /^outgoing\(\[\[(.*)\]\]\)$/i.exec(v);
        if (o) return { kind: "outgoing" as const, value: o[1], not };
        if (v.startsWith("#")) return { kind: "tag" as const, value: v.slice(1), not };
        if (/^".*"$/.test(v)) return { kind: "folder" as const, value: v.slice(1, -1), not };
        if (/^\[\[.*\]\]$/.test(v)) return { kind: "note" as const, value: v.slice(2, -2), not };
        return null;
      });
      if (read.every((x) => x)) {
        f.from = read as DvForm["from"];
        f.fromJoin = join;
      } else f.extra.push(l);
    } else if ((m = /^WHERE\s+(.+)$/i.exec(l)) && !f.where.length) {
      const join = /\s+OR\s+/i.test(m[1]) && !/\s+AND\s+/i.test(m[1]) ? "OR" : "AND";
      const parts = splitTop(m[1], join === "OR" ? /^\s+OR\s+/i : /^\s+AND\s+/i);
      const read = parts.map((p) => {
        let c = /^(!?)contains\((.+?),\s*(.+)\)$/i.exec(p);
        if (c) return { field: c[2].trim(), op: (c[1] ? "does not contain" : "contains") as DvOp, value: unquote(c[3].trim()) };
        c = /^(.+?)\s*(!=|<=|>=|=|<|>)\s*(.+)$/.exec(p);
        if (c) return { field: c[1].trim(), op: c[2] as DvOp, value: unquote(c[3].trim()) };
        // A yes-or-no field on its own: `completed`, or `!completed` for not.
        c = /^(!?)\s*([A-Za-z_][\w.-]*)$/.exec(p.trim());
        if (c) return { field: c[2], op: (c[1] ? "is false" : "is true") as DvOp, value: "" };
        return null;
      });
      if (read.every((x) => x)) {
        f.where = read as DvForm["where"];
        f.whereJoin = join;
      } else f.extra.push(l);
    } else if ((m = /^SORT\s+(.+)$/i.exec(l)) && !f.sort.length)
      f.sort = splitTop(m[1], /^,/).map((s) => {
        const d = /^(.*?)\s+(ASC|DESC|ascending|descending)$/i.exec(s);
        return d ? { field: d[1], dir: (/^d/i.test(d[2]) ? "DESC" : "ASC") as "ASC" | "DESC" } : { field: s, dir: "ASC" as const };
      });
    else if ((m = /^GROUP BY\s+(.+)$/i.exec(l)) && !f.groupBy) f.groupBy = m[1];
    else if ((m = /^FLATTEN\s+(.+)$/i.exec(l)) && !f.flatten) f.flatten = m[1];
    else if ((m = /^LIMIT\s+(\d+)$/i.exec(l))) f.limit = +m[1];
    else f.extra.push(l);
  }
  return f;
}
