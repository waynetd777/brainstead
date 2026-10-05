// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Help with queries while typing, inside ```tasks, ```dataview and ```dataviewjs blocks: the
// instructions and what can follow them, the vault's tags, folders, notes and fields, Dataview's
// functions and the dv API, each with a line of meaning and its docs page (src/editor/queryVocab.ts).
// Also: a line the engine can't read is underlined with its message; and ```tasks or ```dataview
// then Enter closes the block and opens the help. "Build a query…" opens the query builder
// (src/editor/QueryBuilder.tsx).

import { Completion, CompletionContext, CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { Diagnostic, linter } from "@codemirror/lint";
import { EditorSelection, EditorState, Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { describeError, parseQuery as parseDql } from "../md/dataview/parse";
import { localToday } from "../md/taskQuery";
import { parseQuery as parseTasks } from "../tasksq/query";
import { openQueryBuilder } from "./queryBuilderStore";
import {
  dateWords,
  DATE_OPS,
  DV_API,
  DV_ARRAY,
  DV_COMMANDS,
  DV_EXPR_OPS,
  DV_FILE_FIELDS,
  DV_LITERALS,
  DV_SORT_DIRS,
  DV_SOURCE_OPS,
  DV_TASK_FIELDS,
  DV_TYPES,
  DATAVIEW_DOCS,
  dvFunctions,
  tasksElements,
  tasksGroupKeys,
  tasksInstructions,
  tasksPriorities,
  tasksSortKeys,
  tasksStatusTypes,
  TASKS_BOOLEANS,
  TASKS_DOCS,
  vaultVocab,
  VocabItem,
} from "./queryVocab";

export type QueryLang = "tasks" | "dataview" | "dataviewjs";
const LANGS = new Set<string>(["tasks", "dataview", "dataviewjs"]);
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/;

/** A query block: its language, the opening and closing fence lines (1-based; close null while
 *  it's still open), and where its text starts and ends. */
export interface QueryFence {
  lang: QueryLang;
  open: number;
  close: number | null;
  from: number;
  to: number;
}

/** Every fenced block in the document, query or not, with its line numbers. */
function fences(state: EditorState): { lang: string; open: number; close: number | null; marker: string }[] {
  const out: { lang: string; open: number; close: number | null; marker: string }[] = [];
  let cur: (typeof out)[number] | null = null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const m = FENCE.exec(state.doc.line(n).text);
    if (!m) continue;
    if (!cur) {
      cur = { lang: m[2].toLowerCase(), open: n, close: null, marker: m[1] };
      out.push(cur);
    } else if (m[1][0] === cur.marker[0] && m[1].length >= cur.marker.length && !m[2]) {
      cur.close = n;
      cur = null;
    }
  }
  return out;
}

function toFence(state: EditorState, f: { lang: string; open: number; close: number | null }): QueryFence {
  const from = state.doc.line(f.open).to + 1;
  const to = f.close === null ? state.doc.length : state.doc.line(f.close).from - 1;
  return {
    lang: f.lang as QueryLang,
    open: f.open,
    close: f.close,
    from: Math.min(from, state.doc.length),
    to: Math.max(to, Math.min(from, state.doc.length)),
  };
}

/** The query block `pos` is inside (not on its fence lines), or null. */
export function fenceAt(state: EditorState, pos: number): QueryFence | null {
  const n = state.doc.lineAt(pos).number;
  for (const f of fences(state)) {
    if (n <= f.open) break;
    if (f.close !== null && n >= f.close) continue;
    return LANGS.has(f.lang) ? toFence(state, f) : null;
  }
  return null;
}

/** The query block whose opening fence is on the line of `pos`, or null. */
export function fenceOpenedAt(state: EditorState, pos: number): QueryFence | null {
  const n = state.doc.lineAt(pos).number;
  const f = fences(state).find((x) => x.open === n);
  return f && LANGS.has(f.lang) ? toFence(state, f) : null;
}

/** Every query block, for diagnostics. */
export function queryFences(state: EditorState): QueryFence[] {
  return fences(state)
    .filter((f) => LANGS.has(f.lang))
    .map((f) => toFence(state, f));
}

// ── Completions ──────────────────────────────────────────────────────────────────────────────

function infoNode(item: VocabItem): () => Node {
  return () => {
    const d = document.createElement("div");
    d.className = "cm-qinfo";
    if (item.detail) {
      const s = document.createElement("code");
      s.textContent = item.detail;
      d.append(s);
    }
    if (item.info) {
      const p = document.createElement("p");
      p.textContent = item.info;
      d.append(p);
    }
    const a = document.createElement("a");
    a.href = item.docs;
    a.textContent = "Docs ↗";
    a.className = "qdocs";
    a.addEventListener("mousedown", (e) => e.preventDefault());
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void openUrl(item.docs);
    });
    d.append(a);
    return d;
  };
}

