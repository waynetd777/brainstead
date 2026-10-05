// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// What the editor's query help offers inside ```tasks, ```dataview and ```dataviewjs blocks
// (src/editor/queryAssist.ts): the instructions, keys, functions and API members, each with a
// line of meaning and the docs page that explains it. The keys come from the engines themselves
// (src/tasksq/query.ts, src/md/dataview/eval.ts) and tests check every entry still parses, so
// the help can't drift from what runs. The vault's own tags, folders, notes and fields come from
// the Dataview page cache.

import { FUNCTIONS } from "../md/dataview/eval";
import { loadPages } from "../md/dataview/pages";
import { vaultVersion } from "../state";
import { GROUP_KEYS, LAYOUT_ELEMENTS, PRIORITY_NAMES, SORT_KEYS, STATUS_TYPES } from "../tasksq/query";

/** One thing the help can offer. `apply` is what's typed (default: the label). */
export interface VocabItem {
  label: string;
  detail?: string;
  info: string;
  docs: string;
  apply?: string;
  /** Sorts it higher (CodeMirror's boost). */
  boost?: number;
}

const T = "https://publish.obsidian.md/tasks/Queries/";
export const TASKS_DOCS = {
  filters: `${T}Filters`,
  sorting: `${T}Sorting`,
  grouping: `${T}Grouping`,
  layout: `${T}Layout`,
  limiting: `${T}Limiting`,
  combining: `${T}Combining+Filters`,
  explain: `${T}Explaining+Queries`,
};
const D = "https://blacksmithgu.github.io/obsidian-dataview/";
export const DATAVIEW_DOCS = {
  structure: `${D}queries/structure/`,
  types: `${D}queries/query-types/`,
  commands: `${D}queries/data-commands/`,
  sources: `${D}reference/sources/`,
  expressions: `${D}reference/expressions/`,
  literals: `${D}reference/literals/`,
  functions: `${D}reference/functions/`,
  pages: `${D}annotation/metadata-pages/`,
  tasks: `${D}annotation/metadata-tasks/`,
  api: `${D}api/code-reference/`,
  array: `${D}api/data-array/`,
};

// ── Tasks ────────────────────────────────────────────────────────────────────────────────────

const DATE_FIELDS: [word: string, name: string][] = [
  ["due", "due"],
  ["scheduled", "scheduled (deferred)"],
  ["starts", "start"],
  ["created", "created"],
  ["done", "done"],
  ["cancelled", "cancelled"],
  ["happens", "due, start or scheduled"],
];
const HAS_DATE = ["due", "scheduled", "start", "created", "done", "cancelled", "happens"];

