// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The Tasks plugin's query language, as its documentation describes it (Queries/*): filters and
// boolean combinations, `sort by`, `group by`, `limit`, layout (`hide`/`show`, short and full
// mode), `explain`, comments, line continuations, placeholders and query file defaults. The whole
// language runs here in the window, because `filter/sort/group by function` are JavaScript and
// run here anyway (the same trust as templates, decided 2026-10-02; only in the user's own notes,
// QueryFile.scripts, decided 2026-10-03); Rust hands over every task
// (`tasks_all`). Brainstead adds `sort by rank`, the manual order dragged in the task lists.

import moment, { Moment } from "moment";
import { RRule } from "rrule";
import { DateField, STATUS_ORDER } from "./fields";
import { DayRange, explainDay, parseDateRange } from "./dates";
import { isBlocked, isBlocking, PRIORITY_LABEL, QTask, scriptTask } from "./task";
import { SCRIPTS_OFF } from "../md/scripts";

/** The note a query block is in. */
export interface QueryFile {
  path: string;
  /** Its properties, for query file defaults (`TQ_*`) and `query.file.property()`. */
  frontmatter?: Record<string, unknown> | null;
  /** Whether `filter/sort/group by function` may run: only in a note the user wrote
   *  (src/md/scripts.ts). Without it, a query that uses one says so instead of running. */
  scripts?: boolean;
}

export interface Ctx {
  today: Moment;
  all: QTask[];
  file: QueryFile;
}

interface Filter {
  source: string;
  test: (t: QTask, c: Ctx) => boolean;
  explain: (c: Ctx) => string[];
}

interface Sorter {
  source: string;
  cmp: (a: QTask, b: QTask, c: Ctx) => number;
}

interface Grouper {
  source: string;
  reverse: boolean;
  /** Headings the task goes under: `%%key%%` prefixes order them and aren't shown. */
  keys: (t: QTask, c: Ctx) => string[];
}

export type Element =
  | "id"
  | "depends on"
  | "priority"
  | "cancelled date"
  | "created date"
  | "start date"
  | "scheduled date"
  | "due date"
  | "done date"
  | "recurrence rule"
  | "on completion"
  | "tags"
  | "toolbar"
  | "tree"
  | "edit button"
  | "postpone button"
  | "backlink"
  | "nested backlink"
  | "urgency"
  | "task count"
  | "group count";

const ELEMENTS: Element[] = [
  "id",
  "depends on",
  "priority",
  "cancelled date",
  "created date",
  "start date",
  "scheduled date",
  "due date",
  "done date",
  "recurrence rule",
  "on completion",
  "tags",
  "toolbar",
  "tree",
  "edit button",
  "postpone button",
  "backlink",
  "nested backlink",
  "urgency",
  "task count",
  "group count",
];
const HIDDEN_BY_DEFAULT: Element[] = ["tree", "urgency", "group count"];

export interface Query {
  filters: Filter[];
  sorters: Sorter[];
  groupers: Grouper[];
  limit: number | null;
  limitGroups: number | null;
  shown: Set<Element>;
  shortMode: boolean;
  explain: boolean;
  /** The lines as run, after continuations, placeholders and file defaults. */
  lines: string[];
  error: string | null;
}

export interface Group {
  /** One heading per `group by`, as shown (sort keys taken off). */
  headings: string[];
  tasks: QTask[];
}

export interface Result {
  groups: Group[];
  /** Matches before `limit`. */
  total: number;
  shown: number;
  explanation: string | null;
  error: string | null;
}

const TQ_ELEMENTS: [string, Element][] = [
  ["TQ_show_backlink", "backlink"],
  ["TQ_show_cancelled_date", "cancelled date"],
  ["TQ_show_created_date", "created date"],
  ["TQ_show_depends_on", "depends on"],
  ["TQ_show_done_date", "done date"],
  ["TQ_show_due_date", "due date"],
  ["TQ_show_edit_button", "edit button"],
  ["TQ_show_id", "id"],
  ["TQ_show_on_completion", "on completion"],
  ["TQ_show_postpone_button", "postpone button"],
  ["TQ_show_priority", "priority"],
  ["TQ_show_recurrence_rule", "recurrence rule"],
  ["TQ_show_scheduled_date", "scheduled date"],
  ["TQ_show_start_date", "start date"],
  ["TQ_show_tags", "tags"],
  ["TQ_show_task_count", "task count"],
  ["TQ_show_toolbar", "toolbar"],
  ["TQ_show_tree", "tree"],
  ["TQ_show_urgency", "urgency"],
];

