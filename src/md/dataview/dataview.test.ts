// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { DateTime, Duration, Settings } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DvRawItem, DvRawPage } from "../../api";
import { evaluate } from "./eval";
import { buildPages } from "./pages";
import { describeError, parseExpr, parseQuery } from "./parse";
import { execute, makeContext } from "./query";
import { Link, parseFieldValue, toText, Value } from "./values";

const NOW = DateTime.fromISO("2026-10-02T10:00:00");
beforeAll(() => {
  Settings.now = () => NOW.toMillis();
});
afterAll(() => {
  Settings.now = () => Date.now();
});

function item(line: number, text: string, status: string | null = " ", extra: Partial<DvRawItem> = {}): DvRawItem {
  return {
    line,
    lineCount: 1,
    lineText: `- ${status === null ? "" : `[${status}] `}${text}`,
    text,
    status,
    parent: null,
    section: null,
    blockId: null,
    tags: [...text.matchAll(/#[\w/-]+/g)].map((m) => m[0]),
    links: [],
    fields: [...text.matchAll(/\[([^:\]]+)::\s*([^\]]*)\]/g)].map((m) => [m[1], m[2], line] as [string, string, number]),
    ...extra,
  };
}

function page(path: string, extra: Partial<DvRawPage> = {}): DvRawPage {
  return {
    path,
    title: path.replace(/\.md$/, "").split("/").pop()!,
    size: 100,
    ctime: DateTime.fromISO("2026-09-01").toMillis(),
    mtime: DateTime.fromISO("2026-10-01T09:30").toMillis(),
    day: null,
    frontmatter: {},
    aliases: [],
    etags: [],
    links: [],
    fields: [],
    lists: [],
    ...extra,
  };
}

const RAW: DvRawPage[] = [
  page("Books/Dune.md", {
    frontmatter: { rating: 9, author: "Frank Herbert", read: "2026-09-20", tags: ["book", "scifi"] },
    etags: ["#book", "#scifi"],
    fields: [["Genre", "Science Fiction", 5]],
    links: [{ target: "Arrakis", path: "Places/Arrakis.md", display: null, subpath: null, embed: false, line: 6 }],
  }),
  page("Books/Emma.md", {
    frontmatter: { rating: 7, author: "Jane Austen", read: "2026-08-01", tags: ["book/classic"] },
    etags: ["#book/classic"],
  }),
  page("Places/Arrakis.md", { frontmatter: { kind: "planet" } }),
  page("Me. To Do List.md", {
    lists: [
      item(3, "Ship it 📅 2026-10-05 ^rank-2048"),
      item(4, "Chase Sam #followup ^rank-1024"),
      item(5, "Old one ✅ 2026-09-30", "x"),
      item(6, "Plan [priority:: high]"),
      item(7, "just a note", null),
    ],
  }),
  page("Spec.md", {
    lists: [item(2, "Reading [book:: Dune] [pages:: 412]", null), item(3, "Plain [book:: Emma]", null), item(4, "nothing here", null)],
  }),
  page("Daily/2026-10-01.md", {
    day: "2026-10-01",
    fields: [
      ["mood", "good", 2],
      ["mood", "tired", 3],
    ],
  }),
];

const set = buildPages(RAW);
const run = (q: string, self: string | null = null) => execute(q, set, self);
const ev = (src: string, row: Record<string, Value> = {}, self: string | null = null): Value =>
  evaluate(parseExpr(src), { ...makeContext(set, self), row });

describe("dataview values", () => {
  it("types inline field text as Dataview does", () => {
    const r = (t: string) => (t === "Note" ? "Note.md" : null);
    expect(parseFieldValue("42", r)).toBe(42);
    expect(parseFieldValue("true", r)).toBe(true);
    expect(DateTime.isDateTime(parseFieldValue("2026-10-02", r))).toBe(true);
    expect(Duration.isDuration(parseFieldValue("3 days", r))).toBe(true);
    expect((parseFieldValue("[[Note]]", r) as Link).path).toBe("Note.md");
    expect(parseFieldValue('"quoted, text"', r)).toBe("quoted, text");
    expect(parseFieldValue("[[Note]], [[Other]]", r)).toHaveLength(2);
    expect(parseFieldValue("red, green", r)).toBe("red, green");
  });
});