/** Instructions that start a line in a tasks block. `apply` ends in a space where a value follows. */
export function tasksInstructions(): VocabItem[] {
  const f = TASKS_DOCS.filters;
  const out: VocabItem[] = [
    { label: "not done", info: "Tasks that aren't done or cancelled.", docs: f, boost: 3 },
    { label: "done", info: "Tasks that are done or cancelled.", docs: f, boost: 2 },
  ];
  for (const [w, name] of DATE_FIELDS) {
    for (const op of ["before", "after", "on", "in", "on or before", "on or after"])
      out.push({
        label: `${w} ${op}`,
        apply: `${w} ${op} `,
        detail: "date",
        info: `Tasks whose ${name} date is ${op} a date or range: today, next week, 2026-10-05.`,
        docs: f,
      });
  }
  for (const k of HAS_DATE) {
    out.push({ label: `no ${k} date`, info: `Tasks without a ${k} date.`, docs: f });
    out.push({ label: `has ${k} date`, info: `Tasks with a ${k} date.`, docs: f });
  }
  for (const k of ["due", "scheduled", "start", "created", "done", "cancelled"])
    out.push({ label: `${k} date is invalid`, info: `Tasks whose ${k} date isn't a real date.`, docs: f });
  out.push(
    { label: "priority is", apply: "priority is ", detail: "highest … lowest", info: "Tasks with exactly this priority.", docs: f },
    { label: "priority is above", apply: "priority is above ", info: "Tasks more urgent than this priority.", docs: f },
    { label: "priority is below", apply: "priority is below ", info: "Tasks less urgent than this priority.", docs: f },
    { label: "priority is not", apply: "priority is not ", info: "Tasks with any other priority.", docs: f },
    { label: "is recurring", info: "Repeating tasks.", docs: f },
    { label: "is not recurring", info: "Tasks that don't repeat.", docs: f },
    { label: "status.type is", apply: "status.type is ", detail: "TODO, DONE, …", info: "Tasks of one status type.", docs: f },
    { label: "status.type is not", apply: "status.type is not ", info: "Tasks of any other status type.", docs: f },
    { label: "status.name includes", apply: "status.name includes ", info: "Tasks whose status name includes the text.", docs: f },
    { label: "tags include", apply: "tags include ", detail: "#tag", info: "Tasks with a tag that includes the text.", docs: f },
    {
      label: "tags do not include",
      apply: "tags do not include ",
      detail: "#tag",
      info: "Tasks with no tag that includes the text.",
      docs: f,
    },
    { label: "has tags", info: "Tasks with at least one tag.", docs: f },
    { label: "no tags", info: "Tasks without tags.", docs: f },
    { label: "has id", info: "Tasks with an id.", docs: f },
    { label: "no id", info: "Tasks without an id.", docs: f },
    { label: "has depends on", info: "Tasks that wait on others.", docs: f },
    { label: "no depends on", info: "Tasks that wait on nothing.", docs: f },
    { label: "is blocking", info: "Open tasks another open task depends on.", docs: f },
    { label: "is not blocking", info: "Tasks nothing open waits on.", docs: f },
    { label: "is blocked", info: "Tasks waiting on an open task.", docs: f },
    { label: "is not blocked", info: "Tasks free to start.", docs: f },
    { label: "exclude sub-items", info: "Only top-level tasks, not those indented under another.", docs: f },
  );
  for (const [k, what] of [
    ["description", "task text"],
    ["path", "note's path"],
    ["folder", "note's folder"],
    ["root", "note's top folder"],
    ["filename", "note's file name"],
    ["heading", "heading above the task"],
  ]) {
    out.push(
      { label: `${k} includes`, apply: `${k} includes `, info: `Tasks whose ${what} includes the text (any case).`, docs: f },
      { label: `${k} does not include`, apply: `${k} does not include `, info: `Tasks whose ${what} doesn't include the text.`, docs: f },
      { label: `${k} regex matches`, apply: `${k} regex matches /`, info: `Tasks whose ${what} matches a /regular expression/.`, docs: f },
    );
  }
  out.push(
    {
      label: "filter by function",
      apply: "filter by function ",
      detail: "JavaScript",
      info: "Tasks for which the JavaScript expression is true; `task` is the task.",
      docs: f,
    },
    {
      label: "sort by",
      apply: "sort by ",
      detail: "key [reverse]",
      info: "Orders the results; several lines sort by each in turn.",
      docs: TASKS_DOCS.sorting,
      boost: 1,
    },
    {
      label: "sort by function",
      apply: "sort by function ",
      info: "Orders by a JavaScript expression of `task`.",
      docs: TASKS_DOCS.sorting,
    },
    {
      label: "group by",
      apply: "group by ",
      detail: "key [reverse]",
      info: "Puts the results under headings; several lines nest.",
      docs: TASKS_DOCS.grouping,
      boost: 1,
    },
    {
      label: "group by function",
      apply: "group by function ",
      info: "Groups by a JavaScript expression of `task`.",
      docs: TASKS_DOCS.grouping,
    },
    { label: "limit", apply: "limit ", detail: "number", info: "Shows at most this many tasks.", docs: TASKS_DOCS.limiting },
    {
      label: "limit groups",
      apply: "limit groups ",
      detail: "number",
      info: "Shows at most this many tasks in each group.",
      docs: TASKS_DOCS.limiting,
    },
    { label: "hide", apply: "hide ", detail: "element", info: "Hides a part of each task or of the block.", docs: TASKS_DOCS.layout },
    { label: "show", apply: "show ", detail: "element", info: "Shows a part hidden by default.", docs: TASKS_DOCS.layout },
    { label: "short mode", info: "Shows the task fields as icons only.", docs: TASKS_DOCS.layout },
    { label: "full mode", info: "Shows the task fields in full (the default).", docs: TASKS_DOCS.layout },
    { label: "explain", info: "Shows how the query was read, above the results.", docs: TASKS_DOCS.explain },
    {
      label: "( … ) AND ( … )",
      apply: "(",
      detail: "boolean",
      info: "Combines filters in brackets with AND, OR, XOR, NOT, AND NOT, OR NOT.",
      docs: TASKS_DOCS.combining,
    },
    {
      label: "NOT ( … )",
      apply: "NOT (",
      detail: "boolean",
      info: "Tasks the filter in brackets doesn't match.",
      docs: TASKS_DOCS.combining,
    },
  );
  return out;
}

