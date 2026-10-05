// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Running a DQL query: pages from the FROM source, then each data command in the order written
// (WHERE, SORT, GROUP BY, FLATTEN, LIMIT), then the query type's view: a table, a list, tasks or a
// calendar (https://blacksmithgu.github.io/obsidian-dataview/queries/data-commands/).

import { DateTime } from "luxon";
import { Context, evaluate } from "./eval";
import { PageSet } from "./pages";
import { linkParts, parseQuery, Query, Source } from "./parse";
import { compare, DvObject, Link, truthy, Value } from "./values";

/** One row: what it is (a page's link, a group's key) and its fields. */
export interface Row {
  id: Value;
  data: DvObject;
}

export type Result =
  | { type: "table"; idName: string | null; headers: string[]; rows: { id: Value; values: Value[] }[] }
  | { type: "list"; withoutId: boolean; items: { id: Value; value?: Value; children?: Value[] }[] }
  | { type: "task"; groups: { key: Value | undefined; tasks: DvObject[] }[] }
  | { type: "calendar"; entries: { date: DateTime; link: Value; value: Value }[] };

export function makeContext(set: PageSet, selfPath: string | null): Omit<Context, "row"> {
  const resolve = (t: string): string | null => {
    if (!t) return selfPath;
    const base = t.replace(/\.md$/i, "");
    if (set.byPath.has(`${base}.md`)) return `${base}.md`;
    return set.byName.get((base.split("/").pop() ?? base).toLowerCase()) ?? null;
  };
  return {
    self: selfPath ? (set.byPath.get(selfPath) ?? null) : null,
    page: (p) => set.byPath.get(p) ?? set.byPath.get(`${p}.md`) ?? null,
    resolve,
  };
}

const fileOf = (p: DvObject) => p.file as DvObject;

/** The pages a source names. */
export function sourcePages(src: Source, set: PageSet, ctx: Omit<Context, "row">): DvObject[] {
  const all = set.pages;
  const paths = (s: Source): Set<string> => {
    switch (s.t) {
      case "all":
        return new Set(all.map((p) => fileOf(p).path as string));
      case "tag": {
        const t = s.tag.toLowerCase();
        return new Set(
          all.filter((p) => (fileOf(p).tags as string[]).some((x) => x.toLowerCase() === t)).map((p) => fileOf(p).path as string),
        );
      }
      case "folder": {
        const f = s.folder.replace(/^\/+|\/+$/g, "");
        if (!f) return paths({ t: "all" });
        return new Set(all.map((p) => fileOf(p).path as string).filter((p) => p.startsWith(`${f}/`) || p === `${f}.md` || p === f));
      }
      case "link": {
        const parts = linkParts(s.text);
        const target = parts.target ? ctx.resolve(parts.target) : ((ctx.self && (fileOf(ctx.self).path as string)) ?? null);
        if (!target) return new Set();
        if (s.outgoing) {
          const page = set.byPath.get(target);
          return new Set(page ? (fileOf(page).outlinks as Link[]).map((l) => l.path).filter((p) => set.byPath.has(p)) : []);
        }
        return new Set(
          all.filter((p) => (fileOf(p).outlinks as Link[]).some((l) => l.path === target)).map((p) => fileOf(p).path as string),
        );
      }
      case "and": {
        const a = paths(s.l);
        const b = paths(s.r);
        return new Set([...a].filter((x) => b.has(x)));
      }
      case "or":
        return new Set([...paths(s.l), ...paths(s.r)]);
      case "not": {
        const n = paths(s.s);
        return new Set(all.map((p) => fileOf(p).path as string).filter((p) => !n.has(p)));
      }
    }
  };
  const keep = paths(src);
  return all.filter((p) => keep.has(fileOf(p).path as string));
}

/** A task's fields over its page's, as Dataview gives TASK queries. */
function taskRow(task: DvObject, page: DvObject): DvObject {
  const o = Object.create(null) as DvObject;
  Object.assign(o, page, task);
  return Object.defineProperties(o, Object.getOwnPropertyDescriptors(task));
}