describe("dataview expressions", () => {
  it("does arithmetic, comparison and logic with Dataview's precedence", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev('"a" + 1')).toBe("a1");
    expect(ev("2 > 1 and !(3 < 2) or false")).toBe(true);
    expect(ev("10 % 4")).toBe(2);
  });
  it("reads dates and durations", () => {
    expect((ev("date(today)") as DateTime).toISODate()).toBe("2026-10-02");
    expect((ev("date(today) + dur(1 week)") as DateTime).toISODate()).toBe("2026-10-09");
    expect((ev("date(2026-10-05) - date(2026-10-02)") as Duration).as("days")).toBe(3);
    expect(ev("date(2026-10-02).month")).toBe(10);
    expect(ev('dateformat(date(2026-10-02), "yyyy-MM-dd")')).toBe("2026-10-02");
    expect(ev('date("2026-10-02") = date(2026-10-02)')).toBe(true);
    expect((ev("dur(3 days) + dur(2 hours)") as Duration).as("hours")).toBe(74);
  });
  it("runs the function library", () => {
    expect(ev('contains(list("Hello", 1), "Hell")')).toBe(true);
    expect(ev('econtains(list("Hello"), "Hell")')).toBe(false);
    expect(ev('icontains("Hello", "hell")')).toBe(true);
    expect(ev('containsword("the cat sat", "CAT")')).toBe(true);
    expect(ev("length(list(1, 2, 3))")).toBe(3);
    expect(ev("sum(list(1, 2, 3))")).toBe(6);
    expect(ev("average(list(1, 2, 3))")).toBe(2);
    expect(ev("product(list(2, 3))")).toBe(6);
    expect(ev('reduce(list(1, 2, 3), "+")')).toBe(6);
    expect(ev("max(1, 5, 3)")).toBe(5);
    expect(ev("min(list(4, 2))")).toBe(2);
    expect(ev("round(3.14159, 2)")).toBe(3.14);
    expect(ev("filter(list(1, 2, 3), (x) => x > 1)")).toEqual([2, 3]);
    expect(ev("map(list(1, 2), (x) => x * 2)")).toEqual([2, 4]);
    expect(ev("all(list(1, 2), (x) => x > 0)")).toBe(true);
    expect(ev("flat(list(list(1, 2), list(3)))")).toEqual([1, 2, 3]);
    expect(ev("unique(list(1, 1, 2))")).toEqual([1, 2]);
    expect(ev("sort(list(3, 1, 2))")).toEqual([1, 2, 3]);
    expect(ev('join(list("a", "b"), " - ")')).toBe("a - b");
    expect(ev('regexmatch("\\\\w+", "abc")')).toBe(true);
    expect(ev('regextest("b", "abc")')).toBe(true);
    expect(ev('regexreplace("yes", "[ys]", "a")')).toBe("aea");
    expect(ev('replace("what", "wh", "h")')).toBe("hat");
    expect(ev('lower(list("A", "B"))')).toEqual(["a", "b"]);
    expect(ev('split("a,b,c", ",")')).toEqual(["a", "b", "c"]);
    expect(ev('padleft("7", 3, "0")')).toBe("007");
    expect(ev('truncate("Hello there!", 8)')).toBe("Hello...");
    expect(ev('substring("hello", 1, 3)')).toBe("el");
    expect(ev("default(null, 2)")).toBe(2);
    expect(ev("default(list(1, null), 0)")).toEqual([1, 0]);
    expect(ev('choice(true, "y", "n")')).toBe("y");
    expect(ev('number("18 years")')).toBe(18);
    expect(ev("typeof(dur(1 day))")).toBe("duration");
    expect(ev('object("a", 1).a')).toBe(1);
    expect(ev("nonnull(list(1, null))")).toEqual([1]);
    expect(ev("firstvalue(list(null, 2))")).toBe(2);
    expect(ev('extract(object("a", 1, "b", 2), "a")')).toEqual({ a: 1 });
    expect(ev("minby(list(3, 1, 2), (x) => x)")).toBe(1);
    expect(ev('meta(link("Books/Dune", "D")).display')).toBe("D");
    expect(ev('display(link("Books/Dune"))')).toBe("Dune");
    expect(typeof ev('hash("2026-10-02", "x")')).toBe("number");
    expect(ev("[1, 2][1]")).toBe(2);
    expect(ev('{a: 1, "b c": 2}["b c"]')).toBe(2);
  });
  it("reads fields of the row, of this, through links and across lists", () => {
    const dune = set.byPath.get("Books/Dune.md")!;
    expect(ev("rating", dune)).toBe(9);
    expect(ev("genre", dune)).toBe("Science Fiction");
    expect(ev("Genre", dune)).toBe("Science Fiction");
    expect(ev("file.name", dune)).toBe("Dune");
    expect(ev('row["author"]', dune)).toBe("Frank Herbert");
    expect(ev("this.file.name", {}, "Books/Emma.md")).toBe("Emma");
    expect(ev("[[Arrakis]].kind")).toBe("planet");
    expect(ev("file.outlinks.file.name", dune)).toEqual(["Arrakis"]);
    expect(ev("file.tags", set.byPath.get("Books/Emma.md")!)).toEqual(["#book", "#book/classic"]);
    expect(ev("mood", set.byPath.get("Daily/2026-10-01.md")!)).toEqual(["good", "tired"]);
    expect((ev("file.day", set.byPath.get("Daily/2026-10-01.md")!) as DateTime).toISODate()).toBe("2026-10-01");
  });
});