export const TASKS_BOOLEANS: VocabItem[] = ["AND", "OR", "XOR", "AND NOT", "OR NOT"].map((op) => ({
  label: op,
  apply: `${op} (`,
  info: `Joins the filters before and after with ${op}.`,
  docs: TASKS_DOCS.combining,
}));

export const DATE_OPS = ["before", "after", "on", "in", "on or before", "on or after", "in or before", "in or after"];

export function dateWords(today: string): VocabItem[] {
  const f = TASKS_DOCS.filters;
  return [
    ["today", "Today."],
    ["tomorrow", "Tomorrow."],
    ["yesterday", "Yesterday."],
    ["this week", "Monday to Sunday of this week."],
    ["next week", "Next Monday to Sunday."],
    ["last week", "Last Monday to Sunday."],
    ["this month", "This calendar month."],
    ["next month", "Next calendar month."],
    ["last month", "Last calendar month."],
    ["in 3 days", "Three days from today."],
    [today, "A date, as YYYY-MM-DD."],
  ].map(([label, info]) => ({ label, info, docs: f }));
}

export const tasksSortKeys = (): VocabItem[] => SORT_KEYS.map((k) => ({ label: k, info: `Sorts by ${k}.`, docs: TASKS_DOCS.sorting }));
export const tasksGroupKeys = (): VocabItem[] => GROUP_KEYS.map((k) => ({ label: k, info: `Groups by ${k}.`, docs: TASKS_DOCS.grouping }));
export const tasksElements = (): VocabItem[] => LAYOUT_ELEMENTS.map((k) => ({ label: k, info: `The ${k}.`, docs: TASKS_DOCS.layout }));
export const tasksPriorities = (): VocabItem[] =>
  PRIORITY_NAMES.map((k) => ({ label: k, info: `${k[0].toUpperCase()}${k.slice(1)} priority.`, docs: TASKS_DOCS.filters }));
export const tasksStatusTypes = (): VocabItem[] =>
  STATUS_TYPES.map((k) => ({ label: k, info: `Status type ${k}.`, docs: TASKS_DOCS.filters }));

// ── Dataview ─────────────────────────────────────────────────────────────────────────────────

export const DV_TYPES: VocabItem[] = [
  {
    label: "TABLE",
    apply: "TABLE ",
    detail: "fields",
    info: "A table: one row per page, a column per field listed after it.",
    docs: DATAVIEW_DOCS.types,
    boost: 3,
  },
  { label: "TABLE WITHOUT ID", apply: "TABLE WITHOUT ID ", info: "A table without the page column.", docs: DATAVIEW_DOCS.types },
  { label: "LIST", apply: "LIST", info: "A list of pages, with an optional value after each.", docs: DATAVIEW_DOCS.types, boost: 2 },
  { label: "LIST WITHOUT ID", apply: "LIST WITHOUT ID ", info: "A list of values without the page links.", docs: DATAVIEW_DOCS.types },
  { label: "TASK", apply: "TASK", info: "The tasks in the pages, tickable.", docs: DATAVIEW_DOCS.types, boost: 1 },
  {
    label: "CALENDAR",
    apply: "CALENDAR ",
    detail: "date field",
    info: "A month calendar with a dot per page on its date.",
    docs: DATAVIEW_DOCS.types,
  },
];

