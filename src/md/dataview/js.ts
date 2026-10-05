// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// DataviewJS (```dataviewjs and inline `$= …`): the script runs in the window, as templates do
// (the vault owner's own code, decided 2026-10-02), with Dataview's `dv` API
// (https://blacksmithgu.github.io/obsidian-dataview/api/code-reference/): pages and DataArrays,
// links, dates, the function library, DQL from code, reading vault files, and rendering into the
// block. There's no `app`: anything that needs the other app's internals isn't available.

import * as luxon from "luxon";
import { DateTime, Duration } from "luxon";
import { api } from "../../api";
import { Context, evaluate, FUNCTIONS } from "./eval";
import { PageSet } from "./pages";
import { dateKeyword, describeError, parseExpr, parseSource } from "./parse";
import { execute, makeContext, Result, sourcePages } from "./query";
import { compare, DvObject, equals, Link, parseDuration, parseFieldValue, toText, typeOf, Value } from "./values";

const TARGET = Symbol("target");

/** Wraps a value for scripts: lists become DataArrays, objects let their lists be DataArrays. */
export function toJs(v: unknown): unknown {
  if (Array.isArray(v)) return dataArray(v);
  if (v && typeof v === "object" && typeOf(v as Value) === "object" && !(TARGET in (v as object))) {
    return new Proxy(v as object, {
      get(t, p) {
        if (p === TARGET) return t;
        return toJs(Reflect.get(t, p));
      },
      has: (t, p) => p === TARGET || Reflect.has(t, p),
    });
  }
  return v;
}

/** Back from what a script hands over: DataArrays as lists, wrapped objects as themselves. */
export function fromJs(v: unknown): Value {
  if (v === undefined) return null;
  if (v && typeof v === "object" && "dvArray" in (v as object)) return ((v as DataArray<unknown>).array() as unknown[]).map(fromJs);
  if (Array.isArray(v)) return v.map(fromJs);
  if (v && typeof v === "object" && TARGET in (v as object)) return (v as { [TARGET]: DvObject })[TARGET];
  return v as Value;
}

export interface DataArray<T> {
  readonly dvArray: true;
  readonly length: number;
  readonly values: T[];
  [index: number]: T;
  [field: string]: unknown;
  where(p: (x: T, i: number) => unknown): DataArray<T>;
  filter(p: (x: T, i: number) => unknown): DataArray<T>;
  map<U>(f: (x: T, i: number) => U): DataArray<U>;
  flatMap<U>(f: (x: T, i: number) => U[] | DataArray<U>): DataArray<U>;
  mutate(f: (x: T, i: number) => unknown): DataArray<T>;
  limit(n: number): DataArray<T>;
  slice(a?: number, b?: number): DataArray<T>;
  concat(o: Iterable<T>): DataArray<T>;
  indexOf(x: T, from?: number): number;
  find(p: (x: T, i: number) => unknown): T | undefined;
  findIndex(p: (x: T, i: number) => unknown): number;
  includes(x: T): boolean;
  join(sep?: string): string;
  sort(key?: (x: T) => unknown, dir?: "asc" | "desc", cmp?: (a: unknown, b: unknown) => number): DataArray<T>;
  groupBy(key: (x: T) => unknown, cmp?: (a: unknown, b: unknown) => number): DataArray<{ key: unknown; rows: DataArray<T> }>;
  groupIn(key: (x: unknown) => unknown): DataArray<unknown>;
  distinct(key?: (x: T) => unknown): DataArray<T>;
  every(p: (x: T) => unknown): boolean;
  some(p: (x: T) => unknown): boolean;
  none(p: (x: T) => unknown): boolean;
  first(): T | undefined;
  last(): T | undefined;
  to(key: string): DataArray<unknown>;
  into(key: string): DataArray<unknown>;
  expand(key: string): DataArray<unknown>;
  forEach(f: (x: T, i: number) => void): void;
  array(): T[];
  [Symbol.iterator](): Iterator<T>;
}

const field = (x: unknown, k: string): unknown => {
  if (x === null || x === undefined) return undefined;
  const raw = TARGET in (x as object) ? (x as { [TARGET]: DvObject })[TARGET] : x;
  if (raw instanceof Link) return undefined;
  return (raw as Record<string, unknown>)[k];
};

/** Dataview's DataArray: a list with query helpers; `arr.field` reads the field from each element,
 *  flattening lists ("swizzling"). */
