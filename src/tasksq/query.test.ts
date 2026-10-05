// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The documented examples of the Tasks query language (Queries/* in the plugin's docs), against a
// fixed today: Friday 2 October 2026.

import moment from "moment";
import { describe, expect, it } from "vitest";
import type { TaskRow } from "../api";
import { completion, nextDay, nextOccurrence, withPriority, cancelled } from "./edits";
import { parseTask } from "./fields";
import { headingText, parseQuery, runQuery } from "./query";
import { toQTask } from "./task";
import { SCRIPTS_OFF } from "../md/scripts";

const today = moment("2026-10-02", "YYYY-MM-DD");

let n = 0;
function row(lineText: string, path = "Notes/A.md", heading: string | null = null): TaskRow {
  return {
    path,
    title: path,
    line: n++,
    lineText,
    text: "",
    status: " ",
    done: false,
    due: null,
    scheduled: null,
    start: null,
    doneOn: null,
    created: null,
    cancelled: null,
    rank: null,
    tags: [],
    heading,
  } as TaskRow;
}

const TASKS = [
  row("- [ ] write report 📅 2026-10-02 #work", "Work/Plan.md", "This week"),
  row("- [ ] buy milk ⏫ 📅 2026-09-30", "Home/Shop.md", "Errands"),
  row("- [x] send minutes ✅ 2026-10-01 #work", "Work/Plan.md", "This week"),
  row("- [/] draft budget 🛫 2026-10-05 ⏳ 2026-10-03", "Work/Budget.md"),
  row("- [-] old idea ❌ 2026-09-01", "Ideas.md"),
  row("- [ ] take out the trash 🔁 every Sunday 📅 2026-10-04", "Home/Chores.md"),
  row("    - [ ] sub item 🔽", "Home/Chores.md"),
  row("- [ ] bad date 📅 2026-02-30", "Ideas.md"),
  row("- [ ] blocked one ⛔ abc", "Work/Plan.md"),
  row("- [ ] blocker 🆔 abc 🔺", "Work/Plan.md"),
];
const all = TASKS.map((r) => toQTask(r, today)!);
const file = { path: "Work/Index.md", scripts: true };
const run = (src: string) => runQuery(parseQuery(src, file, today), { today, all, file });
const names = (src: string) => {
  const r = run(src);
  if (r.error) throw new Error(r.error);
  return r.groups.flatMap((g) => g.tasks.map((t) => t.description.split(" #")[0]));
};

describe("task fields", () => {
  it("reads every field from the end of the line", () => {
    const f = parseTask(
      "- [ ] Do it #a ⏫ 🔁 every week when done 🛫 2026-10-01 ⏳ 2026-10-02 📅 2026-10-03 🆔 x1 ⛔ y2, z3 🏁 delete #b ^rank-2048",
    )!;
    expect(f.description).toBe("Do it #a #b");
    expect(f.priority).toBe("high");
    expect(f.recurrence).toBe("every week when done");
    expect(f.dates).toEqual({ start: "2026-10-01", scheduled: "2026-10-02", due: "2026-10-03" });
    expect([f.id, f.dependsOn, f.onCompletion, f.rank]).toEqual(["x1", ["y2", "z3"], "delete", 2048]);
    expect(f.tags).toEqual(["#a", "#b"]);
  });
});