export const DV_COMMANDS: VocabItem[] = [
  {
    label: "FROM",
    apply: "FROM ",
    detail: '#tag, "folder", [[note]]',
    info: "Which pages: tags, folders, links in or out; combine with and, or, -.",
    docs: DATAVIEW_DOCS.sources,
    boost: 3,
  },
  {
    label: "WHERE",
    apply: "WHERE ",
    detail: "condition",
    info: "Keeps the rows where the condition is true.",
    docs: DATAVIEW_DOCS.commands,
    boost: 2,
  },
  {
    label: "SORT",
    apply: "SORT ",
    detail: "field [ASC|DESC]",
    info: "Orders the rows; several fields separated by commas.",
    docs: DATAVIEW_DOCS.commands,
    boost: 1,
  },
  {
    label: "GROUP BY",
    apply: "GROUP BY ",
    detail: "field",
    info: "One row per value; the grouped pages are in `rows`.",
    docs: DATAVIEW_DOCS.commands,
  },
  { label: "FLATTEN", apply: "FLATTEN ", detail: "list field", info: "One row per item of a list field.", docs: DATAVIEW_DOCS.commands },
  { label: "LIMIT", apply: "LIMIT ", detail: "number", info: "At most this many rows.", docs: DATAVIEW_DOCS.commands },
];

export const DV_SORT_DIRS: VocabItem[] = [
  { label: "ASC", info: "Smallest first (the default).", docs: DATAVIEW_DOCS.commands },
  { label: "DESC", info: "Largest first.", docs: DATAVIEW_DOCS.commands },
];

export const DV_SOURCE_OPS: VocabItem[] = [
  { label: "and", apply: "and ", info: "Pages in both sources.", docs: DATAVIEW_DOCS.sources },
  { label: "or", apply: "or ", info: "Pages in either source.", docs: DATAVIEW_DOCS.sources },
  { label: "-", info: "Leaves out the source after it.", docs: DATAVIEW_DOCS.sources },
  { label: "outgoing([[…]])", apply: "outgoing([[", info: "Pages the given note links to.", docs: DATAVIEW_DOCS.sources },
];

/** `file.*` fields every page has. */
export const DV_FILE_FIELDS: [name: string, info: string][] = [
  ["file.name", "The file's name, without .md."],
  ["file.folder", "The folder it's in."],
  ["file.path", "Its path in the vault."],
  ["file.ext", "Its extension."],
  ["file.link", "A link to it."],
  ["file.size", "Its size in bytes."],
  ["file.ctime", "When it was created (date and time)."],
  ["file.cday", "The day it was created."],
  ["file.mtime", "When it was last changed (date and time)."],
  ["file.mday", "The day it was last changed."],
  ["file.tags", "Its tags, broken down (#a/b is also #a)."],
  ["file.etags", "Its tags as written."],
  ["file.inlinks", "Pages that link to it."],
  ["file.outlinks", "Pages it links to."],
  ["file.aliases", "Its aliases."],
  ["file.tasks", "Its tasks."],
  ["file.lists", "Its list items, tasks included."],
  ["file.frontmatter", "Its properties, as written."],
  ["file.day", "The date in its name, or its date property."],
  ["file.starred", "Whether it's starred (always false here)."],
];

/** Fields a TASK query's rows have. */
export const DV_TASK_FIELDS: [name: string, info: string][] = [
  ["text", "The task's text."],
  ["completed", "Whether it's done."],
  ["fullyCompleted", "Whether it and every subtask are done."],
  ["checked", "Whether its box has anything in it."],
  ["status", "The character in its box."],
  ["due", "Its due date."],
  ["completion", "The day it was done."],
  ["created", "The day it was written down."],
  ["start", "The day it can start."],
  ["scheduled", "The day it's deferred to."],
  ["tags", "Its tags."],
  ["line", "Its line in the note."],
  ["section", "A link to the heading above it."],
  ["header", "The heading above it."],
  ["children", "Its subtasks."],
  ["parent", "The line of the task it's under."],
];