export function dataArray<T>(input: Iterable<T>): DataArray<T> {
  const values = [...input].map((x) => (x && typeof x === "object" && "dvArray" in (x as object) ? x : x)) as T[];
  const wrap = <U>(xs: U[]) => dataArray(xs);
  const el = (x: T) => toJs(x) as T;
  const cmpKeys = (cmp?: (a: unknown, b: unknown) => number) => cmp ?? ((a: unknown, b: unknown) => compare(fromJs(a), fromJs(b)));
  const flatTo = (key: string, deep: boolean) => {
    const out: unknown[] = [];
    for (const v of values) {
      const f = field(v, key);
      if (Array.isArray(f) || (f && typeof f === "object" && "dvArray" in (f as object)))
        out.push(...(Array.isArray(f) ? f : (f as DataArray<unknown>).array()));
      else if (f !== undefined || deep) out.push(f);
    }
    return dataArray(out);
  };
  const methods = {
    dvArray: true as const,
    get length() {
      return values.length;
    },
    get values() {
      return values.map(el);
    },
    where: (p: (x: T, i: number) => unknown) => wrap(values.filter((x, i) => p(el(x), i))),
    filter: (p: (x: T, i: number) => unknown) => wrap(values.filter((x, i) => p(el(x), i))),
    map: <U>(f: (x: T, i: number) => U) => wrap(values.map((x, i) => f(el(x), i))),
    flatMap: <U>(f: (x: T, i: number) => U[] | DataArray<U>) =>
      wrap(
        values.flatMap((x, i) => {
          const r = f(el(x), i);
          return r && typeof r === "object" && "dvArray" in (r as object) ? (r as DataArray<U>).array() : (r as U[]);
        }),
      ),
    mutate: (f: (x: T, i: number) => unknown) => {
      values.forEach((x, i) => f(el(x), i));
      return proxy;
    },
    limit: (n: number) => wrap(values.slice(0, n)),
    slice: (a?: number, b?: number) => wrap(values.slice(a, b)),
    concat: (o: Iterable<T>) =>
      wrap([...values, ...(o && typeof o === "object" && "dvArray" in (o as object) ? (o as DataArray<T>).array() : [...o])]),
    indexOf: (x: T, from?: number) => values.findIndex((v, i) => i >= (from ?? 0) && equals(fromJs(v), fromJs(x))),
    find: (p: (x: T, i: number) => unknown) => {
      const i = values.findIndex((x, j) => p(el(x), j));
      return i < 0 ? undefined : el(values[i]);
    },
    findIndex: (p: (x: T, i: number) => unknown) => values.findIndex((x, i) => p(el(x), i)),
    includes: (x: T) => values.some((v) => equals(fromJs(v), fromJs(x))),
    join: (sep?: string) => values.map((v) => toText(fromJs(v), true)).join(sep ?? ", "),
    sort: (key?: (x: T) => unknown, dir?: "asc" | "desc", cmp?: (a: unknown, b: unknown) => number) => {
      const k = key ?? ((x: T) => x);
      const c = cmpKeys(cmp);
      const keyed = values.map((v, i) => ({ v, i, k: k(el(v)) }));
      keyed.sort((a, b) => (dir === "desc" ? -1 : 1) * c(a.k, b.k) || a.i - b.i);
      return wrap(keyed.map((x) => x.v));
    },
    groupBy: (key: (x: T) => unknown, cmp?: (a: unknown, b: unknown) => number) => {
      const c = cmpKeys(cmp);
      const groups: { key: unknown; rows: T[] }[] = [];
      for (const v of values) {
        const k = key(el(v));
        const g = groups.find((x) => c(x.key, k) === 0);
        if (g) g.rows.push(v);
        else groups.push({ key: k, rows: [v] });
      }
      groups.sort((a, b) => c(a.key, b.key));
      return wrap(groups.map((g) => ({ key: g.key, rows: dataArray(g.rows) })));
    },
    groupIn: (key: (x: unknown) => unknown) =>
      wrap(
        values.map((g) => {
          const rows = field(g, "rows");
          return rows && typeof rows === "object" && "dvArray" in (rows as object)
            ? { key: field(g, "key"), rows: (rows as DataArray<unknown>).groupBy(key) }
            : g;
        }),
      ),
    distinct: (key?: (x: T) => unknown) => {
      const out: T[] = [];
      const seen: unknown[] = [];
      for (const v of values) {
        const k = key ? key(el(v)) : v;
        if (!seen.some((s) => equals(fromJs(s), fromJs(k)))) {
          seen.push(k);
          out.push(v);
        }
      }
      return wrap(out);
    },
    every: (p: (x: T) => unknown) => values.every((x) => p(el(x))),
    some: (p: (x: T) => unknown) => values.some((x) => p(el(x))),
    none: (p: (x: T) => unknown) => !values.some((x) => p(el(x))),
    first: () => (values.length ? el(values[0]) : undefined),
    last: () => (values.length ? el(values[values.length - 1]) : undefined),
    to: (key: string) => flatTo(key, false),
    into: (key: string) => flatTo(key, false),
    expand: (key: string) => {
      const out: unknown[] = [];
      const walk = (v: unknown) => {
        out.push(v);
        const kids = field(v, key);
        for (const k of Array.isArray(kids) ? kids : []) walk(k);
      };
      values.forEach(walk);
      return dataArray(out);
    },
    forEach: (f: (x: T, i: number) => void) => values.forEach((x, i) => f(el(x), i)),
    array: () => [...values],
    toString: () => values.map((v) => toText(fromJs(v), true)).join(", "),
    [Symbol.iterator]: function* () {
      for (const v of values) yield el(v);
    },
  };
  const proxy: DataArray<T> = new Proxy(methods as unknown as DataArray<T>, {
    get(t, p, r) {
      if (typeof p === "symbol" || p in t) return Reflect.get(t, p, r);
      if (/^-?\d+$/.test(p)) {
        const i = +p;
        const v = values[i < 0 ? values.length + i : i];
        return v === undefined ? undefined : el(v);
      }
      return flatTo(p, true);
    },
    has: (t, p) => p in t || (typeof p === "string" && /^\d+$/.test(p) && +p < values.length),
  });
  return proxy;
}