describe("filters", () => {
  it("status", () => {
    expect(names("done")).toEqual(["send minutes", "old idea"]);
    expect(names("status.type is IN_PROGRESS")).toEqual(["draft budget"]);
    expect(names("status.name includes cancel")).toEqual(["old idea"]);
  });
  it("dates, relative and ranges", () => {
    expect(names("due today")).toEqual(["write report"]);
    expect(names("due before today")).toEqual(["buy milk"]);
    expect(names("due this week").sort()).toEqual(["buy milk", "take out the trash", "write report"]);
    expect(names("due 2026-09-29 2026-10-02").sort()).toEqual(["buy milk", "write report"]);
    expect(names("due date is invalid")).toEqual(["bad date"]);
    expect(names("has scheduled date")).toEqual(["draft budget"]);
    // No start date lets a task through a start search.
    expect(names("starts after 2026-10-10")).not.toContain("draft budget");
    expect(names("starts after 2026-10-10")).toContain("buy milk");
    expect(names("happens on 2026-10-03")).toEqual(["draft budget"]);
    expect(names("done in 2026-10")).toEqual(["send minutes"]);
    expect(names("due in 2026-W40").sort()).toEqual(["buy milk", "take out the trash", "write report"].sort());
  });
  it("text, tags, paths and regexes", () => {
    expect(names("description includes MILK")).toEqual(["buy milk"]);
    expect(names("tags include #work").sort()).toEqual(["send minutes", "write report"]);
    expect(names("tag regex matches /^#wo/i").length).toBe(2);
    expect(names("path includes home").sort()).toEqual(["buy milk", "sub item", "take out the trash"]);
    expect(names("folder includes Work/").length).toBe(5);
    expect(names("filename includes Budget")).toEqual(["draft budget"]);
    expect(names("root includes Home")).toHaveLength(3);
    expect(names("heading includes errands")).toEqual(["buy milk"]);
  });
  it("a regex with the g flag matches every task, not every other one", () => {
    expect(names("description regex matches /o/g").sort()).toEqual(names("description regex matches /o/").sort());
    expect(names("description regex matches /o/g").length).toBeGreaterThan(3);
  });
  it("runs no function where scripts are off, and says so", () => {
    let ran = false;
    (globalThis as { __ranTasksFn?: () => void }).__ranTasksFn = () => (ran = true);
    for (const src of [
      "filter by function globalThis.__ranTasksFn() || true",
      "sort by function globalThis.__ranTasksFn()",
      "group by function globalThis.__ranTasksFn()",
      "(not done) AND (filter by function globalThis.__ranTasksFn() || true)",
    ]) {
      for (const off of [{ path: "sources/Email.md" }, { path: "", scripts: false }]) {
        const r = runQuery(parseQuery(src, off, today), { today, all, file: off });
        expect(r.error).toBe(SCRIPTS_OFF);
      }
    }
    expect(ran).toBe(false);
    expect(names("filter by function globalThis.__ranTasksFn() || true").length).toBe(all.length);
    expect(ran).toBe(true);
  });
  it("query.allTasks is the same list for every task that asks", () => {
    expect(names("filter by function query.allTasks === query.allTasks && query.allTasks.length === 10")).toHaveLength(all.length);
  });
  it("priority, recurrence, sub-items, dependencies", () => {
    expect(names("priority is above none").sort()).toEqual(["blocker", "buy milk"]);
    expect(names("priority is low")).toEqual(["sub item"]);
    expect(names("is recurring")).toEqual(["take out the trash"]);
    expect(names("recurrence includes sunday")).toEqual(["take out the trash"]);
    expect(names("exclude sub-items")).not.toContain("sub item");
    expect(names("is blocked")).toEqual(["blocked one"]);
    expect(names("is blocking")).toEqual(["blocker"]);
    expect(names("has id")).toEqual(["blocker"]);
  });
  it("boolean combinations, with precedence and every delimiter", () => {
    expect(names("(tags include #work) AND (not done)")).toEqual(["write report"]);
    expect(names("[path includes Home] OR [path includes Ideas]").length).toBe(5);
    expect(names("NOT (path includes Work)").length).toBe(5);
    expect(names('"done" XOR "tags include #work"').sort()).toEqual(["old idea", "write report"]);
    expect(names("(path includes Home) AND NOT (is recurring)").sort()).toEqual(["buy milk", "sub item"]);
    // AND before OR.
    expect(names("(path includes Ideas) OR (path includes Home) AND (is recurring)").sort()).toEqual([
      "bad date",
      "old idea",
      "take out the trash",
    ]);
    expect(names("( (path includes Home) OR (path includes Ideas) ) AND (not done)").length).toBe(4);
  });
  it("functions", () => {
    expect(names("filter by function task.priorityName === 'High'")).toEqual(["buy milk"]);
    expect(names("filter by function task.due.category.name === 'Overdue'")).toEqual(["buy milk"]);
    expect(names("filter by function task.file.folder === 'Home/' && !task.isRecurring")).toEqual(["buy milk", "sub item"]);
  });
  it("comments, continuations and placeholders", () => {
    expect(names("# just a comment\npath includes \\\nHome\nnot done").length).toBe(3);
    expect(names("folder includes {{query.file.folder}}").length).toBe(5);
  });
  it("reports what it doesn't understand", () => {
    expect(run("due whenever-ish").error).toContain("do not understand due date");
    expect(run("frobnicate").error).toBe('Tasks query: do not understand query\nProblem line: "frobnicate"');
    expect(run("(done) AND").error).toContain("Boolean combination");
  });
});