/** Signatures and meanings for the function library; tests check this covers FUNCTIONS exactly. */
export const DV_FUNCTION_INFO: Record<string, [sig: string, info: string]> = {
  object: ["object(key1, value1, …)", "An object from keys and values."],
  list: ["list(value1, value2, …)", "A list of the values."],
  array: ["array(value1, …)", "Same as list()."],
  date: ["date(text | today | now | tomorrow | sow | eom …, [format])", "A date from text or a keyword."],
  dur: ["dur(text)", "A duration: dur(3 days), dur(1h 30m)."],
  number: ["number(text)", "The first number in the text."],
  string: ["string(value)", "The value as text."],
  link: ["link(path, [display])", "A link to a note."],
  embed: ["embed(link, [embed?])", "The link as an embed."],
  elink: ["elink(url, [display])", "A link to a web address."],
  typeof: ["typeof(value)", "The type: number, string, date, link …"],
  round: ["round(number, [digits])", "Rounded."],
  trunc: ["trunc(number)", "The whole part."],
  floor: ["floor(number)", "Rounded down."],
  ceil: ["ceil(number)", "Rounded up."],
  min: ["min(a, b, …)", "The smallest."],
  max: ["max(a, b, …)", "The largest."],
  sum: ["sum(list)", "The total."],
  product: ["product(list)", "Everything multiplied."],
  average: ["average(list)", "The mean."],
  reduce: ['reduce(list, "+")', "Combines the list with an operator."],
  minby: ["minby(list, (x) => value)", "The item with the smallest value."],
  maxby: ["maxby(list, (x) => value)", "The item with the largest value."],
  contains: ["contains(list | text | object, value)", "Whether it contains the value (text: any part)."],
  icontains: ["icontains(list | text, value)", "contains(), ignoring case."],
  econtains: ["econtains(list | text, value)", "Whether it contains exactly the value."],
  containsword: ["containsword(text, word)", "Whether the text has the whole word."],
  extract: ["extract(object, key1, …)", "Just those keys."],
  sort: ["sort(list)", "Sorted."],
  reverse: ["reverse(list)", "Reversed."],
  length: ["length(list | text)", "How many items or characters."],
  nonnull: ["nonnull(list)", "Without the empty values."],
  firstvalue: ["firstvalue(list)", "The first value that isn't empty."],
  all: ["all(list, [(x) => test])", "Whether every item is true."],
  any: ["any(list, [(x) => test])", "Whether some item is true."],
  none: ["none(list, [(x) => test])", "Whether no item is true."],
  join: ["join(list, [separator])", "The items as one text."],
  filter: ["filter(list, (x) => test)", "The items that pass."],
  map: ["map(list, (x) => value)", "Each item changed."],
  flat: ["flat(list, [depth])", "Nested lists flattened."],
  slice: ["slice(list, [start, [end]])", "Part of the list."],
  unique: ["unique(list)", "Without repeats."],
  regextest: ["regextest(pattern, text)", "Whether the pattern is found in the text."],
  regexmatch: ["regexmatch(pattern, text)", "Whether the whole text matches."],
  regexreplace: ["regexreplace(text, pattern, replacement)", "Replaces every match."],
  replace: ["replace(text, find, replacement)", "Replaces every occurrence."],
  lower: ["lower(text)", "Lower case."],
  upper: ["upper(text)", "Upper case."],
  split: ["split(text, delimiter, [limit])", "A list of the parts."],
  startswith: ["startswith(text, prefix)", "Whether it starts with the prefix."],
  endswith: ["endswith(text, suffix)", "Whether it ends with the suffix."],
  padleft: ["padleft(text, length, [padding])", "Padded on the left."],
  padright: ["padright(text, length, [padding])", "Padded on the right."],
  substring: ["substring(text, start, [end])", "Part of the text."],
  truncate: ["truncate(text, length, [suffix])", "Cut to a length, with … at the end."],
  default: ["default(value, fallback)", "The fallback when the value is empty."],
  ldefault: ["ldefault(value, fallback)", "default(), not applied to each item of a list."],
  display: ["display(value)", "The value as it's shown, as text."],
  choice: ["choice(test, ifTrue, ifFalse)", "One of two values."],
  hash: ["hash(seed, [text], [number])", "A number from the inputs, for stable random order."],
  striptime: ["striptime(date)", "The date without its time."],
  dateformat: ['dateformat(date, "yyyy-MM-dd")', "The date as text in a format."],
  durationformat: ["durationformat(duration, \"h 'hours'\")", "The duration as text in a format."],
  currencyformat: ["currencyformat(number, [currency])", "The number as money."],
  localtime: ["localtime(date)", "The date in this time zone."],
  meta: ["meta(link)", "A link's parts: path, display, subpath, type."],
};