/** Sets `name` (a dotted path like file.tags when unnamed) to `v`. */
function setPath(o: DvObject, name: string, v: Value): DvObject {
  const parts = /^[\p{L}_][\p{L}\p{N}_-]*(\.[\p{L}_][\p{L}\p{N}_-]*)*$/u.test(name) ? name.split(".") : [name];
  const out: DvObject = Object.assign(Object.create(Object.getPrototypeOf(o) ?? null), o);
  Object.defineProperties(out, Object.getOwnPropertyDescriptors(o));
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = { ...((cur[parts[i]] as DvObject) ?? {}) };
    cur[parts[i]] = next;
    cur = next;
  }
  cur[parts[parts.length - 1]] = v;
  return out;
}

export function execute(q: Query | string, set: PageSet, selfPath: string | null): Result {
  const query = typeof q === "string" ? parseQuery(q) : q;
  const base = makeContext(set, selfPath);
  const pages = sourcePages(query.from, set, base);
  let rows: Row[] =
    query.type === "task"
      ? pages.flatMap((p) => (fileOf(p).tasks as DvObject[]).map((t) => ({ id: t.link as Value, data: taskRow(t, p) })))
      : pages.map((p) => ({ id: fileOf(p).link as Value, data: p }));
  let grouped = false;
  let groupName = "key";
  const ev = (e: Parameters<typeof evaluate>[0], row: DvObject) => evaluate(e, { ...base, row });

  for (const op of query.ops) {
    switch (op.t) {
      case "where":
        rows = rows.filter((r) => truthy(ev(op.expr, r.data)));
        break;
      case "sort": {
        const keyed = rows.map((r, i) => ({ r, i, k: op.keys.map((k) => ev(k.expr, r.data)) }));
        keyed.sort((a, b) => {
          for (let j = 0; j < op.keys.length; j++) {
            const c = compare(a.k[j], b.k[j]);
            if (c) return op.keys[j].desc ? -c : c;
          }
          return a.i - b.i;
        });
        rows = keyed.map((x) => x.r);
        break;
      }
      case "group": {
        const groups: { key: Value; rows: Row[] }[] = [];
        for (const r of rows) {
          const k = ev(op.expr, r.data);
          const g = groups.find((x) => compare(x.key, k) === 0);
          if (g) g.rows.push(r);
          else groups.push({ key: k, rows: [r] });
        }
        groups.sort((a, b) => compare(a.key, b.key));
        rows = groups.map((g) => ({ id: g.key, data: { [op.name]: g.key, rows: g.rows.map((r) => r.data) } }));
        grouped = true;
        groupName = op.name;
        break;
      }
      case "flatten": {
        const out: Row[] = [];
        for (const r of rows) {
          const v = ev(op.expr, r.data);
          for (const x of Array.isArray(v) ? (v.length ? v : [null]) : [v]) out.push({ id: r.id, data: setPath(r.data, op.name, x) });
        }
        rows = out;
        break;
      }
      case "limit":
        rows = rows.slice(0, op.n);
        break;
    }
  }

  switch (query.type) {
    case "table":
      return {
        type: "table",
        idName: query.withoutId ? null : grouped ? groupName : "File",
        headers: query.fields.map((f) => f.name),
        rows: rows.map((r) => ({ id: r.id, values: query.fields.map((f) => ev(f.expr, r.data)) })),
      };
    case "list":
      return {
        type: "list",
        withoutId: query.withoutId,
        items: rows.map((r) => {
          const value = query.fields[0] ? ev(query.fields[0].expr, r.data) : undefined;
          // A group without an expression lists its rows.
          const children =
            grouped && !query.fields[0] ? (r.data.rows as DvObject[]).map((x) => (x.file ? fileOf(x).link : x.link) ?? null) : undefined;
          return { id: r.id, value, children };
        }),
      };
    case "task":
      return grouped
        ? { type: "task", groups: rows.map((r) => ({ key: r.id, tasks: r.data.rows as DvObject[] })) }
        : { type: "task", groups: [{ key: undefined, tasks: rows.map((r) => r.data) }] };
    case "calendar": {
      const entries: { date: DateTime; link: Value; value: Value }[] = [];
      for (const r of rows) {
        const d = ev(query.fields[0].expr, r.data);
        if (DateTime.isDateTime(d)) entries.push({ date: d, link: r.id, value: d });
      }
      return { type: "calendar", entries };
    }
  }
}