/** Instructions from the note's `TQ_*` properties, put before the block's own (Queries/Query File Defaults). */
export function fileDefaults(fm: Record<string, unknown> | null | undefined): string[] {
  if (!fm) return [];
  const out: string[] = [];
  const bool = (v: unknown) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);
  if (bool(fm.TQ_explain) === true) out.push("explain");
  const sm = bool(fm.TQ_short_mode);
  if (sm !== null) out.push(sm ? "short mode" : "full mode");
  for (const [k, el] of TQ_ELEMENTS) {
    const b = bool(fm[k]);
    if (b !== null) out.push(`${b ? "show" : "hide"} ${el}`);
  }
  if (typeof fm.TQ_extra_instructions === "string") out.push(...fm.TQ_extra_instructions.split("\n"));
  return out;
}

/** `{{query.file.path}}` and friends (Scripting/Placeholders). */
export function expandPlaceholders(line: string, file: QueryFile): string {
  const noExt = (p: string) => p.replace(/\.md$/i, "");
  const slash = file.path.lastIndexOf("/");
  const filename = slash < 0 ? file.path : file.path.slice(slash + 1);
  const values: Record<string, string> = {
    "query.file.path": file.path,
    "query.file.pathWithoutExtension": noExt(file.path),
    "query.file.filename": filename,
    "query.file.filenameWithoutExtension": noExt(filename),
    "query.file.folder": slash < 0 ? "/" : `${file.path.slice(0, slash)}/`,
    "query.file.root": file.path.includes("/") ? `${file.path.slice(0, file.path.indexOf("/"))}/` : "/",
  };
  return line.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) => {
    const prop = /^query\.file\.property\(\s*['"](.+)['"]\s*\)$/.exec(k);
    if (prop) {
      const v = file.frontmatter?.[prop[1]];
      return v == null ? "" : String(v);
    }
    if (k in values) return values[k];
    throw new Error(`There was an error expanding one or more placeholders.\n\nThe error message was:\n    Unknown property: ${k}`);
  });
}

/** Lines ending in `\` continue on the next (`\\` keeps a backslash); `#` lines are comments. */
function logicalLines(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trim();
    if (/(^|[^\\])\\$/.test(l)) {
      cur += `${l.slice(0, -1).trimEnd()} `;
      continue;
    }
    cur += l;
    out.push(cur.replace(/\\\\$/, "\\").trim());
    cur = "";
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((l) => l && !l.startsWith("#"));
}

const notUnderstood = (line: string) => `Tasks query: do not understand query\nProblem line: "${line}"`;

/** Parses a block. `file` is the note it's in. */
export function parseQuery(src: string, file: QueryFile, today: Moment = moment().startOf("day")): Query {
  const q: Query = {
    filters: [],
    sorters: [],
    groupers: [],
    limit: null,
    limitGroups: null,
    shown: new Set(ELEMENTS.filter((e) => !HIDDEN_BY_DEFAULT.includes(e))),
    shortMode: false,
    explain: false,
    lines: [],
    error: null,
  };
  let lines: string[];
  try {
    lines = [...fileDefaults(file.frontmatter).filter((l) => l.trim() && !l.trim().startsWith("#")), ...logicalLines(src)].map((l) =>
      expandPlaceholders(l.trim(), file),
    );
  } catch (e) {
    q.error = e instanceof Error ? e.message : String(e);
    return q;
  }
  q.lines = lines;
  scriptsOn = file.scripts === true;
  try {
    for (const line of lines) {
      const err = instruction(q, line, today);
      if (err) {
        q.error = err;
        return q;
      }
    }
  } finally {
    scriptsOn = false;
  }
  return q;
}

