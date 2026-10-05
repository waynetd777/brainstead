// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// `dataview` and `dataviewjs` blocks, and inline `= …` / `$= …` queries, drawn in a document:
// tables in the document's style, lists, task lists worked like the Tasks screen (tick, menu,
// drag when sorted by rank), a month calendar, group headings and counts; Dataview's errors; a
// link to Dataview's documentation. Answers follow the vault as it changes.

import { QueryDocsLink } from "./queryDocs";
import { SCRIPTS_OFF } from "./scripts";
import { DateTime } from "luxon";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import type { TaskRow } from "../api";
import { openDoc } from "../nav";
import { useVaultVersion } from "../state";
import { TaskList } from "../TaskList";
import { DvLink, DvValue } from "./dataview/DvText";
import { runInline, runScript, Renderer } from "./dataview/js";
import { loadPages, PageSet, rawOf } from "./dataview/pages";
import { describeError, parseExpr, parseQuery, Query } from "./dataview/parse";
import { evaluate } from "./dataview/eval";
import { execute, makeContext, Result } from "./dataview/query";
import { DvObject, Link, toText, Value } from "./dataview/values";

/** The vault's pages, kept up to date with it. */
function usePages(): { set: PageSet | null; err: string | null } {
  const version = useVaultVersion();
  const [state, setState] = useState<{ set: PageSet | null; err: string | null }>({ set: null, err: null });
  useEffect(() => {
    let live = true;
    loadPages(version)
      .then((set) => live && setState({ set, err: null }))
      .catch((e) => live && setState((s) => ({ ...s, err: String(e) })));
    return () => {
      live = false;
    };
  }, [version]);
  return state;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
const iso = (v: Value) => (DateTime.isDateTime(v) ? v.toISODate() : null);

/** A Dataview task as the app's task row, so ticking and the task menu work on it. */
export function taskRow(t: DvObject): TaskRow | null {
  const raw = rawOf(t);
  if (!raw) return null;
  const it = raw.item;
  const pick = (re: RegExp) => re.exec(it.text)?.[1] ?? null;
  const rank = /\^rank-(\d+)\s*$/.exec(it.text);
  return {
    path: raw.path,
    title: raw.title,
    line: it.line,
    lineText: it.lineText,
    text: it.text.replace(/\s*\^rank-\d+\s*$/, ""),
    done: it.status === "x" || it.status === "X",
    due: pick(/(?:📅|🗓️?)\s*(\d{4}-\d{2}-\d{2})/u) ?? (DAY.test(iso(t.due) ?? "") ? iso(t.due) : null),
    scheduled: pick(/⏳\s*(\d{4}-\d{2}-\d{2})/u) ?? iso(t.scheduled),
    start: pick(/🛫\s*(\d{4}-\d{2}-\d{2})/u) ?? iso(t.start),
    doneOn: pick(/✅\s*(\d{4}-\d{2}-\d{2})/u) ?? iso(t.completion),
    created: pick(/➕\s*(\d{4}-\d{2}-\d{2})/u) ?? iso(t.created),
    rank: rank ? +rank[1] : null,
    tags: it.tags.map((x) => x.replace(/^#/, "")),
    heading: it.section,
  } as TaskRow;
}

/** Sorted by `rank` alone, ungrouped: the order is the one dragging sets. */
function isManual(q: Query): boolean {
  if (q.ops.some((o) => o.t === "group")) return false;
  const sorts = q.ops.filter((o) => o.t === "sort");
  if (sorts.length !== 1) return false;
  const s = sorts[0].t === "sort" ? sorts[0] : null;
  return !!s && s.keys.length === 1 && !s.keys[0].desc && s.keys[0].expr.t === "var" && s.keys[0].expr.name === "rank";
}

function Tasks({ tasks, manual }: { tasks: DvObject[]; manual: boolean }) {
  const rows = useMemo(() => tasks.map(taskRow).filter((r): r is TaskRow => !!r), [tasks]);
  return <TaskList rows={rows} manual={manual} empty="No matching tasks." />;
}

function Calendar({ entries }: { entries: { date: DateTime; link: Value }[] }) {
  const first = entries.length ? entries.reduce((a, b) => (b.date < a.date ? b : a)).date : DateTime.now();
  const [month, setMonth] = useState<DateTime>(() => DateTime.now().startOf("month"));
  useEffect(() => {
    if (entries.length && !entries.some((e) => e.date.hasSame(DateTime.now(), "month"))) setMonth(first.startOf("month"));
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = month.startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => start.plus({ days: i }));
  const byDay = new Map<string, Value[]>();
  for (const e of entries) {
    const k = e.date.toISODate()!;
    byDay.set(k, [...(byDay.get(k) ?? []), e.link]);
  }
  const today = DateTime.now().toISODate();
  return (
    <div className="dvcal">
      <div className="dvcalhead">
        <button
          type="button"
          className="ibtn sm"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => setMonth(month.minus({ months: 1 }))}
        >
          ‹
        </button>
        <b>{month.toFormat("MMMM yyyy")}</b>
        <button
          type="button"
          className="ibtn sm"
          aria-label="Next month"
          title="Next month"
          onClick={() => setMonth(month.plus({ months: 1 }))}
        >
          ›
        </button>
      </div>
      <div className="dvcalgrid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const k = d.toISODate()!;
          const items = byDay.get(k) ?? [];
          return (
            <div key={k} className={`day ${d.month !== month.month ? "out" : ""} ${k === today ? "today" : ""}`}>
              <span className="n">{d.day}</span>
              <span className="dots">
                {items.map((l, i) =>
                  l instanceof Link ? <span key={i} className="dot" title={l.label()} onClick={() => openDoc(l.path)} /> : null,
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A query's answer. */
export function DvResultView({ r, query }: { r: Result; query?: Query }): ReactNode {
  switch (r.type) {
    case "table": {
      const headers = [...(r.idName ? [`${r.idName === "File" ? "File" : r.idName} (${r.rows.length})`] : []), ...r.headers];
      return (
        <div className="dvwrap">
          <table className="dvtable">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i}>
                  {r.idName && (
                    <td>
                      <DvValue v={row.id} />
                    </td>
                  )}
                  {row.values.map((v, j) => (
                    <td key={j}>
                      <DvValue v={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "list":
      return (
        <ul className="dvlist">
          {r.items.map((it, i) => (
            <li key={i}>
              {r.withoutId ? (
                <DvValue v={it.value ?? null} />
              ) : it.value === undefined ? (
                <DvValue v={it.id} />
              ) : (
                <>
                  <DvValue v={it.id} />: <DvValue v={it.value} />
                </>
              )}
              {it.children && (
                <ul>
                  {it.children.map((c, j) => (
                    <li key={j}>
                      <DvValue v={c} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      );
    case "task": {
      const manual = !!query && isManual(query);
      if (r.groups.length === 1 && r.groups[0].key === undefined) return <Tasks tasks={r.groups[0].tasks} manual={manual} />;
      if (!r.groups.length) return <div className="tqmsg faint">No matching tasks.</div>;
      return (
        <>
          {r.groups.map((g, i) => (
            <div key={i} className="dvgroup">
              <h4 className="dvgroupkey">
                {g.key instanceof Link ? <DvLink link={g.key} /> : <DvValue v={g.key ?? null} />}
                <span className="faint"> ({g.tasks.length})</span>
              </h4>
              <Tasks tasks={g.tasks} manual={false} />
            </div>
          ))}
        </>
      );
    }
    case "calendar":
      return <Calendar entries={r.entries} />;
  }
}

function count(r: Result): string {
  const n =
    r.type === "table"
      ? r.rows.length
      : r.type === "list"
        ? r.items.length
        : r.type === "task"
          ? r.groups.reduce((a, g) => a + g.tasks.length, 0)
          : r.entries.length;
  const noun = r.type === "task" ? "task" : "result";
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The block's footer, as a `tasks` block's: the count (the docs link is in the header). */
function Foot({ children }: { children?: React.ReactNode }) {
  return children ? <div className="tqfoot">{children}</div> : null;
}

/** A `dataview` block. */
function DqlBlock({ src, path }: { src: string; path: string }) {
  const { set, err } = usePages();
  const out = useMemo(() => {
    if (!set) return null;
    try {
      const q = parseQuery(src);
      return { q, r: execute(q, set, path) };
    } catch (e) {
      return { error: describeError(src, e) };
    }
  }, [set, src, path]);
  return (
    <div className="tq dv">
      <div className="tqhead">
        <span className="eyebrow">dataview</span>
        <code title={src}>{src.replace(/\s+/g, " ").trim()}</code>
        <QueryDocsLink lang="dataview" />
      </div>
      {err ? (
        <pre className="dverr">{err}</pre>
      ) : !out ? (
        <div className="tqmsg faint">Loading…</div>
      ) : "error" in out ? (
        <pre className="dverr">{out.error}</pre>
      ) : (
        <DvResultView r={out.r} query={out.q} />
      )}
      <Foot>{out && !("error" in out) ? <span className="faint">{count(out.r)}</span> : null}</Foot>
    </div>
  );
}

/** Draws into plain elements for scripts, with React roots that go when the block reruns. Once
 *  `run.live` is false (the block reran or went), a script still going draws nothing more. */
function makeRenderer(roots: Root[], run: { live: boolean } = { live: true }): Renderer {
  const mount = (el: HTMLElement, node: ReactNode) => {
    if (!run.live) return;
    const r = createRoot(el);
    roots.push(r);
    r.render(node);
  };
  return {
    value: (el, v) => mount(el, <DvValue v={v} />),
    result: (el, r) => mount(el, <DvResultView r={r} />),
    tasks: (el, tasks, byFile) => {
      if (!byFile) return mount(el, <Tasks tasks={tasks} manual={false} />);
      const groups = new Map<string, DvObject[]>();
      for (const t of tasks) {
        const p = (t.path as string) ?? "";
        groups.set(p, [...(groups.get(p) ?? []), t]);
      }
      mount(
        el,
        <>
          {[...groups].map(([p, ts]) => (
            <div key={p} className="dvgroup">
              <h4 className="dvgroupkey">
                <DvLink link={new Link(p)} />
                <span className="faint"> ({ts.length})</span>
              </h4>
              <Tasks tasks={ts} manual={false} />
            </div>
          ))}
        </>,
      );
    },
    error: (el, msg) => {
      const pre = document.createElement("pre");
      pre.className = "dverr";
      pre.textContent = msg;
      el.append(pre);
    },
  };
}

/** A `dataviewjs` block. */
function JsBlock({ src, path }: { src: string; path: string }) {
  const { set, err } = usePages();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !set) return;
    const roots: Root[] = [];
    const run = { live: true };
    // Each run draws into its own box, taken away when the block reruns, so a slow earlier run
    // can't add its output beside the new one.
    const out = document.createElement("div");
    el.replaceChildren(out);
    void runScript(src, { set, selfPath: path, container: out, render: makeRenderer(roots, run) }, undefined);
    return () => {
      run.live = false;
      out.remove();
      // Unmount after this render, as React asks.
      const rs = roots.splice(0);
      queueMicrotask(() => rs.forEach((r) => r.unmount()));
    };
  }, [set, src, path]);
  return (
    <div className="tq dv">
      <div className="tqhead">
        <span className="eyebrow">dataviewjs</span>
        <QueryDocsLink lang="dataviewjs" />
      </div>
      {err && <pre className="dverr">{err}</pre>}
      <div className="dvjs prose-inherit" ref={box} />
    </div>
  );
}

/** A `dataview` or `dataviewjs` block. Scripts run only when `scripts` says so (src/md/scripts.ts). */
export function DataviewBlock({
  lang,
  src,
  path,
  scripts,
}: {
  lang: "dataview" | "dataviewjs";
  src: string;
  path: string;
  scripts: boolean;
}) {
  if (lang === "dataview") return <DqlBlock src={src} path={path} />;
  if (!scripts)
    return (
      <div className="tq dv">
        <div className="tqhead">
          <span className="eyebrow">dataviewjs</span>
        </div>
        <div className="tqmsg faint">{SCRIPTS_OFF}</div>
      </div>
    );
  return <JsBlock src={src} path={path} />;
}

/** Inline `= expression` and `$= script`: the value, in place; the code itself when it fails, or
 *  when it's a script and `scripts` is off. */
export function DataviewInline({ code, path, scripts = false }: { code: string; path: string; scripts?: boolean }) {
  const { set } = usePages();
  const js = code.startsWith("$=");
  const skip = js && !scripts;
  const expr = code.replace(/^\$?=\s*/, "");
  const [v, setV] = useState<{ v: Value } | { err: string } | null>(null);
  useEffect(() => {
    if (!set || skip) return;
    let live = true;
    const roots: Root[] = [];
    const run = { live: true };
    if (js) {
      const el = document.createElement("div");
      runInline(expr, { set, selfPath: path, container: el, render: makeRenderer(roots, run) })
        .then((x) => live && setV({ v: x }))
        .catch((e) => live && setV({ err: String(e) }));
    } else {
      try {
        const base = makeContext(set, path);
        setV({ v: evaluate(parseExpr(expr), { ...base, row: base.self ?? {} }) });
      } catch (e) {
        setV({ err: e instanceof Error ? e.message : String(e) });
      }
    }
    return () => {
      live = false;
      run.live = false;
      const rs = roots.splice(0);
      queueMicrotask(() => rs.forEach((r) => r.unmount()));
    };
  }, [set, expr, js, path, skip]);
  if (skip)
    return (
      <code className="noscript" title={SCRIPTS_OFF}>
        {code}
      </code>
    );
  if (!v) return <code>{code}</code>;
  if ("err" in v)
    return (
      <code className="dverrinline" title={`Dataview: ${v.err}`}>
        {code}
      </code>
    );
  return (
    <span className="dvinline" title={code}>
      <DvValue v={v.v} />
    </span>
  );
}

export { toText };
