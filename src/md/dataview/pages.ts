// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Dataview's pages, built from what Rust reads (src-tauri/src/dataview.rs): frontmatter and
// inline fields typed, the implicit `file.*` fields, incoming links, and every list item and task
// with its own fields (https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-pages/,
// metadata-tasks/). Kept between queries and brought up to date with what changed.

import { DateTime } from "luxon";
import { api, DvRawItem, DvRawLink, DvRawPage } from "../../api";
import { parseDayInName } from "./eval";
import { canonicalKey, DvObject, fromYaml, Link, parseFieldValue, parseIsoDate, Value } from "./values";

/** The raw line behind an item, for task edits (not a Dataview field). */
export const RAW = Symbol("raw");
export interface ItemRaw {
  path: string;
  title: string;
  item: DvRawItem;
}
export function rawOf(item: DvObject): ItemRaw | undefined {
  return (item as unknown as { [RAW]?: ItemRaw })[RAW];
}

export interface PageSet {
  pages: DvObject[];
  byPath: Map<string, DvObject>;
  /** Lower-cased file name (no folder, no .md) → path, for resolving link text. */
  byName: Map<string, string>;
}

const TASK_EMOJI: [RegExp, string][] = [
  [/(?:📅|🗓️?)\s*(\d{4}-\d{2}-\d{2})/u, "due"],
  [/✅\s*(\d{4}-\d{2}-\d{2})/u, "completion"],
  [/➕\s*(\d{4}-\d{2}-\d{2})/u, "created"],
  [/🛫\s*(\d{4}-\d{2}-\d{2})/u, "start"],
  [/⏳\s*(\d{4}-\d{2}-\d{2})/u, "scheduled"],
];

/** Keys whose value is a list made by repeating the field (not a list value). */
const merged = new WeakMap<DvObject, Set<string>>();

/** Adds a field under its own key and Dataview's canonical one; a repeated key becomes a list. */
function addField(o: DvObject, key: string, v: Value) {
  for (const k of new Set([key, canonicalKey(key)])) {
    if (!k || k === "file") continue;
    if (!(k in o)) {
      o[k] = v;
      continue;
    }
    const m = merged.get(o) ?? new Set<string>();
    merged.set(o, m);
    o[k] = m.has(k) ? [...(o[k] as Value[]), v] : [o[k], v];
    m.add(k);
  }
}

/** `#a/b` is also `#a`, as `file.tags` breaks tags down. */
function breakDown(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const parts = t.replace(/^#/, "").split("/");
    for (let i = 1; i <= parts.length; i++) {
      const x = `#${parts.slice(0, i).join("/")}`;
      if (!out.includes(x)) out.push(x);
    }
  }
  return out;
}

const stem = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/i, "");

export function linkOf(l: DvRawLink): Link {
  return new Link(l.path ?? l.target, l.display ?? undefined, l.subpath ?? undefined, l.embed);
}