describe("sorting, grouping and limits", () => {
  it("sorts with reverse and falls back to the default order", () => {
    expect(names("not done\nsort by description").slice(0, 3)).toEqual(["bad date", "blocked one", "blocker"]);
    expect(names("not done\nsort by description reverse")[0]).toBe("write report");
    // Default: status type, then urgency (overdue first).
    expect(names("not done")[0]).toBe("draft budget");
    expect(names("not done\nsort by due")[0]).toBe("bad date");
    expect(names("not done\nsort by function task.description.length")[0]).toBe("blocker");
  });
  it("groups, nests, reverses and limits", () => {
    const r = run("not done\ngroup by root\ngroup by priority\nlimit groups 1");
    expect(r.groups.map((g) => g.headings.join(" › "))).toContain("Home/ › High priority");
    expect(r.groups.every((g) => g.tasks.length === 1)).toBe(true);
    const d = run("group by due reverse\nhas due date");
    expect(d.groups.map((g) => g.headings[0])).toEqual([
      "2026-10-04 Sunday",
      "2026-10-02 Friday",
      "2026-09-30 Wednesday",
      "Invalid due date",
    ]);
    expect(run("group by tags\ntags include #work").groups.map((g) => g.headings[0])).toEqual(["#work"]);
    const lim = run("limit 2");
    expect([lim.shown, lim.total]).toEqual([2, TASKS.length]);
    expect(headingText("%%3%% Future")).toBe("Future");
  });
  it("explains", () => {
    const e = run("explain\nnot done\n(due before tomorrow) AND (is recurring)").explanation!;
    expect(e).toContain("Explanation of this Tasks code block query:");
    expect(e).toContain("due date is before 2026-10-03 (Saturday 3rd October 2026)");
    expect(e).toContain("AND (All of):");
  });
  it("layout options", () => {
    const q = parseQuery("hide due date\nshow urgency\nshort mode", file, today);
    expect([q.shown.has("due date"), q.shown.has("urgency"), q.shortMode]).toEqual([false, true, true]);
    expect(parseQuery("hide everything", file, today).error).toContain("do not understand");
  });
  it("query file defaults", () => {
    const q = parseQuery(
      "not done",
      { path: "A.md", frontmatter: { TQ_explain: true, TQ_short_mode: true, TQ_extra_instructions: "path includes Home" } },
      today,
    );
    expect([q.explain, q.shortMode, q.filters.length]).toEqual([true, true, 2]);
  });
});

describe("recurrence", () => {
  it("computes the next day from the documented rules", () => {
    const d = (s: string) => moment(s, "YYYY-MM-DD");
    expect(nextDay("every Sunday", d("2021-04-25"))!.format("YYYY-MM-DD")).toBe("2021-05-02");
    expect(nextDay("every weekday", d("2026-10-02"))!.format("YYYY-MM-DD")).toBe("2026-10-05");
    expect(nextDay("every month on the last", d("2022-01-31"))!.format("YYYY-MM-DD")).toBe("2022-02-28");
    expect(nextDay("every month", d("2021-10-31"))!.format("YYYY-MM-DD")).toBe("2021-11-30");
    expect(nextDay("every month on the 31st", d("2022-01-31"))!.format("YYYY-MM-DD")).toBe("2022-03-31");
    expect(nextDay("every 2 weeks", d("2021-10-30"))!.format("YYYY-MM-DD")).toBe("2021-11-13");
  });
  it("keeps the other dates' distance, and 'when done' counts from today", () => {
    expect(nextOccurrence("- [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-10-28 📅 2021-10-30", today)).toBe(
      "- [ ] Mow the lawn 🔁 every 2 weeks ⏳ 2021-11-11 📅 2021-11-13",
    );
    expect(nextOccurrence("- [ ] sweep 🔁 every week when done ⏳ 2021-02-06", moment("2022-02-13", "YYYY-MM-DD"))).toBe(
      "- [ ] sweep 🔁 every week when done ⏳ 2022-02-20",
    );
  });
  it("completes: next occurrence above the done line; 🏁 delete removes the done one", () => {
    const c = completion("- [ ] take out the trash 🔁 every Sunday 📅 2021-04-25 ^rank-1024", moment("2021-04-24", "YYYY-MM-DD"))!;
    expect(c.lines).toEqual([
      "- [ ] take out the trash 🔁 every Sunday 📅 2021-05-02",
      "- [x] take out the trash 🔁 every Sunday 📅 2021-04-25 ✅ 2021-04-24 ^rank-1024",
    ]);
    expect(completion("- [ ] plain", today)).toBeNull();
    expect(completion("- [ ] one-off 🏁 delete", today)!.lines).toEqual([]);
  });
  it("cancels and sets priorities", () => {
    expect(cancelled("- [ ] idea 📅 2026-10-09", today).lines).toEqual(["- [-] idea 📅 2026-10-09 ❌ 2026-10-02"]);
    expect(withPriority("- [ ] idea #x 📅 2026-10-09 ^rank-5", "high").lines).toEqual(["- [ ] idea #x ⏫ 📅 2026-10-09 ^rank-5"]);
    expect(withPriority("- [ ] idea ⏫ 📅 2026-10-09", "none").lines).toEqual(["- [ ] idea 📅 2026-10-09"]);
    expect(withPriority("- [ ] idea", "lowest").lines).toEqual(["- [ ] idea ⏬"]);
  });
});