const opt = (item: VocabItem, type?: string): Completion => ({
  label: item.label,
  detail: item.detail,
  apply: item.apply ?? item.label,
  info: infoNode(item),
  boost: item.boost,
  type,
});

/** The opener of the builder, as the first choice in an empty block. */
function builderOption(lang: QueryLang): Completion {
  return {
    label: "Build a query…",
    detail: lang === "tasks" ? "Tasks" : "Dataview",
    boost: 99,
    type: "builder",
    apply: (view: EditorView) => openBuilderAt(view, view.state.selection.main.head),
  };
}

const simple = (labels: string[], docs: string, info: (l: string) => string): VocabItem[] =>
  labels.map((label) => ({ label, docs, info: info(label) }));

/** What to offer at a place in a tasks block: where the replaced text starts, and the items. */
export async function tasksOptions(lineBefore: string, explicit: boolean): Promise<{ start: number; items: VocabItem[] } | null> {
  const lead = lineBefore.length - lineBefore.trimStart().length;
  // Inside brackets, after `(` or a boolean operator: a fresh filter.
  const inner = /(?:^|[(\s])\(\s*([^()]*)$/.exec(lineBefore);
  let text = lineBefore.slice(lead);
  let base = lead;
  if (inner && lineBefore.trimStart().match(/^(NOT\s+)?\(/)) {
    text = inner[1];
    base = lineBefore.length - inner[1].length;
  }
  let m: RegExpExecArray | null;
  const at = (rest: string) => base + text.length - rest.length;
  // After a bracketed filter: AND, OR …
  if (/^(NOT\s+)?\(/.test(lineBefore.trimStart()) && (m = /\)\s+(\w*(?: \w*)?)$/.exec(lineBefore)))
    return { start: lineBefore.length - m[1].length, items: TASKS_BOOLEANS };
  if ((m = /^sort by (?:\S+ )(\w*)$/i.exec(text)))
    return { start: at(m[1]), items: simple(["reverse"], TASKS_DOCS.sorting, () => "Largest first.") };
  if ((m = /^group by (?:\S+ )(\w*)$/i.exec(text)))
    return { start: at(m[1]), items: simple(["reverse"], TASKS_DOCS.grouping, () => "Groups in reverse order.") };
  if ((m = /^sort by (\S*)$/i.exec(text))) return { start: at(m[1]), items: tasksSortKeys() };
  if ((m = /^group by (\S*)$/i.exec(text))) return { start: at(m[1]), items: tasksGroupKeys() };
  if ((m = /^(?:hide|show) ([\w ]*)$/i.exec(text))) return { start: at(m[1]), items: tasksElements() };
  if ((m = /^priority is (?:(?:above|below|not) )?(\w*)$/i.exec(text))) {
    const items = tasksPriorities();
    if (/^priority is \w*$/i.test(text))
      items.unshift(...simple(["above", "below", "not"], TASKS_DOCS.filters, (l) => `Priority ${l} the one after it.`));
    return { start: at(m[1]), items };
  }
  if ((m = /^status\.type (?:is (?:not )?)?(\w*)$/i.exec(text))) {
    const items = /^status\.type \w*$/i.test(text)
      ? simple(["is", "is not"], TASKS_DOCS.filters, () => "Then a status type.")
      : tasksStatusTypes();
    return { start: at(m[1]), items };
  }
  if (
    (m =
      /^(?:due|done|scheduled|starts|created|cancelled|happens) (?:on or before|on or after|in or before|in or after|before|after|on|in) (.*)$/i.exec(
        text,
      ))
  )
    return { start: at(m[1]), items: dateWords(localToday()) };
  if ((m = /^(?:due|done|scheduled|starts|created|cancelled|happens) ([\w ]*)$/i.exec(text)) && !/ date/i.test(text))
    return {
      start: at(m[1]),
      items: [...simple(DATE_OPS, TASKS_DOCS.filters, (o) => `Then a date or range ${o} which.`), ...dateWords(localToday())],
    };
  if ((m = /^tags? (?:include|includes|do not include|does not include) (\S*)$/i.exec(text))) {
    const v = await vaultVocab();
    return { start: at(m[1]), items: v.tags.map((t) => ({ label: t, info: "A tag in the vault.", docs: TASKS_DOCS.filters })) };
  }
  if ((m = /^(?:path|folder|root) (?:includes|does not include) (.*)$/i.exec(text))) {
    const v = await vaultVocab();
    return { start: at(m[1]), items: v.folders.map((f) => ({ label: f, info: "A folder in the vault.", docs: TASKS_DOCS.filters })) };
  }
  if ((m = /^filename (?:includes|does not include) (.*)$/i.exec(text))) {
    const v = await vaultVocab();
    return { start: at(m[1]), items: v.notes.map((f) => ({ label: f, info: "A note in the vault.", docs: TASKS_DOCS.filters })) };
  }
  // The start of an instruction: words only, so far.
  if (/^[\w. ]*$/.test(text) && (text.trim() || explicit)) return { start: base, items: tasksInstructions() };
  return null;
}

/** The DQL command clause the cursor is in, from the query text before it. */
function dqlClause(before: string): string {
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const m = /^\s*(FROM|WHERE|SORT|GROUP BY|FLATTEN|LIMIT)\b/i.exec(l);
    if (m) return m[1].toUpperCase();
    const head = /^\s*(TABLE|LIST|TASK|CALENDAR)\b/i.exec(l);
    if (head) {
      // FROM on the same line as the type: `LIST FROM #x`.
      const inline = /\b(FROM|WHERE|SORT|GROUP BY|FLATTEN|LIMIT)\b(?!.*\b(FROM|WHERE|SORT|GROUP BY|FLATTEN|LIMIT)\b)/i.exec(l);
      return inline ? inline[1].toUpperCase() : "HEAD";
    }
  }
  return "START";
}

function fieldItems(fields: string[], task: boolean): VocabItem[] {
  return [
    ...DV_FILE_FIELDS.map(([label, info]) => ({ label, info, docs: DATAVIEW_DOCS.pages })),
    ...(task ? DV_TASK_FIELDS.map(([label, info]) => ({ label, info, docs: DATAVIEW_DOCS.tasks })) : []),
    ...fields.map((label) => ({ label, info: "A field written in the vault's notes.", docs: DATAVIEW_DOCS.pages, boost: 1 })),
  ];
}

/** What to offer at a place in a dataview block. `before` is the block's text up to the cursor. */
export async function dataviewOptions(before: string, explicit: boolean): Promise<{ start: number; items: VocabItem[] } | null> {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const trimmed = line.trimStart();
  const clause = dqlClause(before);
  const isTask = /^\s*TASK\b/im.test(before);
  // The query type, on the first line with words.
  if (clause === "START") {
    if (/^[A-Za-z ]*$/.test(trimmed) && (trimmed || explicit)) return { start: before.length - trimmed.length, items: DV_TYPES };
    return null;
  }
  // A command (or an expression going on) at the start of a later line.
  if (/^[A-Za-z]*(?: [Bb][Yy]?)?$/.test(trimmed) && !/^\s*(TABLE|LIST|TASK|CALENDAR)\b/i.test(line)) {
    if (!trimmed && !explicit) return null;
    const items = [...DV_COMMANDS, ...(trimmed ? [...(await exprItems(isTask)), ...DV_EXPR_OPS] : [])];
    return { start: before.length - trimmed.length, items };
  }
  if (clause === "FROM") {
    let m: RegExpExecArray | null;
    const v = await vaultVocab();
    if ((m = /#([\p{L}\p{N}_/-]*)$/u.exec(before)))
      return {
        start: before.length - m[0].length,
        items: v.tags.map((t) => ({ label: t, info: "A tag in the vault.", docs: DATAVIEW_DOCS.sources })),
      };
    if ((m = /"([^"\n]*)$/.exec(before)))
      return {
        start: before.length - m[0].length,
        items: v.folders.map((f) => ({ label: `"${f}"`, info: "A folder in the vault.", docs: DATAVIEW_DOCS.sources })),
      };
    if ((m = /\[\[([^\]\n]*)$/.exec(before)))
      return {
        start: before.length - m[0].length,
        items: v.notes.map((n) => ({ label: `[[${n}]]`, info: "A note: pages linking to it.", docs: DATAVIEW_DOCS.sources })),
      };
    if ((m = /(?:^|\s)([\w-]*)$/.exec(before)) && (m[1] || explicit)) {
      const sources: VocabItem[] = [
        ...DV_SOURCE_OPS,
        ...v.tags.map((t) => ({ label: t, info: "A tag in the vault.", docs: DATAVIEW_DOCS.sources })),
        ...v.folders.map((f) => ({ label: `"${f}"`, info: "A folder in the vault.", docs: DATAVIEW_DOCS.sources })),
      ];
      return { start: before.length - m[1].length, items: [...sources, ...DV_COMMANDS] };
    }
    return null;
  }
  if (clause === "SORT") {
    const m = /\S\s+(\w*)$/.exec(line);
    if (m && !/^\s*SORT\s+\w*$/i.test(line) && !/[,(]\s*\w*$/.test(line))
      return { start: before.length - m[1].length, items: [...DV_SORT_DIRS, ...DV_COMMANDS] };
  }
  if (clause === "LIMIT") return null;
  // An expression: fields, functions, literals.
  const tok = /([\p{L}_][\p{L}\p{N}_.-]*|)$/u.exec(before)!;
  if (!tok[1] && !explicit) return null;
  // Inside a string: nothing.
  if ((line.split('"').length - 1) % 2 === 1) return null;
  const items = await exprItems(isTask);
  if (clause !== "HEAD" || !/^\s*(TABLE|LIST|TASK|CALENDAR)\s*$/i.test(line)) items.push(...DV_EXPR_OPS, ...DV_COMMANDS);
  return { start: before.length - tok[1].length, items };
}

async function exprItems(task: boolean): Promise<VocabItem[]> {
  const v = await vaultVocab();
  return [...fieldItems(v.fields, task), ...dvFunctions(), ...DV_LITERALS];
}

/** What to offer at a place in a dataviewjs block. */
export function dataviewjsOptions(before: string): { start: number; items: VocabItem[] } | null {
  let m: RegExpExecArray | null;
  if ((m = /\bdv\.(\w*)$/.exec(before)))
    return {
      start: before.length - m[1].length,
      items: DV_API.map(([label, sig, info]) => ({
        label,
        detail: sig,
        info,
        docs: DATAVIEW_DOCS.api,
        apply: sig.includes("(") && sig.startsWith("dv.") ? `${label}(` : label,
      })),
    };
  if ((m = /\)\s*\.(\w*)$/.exec(before)))
    return {
      start: before.length - m[1].length,
      items: DV_ARRAY.map(([label, sig, info]) => ({
        label,
        detail: sig,
        info,
        docs: DATAVIEW_DOCS.array,
        apply: sig.includes("(") ? `${label}(` : label,
      })),
    };
  return null;
}

/** The completion source for query blocks. */
export async function queryCompletions(ctx: CompletionContext): Promise<CompletionResult | null> {
  const fence = fenceAt(ctx.state, ctx.pos);
  if (!fence) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const lineBefore = line.text.slice(0, ctx.pos - line.from);
  const blockBefore = ctx.state.sliceDoc(fence.from, ctx.pos);
  const empty = !ctx.state.sliceDoc(fence.from, fence.to).trim();
  let r: { start: number; items: VocabItem[] } | null;
  let from: number;
  if (fence.lang === "tasks") {
    r = await tasksOptions(lineBefore, ctx.explicit);
    from = line.from + (r?.start ?? 0);
  } else if (fence.lang === "dataview") {
    r = await dataviewOptions(blockBefore, ctx.explicit);
    from = fence.from + (r?.start ?? 0);
  } else {
    r = dataviewjsOptions(blockBefore);
    from = fence.from + (r?.start ?? 0);
  }
  if (ctx.aborted) return null;
  const options: Completion[] = (r?.items ?? []).map((i) => opt(i));
  if (empty && fence.lang !== "dataviewjs") options.unshift(builderOption(fence.lang));
  if (!options.length) return null;
  return { from: r ? from : ctx.pos, options, validFor: /^[\w.#/" -]*$/ };
}

// ── The builder, opened on a block ───────────────────────────────────────────────────────────

/** Opens the query builder on the block at `pos` (its fence line or inside it), or to insert a new
 *  one at the caret. */
export function openBuilderAt(view: EditorView, pos: number, lang?: QueryLang, kind?: string) {
  const f = fenceAt(view.state, pos) ?? fenceOpenedAt(view.state, pos);
  if (f && f.lang !== "dataviewjs") {
    const text = view.state.sliceDoc(f.from, f.to);
    openQueryBuilder({
      lang: f.lang,
      text,
      apply: (q) => {
        const cur = queryFences(view.state).find((x) => x.open === f.open);
        if (!cur) return;
        view.dispatch({ changes: { from: cur.from, to: cur.to, insert: q }, userEvent: "input.query" });
        view.focus();
      },
    });
    return;
  }
  const at = view.state.selection.main.head;
  openQueryBuilder({
    lang: lang === "dataview" ? "dataview" : "tasks",
    kind,
    text: "",
    apply: (q, l) => {
      const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length));
      const pre = line.text.trim() ? "\n\n" : "";
      const from = line.text.trim() ? line.to : line.from;
      const insert = `${pre}\`\`\`${l}\n${q}\n\`\`\`\n`;
      view.dispatch({ changes: { from, to: line.to, insert }, userEvent: "input.query" });
      view.focus();
    },
  });
}

// ── ```tasks + Enter ─────────────────────────────────────────────────────────────────────────

/** On Enter at the end of a ```tasks / ```dataview line that opens a block nothing closes: close
 *  it, put the caret inside, and open the help. */
export function closeFenceOnEnter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  const m = /^(\s*)(`{3,})(tasks|dataview|dataviewjs)\s*$/i.exec(line.text);
  if (!m) return false;
  const f = fences(state).find((x) => x.open === line.number);
  if (!f || f.close !== null) return false;
  const indent = m[1];
  const insert = `\n${indent}\n${indent}${m[2]}`;
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + 1 + indent.length),
    userEvent: "input",
    scrollIntoView: true,
  });
  startCompletion(view);
  return true;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────────────────────

/** The lines an engine can't read, as underlines with its message. */
export function queryDiagnostics(state: EditorState): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const f of queryFences(state)) {
    if (f.lang === "dataviewjs" || f.close === null) continue;
    const text = state.sliceDoc(f.from, f.to);
    if (!text.trim()) continue;
    if (f.lang === "tasks") {
      // Line by line, so the underline goes under the one at fault.
      let pos = f.from;
      for (const l of text.split("\n")) {
        const t = l.trim();
        if (t && !t.startsWith("#") && !/\\$/.test(t) && !/\{\{query\./.test(t)) {
          // Only checked here, never run: a function line compiles without running.
          const q = parseTasks(t, { path: "", scripts: true });
          if (q.error)
            out.push({
              from: pos + (l.length - l.trimStart().length),
              to: pos + l.length,
              severity: "error",
              message: q.error.replace(/\nProblem line: .*$/s, ""),
            });
        }
        pos += l.length + 1;
      }
    } else {
      try {
        parseDql(text);
      } catch (e) {
        const p = (e as { pos?: number }).pos;
        const at = typeof p === "number" ? f.from + Math.min(p, text.length) : f.from;
        const lineEnd = state.doc.lineAt(Math.min(at, state.doc.length)).to;
        const msg = describeError(text, e).split("\n").pop() ?? String(e);
        out.push({
          from: Math.min(at, lineEnd),
          to: Math.max(Math.min(at + 1, lineEnd), Math.min(at, lineEnd)),
          severity: "error",
          message: msg,
        });
      }
    }
  }
  return out;
}

/** The query help as an editor extension (the completion source is added in cm.ts). */
export function queryAssist(): Extension {
  return [Prec.highest(keymap.of([{ key: "Enter", run: closeFenceOnEnter }])), linter((v) => queryDiagnostics(v.state), { delay: 400 })];
}