describe("dataview queries", () => {
  it("tables pages from a folder, sorted, with aliases", () => {
    const r = run('TABLE author AS "Author", rating FROM "Books" WHERE rating > 5 SORT rating DESC');
    expect(r.type).toBe("table");
    if (r.type !== "table") return;
    expect(r.headers).toEqual(["Author", "rating"]);
    expect(r.rows.map((x) => x.values[0])).toEqual(["Frank Herbert", "Jane Austen"]);
    expect(r.idName).toBe("File");
  });
  it("selects by tag with subtags, and combines sources", () => {
    const names = (q: string) => {
      const r = run(q);
      return r.type === "list" ? r.items.map((i) => (i.id as Link).fileName()) : [];
    };
    expect(names("LIST FROM #book")).toEqual(["Dune", "Emma"]);
    expect(names("LIST FROM #book AND -#scifi")).toEqual(["Emma"]);
    expect(names('LIST FROM #scifi OR "Places"')).toEqual(["Dune", "Arrakis"]);
    expect(names("LIST FROM [[Arrakis]]")).toEqual(["Dune"]);
    expect(names("LIST FROM outgoing([[Dune]])")).toEqual(["Arrakis"]);
  });
  it("lists with an expression and without ids", () => {
    const r = run('LIST WITHOUT ID author FROM "Books" SORT file.name');
    expect(r.type === "list" && r.items.map((i) => i.value)).toEqual(["Frank Herbert", "Jane Austen"]);
  });
  it("groups and flattens", () => {
    const g = run('TABLE rows.file.name AS "Books" FROM #book GROUP BY author');
    expect(g.type === "table" && g.rows.map((r) => r.id)).toEqual(["Frank Herbert", "Jane Austen"]);
    expect(g.type === "table" && g.idName).toBe("key");
    const f = run("TABLE WITHOUT ID tag FROM #book FLATTEN file.etags AS tag SORT tag");
    expect(f.type === "table" && f.rows.map((r) => r.values[0])).toEqual(["#book", "#book/classic", "#scifi"]);
  });
  it("finds tasks, with their fields and their page's, and the previous app's To Do queries", () => {
    const r = run('TASK WHERE !completed AND !contains(tags, "#followup") SORT rank');
    expect(r.type).toBe("task");
    if (r.type !== "task") return;
    expect(r.groups[0].tasks.map((t) => t.text)).toEqual(["Plan [priority:: high]", "Ship it 📅 2026-10-05"]);
    const dated = run("TASK WHERE due");
    expect(dated.type === "task" && (dated.groups[0].tasks[0].due as DateTime).toISODate()).toBe("2026-10-05");
    const fu = run('TASK WHERE contains(tags, "#followup")');
    expect(fu.type === "task" && fu.groups[0].tasks.length).toBe(1);
    const prio = run('TASK WHERE priority = "high"');
    expect(prio.type === "task" && prio.groups[0].tasks.length).toBe(1);
    const page = run('TASK WHERE file.name = "Me. To Do List" AND completed');
    expect(page.type === "task" && page.groups[0].tasks.map((t) => t.text)).toEqual(["Old one ✅ 2026-09-30"]);
  });
  it("puts dated pages on a calendar", () => {
    const r = run("CALENDAR file.day");
    expect(r.type === "calendar" && r.entries.map((e) => e.date.toISODate())).toEqual(["2026-10-01"]);
  });
  it("flattens list items and reads their own fields", () => {
    const r = run('TABLE WITHOUT ID item.book AS "Book", item.pages FROM "Spec" FLATTEN file.lists AS item WHERE item.book');
    expect(r.type === "table" && r.rows.map((x) => x.values)).toEqual([
      ["Dune", 412],
      ["Emma", null],
    ]);
  });
  it("limits", () => {
    const r = run('LIST FROM "Books" LIMIT 1');
    expect(r.type === "list" && r.items.length).toBe(1);
  });
  it("explains parse errors with the line and a caret", () => {
    let msg = "";
    try {
      parseQuery("TABLE x\nWHERE (");
    } catch (e) {
      msg = describeError("TABLE x\nWHERE (", e);
    }
    expect(msg).toContain("PARSING FAILED");
    expect(msg).toContain("> 2 | WHERE (");
    expect(() => parseQuery("TABEL x")).toThrow(/query type/);
  });
  it("writes values as Dataview shows them", () => {
    expect(toText(null)).toBe("-");
    expect(toText(DateTime.fromISO("2026-10-02"))).toBe("October 02, 2026");
    expect(toText(Duration.fromObject({ days: 3 }))).toBe("3 days");
  });
});