/** Builds the pages from raw ones. `resolve` maps link text written in a field to a path. */
export function buildPages(raw: DvRawPage[]): PageSet {
  const byName = new Map<string, string>();
  for (const p of raw) {
    const k = stem(p.path).toLowerCase();
    // The shortest path wins, as link resolution does.
    const cur = byName.get(k);
    if (!cur || p.path.length < cur.length) byName.set(k, p.path);
    for (const a of p.aliases) if (!byName.has(a.toLowerCase())) byName.set(a.toLowerCase(), p.path);
  }
  const paths = new Set(raw.map((p) => p.path));
  const resolve = (t: string) => {
    if (!t) return null;
    const base = t.replace(/\.md$/i, "");
    if (paths.has(`${base}.md`)) return `${base}.md`;
    return byName.get(stem(base).toLowerCase()) ?? null;
  };
  const inlinks = new Map<string, Link[]>();
  for (const p of raw)
    for (const l of p.links)
      if (l.path && l.path !== p.path) {
        const list = inlinks.get(l.path) ?? [];
        if (!list.some((x) => x.path === p.path)) list.push(new Link(p.path));
        inlinks.set(l.path, list);
      }

  const pages: DvObject[] = [];
  const byPath = new Map<string, DvObject>();
  for (const p of raw) {
    const page: DvObject = {};
    for (const [k, v] of Object.entries(p.frontmatter ?? {})) addField(page, k, fromYaml(v, resolve));
    for (const [k, v] of p.fields) addField(page, k, parseFieldValue(v, resolve));

    const items = new Map<number, DvObject>();
    const lists: DvObject[] = [];
    for (const it of p.lists) {
      const o: DvObject = {};
      const rank = /\^rank-(\d+)\s*$/.exec(it.text);
      const section = it.section ? new Link(p.path, undefined, it.section) : new Link(p.path);
      Object.assign(o, {
        text: it.text.replace(/\s*\^rank-\d+\s*$/, ""),
        line: it.line,
        lineCount: it.lineCount,
        path: p.path,
        section,
        header: section,
        link: it.blockId && !rank ? new Link(p.path, undefined, `^${it.blockId}`) : section,
        tags: it.tags,
        outlinks: it.links.map(linkOf),
        children: [],
        task: it.status !== null,
        annotated: it.fields.length > 0,
        parent: it.parent,
        blockId: it.blockId && !rank ? it.blockId : null,
        symbol: /^\s*>?\s*(\S+)/.exec(it.lineText)?.[1] ?? "-",
        // Brainstead and the previous app order tasks by hand with ^rank-N.
        rank: rank ? +rank[1] : null,
      });
      if (it.status !== null) {
        const done = it.status === "x" || it.status === "X";
        Object.assign(o, { status: it.status, checked: it.status !== " ", completed: done, fullyCompleted: done });
        for (const [re, k] of TASK_EMOJI) {
          const m = re.exec(it.text);
          if (m) o[k] = parseIsoDate(m[1]);
        }
      }
      for (const [k, v] of it.fields) addField(o, k, parseFieldValue(v, resolve));
      if (o.completion === undefined && it.status !== null) o.completion = null;
      Object.defineProperty(o, RAW, { value: { path: p.path, title: p.title, item: it }, enumerable: false });
      items.set(it.line, o);
      lists.push(o);
    }
    for (const o of lists) {
      const parent = o.parent === null ? undefined : items.get(o.parent as number);
      if (parent) (parent.children as DvObject[]).push(o);
    }
    // A task is fully completed when it and every sub-task are.
    const full = (o: DvObject): boolean =>
      (!o.task || (o.completed as boolean)) && (o.children as DvObject[]).every((c) => full(c) || !c.task);
    for (const o of lists) if (o.task) o.fullyCompleted = full(o);

    const ctime = DateTime.fromMillis(p.ctime);
    const mtime = DateTime.fromMillis(p.mtime);
    const dayField = page.date;
    const day = p.day ? parseIsoDate(p.day) : DateTime.isDateTime(dayField) ? dayField : parseDayInName(stem(p.path));
    const folder = p.path.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/")) : "";
    const out: Link[] = [];
    const seen = new Set<string>();
    for (const l of p.links) {
      const k = `${l.path ?? l.target}#${l.subpath ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(linkOf(l));
    }
    page.file = {
      name: stem(p.path),
      folder,
      path: p.path,
      ext: (p.path.split(".").pop() ?? "md").toLowerCase(),
      link: new Link(p.path),
      size: p.size,
      ctime,
      cday: ctime.startOf("day"),
      mtime,
      mday: mtime.startOf("day"),
      tags: breakDown(p.etags),
      etags: p.etags,
      inlinks: inlinks.get(p.path) ?? [],
      outlinks: out,
      aliases: p.aliases,
      tasks: lists.filter((o) => o.task),
      lists,
      frontmatter: Object.fromEntries(Object.entries(p.frontmatter ?? {}).map(([k, v]) => [k, fromYaml(v, resolve)])),
      day: day ?? null,
      starred: false,
    };
    pages.push(page);
    byPath.set(p.path, page);
  }
  return { pages, byPath, byName };
}

// ── The store: kept between queries, brought up to date by what changed ──────────────────────

let gen = 0;
let raw = new Map<string, DvRawPage>();
let built: PageSet | null = null;
let pending: Promise<PageSet> | null = null;
let builtAt = -1;
let pendingAt = -1;

/** The pages as they are now. `version` is the vault's change counter: a new one asks Rust for
 *  what changed. */
export function loadPages(version: number): Promise<PageSet> {
  if (built && builtAt === version) return Promise.resolve(built);
  // A load for an older version is under way: let it finish, then catch up with this one.
  if (pending) return pendingAt === version ? pending : pending.catch(() => null).then(() => loadPages(version));
  pendingAt = version;
  pending = api
    .dataviewPages(gen)
    .then((d) => {
      const all = new Set(d.all);
      for (const p of d.changed) raw.set(p.path, p);
      for (const k of [...raw.keys()]) if (!all.has(k)) raw.delete(k);
      if (d.gen < gen) raw = new Map(d.changed.map((p) => [p.path, p]));
      gen = d.gen;
      built = buildPages(d.all.map((p) => raw.get(p)).filter((p): p is DvRawPage => !!p));
      builtAt = version;
      return built;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