export const DV_LITERALS: VocabItem[] = [
  { label: "this", info: "The page the query is in.", docs: DATAVIEW_DOCS.expressions },
  { label: "date(today)", info: "Today.", docs: DATAVIEW_DOCS.literals },
  { label: "date(now)", info: "Now, with the time.", docs: DATAVIEW_DOCS.literals },
  { label: "date(tomorrow)", info: "Tomorrow.", docs: DATAVIEW_DOCS.literals },
  { label: "date(yesterday)", info: "Yesterday.", docs: DATAVIEW_DOCS.literals },
  { label: "date(sow)", info: "The start of this week.", docs: DATAVIEW_DOCS.literals },
  { label: "date(eom)", info: "The end of this month.", docs: DATAVIEW_DOCS.literals },
  { label: "dur(1 week)", info: "A duration: 1 week, 3 days, 2h 30m.", docs: DATAVIEW_DOCS.literals },
  { label: "true", info: "Yes.", docs: DATAVIEW_DOCS.literals },
  { label: "false", info: "No.", docs: DATAVIEW_DOCS.literals },
  { label: "null", info: "Nothing.", docs: DATAVIEW_DOCS.literals },
];

export const DV_EXPR_OPS: VocabItem[] = [
  { label: "AND", apply: "AND ", info: "Both are true.", docs: DATAVIEW_DOCS.expressions },
  { label: "OR", apply: "OR ", info: "Either is true.", docs: DATAVIEW_DOCS.expressions },
  { label: "AS", apply: "AS ", info: 'Names a column: field AS "Name".', docs: DATAVIEW_DOCS.types },
];

export function dvFunctions(): VocabItem[] {
  return Object.keys(FUNCTIONS).map((k) => {
    const [sig, info] = DV_FUNCTION_INFO[k] ?? [`${k}(…)`, ""];
    const call = sig.includes("(");
    return { label: k, detail: sig, info, docs: DATAVIEW_DOCS.functions, apply: call ? `${k}(` : k };
  });
}

/** `dv.` members for DataviewJS. */
export const DV_API: [name: string, sig: string, info: string][] = [
  ["current", "dv.current()", "The page the script is in."],
  ["pages", "dv.pages(source)", 'Pages matching a source, as a data array: dv.pages("#tag").'],
  ["page", "dv.page(path)", "One page by path or link."],
  ["pagePaths", "dv.pagePaths(source)", "The paths of the matching pages."],
  ["array", "dv.array(value)", "Makes a data array."],
  ["isArray", "dv.isArray(value)", "Whether it's an array or data array."],
  ["fileLink", "dv.fileLink(path, [embed], [display])", "A link to a note."],
  ["sectionLink", "dv.sectionLink(path, section, [embed], [display])", "A link to a heading."],
  ["blockLink", "dv.blockLink(path, block, [embed], [display])", "A link to a block."],
  ["date", "dv.date(text)", "A date (luxon DateTime)."],
  ["duration", "dv.duration(text)", "A duration."],
  ["compare", "dv.compare(a, b)", "-1, 0 or 1, as Dataview sorts."],
  ["equal", "dv.equal(a, b)", "Whether two values are equal."],
  ["clone", "dv.clone(value)", "A deep copy."],
  ["parse", "dv.parse(text)", "Text read as a Dataview value."],
  ["evaluate", "dv.evaluate(expression, [context])", "An expression's result, or an error."],
  ["tryEvaluate", "dv.tryEvaluate(expression, [context])", "An expression's value; throws on error."],
  ["query", "dv.query(source)", "Runs a DQL query; returns the result or an error."],
  ["tryQuery", "dv.tryQuery(source)", "Runs a DQL query; throws on error."],
  ["queryMarkdown", "dv.queryMarkdown(source)", "A DQL query's result as markdown."],
  ["tryQueryMarkdown", "dv.tryQueryMarkdown(source)", "The same; throws on error."],
  ["header", "dv.header(level, text)", "A heading."],
  ["paragraph", "dv.paragraph(text)", "A paragraph."],
  ["span", "dv.span(text)", "Inline text."],
  ["el", "dv.el(tag, text, [options])", 'Any element: dv.el("b", "bold").'],
  ["list", "dv.list(items)", "A bulleted list."],
  ["taskList", "dv.taskList(tasks, [groupByFile])", "Tickable tasks."],
  ["table", "dv.table(headers, rows)", "A table."],
  ["execute", "dv.execute(source)", "Runs a DQL query here and shows it."],
  ["executeJs", "dv.executeJs(code)", "Runs DataviewJS here."],
  ["view", "dv.view(path, input)", "Runs a view script from the vault."],
  ["markdownTable", "dv.markdownTable(headers, rows)", "A table as markdown text."],
  ["markdownList", "dv.markdownList(items)", "A list as markdown text."],
  ["markdownTaskList", "dv.markdownTaskList(tasks)", "Tasks as markdown text."],
  ["io", "dv.io.load(path) / dv.io.csv(path)", "Reads a vault file's text or a CSV."],
  ["luxon", "dv.luxon", "The luxon date library."],
  ["container", "dv.container", "The element the script draws into."],
];