/** A tiny CSV reader for dv.io.csv: a header row, quoted fields, values typed as fields are. */
export function parseCsv(text: string): Record<string, Value>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), parseFieldValue(r[i] ?? "", () => null)])));
}

/** What the renderer does with what a script asks to show. */
export interface Renderer {
  value(el: HTMLElement, v: Value): void;
  result(el: HTMLElement, r: Result): void;
  tasks(el: HTMLElement, tasks: DvObject[], groupByFile: boolean): void;
  error(el: HTMLElement, msg: string): void;
}

export interface DvEnv {
  set: PageSet;
  selfPath: string | null;
  container: HTMLElement;
  render: Renderer;
}

/** The `dv` object a script gets. */
export function makeDv(env: DvEnv) {
  const base = makeContext(env.set, env.selfPath);
  const ctx = (row: DvObject = env.set.byPath.get(env.selfPath ?? "") ?? {}): Context => ({ ...base, row });
  const pagePath = (p: unknown): string | null => {
    const raw = fromJs(p);
    if (raw instanceof Link) return raw.path;
    if (typeof raw !== "string") return null;
    if (env.set.byPath.has(raw)) return raw;
    if (env.set.byPath.has(`${raw}.md`)) return `${raw}.md`;
    return base.resolve(raw.replace(/^\[\[|\]\]$/g, ""));
  };
  const el = (
    tag: string,
    text: unknown,
    opts: { cls?: string | string[]; attr?: Record<string, string>; container?: HTMLElement } = {},
  ) => {
    const e = document.createElement(tag);
    if (opts.cls) e.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
    for (const [k, v] of Object.entries(opts.attr ?? {})) e.setAttribute(k, v);
    (opts.container ?? env.container).append(e);
    if (text !== undefined && text !== null) {
      const v = fromJs(text);
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") env.render.value(e, String(v));
      else env.render.value(e, v);
    }
    return e;
  };
  const func: Record<string, (...a: unknown[]) => unknown> = {};
  for (const [name, f] of Object.entries(FUNCTIONS)) func[name] = (...a: unknown[]) => toJs(f(ctx(), ...a.map(fromJs)));
  const toDate = (v: unknown): DateTime | null => {
    const r = fromJs(v);
    if (DateTime.isDateTime(r)) return r;
    if (r instanceof Link) return (func.date(r) as DateTime) ?? null;
    return typeof r === "string" ? dateKeyword(r) : null;
  };
  const queryValue = (r: Result) => {
    switch (r.type) {
      case "table":
        return {
          type: "table",
          headers: [...(r.idName ? [r.idName] : []), ...r.headers],
          values: r.rows.map((x) => [...(r.idName ? [x.id] : []), ...x.values]),
        };
      case "list":
        return { type: "list", values: r.items.map((x) => (r.withoutId ? (x.value ?? x.id) : (x.value ?? x.id))) };
      case "task":
        return { type: "task", values: r.groups.flatMap((g) => g.tasks) };
      case "calendar":
        return { type: "calendar", values: r.entries };
    }
  };
  const io = {
    load: async (path: unknown) => {
      const p = typeof path === "string" ? path : pagePath(path);
      return p ? ((await api.dataviewRead(p)) ?? undefined) : undefined;
    },
    csv: async (path: unknown) => {
      const t = await io.load(path);
      return t === undefined ? undefined : dataArray(parseCsv(t));
    },
    normalize: (path: string) => pagePath(path) ?? path,
  };
  const dv = {
    container: env.container,
    luxon,
    func,
    io,
    current: () => toJs(env.set.byPath.get(env.selfPath ?? "") ?? null),
    page: (p: unknown) => {
      const path = pagePath(p);
      const pg = path ? env.set.byPath.get(path) : undefined;
      return pg ? toJs(pg) : undefined;
    },
    pages: (source?: string) => dataArray(sourcePages(parseSource(source ?? ""), env.set, base)).map((p) => p),
    pagePaths: (source?: string) =>
      dataArray(sourcePages(parseSource(source ?? ""), env.set, base).map((p) => (p.file as DvObject).path as string)),
    array: (v: unknown) => (v && typeof v === "object" && "dvArray" in (v as object) ? v : dataArray(Array.isArray(v) ? v : [v])),
    isArray: (v: unknown) => Array.isArray(v) || !!(v && typeof v === "object" && "dvArray" in (v as object)),
    fileLink: (path: string, embed = false, display?: string) => new Link(pagePath(path) ?? path, display, undefined, embed),
    sectionLink: (path: string, section: string, embed = false, display?: string) =>
      new Link(pagePath(path) ?? path, display, section, embed),
    blockLink: (path: string, block: string, embed = false, display?: string) =>
      new Link(pagePath(path) ?? path, display, `^${block}`, embed),
    date: (v: unknown) => toDate(v),
    duration: (v: unknown) => {
      const r = fromJs(v);
      return Duration.isDuration(r) ? r : typeof r === "string" ? parseDuration(r) : null;
    },
    compare: (a: unknown, b: unknown) => compare(fromJs(a), fromJs(b)),
    equal: (a: unknown, b: unknown) => equals(fromJs(a), fromJs(b)),
    clone: <V>(v: V): V => structuredCloneValue(v),
    parse: (text: string) => parseFieldValue(text, base.resolve),
    evaluate: (expr: string, row?: object) => {
      try {
        return { successful: true, value: toJs(evaluate(parseExpr(expr), ctx(row ? (fromJs(row) as DvObject) : undefined))) };
      } catch (e) {
        return { successful: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    tryEvaluate: (expr: string, row?: object) => toJs(evaluate(parseExpr(expr), ctx(row ? (fromJs(row) as DvObject) : undefined))),
    query: async (q: string, file?: string) => {
      try {
        return { successful: true, value: queryValue(execute(q, env.set, file ?? env.selfPath)) };
      } catch (e) {
        return { successful: false, error: describeError(q, e) };
      }
    },
    tryQuery: async (q: string, file?: string) => queryValue(execute(q, env.set, file ?? env.selfPath)),
    queryMarkdown: async (q: string, file?: string) => {
      try {
        return { successful: true, value: resultMarkdown(execute(q, env.set, file ?? env.selfPath)) };
      } catch (e) {
        return { successful: false, error: describeError(q, e) };
      }
    },
    tryQueryMarkdown: async (q: string, file?: string) => resultMarkdown(execute(q, env.set, file ?? env.selfPath)),

    // Rendering into the block.
    el,
    header: (level: number, text: unknown, opts?: object) => el(`h${Math.min(6, Math.max(1, level))}`, text, opts),
    paragraph: (text: unknown, opts?: object) => el("p", text, opts),
    span: (text: unknown, opts?: object) => el("span", text, opts),
    list: (items: unknown) => {
      const ul = el("ul", undefined, { cls: "dvlist" });
      for (const x of fromJs(items) as Value[]) env.render.value(ul.appendChild(document.createElement("li")), x);
      return ul;
    },
    table: (headers: unknown, rows: unknown) => {
      const t = el("table", undefined, { cls: "dvtable" }) as HTMLTableElement;
      const hs = fromJs(headers) as Value[];
      const head = t.createTHead().insertRow();
      for (const h of hs) env.render.value(head.appendChild(document.createElement("th")), h);
      const body = t.createTBody();
      for (const r of fromJs(rows) as Value[][]) {
        const tr = body.insertRow();
        for (const c of Array.isArray(r) ? r : [r]) env.render.value(tr.insertCell(), c);
      }
      return t;
    },
    taskList: (tasks: unknown, groupByFile = true) => {
      const box = el("div", undefined);
      env.render.tasks(
        box,
        (fromJs(tasks) as DvObject[]).filter((t) => t && typeof t === "object"),
        groupByFile,
      );
      return box;
    },
    execute: (q: string) => {
      const box = el("div", undefined);
      try {
        env.render.result(box, execute(q, env.set, env.selfPath));
      } catch (e) {
        env.render.error(box, describeError(q, e));
      }
      return box;
    },
    executeJs: async (code: string) => runScript(code, { ...env, container: el("div", undefined) }, null),
    view: async (path: string, input?: unknown) => {
      const p = path.replace(/^\/+/, "");
      const js = (await api.dataviewRead(`${p}.js`)) ?? (await api.dataviewRead(`${p}/view.js`));
      if (js === null) throw new Error(`Dataview: custom view not found for '${p}/view.js' or '${p}.js'.`);
      const css = await api.dataviewRead(`${p}/view.css`);
      if (css) {
        const style = document.createElement("style");
        style.textContent = css;
        env.container.append(style);
      }
      return runScript(js, env, input);
    },
    markdownTable: (headers: unknown, rows: unknown) =>
      mdTable(
        (fromJs(headers) as Value[]).map((h) => toText(h, true)),
        (fromJs(rows) as Value[][]).map((r) => r.map((c) => toText(c, true))),
      ),
    markdownList: (items: unknown) => (fromJs(items) as Value[]).map((x) => `- ${toText(x, true)}`).join("\n"),
    markdownTaskList: (tasks: unknown) =>
      (fromJs(tasks) as DvObject[]).map((t) => `- [${(t.status as string) ?? " "}] ${t.text}`).join("\n"),
  };
  return dv;
}

function structuredCloneValue<V>(v: V): V {
  const raw = fromJs(v);
  const clone = (x: Value): Value => {
    if (Array.isArray(x)) return x.map(clone);
    if (x && typeOf(x) === "object") return Object.fromEntries(Object.entries(x as DvObject).map(([k, y]) => [k, clone(y)]));
    return x;
  };
  return toJs(clone(raw)) as V;
}

function mdTable(headers: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.map(esc).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

/** A result as markdown (dv.queryMarkdown). */
export function resultMarkdown(r: Result): string {
  switch (r.type) {
    case "table":
      return mdTable(
        [...(r.idName ? [r.idName] : []), ...r.headers],
        r.rows.map((x) => [...(r.idName ? [x.id] : []), ...x.values].map((v) => toText(v, true))),
      );
    case "list":
      return r.items
        .map(
          (x) =>
            `- ${r.withoutId || x.value === undefined ? toText(x.value ?? x.id, true) : `${toText(x.id, true)}: ${toText(x.value, true)}`}`,
        )
        .join("\n");
    case "task":
      return r.groups
        .flatMap((g) => [
          ...(g.key !== undefined ? [`## ${toText(g.key, true)}`] : []),
          ...g.tasks.map((t) => `- [${(t.status as string) ?? " "}] ${t.text}`),
        ])
        .join("\n");
    case "calendar":
      return r.entries.map((e) => `- ${e.date.toISODate()}: ${toText(e.link, true)}`).join("\n");
  }
}

/** Runs a script with `dv` and `input`; the promise settles when it's done. Errors are drawn in
 *  the container as Dataview draws them. */
export async function runScript(code: string, env: DvEnv, input: unknown): Promise<void> {
  const dv = makeDv(env);
  try {
    const f = new Function("dv", "input", "luxon", "app", `return (async () => {\n${code}\n})();`) as (...a: unknown[]) => Promise<unknown>;
    await f(dv, input, luxon, noApp);
  } catch (e) {
    env.render.error(env.container, `Evaluation Error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}

/** Evaluates inline DataviewJS (`$= …`): its value, to be drawn in place. */
export async function runInline(expr: string, env: DvEnv): Promise<Value> {
  const dv = makeDv(env);
  const f = new Function("dv", "luxon", "app", `return (async () => (${expr}))();`) as (...a: unknown[]) => Promise<unknown>;
  return fromJs(await f(dv, luxon, noApp));
}

/** `app` isn't there: say so clearly when a script reaches for it. */
const noApp = new Proxy(
  {},
  {
    get(_t, p) {
      throw new Error(`app.${String(p)} isn't available in Brainstead: Dataview scripts here can use dv, input and luxon.`);
    },
  },
);