/** Applies one line to the query; returns an error message when it can't. */
function instruction(q: Query, line: string, today: Moment): string | null {
  const l = line.toLowerCase();
  let m: RegExpExecArray | null;
  if (l === "explain") {
    q.explain = true;
    return null;
  }
  if (l === "short mode" || l === "short" || l === "full mode" || l === "full") {
    q.shortMode = l.startsWith("short");
    return null;
  }
  if (l === "ignore global query") return null;
  if ((m = /^(hide|show) (.+)$/i.exec(line))) {
    const el = m[2].toLowerCase().trim() as Element;
    // Older spellings.
    const name = ({ backlinks: "backlink", recurrence: "recurrence rule", "tree view": "tree" } as Record<string, Element>)[el] ?? el;
    if (!ELEMENTS.includes(name)) return notUnderstood(line);
    if (m[1].toLowerCase() === "hide") q.shown.delete(name);
    else q.shown.add(name);
    return null;
  }
  if ((m = /^limit (?:to )?(\d+)(?: tasks?)?$/i.exec(line))) {
    q.limit = +m[1];
    return null;
  }
  if ((m = /^limit groups (?:to )?(\d+)(?: tasks?)?$/i.exec(line))) {
    q.limitGroups = +m[1];
    return null;
  }
  if ((m = /^sort by (.+)$/i.exec(line))) {
    const s = sorter(m[1], line);
    if (typeof s === "string") return s;
    q.sorters.push(s);
    return null;
  }
  if ((m = /^group by (.+)$/i.exec(line))) {
    const g = grouper(m[1], line);
    if (typeof g === "string") return g;
    q.groupers.push(g);
    return null;
  }
  const f = filter(line, today);
  if (typeof f === "string") return f;
  q.filters.push(f);
  return null;
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────

const ok = (source: string, test: Filter["test"], explain?: string | ((c: Ctx) => string[])): Filter => ({
  source,
  test,
  explain: (c) => (explain === undefined ? [source] : typeof explain === "string" ? [`${source} =>`, `  ${explain}`] : explain(c)),
});

/** `/pattern/flags` as JavaScript reads it. */
function regex(text: string): RegExp | string {
  const m = /^\/(.*)\/([a-z]*)$/.exec(text.trim());
  if (!m) return `Tasks query: cannot parse regex (description); check for leading or trailing spaces`;
  try {
    return new RegExp(m[1], m[2]);
  } catch (e) {
    return `Tasks query: cannot parse regex: ${(e as Error).message}`;
  }
}

/** `name includes|does not include|regex matches|regex does not match <value>` over one text or several. */
function textFilter(
  line: string,
  names: string,
  get: (t: QTask) => string | string[],
  inc = "includes",
  notInc = "does not include",
): Filter | string | null {
  const re = new RegExp(`^(?:${names}) (${inc}|${notInc}|regex matches|regex does not match) (.*)$`, "i");
  const m = re.exec(line);
  if (!m) return null;
  const op = m[1].toLowerCase();
  const value = m[2];
  const all = (t: QTask) => {
    const v = get(t);
    return Array.isArray(v) ? v : [v];
  };
  if (op.startsWith("regex")) {
    const r = regex(value);
    if (typeof r === "string") return r;
    // A `g` or `y` flag makes test() go on from the last match: start each test afresh.
    const hit = (t: QTask) =>
      all(t).some((s) => {
        r.lastIndex = 0;
        return r.test(s);
      });
    return ok(
      line,
      op === "regex matches" ? hit : (t) => !hit(t),
      `using regex:     '${r.source.replace(/\//g, "\\/")}'${r.flags ? ` with flag${r.flags.length > 1 ? "s" : ""} '${r.flags}'` : " with no flags"}`,
    );
  }
  const needle = value.toLowerCase();
  const hit = (t: QTask) => all(t).some((s) => s.toLowerCase().includes(needle));
  return ok(line, op === inc.toLowerCase() ? hit : (t) => !hit(t));
}

const DATE_NAMES: Record<string, DateField | "happens"> = {
  due: "due",
  done: "done",
  scheduled: "scheduled",
  starts: "start",
  start: "start",
  created: "created",
  cancelled: "cancelled",
  happens: "happens",
};
const HAPPENS: DateField[] = ["start", "scheduled", "due"];

function dateFilter(line: string, today: Moment): Filter | string | null {
  let m = /^(no|has) (due|done|scheduled|start|created|cancelled|happens) date$/i.exec(line);
  if (m) {
    const k = DATE_NAMES[m[2].toLowerCase()];
    const has = (t: QTask) => (k === "happens" ? HAPPENS.some((h) => !!t.dates[h]) : !!t.dates[k]);
    return ok(line, m[1].toLowerCase() === "has" ? has : (t) => !has(t));
  }
  m = /^(due|done|scheduled|start|created|cancelled) date is invalid$/i.exec(line);
  if (m) {
    const k = DATE_NAMES[m[1].toLowerCase()] as DateField;
    return ok(line, (t) => !!t.dates[k] && !t.isValid(k));
  }
  m =
    /^(due|done|scheduled|starts|created|cancelled|happens)(?: (on or before|on or after|in or before|in or after|before|after|on|in))? (.+)$/i.exec(
      line,
    );
  if (!m) return null;
  const k = DATE_NAMES[m[1].toLowerCase()];
  const op = (m[2] ?? "on").toLowerCase();
  const range = parseDateRange(m[3], today);
  if (!range) return `Tasks query: do not understand ${m[1].toLowerCase()} date\nProblem line: "${line}"`;
  const matches = (d: string) => {
    const x = moment(d, "YYYY-MM-DD", true);
    if (!x.isValid()) return false;
    switch (op) {
      case "before":
        return x.isBefore(range.start, "day");
      case "after":
        return x.isAfter(range.end, "day");
      case "on or before":
      case "in or before":
        return !x.isAfter(range.end, "day");
      case "on or after":
      case "in or after":
        return !x.isBefore(range.start, "day");
      default:
        return !x.isBefore(range.start, "day") && !x.isAfter(range.end, "day");
    }
  };
  const test = (t: QTask) => {
    if (k === "happens") return HAPPENS.some((h) => !!t.dates[h] && matches(t.dates[h]!));
    const d = t.dates[k];
    // A task with no start date can be started whenever, so start searches let it through.
    if (!d) return k === "start";
    return matches(d);
  };
  const field = k === "happens" ? "due, start or scheduled" : k;
  const words = explainRange(op, range);
  return ok(line, test, () => [`${line} =>`, `  ${field} date ${words}${k === "start" ? " OR no start date" : ""}`]);
}

function explainRange(op: string, r: DayRange): string {
  const a = explainDay(r.start);
  const b = explainDay(r.end);
  if (!r.isRange)
    return (
      { before: `is before ${a}`, after: `is after ${a}`, "on or before": `is on or before ${a}`, "on or after": `is on or after ${a}` }[
        op
      ] ?? `is on ${a}`
    );
  switch (op) {
    case "before":
      return `is before ${a}`;
    case "after":
      return `is after ${b}`;
    case "in or before":
    case "on or before":
      return `is on or before ${b}`;
    case "in or after":
    case "on or after":
      return `is on or after ${a}`;
    default:
      return `is between:\n    ${a} and\n    ${b} inclusive`;
  }
}

const PRIORITIES = ["highest", "high", "medium", "none", "low", "lowest"] as const;

/** One filter line, a boolean combination included. */
function filter(line: string, today: Moment): Filter | string {
  const l = line.toLowerCase();
  if (/^(not\s+)?[([{"]/i.test(line) && (/^[([{"]/.test(line) || /^NOT\s/.test(line))) return booleanFilter(line, today);
  if (l === "done") return ok(line, (t) => t.isDone, "status.type is DONE or CANCELLED or NON_TASK");
  if (l === "not done") return ok(line, (t) => !t.isDone, "status.type is TODO or IN_PROGRESS or ON_HOLD");
  let m: RegExpExecArray | null;
  if ((m = /^status\.type (is|is not) (TODO|DONE|IN_PROGRESS|ON_HOLD|CANCELLED|NON_TASK)$/i.exec(line))) {
    const want = m[2].toUpperCase();
    const is = m[1].toLowerCase() === "is";
    return ok(line, (t) => (t.statusInfo.type === want) === is);
  }
  if (/^status\.type /i.test(line))
    return `Tasks query: Invalid status.type instruction: '${line}'.\n    Allowed values:  TODO DONE IN_PROGRESS ON_HOLD CANCELLED NON_TASK`;
  if (l === "is recurring") return ok(line, (t) => !!t.recurrence);
  if (l === "is not recurring") return ok(line, (t) => !t.recurrence);
  if (l === "exclude sub-items") return ok(line, (t) => !t.isSubItem);
  if (l === "has tags") return ok(line, (t) => t.tags.length > 0);
  if (l === "no tags") return ok(line, (t) => t.tags.length === 0);
  if (l === "has id") return ok(line, (t) => !!t.id);
  if (l === "no id") return ok(line, (t) => !t.id);
  if (l === "has depends on") return ok(line, (t) => t.dependsOn.length > 0);
  if (l === "no depends on") return ok(line, (t) => t.dependsOn.length === 0);
  if (l === "is blocking") return ok(line, (t, c) => isBlocking(t, c.all));
  if (l === "is not blocking") return ok(line, (t, c) => !isBlocking(t, c.all));
  if (l === "is blocked") return ok(line, (t, c) => isBlocked(t, c.all));
  if (l === "is not blocked") return ok(line, (t, c) => !isBlocked(t, c.all));
  if ((m = /^priority is (above |below |not )?(lowest|low|none|medium|high|highest)$/i.exec(line))) {
    const n = PRIORITIES.indexOf(m[2].toLowerCase() as (typeof PRIORITIES)[number]);
    const how = (m[1] ?? "").trim().toLowerCase();
    return ok(
      line,
      (t) =>
        how === "above"
          ? t.priorityNumber < n
          : how === "below"
            ? t.priorityNumber > n
            : how === "not"
              ? t.priorityNumber !== n
              : t.priorityNumber === n,
      `priority is ${how ? `${how} ` : ""}${PRIORITY_LABEL[PRIORITIES[n]].toLowerCase()}`,
    );
  }
  if ((m = /^filter by function (.+)$/is.exec(line))) {
    const fn = compileFunction(m[1]);
    if (typeof fn === "string") return fn;
    return ok(line, (t, c) => !!runFunction(fn, t, c));
  }
  const date = dateFilter(line, today);
  if (date) return date;
  const text =
    textFilter(line, "description", (t) => t.description) ??
    textFilter(line, "status\\.name", (t) => t.statusInfo.name) ??
    textFilter(line, "recurrence", (t) => t.recurrence ?? "") ??
    textFilter(line, "tags", (t) => t.tags, "include", "do not include") ??
    textFilter(line, "tag", (t) => t.tags) ??
    textFilter(line, "id", (t) => t.id ?? "") ??
    textFilter(line, "path", (t) => t.path) ??
    textFilter(line, "root", (t) => t.root) ??
    textFilter(line, "folder", (t) => t.folder) ??
    textFilter(line, "filename", (t) => t.filename) ??
    textFilter(line, "heading", (t) => t.heading ?? "");
  if (text) return text;
  return notUnderstood(line);
}

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"' };

type Node = { op: "AND" | "OR" | "XOR"; a: Node; b: Node } | { op: "NOT"; a: Node } | { op: "LEAF"; f: Filter };

/** `(a) AND NOT (b) OR …`, with NOT before XOR before AND before OR (Queries/Combining Filters). */
function booleanFilter(line: string, today: Moment): Filter | string {
  const fail = (why: string) =>
    `Tasks query: Could not interpret the following instruction as a Boolean combination:\n    ${line}\n\nThe error message is:\n    ${why}`;
  const tokens: (string | { group: string })[] = [];
  let i = 0;
  const s = line;
  let open: string | null = null;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch in PAIRS && (open === null || ch === open)) {
      // One kind of delimiter per line; brackets nest, quotes don't.
      open = ch;
      const close = PAIRS[ch];
      let j = -1;
      if (close === ch) j = s.indexOf(close, i + 1);
      else
        for (let k = i, depth = 0; k < s.length; k++) {
          if (s[k] === ch) depth++;
          else if (s[k] === close && --depth === 0) {
            j = k;
            break;
          }
        }
      if (j < 0) return fail(`malformed boolean query -- Invalid token (check the documentation for guidelines)`);
      tokens.push({ group: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const w = /^(AND NOT|OR NOT|AND|OR|XOR|NOT)(?=\s|$|[([{"])/.exec(s.slice(i));
    if (!w) return fail(`malformed boolean query -- Invalid token (check the documentation for guidelines)`);
    tokens.push(w[1]);
    i += w[1].length;
  }
  let p = 0;
  const atom = (): Node | string => {
    const t = tokens[p];
    if (t === "NOT") {
      p++;
      const a = atom();
      return typeof a === "string" ? a : { op: "NOT", a };
    }
    if (t && typeof t === "object") {
      p++;
      const inner = t.group.trim();
      const f = /^[([{"]/.test(inner) || /^NOT\s/.test(inner) ? booleanFilter(inner, today) : filter(inner, today);
      if (typeof f === "string") return f;
      return { op: "LEAF", f };
    }
    return fail("malformed boolean query -- Invalid token (check the documentation for guidelines)");
  };
  const level = (ops: string[], next: () => Node | string) => (): Node | string => {
    let a = next();
    if (typeof a === "string") return a;
    while (typeof tokens[p] === "string" && ops.includes(tokens[p] as string)) {
      const op = tokens[p++] as string;
      let b = next();
      if (typeof b === "string") return b;
      if (op.endsWith(" NOT")) b = { op: "NOT", a: b };
      a = { op: op.split(" ")[0] as "AND" | "OR" | "XOR", a, b };
    }
    return a;
  };
  const xor = level(["XOR"], atom);
  const and = level(["AND", "AND NOT"], xor);
  const or = level(["OR", "OR NOT"], and);
  const tree = or();
  if (typeof tree === "string") return tree;
  if (p < tokens.length) return fail("malformed boolean query -- Invalid token (check the documentation for guidelines)");
  const test = (n: Node, t: QTask, c: Ctx): boolean =>
    n.op === "LEAF"
      ? n.f.test(t, c)
      : n.op === "NOT"
        ? !test(n.a, t, c)
        : n.op === "AND"
          ? test(n.a, t, c) && test(n.b, t, c)
          : n.op === "OR"
            ? test(n.a, t, c) || test(n.b, t, c)
            : test(n.a, t, c) !== test(n.b, t, c);
  const explainNode = (n: Node, c: Ctx, ind: string): string[] => {
    if (n.op === "LEAF") return n.f.explain(c).map((x) => ind + x.replace(/\n/g, `\n${ind}`));
    if (n.op === "NOT") return [`${ind}NOT:`, ...explainNode(n.a, c, `${ind}  `)];
    const flat = (x: Node): Node[] => (x.op === n.op ? [...flat((x as { a: Node }).a), ...flat((x as { b: Node }).b)] : [x]);
    const title = { AND: "AND (All of):", OR: "OR (At least one of):", XOR: "XOR (Exactly one of):" }[n.op];
    return [`${ind}${title}`, ...(n.op === "XOR" ? [n.a, n.b] : flat(n)).flatMap((x) => explainNode(x, c, `${ind}  `))];
  };
  return { source: line, test: (t, c) => test(tree, t, c), explain: (c) => [`${line} =>`, ...explainNode(tree, c, "  ")] };
}

// ── Functions ────────────────────────────────────────────────────────────────────────────────

type Fn = (task: unknown, query: unknown) => unknown;

/** Set by parseQuery while it reads a query that may run functions (QueryFile.scripts). */
let scriptsOn = false;

function compileFunction(code: string): Fn | string {
  if (!scriptsOn) return SCRIPTS_OFF;
  const body = /\breturn\b/.test(code) ? code : `return (${code});`;
  try {
    return new Function("task", "query", body) as Fn;
  } catch (e) {
    return `Error: Failed parsing expression "${code}".\nThe error message was:\n    "${(e as Error).message}"`;
  }
}

const scriptCache = new WeakMap<QTask, ReturnType<typeof scriptTask>>();
// query.allTasks, made once per run rather than once per task that asks.
const allCache = new WeakMap<Ctx, ReturnType<typeof scriptTask>[]>();

function scriptOf(t: QTask, c: Ctx) {
  let st = scriptCache.get(t);
  if (!st) {
    st = scriptTask(t, c.today, () => c.all);
    scriptCache.set(t, st);
  }
  return st;
}

function runFunction(fn: Fn, t: QTask, c: Ctx): unknown {
  const st = scriptOf(t, c);
  const fm = c.file.frontmatter ?? {};
  const noExt = (p: string) => p.replace(/\.md$/i, "");
  const slash = c.file.path.lastIndexOf("/");
  const filename = slash < 0 ? c.file.path : c.file.path.slice(slash + 1);
  const query = {
    file: {
      path: c.file.path,
      pathWithoutExtension: noExt(c.file.path),
      filename,
      filenameWithoutExtension: noExt(filename),
      folder: slash < 0 ? "/" : `${c.file.path.slice(0, slash)}/`,
      root: c.file.path.includes("/") ? `${c.file.path.slice(0, c.file.path.indexOf("/"))}/` : "/",
      hasProperty: (k: string) => fm[k] != null,
      property: (k: string) => fm[k] ?? null,
      outlinks: [],
      outlinksInBody: [],
      outlinksInProperties: [],
    },
    get allTasks() {
      let a = allCache.get(c);
      if (!a) {
        a = c.all.map((x) => scriptOf(x, c));
        allCache.set(c, a);
      }
      return a;
    },
  };
  return fn(st, query);
}

// ── Sorting ──────────────────────────────────────────────────────────────────────────────────

/** Invalid first, then earliest to latest, then none (Queries/Sorting, "How dates are sorted"). */
function byDate(a: string | undefined, b: string | undefined): number {
  const rank = (d: string | undefined) => (!d ? 2 : moment(d, "YYYY-MM-DD", true).isValid() ? 1 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return ra === 1 ? a!.localeCompare(b!) : 0;
}

const happens = (t: QTask) =>
  HAPPENS.map((k) => t.dates[k])
    .filter((d) => d && moment(d, "YYYY-MM-DD", true).isValid())
    .sort()[0];
const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** The description as it reads: links as their label, emphasis marks gone. */
const visible = (s: string) =>
  s
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_=~`]/g, "")
    .trim();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function compareValues(a: unknown, b: unknown): number {
  const norm = (v: unknown): unknown => {
    if (v && typeof v === "object" && "moment" in (v as object)) return (v as { moment: Moment | null }).moment;
    return v;
  };
  const x = norm(a);
  const y = norm(b);
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(x) || empty(y)) return empty(x) && empty(y) ? 0 : empty(x) ? 1 : -1;
  if (typeof x === "boolean" && typeof y === "boolean") return x === y ? 0 : x ? -1 : 1;
  if (moment.isMoment(x) && moment.isMoment(y)) return x.valueOf() - y.valueOf();
  if (typeof x === "number" && typeof y === "number") return x - y;
  return text(String(x), String(y));
}

const SORTERS: Record<string, (arg: string | null) => Sorter["cmp"] | string> = {
  status: () => (a, b) => Number(a.isDone) - Number(b.isDone),
  "status.name": () => (a, b) => text(a.statusInfo.name, b.statusInfo.name),
  "status.type": () => (a, b) => STATUS_ORDER[a.statusInfo.type] - STATUS_ORDER[b.statusInfo.type],
  id: () => (a, b) => compareValues(a.id, b.id),
  done: () => (a, b) => byDate(a.dates.done, b.dates.done),
  due: () => (a, b) => byDate(a.dates.due, b.dates.due),
  scheduled: () => (a, b) => byDate(a.dates.scheduled, b.dates.scheduled),
  start: () => (a, b) => byDate(a.dates.start, b.dates.start),
  created: () => (a, b) => byDate(a.dates.created, b.dates.created),
  cancelled: () => (a, b) => byDate(a.dates.cancelled, b.dates.cancelled),
  happens: () => (a, b) => byDate(happens(a), happens(b)),
  description: () => (a, b) => text(visible(a.description), visible(b.description)),
  priority: () => (a, b) => a.priorityNumber - b.priorityNumber,
  urgency: () => (a, b) => b.urgency - a.urgency,
  recurring: () => (a, b) => Number(!a.recurrence) - Number(!b.recurrence),
  tag: (arg) => {
    const n = arg ? +arg : 1;
    if (!Number.isInteger(n) || n < 1) return "Tasks query: do not understand query";
    return (a, b) => compareValues(a.tags[n - 1], b.tags[n - 1]);
  },
  path: () => (a, b) => text(a.path, b.path),
  root: () => (a, b) => text(a.root, b.root),
  folder: () => (a, b) => text(a.folder, b.folder),
  filename: () => (a, b) => text(a.filename, b.filename),
  heading: () => (a, b) => (a.heading ? (b.heading ? text(a.heading, b.heading) : 1) : b.heading ? -1 : 0),
  random: () => (a, b, c) => hash(a.description + c.today.format("YYYY-MM-DD")) - hash(b.description + c.today.format("YYYY-MM-DD")),
  // Brainstead: the manual order dragged in the task lists (`^rank-N`), unranked first.
  rank: () => (a, b) => (a.rank === null ? (b.rank === null ? 0 : -1) : b.rank === null ? 1 : a.rank - b.rank),
  manual: () => SORTERS.rank(null) as Sorter["cmp"],
};

function sorter(spec: string, line: string): Sorter | string {
  const fm = /^function (?:reverse )?(.+)$/is.exec(spec);
  if (fm) {
    const reverse = /^function reverse /i.test(spec);
    const fn = compileFunction(fm[1]);
    if (typeof fn === "string") return fn;
    const cache = new WeakMap<QTask, unknown>();
    const key = (t: QTask, c: Ctx) => {
      if (!cache.has(t)) cache.set(t, runFunction(fn, t, c));
      return cache.get(t);
    };
    return { source: line, cmp: (a, b, c) => (reverse ? -1 : 1) * compareValues(key(a, c), key(b, c)) };
  }
  const m = /^(\S+)(?: (\d+))?( reverse)?$/i.exec(spec.trim());
  if (!m) return notUnderstood(line);
  const make = SORTERS[m[1].toLowerCase()];
  if (!make) return notUnderstood(line);
  const cmp = make(m[2] ?? null);
  if (typeof cmp === "string") return notUnderstood(line);
  return { source: line, cmp: m[3] ? (a, b, c) => -cmp(a, b, c) : cmp };
}

const DEFAULT_SORT = ["status.type", "urgency", "due", "priority", "path"].map((k) => sorter(k, `sort by ${k}`) as Sorter);

/** What `sort by` takes, for the editor's query help (src/editor/queryVocab.ts). */
export const SORT_KEYS = Object.keys(SORTERS);

// ── Grouping ─────────────────────────────────────────────────────────────────────────────────

const dateGroup = (k: DateField, label: string) => (t: QTask) => {
  const d = t.dates[k];
  if (!d) return [`%%2%%No ${label} date`];
  const m = moment(d, "YYYY-MM-DD", true);
  return m.isValid() ? [`%%1%%${m.format("YYYY-MM-DD dddd")}`] : [`%%0%%Invalid ${label} date`];
};

function recurrenceText(rule: string): string {
  try {
    return RRule.fromText(rule.replace(/\s+when done$/i, "")).toText() + (/when done$/i.test(rule) ? " when done" : "");
  } catch {
    return rule;
  }
}

const GROUPERS: Record<string, Grouper["keys"]> = {
  status: (t) => [t.isDone ? "Done" : "Todo"],
  "status.name": (t) => [t.statusInfo.name],
  "status.type": (t) => [`%%${STATUS_ORDER[t.statusInfo.type]}%%${t.statusInfo.type}`],
  id: (t) => [t.id ?? ""],
  done: dateGroup("done", "done"),
  due: dateGroup("due", "due"),
  scheduled: dateGroup("scheduled", "scheduled"),
  start: dateGroup("start", "start"),
  created: dateGroup("created", "created"),
  cancelled: dateGroup("cancelled", "cancelled"),
  happens: (t) => {
    const d = happens(t);
    return d ? [`%%1%%${moment(d, "YYYY-MM-DD").format("YYYY-MM-DD dddd")}`] : ["%%2%%No happens date"];
  },
  priority: (t) => [`%%${t.priorityNumber}%%${PRIORITY_LABEL[t.priority]} priority`],
  urgency: (t) => [`%%${(1000 - t.urgency).toFixed(5).padStart(12, "0")}%%${t.urgency.toFixed(2)}`],
  recurring: (t) => [t.recurrence ? "%%0%%Recurring" : "%%1%%Not Recurring"],
  recurrence: (t) => [t.recurrence ? recurrenceText(t.recurrence) : "None"],
  tags: (t) => (t.tags.length ? t.tags : ["(No tags)"]),
  path: (t) => [t.path.replace(/\.md$/i, "")],
  root: (t) => [t.root],
  folder: (t) => [t.folder],
  filename: (t) => [t.filename.replace(/\.md$/i, "")],
  backlink: (t) => [t.heading ? `${t.filename.replace(/\.md$/i, "")} > ${t.heading}` : t.filename.replace(/\.md$/i, "")],
  heading: (t) => [t.heading ?? "(No heading)"],
};

function grouper(spec: string, line: string): Grouper | string {
  const fm = /^function (?:(reverse) )?(.+)$/is.exec(spec);
  if (fm) {
    const fn = compileFunction(fm[2]);
    if (typeof fn === "string") return fn;
    return {
      source: line,
      reverse: !!fm[1],
      keys: (t, c) => {
        const v = runFunction(fn, t, c);
        const list = Array.isArray(v) ? v : [v];
        return list
          .filter((x) => x !== null && x !== undefined && x !== "")
          .map((x) => (moment.isMoment(x) ? x.format("YYYY-MM-DD") : String(x)));
      },
    };
  }
  const m = /^(\S+)( reverse)?$/i.exec(spec.trim());
  const keys = m && GROUPERS[m[1].toLowerCase()];
  if (!m || !keys) return notUnderstood(line);
  return { source: line, reverse: !!m[2], keys };
}

/** What `group by` takes, and what `hide` / `show` name, for the editor's query help. */
export const GROUP_KEYS = Object.keys(GROUPERS);
export const LAYOUT_ELEMENTS: readonly Element[] = ELEMENTS;
export const PRIORITY_NAMES: readonly string[] = PRIORITIES;
export const STATUS_TYPES = ["TODO", "DONE", "IN_PROGRESS", "ON_HOLD", "CANCELLED", "NON_TASK"] as const;

/** A heading as shown: `%%sort key%%` taken off. */
export const headingText = (h: string) => h.replace(/%%[^%]*%%/g, "").trim();

// ── Running ──────────────────────────────────────────────────────────────────────────────────

export function runQuery(q: Query, ctx: Ctx): Result {
  if (q.error) return { groups: [], total: 0, shown: 0, explanation: null, error: q.error };
  let matched: QTask[];
  try {
    matched = ctx.all.filter((t) => q.filters.every((f) => f.test(t, ctx)));
    const sorters = [...q.sorters, ...DEFAULT_SORT];
    matched.sort((a, b) => {
      for (const s of sorters) {
        const r = s.cmp(a, b, ctx);
        if (r) return r;
      }
      return a.path === b.path ? a.lineNumber - b.lineNumber : text(a.path, b.path);
    });
  } catch (e) {
    return {
      groups: [],
      total: 0,
      shown: 0,
      explanation: null,
      error: `Error: Search failed.\nThe error message was:\n    "${(e as Error).message}"`,
    };
  }
  const total = matched.length;
  if (q.limit !== null) matched = matched.slice(0, q.limit);
  let groups: Group[] = [{ headings: [], tasks: matched }];
  try {
    if (q.groupers.length) {
      const map = new Map<string, { keys: string[]; tasks: QTask[] }>();
      for (const t of matched) {
        let paths: string[][] = [[]];
        for (const g of q.groupers) {
          const ks = g.keys(t, ctx);
          paths = paths.flatMap((p) => (ks.length ? ks.map((k) => [...p, k]) : [[...p, ""]]));
        }
        for (const p of paths) {
          const id = JSON.stringify(p);
          if (!map.has(id)) map.set(id, { keys: p, tasks: [] });
          map.get(id)!.tasks.push(t);
        }
      }
      const entries = [...map.values()];
      entries.sort((a, b) => {
        for (let i = 0; i < q.groupers.length; i++) {
          const r = text(a.keys[i], b.keys[i]);
          if (r) return q.groupers[i].reverse ? -r : r;
        }
        return 0;
      });
      groups = entries.map((e) => ({
        headings: e.keys.map(headingText),
        tasks: q.limitGroups !== null ? e.tasks.slice(0, q.limitGroups) : e.tasks,
      }));
    }
  } catch (e) {
    return {
      groups: [],
      total,
      shown: 0,
      explanation: null,
      error: `Error: Grouping failed.\nThe error message was:\n    "${(e as Error).message}"`,
    };
  }
  const shown = new Set(groups.flatMap((g) => g.tasks)).size;
  return { groups, total, shown, explanation: q.explain ? explain(q, ctx) : null, error: null };
}

/** What `explain` prints (Queries/Explaining Queries). */
export function explain(q: Query, ctx: Ctx): string {
  const out = ["Explanation of this Tasks code block query:", ""];
  if (!q.filters.length) out.push("  No filters supplied. All tasks will match the query.", "");
  for (const f of q.filters) out.push(...f.explain(ctx).map((l) => `  ${l}`), "");
  if (q.limit !== null) out.push(`  At most ${q.limit} task${q.limit === 1 ? "" : "s"}.`, "");
  if (q.limitGroups !== null)
    out.push(`  At most ${q.limitGroups} task${q.limitGroups === 1 ? "" : "s"} per group (if any "group by" options are supplied).`, "");
  if (q.groupers.length) out.push("  Group by:", ...q.groupers.map((g) => `    ${g.source}`), "");
  else out.push("  No grouping instructions supplied.", "");
  if (q.sorters.length) out.push("  Sort by:", ...q.sorters.map((s) => `    ${s.source}`), "");
  else out.push("  No sorting instructions supplied.", "");
  return out.join("\n").trimEnd();
}