export const DV_ARRAY: [name: string, sig: string, info: string][] = [
  ["where", ".where((p) => test)", "The items that pass."],
  ["filter", ".filter((p) => test)", "Same as where()."],
  ["map", ".map((p) => value)", "Each item changed."],
  ["flatMap", ".flatMap((p) => list)", "Each item to a list, flattened."],
  ["mutate", ".mutate((p) => {…})", "Changes each item in place."],
  ["limit", ".limit(n)", "The first n items."],
  ["slice", ".slice(start, [end])", "Part of the array."],
  ["concat", ".concat(other)", "Both arrays joined."],
  ["indexOf", ".indexOf(item)", "Where the item is."],
  ["find", ".find((p) => test)", "The first item that passes."],
  ["findIndex", ".findIndex((p) => test)", "Where the first passing item is."],
  ["includes", ".includes(item)", "Whether it has the item."],
  ["join", ".join([separator])", "The items as one text."],
  ["sort", '.sort((p) => key, ["asc"|"desc"])', "Sorted by a key."],
  ["groupBy", ".groupBy((p) => key)", "Groups, each with key and rows."],
  ["groupIn", ".groupIn((p) => key)", "Groups within existing groups."],
  ["distinct", ".distinct([(p) => key])", "Without repeats."],
  ["every", ".every((p) => test)", "Whether all pass."],
  ["some", ".some((p) => test)", "Whether any passes."],
  ["none", ".none((p) => test)", "Whether none passes."],
  ["first", ".first()", "The first item."],
  ["last", ".last()", "The last item."],
  ["to", '.to("field")', "Each item's field (also `.field`)."],
  ["into", '.into("field")', "Each item's field, one level."],
  ["expand", '.expand("children")', "Items and all their nested items."],
  ["forEach", ".forEach((p) => {…})", "Runs a function on each item."],
  ["array", ".array()", "A plain array."],
  ["length", ".length", "How many items."],
  ["values", ".values", "The plain array underneath."],
];

// ── The vault's own names ────────────────────────────────────────────────────────────────────

export interface VaultVocab {
  tags: string[];
  folders: string[];
  notes: string[];
  fields: string[];
}

let provider: () => Promise<VaultVocab> = async () => {
  const set = await loadPages(vaultVersion.get().n);
  const tags = new Set<string>();
  const folders = new Set<string>();
  const fields = new Set<string>();
  const notes: string[] = [];
  for (const p of set.pages) {
    const f = p.file as Record<string, unknown> | undefined;
    for (const t of (f?.tags as string[] | undefined) ?? []) tags.add(String(t));
    const folder = String(f?.folder ?? "");
    if (folder) folders.add(folder);
    notes.push(String(f?.name ?? ""));
    for (const k of Object.keys(p)) if (k !== "file" && !/[\s]/.test(k)) fields.add(k);
  }
  const sort = (s: Iterable<string>) => [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return { tags: sort(tags), folders: sort(folders), notes: sort(notes), fields: sort(fields) };
};

/** The vault's tags, folders, note names and field names. */
export const vaultVocab = () => provider();

/** For tests: answer with these. */
export function setVaultVocabForTest(v: VaultVocab) {
  provider = async () => v;
}
