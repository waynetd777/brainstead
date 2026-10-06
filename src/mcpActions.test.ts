// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, Record<string, unknown> | undefined];
const calls: Call[] = [];
let answers: Record<string, (a: Record<string, unknown> | undefined) => unknown> = {};
const invoke = vi.fn(async (cmd: string, a?: Record<string, unknown>): Promise<unknown> => {
  calls.push([cmd, a]);
  const f = answers[cmd];
  return f ? f(a) : undefined;
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (c: string, a?: Record<string, unknown>) => invoke(c, a),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import type { InboxItem, TaskRow } from "./api";
import { findTask, runAction, taskLineOut } from "./mcpActions";

const row = (over: Partial<TaskRow>): TaskRow => ({
  path: "Me. To Do List.md",
  title: "To Do List",
  line: 11,
  lineText: "- [ ] Call Sam about the launch",
  text: "Call Sam about the launch",
  status: " ",
  done: false,
  due: null,
  scheduled: null,
  start: null,
  doneOn: null,
  created: null,
  rank: null,
  tags: [],
  heading: "Other",
  ...over,
});

const edited = (a: Record<string, unknown> | undefined) => ({
  line: (a?.line as number) ?? 0,
  lineText: "- [x] Call Sam about the launch",
  undo: "Ticked",
});
const run = (action: string, args: Record<string, unknown> = {}) => runAction({ id: "1", action, args });

describe("MCP actions", () => {
  beforeEach(() => {
    calls.length = 0;
    answers = {};
  });

  it("finds a task by its id, or by its text when the line moved", () => {
    const all = [row({}), row({ line: 20, text: "Book the room", lineText: "- [ ] Book the room" })];
    expect(findTask(all, "Me. To Do List.md:12").text).toBe("Call Sam about the launch");
    expect(findTask(all, "Me. To Do List.md:3", "Book the room").line).toBe(20);
    expect(() => findTask(all, "Me. To Do List.md:12", "Something else")).toThrow(/no task/);
    expect(() => findTask(all, "nope")).toThrow(/isn't a task id/);
  });

  it("lists a view, one line per task with its id", async () => {
    answers.tasks_all = () => [
      row({ due: "2026-10-06", project: "Project. Orbit App launch.md" }),
      row({ line: 3, text: "Old", done: true }),
    ];
    const out = (await run("tasks.list", { view: "next" })) as string;
    expect(out).toMatch(/^1 task in next:/);
    expect(out).toContain("- [ ] Call Sam about the launch · due 2026-10-06 · project Orbit App launch  (Me. To Do List.md:12)");
    expect(taskLineOut(row({ effort: "15m" }), true)).toContain("effort 15m");
    await expect(run("tasks.list", { view: "soon" })).rejects.toThrow(/No view/);
  });

  /** change_submit_many answers: each made, or each held. */
  const outcomes = (applied: boolean) => (a: Record<string, unknown> | undefined) =>
    (a!.changes as { page: string }[]).map((c, i) => ({
      id: `c${i}`,
      applied,
      page: c.page,
      flags: applied ? [] : ["It changes or takes out text in your own note."],
      message: applied ? `Changed ${c.page}. Revert it in Changes.` : "Held for the user in Changes.",
    }));
  const submitted = () => calls.filter(([c]) => c === "changes_submit_many").flatMap(([, a]) => a!.changes as Record<string, unknown>[]);

  it("edits a task through Changes: worked out edit by edit, made as one change", async () => {
    answers.tasks_all = () => [row({})];
    answers.change_task_line = (a) => {
      const e = a!.edit as { op: string; date?: string; names?: string[] };
      const l = a!.line as string;
      return e.op === "toggle" ? l.replace("[ ]", "[x]") : e.op === "date" ? `${l} 📅 ${e.date}` : `${l} #context/${e.names![0]}`;
    };
    answers.changes_submit_many = outcomes(true);
    const out = (await run("task.edit", {
      task: "Me. To Do List.md:12",
      text: "Call Sam",
      done: true,
      due: "2026-10-09",
      contexts: ["Calls"],
      priority: "high",
    })) as string;
    // Nothing written straight away: no task command, one change.
    expect(calls.some(([c]) => c.startsWith("task_"))).toBe(false);
    const [c] = submitted();
    expect(c).toMatchObject({ page: "Me. To Do List.md", kind: "task", origin: { kind: "chat" } });
    expect(c.instruction).toEqual({
      op: "lines",
      at: 11,
      old: ["- [ ] Call Sam about the launch"],
      new: ["- [x] Call Sam about the launch ⏫ 📅 2026-10-09 #context/calls"],
    });
    expect(out).toMatch(/^Done \(ticked, due 2026-10-09, priority high, contexts calls\)/);
    expect(out).toContain("Revert it in Changes");
    await expect(run("task.edit", { task: "Me. To Do List.md:12", text: "Call Sam" })).rejects.toThrow(/Nothing to change/);
  });

  it("an unattended edit carries its origin, and says when it's held", async () => {
    answers.tasks_all = () => [row({})];
    answers.changes_submit_many = outcomes(false);
    const origin = { kind: "chat", run: "session-1", trigger: "scheduled" };
    const out = (await run("task.edit", { task: "Me. To Do List.md:12", text: "Call Sam", status: "cancelled", origin })) as string;
    expect(submitted()[0].origin).toEqual(origin);
    expect(out).toMatch(/^Held for the user in Changes: It changes or takes out text/);
  });

  it("moves a task by its rank, through Changes", async () => {
    answers.tasks_all = () => [row({ rank: 1024 }), row({ line: 12, lineText: "- [ ] Book the room", text: "Book the room", rank: 2048 })];
    answers.change_task_line = (a) => `${a!.line} [rank:: 1536]`;
    answers.changes_submit_many = outcomes(true);
    await run("task.move", { task: "Me. To Do List.md:13", text: "Book the room", after: "Me. To Do List.md:12" });
    expect(calls.find(([c]) => c === "change_task_line")![1]!.edit).toEqual({ op: "rank", prev: 1024, next: null });
    expect(submitted()[0].instruction).toMatchObject({ op: "lines", at: 12, new: ["- [ ] Book the room [rank:: 1536]"] });
  });

  it("clarifies an Inbox item through Changes, its edits held together", async () => {
    const task: InboxItem = {
      kind: "task",
      path: "Me. To Do List.md",
      line: 33,
      text: "ring the venue",
      lineText: "- [ ] ring the venue",
      stamp: null,
    };
    const capture: InboxItem = {
      kind: "capture",
      path: "sources/Email. Thread. Hi - 2026-10-02.md",
      line: 0,
      text: "Email. Thread. Hi - 2026-10-02",
      lineText: "Email thread",
      stamp: "2026-10-02",
    };
    const thought: InboxItem = {
      kind: "thought",
      path: "Me. Scratchpad.md",
      line: 4,
      text: "Ask Lena about the beta",
      lineText: "### 2026-10-02 09:00",
      stamp: "2026-10-02 09:00",
      block: "### 2026-10-02 09:00\nAsk Lena about the beta\n",
    };
    answers.inbox_list = () => [task, capture, thought];
    answers.projects_list = () => [{ name: "Orbit App launch", path: "Project. Orbit App launch.md", status: "active" }];
    answers.changes_submit_many = outcomes(true);
    await run("inbox.clarify", { item: "task:34", becomes: "next", text: "Ring the venue", context: "calls" });
    expect(submitted()[0].instruction).toEqual({
      op: "lines",
      at: 33,
      old: ["- [ ] ring the venue"],
      new: ["- [ ] Ring the venue #context/calls"],
    });
    // To a project: out of the To Do list and into the project, as one change.
    calls.length = 0;
    await run("inbox.clarify", { item: "thought:5", becomes: "next", project: "Orbit App launch" });
    expect(submitted().map((c) => [c.page, (c.instruction as { op: string }).op])).toEqual([
      ["Project. Orbit App launch.md", "add_task"],
      ["Me. Scratchpad.md", "lines"],
    ]);
    expect(submitted()[1].instruction).toMatchObject({ old: ["### 2026-10-02 09:00", "Ask Lena about the beta"], new: [] });
    // A capture: trashed through Changes, then marked done.
    calls.length = 0;
    await run("inbox.clarify", { item: "capture:1", becomes: "delete" });
    expect(calls.map(([c]) => c)).toEqual(["inbox_list", "changes_submit_many", "inbox_capture_done"]);
    expect(submitted()[0]).toMatchObject({ kind: "trash", instruction: { op: "trash" } });
    // Held: the capture stays in the Inbox until the user accepts.
    calls.length = 0;
    answers.changes_submit_many = outcomes(false);
    const out = (await run("inbox.clarify", { item: "capture:1", becomes: "next" })) as string;
    expect(calls.some(([c]) => c === "inbox_capture_done")).toBe(false);
    expect(out).toContain("stays in the Inbox");
    await expect(run("inbox.clarify", { item: "task:99", becomes: "next" })).rejects.toThrow(/No Inbox item/);
  });

  it("makes and changes projects through Changes", async () => {
    answers.projects_list = () => [{ name: "Orbit App launch", path: "Project. Orbit App launch.md", status: "active" }];
    answers.change_project_note = (a) => ({ path: `Project. ${a!.name}.md`, content: "---\nstatus: active\n---\n" });
    answers.changes_submit_many = outcomes(true);
    await run("project.create", { name: "Orbit App beta" });
    expect(submitted()[0]).toMatchObject({ page: "Project. Orbit App beta.md", kind: "new", instruction: { op: "page" } });
    calls.length = 0;
    await run("project.update", { project: "Orbit App launch", status: "done", area: null });
    expect(submitted()[0].instruction).toEqual({
      op: "properties",
      set: [
        ["status", "done"],
        ["area", null],
      ],
    });
    expect(calls.some(([c]) => c === "project_set" || c === "project_create")).toBe(false);
    await expect(run("project.update", { project: "Orbit App launch", status: "blocked" })).rejects.toThrow(/status is/);
  });

  it("makes an assistant's change, and accepts, rejects and reverts held ones", async () => {
    answers.change_submit = () => ({
      id: "c1",
      applied: true,
      page: "wiki/entities/Orbit App.md",
      flags: [],
      message: "Changed Orbit App: x. Revert it in Changes.",
    });
    const change = {
      page: "wiki/entities/Orbit App.md",
      kind: "edit",
      title: "x",
      instruction: { op: "page", content: "y" },
      origin: { kind: "chat" },
    };
    expect(await run("change.submit", { change })).toBe("Changed Orbit App: x. Revert it in Changes.");
    expect(calls.find(([c]) => c === "change_submit")![1]).toEqual({ change });
    answers.change_accept = () => ({ id: "c2", applied: true, page: "a.md", flags: [], message: "Changed a." });
    expect(await run("changes", { action: "accept", id: "c2" })).toBe("Changed a.");
    // As an assistant: the app accepts only a change held for a failed check.
    expect(calls.find(([c]) => c === "change_accept")![1]).toEqual({ id: "c2", assistant: true });
    answers.change_revert = () => ({ ok: false, message: "Its lines have been edited since.", before: "old" });
    expect(await run("changes", { action: "revert", id: "c1" })).toMatch(/edited since/);
    answers.changes_accept_all = () => ({ done: 2, failed: [] });
    expect(await run("changes", { action: "accept_run", group: "nightly-1" })).toBe("Accepted 2.");
    expect(calls.find(([c]) => c === "changes_accept_all")![1]).toEqual({ group: "nightly-1", assistant: true });
    await expect(run("changes", { action: "accept" })).rejects.toThrow(/Which change/);
    // Nobody watching: nothing is accepted.
    calls.length = 0;
    await expect(run("changes", { action: "accept", id: "c2", unattended: true })).rejects.toThrow(/nobody is watching/);
    await expect(run("changes", { action: "accept_run", group: "g", unattended: true })).rejects.toThrow(/nobody is watching/);
    expect(calls.length).toBe(0);
  });

  it("reads and sets how long Changes keeps its history", async () => {
    expect(await run("changes", { action: "history" })).toMatch(/for 90 days or up to 500 MB/);
    expect(await run("changes", { action: "history", days: 180, mb: 1000 })).toMatch(/180 days or up to 1 GB/);
    expect(await run("changes", { action: "history" })).toMatch(/180 days/);
    await expect(run("changes", { action: "history", days: 7 })).rejects.toThrow(/days is 30, 90/);
  });

  it("retires the previous app's files, and starts the weekly review over", async () => {
    answers.switchover_status = () => ({ automated: null, skills: true, scripts: false, claudeMd: false });
    answers.switchover_retire = () => "Retired: .claude/skills/, CLAUDE.md updated. The folders are in the Trash.";
    expect(await run("moving_over", { action: "status" })).toMatch(/\.claude\/skills\/ is still in the vault/);
    expect(await run("moving_over", { action: "retire" })).toMatch(/^Retired: \.claude\/skills\//);
    expect(calls.some(([c]) => c === "switchover_retire")).toBe(true);
    answers.weekly_state_read = () => ({ week: "2026-W39", step: 3, done: [0, 1, 2], log: [], notes: "x", startedAt: 1 });
    const out = (await run("weekly.start_over")) as string;
    const st = calls.find(([c]) => c === "weekly_state_write")![1]!.state as { step: number; done: number[]; notes: string };
    expect([st.step, st.done, st.notes]).toEqual([0, [], ""]);
    expect(out).toMatch(/paused on step 4 is dropped/);
  });

  it("takes the Deferred list as deferred, and scheduled as before", async () => {
    answers.tasks_all = () => [row({ scheduled: "2099-01-01" })];
    const out = (await run("tasks.list", { view: "deferred" })) as string;
    expect(out).toMatch(/^1 task in deferred:/);
    expect(await run("tasks.list", { view: "scheduled" })).toBe(out);
  });

  it("starts and stops the summaries by their names, and by the old ones", async () => {
    answers.review_run_now = () => "run-1";
    await run("run.start", { run: "daily_summary", date: "2026-10-03" });
    await run("run.start", { run: "weekly_review", unattended: true });
    expect(calls.filter(([c]) => c === "review_run_now").map(([, a]) => a)).toEqual([
      { kind: "daily", day: "2026-10-03", unattended: false },
      { kind: "weekly", day: null, unattended: true },
    ]);
    // Every run is told when nobody's watching, not only an ingest.
    answers.contradictions_run = () => true;
    await run("run.start", { run: "nightly", unattended: true });
    await run("run.start", { run: "contradictions", unattended: true });
    expect(calls.filter(([c]) => c === "nightly_run_now" || c === "contradictions_run").map(([, a]) => a)).toEqual([
      { unattended: true },
      { unattended: true },
    ]);
    await run("run.stop", { run: "weekly_summary" });
    await run("run.stop", { run: "daily_review" });
    expect(calls.filter(([c]) => c === "reviews_stop").map(([, a]) => a)).toEqual([{ kind: "weekly" }, { kind: "daily" }]);
    await expect(run("run.start", { run: "monthly" })).rejects.toThrow(/daily_summary, weekly_summary/);
  });

  describe("the weekly review", () => {
    const task = { path: "Me. To Do List.md", line: 11, lineText: "- [ ] Call Sam about the launch", text: "Call Sam about the launch" };
    const state = {
      week: "2099-W01",
      step: 2,
      done: [0, 1],
      log: ["Added “Book the room”"],
      notes: "A busy week.",
      startedAt: 1,
      handled: { s0: "skipped" },
    };
    const prep = {
      week: "2099-W01",
      preparedAt: "2099-01-02T12:00:00",
      model: "m",
      stamp: "",
      dropped: 0,
      suggestions: [
        { id: "s0", step: "next", text: "Done already", source: null, action: { do: "tick", task } },
        {
          id: "s1",
          step: "next",
          text: "The launch call happened",
          source: { path: "Meeting. Launch.md", quote: "called Sam" },
          action: { do: "tick", task },
        },
        { id: "s2", step: "loose", text: "Anything from the offsite?", source: null, action: null },
      ],
    };
    beforeEach(() => {
      answers.weekly_state_read = () => state;
      answers.weekprep_status = () => ({ prep, running: false, error: null });
      answers.projects_list = () => [];
      answers.tasks_all = () => [row({})];
      answers.task_toggle = edited;
    });

    it("gives the week, the progress and the suggestions still to decide, by step", async () => {
      const out = (await run("weekly.status")) as string;
      expect(out).toContain("The weekly review for 2099-W01.");
      expect(out).toContain("on step 3 of 11, Process this week's notes; 2 done (Collect loose ends, Empty the inbox)");
      expect(out).toContain("Notes: A busy week.");
      expect(out).toContain("2 still to decide, 1 accepted or skipped");
      expect(out.indexOf("Collect loose ends:")).toBeLessThan(out.indexOf("Next actions:"));
      expect(out).toContain(
        "- The launch call happened · from Meeting. Launch.md (“called Sam”) · accepting: Tick “Call Sam about the launch” off as done  (id s1)",
      );
      expect(out).not.toContain("Done already");
    });

    it("gives the week's review note once it's finished", async () => {
      answers.weekly_state_read = () => null;
      answers.weekly_review_note = () => "Me. Weekly Review - 2099-W01.md";
      const out = (await run("weekly.status")) as string;
      expect(out).toContain("Finished: the user's review of the week is in Me. Weekly Review - 2099-W01.md");
      expect(out).not.toContain("Not started");
    });

    it("accepts a suggestion with the screen's undoable action, and keeps it with the progress", async () => {
      const out = (await run("weekly.suggestion", { id: "s1", action: "accept" })) as string;
      expect(out).toMatch(/^Accepted: Ticked/);
      expect(calls.some(([c]) => c === "task_toggle")).toBe(true);
      const saved = calls.find(([c]) => c === "weekly_state_write")![1]!.state as typeof state;
      expect(saved.handled).toEqual({ s0: "skipped", s1: "accepted" });
      expect(saved.log).toEqual(["Added “Book the room”", "Ticked"]);
    });

    it("skips one, and refuses a prompt, one dealt with, or an unknown id", async () => {
      await run("weekly.suggestion", { id: "s2", action: "skip" });
      expect((calls.find(([c]) => c === "weekly_state_write")![1]!.state as typeof state).handled).toEqual({
        s0: "skipped",
        s2: "skipped",
      });
      await expect(run("weekly.suggestion", { id: "s2", action: "accept" })).rejects.toThrow(/prompt to think about/);
      await expect(run("weekly.suggestion", { id: "s0", action: "skip" })).rejects.toThrow(/skipped already/);
      await expect(run("weekly.suggestion", { id: "nope", action: "skip" })).rejects.toThrow(/No suggestion/);
    });
  });

  describe("tools for what the screens do", () => {
    const report = {
      checks: [
        {
          id: "missing-pages",
          title: "Missing pages",
          classic: true,
          items: [{ text: "[[Northwind]]", name: "Northwind", pages: ["wiki/entities/Acme.md"], safe: false }],
        },
        {
          id: "duplicates",
          title: "Possible duplicates",
          classic: false,
          items: [{ text: "Acme ~ Acme Ltd", page: "wiki/entities/Acme.md", pages: ["wiki/entities/Acme Ltd.md"], safe: false }],
        },
        {
          id: "orphans",
          title: "Orphan pages",
          classic: true,
          ignored: 2,
          items: [{ text: "Lena", page: "wiki/entities/Lena.md", safe: false }],
        },
        { id: "stale-pages", title: "Stale pages", classic: false, items: [{ text: "Maya", page: "wiki/entities/Maya.md", safe: false }] },
        {
          id: "updated",
          title: "Stale updated: dates",
          classic: true,
          items: [{ text: "Acme: updated is old", page: "wiki/entities/Acme.md", safe: true }],
        },
      ],
    };
    beforeEach(() => {
      answers.health_report = () => ({ report, history: [], ranAt: null });
    });

    it("lint gives the screen's report: counted or not, safe fixes and ignored issues", async () => {
      const out = (await run("health.lint")) as string;
      expect(out).toMatch(/Orphan pages \(1; check orphans\)/);
      expect(out).toMatch(/\n\nIgnored, so not listed: Orphan pages 2\./);
      expect(out).toMatch(/Stale pages \(1, not counted/);
      expect(out).toMatch(/Acme: updated is old \[safe fix\]/);
      expect(await run("health.lint", { page: "Lena" })).toMatch(/^Knowledge health for Lena:\n\nOrphan pages \(1; check orphans\)/);
    });

    it("does an issue's own buttons, and Ignore only where the screen has it", async () => {
      answers.health_create_page = () => "wiki/concepts/Northwind.md";
      await run("health.issue", { action: "create", item: "[[Northwind]]", folder: "concepts" });
      expect(calls.find(([c]) => c === "health_create_page")![1]).toEqual({ name: "Northwind", folder: "concepts" });
      answers.links_resolve = () => ["wiki/entities/Acme.md"];
      answers.health_link_ghost = () => 1;
      expect(await run("health.issue", { action: "link_to", item: "[[Northwind]]", to: "Acme" })).toMatch(/in 1 page, each a change/);
      expect(calls.find(([c]) => c === "health_link_ghost")![1]).toEqual({
        target: "Northwind",
        to: "wiki/entities/Acme.md",
        pages: ["wiki/entities/Acme.md"],
        unattended: false,
      });
      await run("health.issue", { action: "not_duplicates", item: "Acme ~ Acme Ltd" });
      expect(calls.find(([c]) => c === "health_dismiss")![1]).toEqual({ a: "wiki/entities/Acme.md", b: "wiki/entities/Acme Ltd.md" });
      expect(await run("health.issue", { action: "not_duplicates", item: "Lena" })).toMatch(/isn't an issue/);
      expect(await run("health.ignore", { item: "[[Northwind]]" })).toMatch(/buttons of their own/);
      expect(calls.some(([c]) => c === "health_ignore")).toBe(false);
      await run("health.ignore", { item: "Lena" });
      expect(calls.find(([c]) => c === "health_ignore")![1]).toEqual({ check: "orphans", text: "Lena" });
    });

    it("tells Reshape pages and Write Current state when nobody's watching", async () => {
      answers.health_reshape = () => ({ run: "r", applied: 0, failed: [], left: 0 });
      answers.current_state_start = () => true;
      answers.current_state_status = () => ({
        running: true,
        run: "r",
        total: 1,
        done: 0,
        written: 0,
        nothing: 0,
        failed: [],
        error: null,
        model: "m",
      });
      await run("health.reshape", { unattended: true });
      await run("health.current_state", { unattended: true });
      expect(calls.find(([c]) => c === "health_reshape")![1]).toEqual({ pages: null, unattended: true });
      expect(calls.find(([c]) => c === "current_state_start")![1]).toEqual({ pages: null, limit: null, unattended: true });
    });

    it("lists contradictions, marks one and saves the report through Changes", async () => {
      const rep = {
        last: {
          started: "2026-10-05T10:00",
          finished: "2026-10-05T10:05",
          running: false,
          doing: "",
          pages: 3,
          extracted: 3,
          claims: 5,
          clashes: 1,
          judged: 1,
          contradictions: 1,
          proposed: 0,
          failed: 0,
          failures: [],
          error: null,
        },
        items: [
          {
            id: "c1",
            subject: "Orbit App",
            attribute: "launch date",
            claims: [{ page: "wiki/entities/Orbit App.md", value: "March", quote: "launches in March" }],
            verdict: {
              id: "c1",
              verdict: "contradiction",
              severity: "high",
              summary: "Two dates.",
              correct: "",
              fix: "",
              patch: null,
              judged: "",
            },
          },
        ],
      };
      answers.contradictions_report = () => rep;
      rep.items.push({
        id: "c2",
        subject: "Maya",
        attribute: "role",
        claims: [],
        verdict: { id: "c2", verdict: "compatible", severity: "low", summary: "Same role.", correct: "", fix: "", patch: null, judged: "" },
      });
      const open = (await run("contradictions")) as string;
      expect(open).toMatch(/ 1 to decide; 1 more not a conflict/);
      expect(open).toMatch(/Orbit App · launch date \(id c1\): contradiction, high/);
      expect(open).not.toMatch(/Maya/);
      expect(await run("contradictions", { all: true })).toMatch(/Maya · role/);
      await run("contradictions", { action: "mark", id: "c1", as: "resolved" });
      expect(calls.find(([c]) => c === "contradictions_mark")![1]).toEqual({ id: "c1", verdict: "resolved" });
      await expect(run("contradictions", { action: "mark", id: "c1", as: "fixed" })).rejects.toThrow(/resolved/);
      let tries = 0;
      answers.changes_submit_many = () => {
        if (tries++ === 0) throw new Error("There's already a page at that path.");
        return [{ applied: true, message: "Made it.", flags: [] }];
      };
      expect(await run("contradictions", { action: "save" })).toBe("Made it.");
      const sent = calls.filter(([c]) => c === "changes_submit_many").map(([, a]) => (a!.changes as { page: string }[])[0].page);
      expect(sent[1]).toMatch(/^Contradictions - \d{4}-\d\d-\d\d-2\.md$/);
    });

    it("goes through the weekly review: start, done, notes and finish", async () => {
      let saved: unknown = null;
      answers.weekly_state_read = () => saved;
      answers.weekly_state_write = (a) => void (saved = a!.state);
      answers.weekly_finish = () => "Me. Weekly Review - 2099-W01.md";
      await expect(run("weekly.step", { action: "done" })).rejects.toThrow(/isn't started/);
      expect(await run("weekly.step", { action: "start" })).toMatch(/step 1 of 11/);
      expect(await run("weekly.step", { action: "done" })).toMatch(/Now step 2 of 11/);
      await run("weekly.step", { action: "notes", log: "Dropped the Garden project" });
      await run("weekly.step", { action: "notes", text: "A good week." });
      expect(saved).toMatchObject({ step: 1, done: [0], log: ["Dropped the Garden project"], notes: "A good week." });
      expect(await run("weekly.step", { action: "finish" })).toMatch(/Saved the review/);
      const body = calls.find(([c]) => c === "weekly_finish")![1]!.body as string;
      expect(body).toMatch(/^2 of 11 steps done\.\n\n- Dropped the Garden project\n\nA good week\.$/);
      expect(saved).toBe(null);
    });

    it("lists, reads, renames and trashes Ask's chats", async () => {
      const c = { filename: "local:a.json", id: "a", title: "Orbit App plan", updatedAt: "2026-10-05T09:00:00" };
      answers.chats_list = () => [c];
      answers.chat_read = () => ({
        ...c,
        transcript: [
          { id: "1", role: "user", text: "Hi" },
          { id: "2", role: "tool", text: "x" },
          { id: "3", role: "assistant", text: "Hello" },
        ],
      });
      expect(await run("chats")).toMatch(/Orbit App plan · 2026-10-05 09:00 · not saved/);
      expect(await run("chats", { action: "read", chat: "orbit app plan" })).toBe(
        "Orbit App plan (2 messages):\n\nUser: Hi\n\nAssistant: Hello",
      );
      await run("chats", { action: "rename", chat: "local:a.json", title: "Launch" });
      expect(calls.find(([c]) => c === "chat_rename")![1]).toEqual({ filename: "local:a.json", title: "Launch" });
      await run("chats", { action: "trash", chat: "local:a.json" });
      expect(calls.find(([c]) => c === "chat_trash")![1]).toEqual({ filename: "local:a.json" });
    });

    it("saves a task list and shows its tasks", async () => {
      answers.settings_write = (a) => a!.settings;
      await run("task_lists", { action: "save", name: "Quick calls", view: "next", context: "@calls", effort: 15 });
      expect(await run("task_lists")).toBe("- Quick calls: next, @calls, 15 min or less");
      answers.tasks_all = () => [
        row({ contexts: ["calls"], effortMin: 10 }),
        row({ line: 3, contexts: ["calls"], effortMin: 60, text: "Long call" }),
        row({ line: 4, text: "Not a call" }),
      ];
      answers.inbox_list = () => [];
      const out = (await run("tasks.list", { list: "Quick calls" })) as string;
      expect(out).toMatch(/^1 task in next:/);
      await expect(run("tasks.list", { list: "Nope" })).rejects.toThrow(/No saved list/);
      await run("task_lists", { action: "remove", name: "Quick calls" });
      expect(await run("task_lists")).toBe("No saved lists.");
    });

    it("reads and changes the settings it's allowed, never Read-only", async () => {
      answers.settings_write = (a) => a!.settings;
      expect(await run("settings")).toMatch(/nightlyTime · Settings › Jobs & schedule › Nightly check time: "02:10"/);
      expect(await run("settings", { action: "set", key: "nightlyTime", value: "03:30" })).toMatch(/is now "03:30"/);
      await run("settings", { action: "set", key: "reviews.weeklyReviewDay", value: "Thursday" });
      expect(await run("settings")).toMatch(/Weekly review day: "thu"/);
      await expect(run("settings", { action: "set", key: "readOnly", value: false })).rejects.toThrow(/the user's/);
      await expect(run("settings", { action: "set", key: "nightlyTime", value: "25:00" })).rejects.toThrow(/HH:MM/);
      await expect(run("settings", { action: "set", key: "spellCheck", value: "maybe" })).rejects.toThrow(/true or false/);
    });

    it("deletes a saved search", async () => {
      expect(await run("saved_searches", { name: "Launch", delete: true })).toBe("Deleted the saved search “Launch”.");
      expect(calls.find(([c]) => c === "smart_list_delete")![1]).toEqual({ name: "Launch" });
    });

    it("imports files into Sources", async () => {
      answers.sources_import = () => [
        { name: "Plan.pdf", path: "sources/Plan.pdf", error: null },
        { name: "Big.mov", path: null, error: "Over 200 MB" },
      ];
      expect(await run("sources.import", { paths: ["/tmp/Plan.pdf", "/tmp/Big.mov"] })).toBe(
        "Added to Sources: sources/Plan.pdf. Not added: Big.mov (Over 200 MB).",
      );
    });

    it("restores from the Trash under another path, and stops every run", async () => {
      answers.trash_restore = (a) => a!.as ?? "x.md";
      expect(await run("trash", { action: "restore", id: "t1", to: "Idea. Other.md" })).toBe("Restored to Idea. Other.md.");
      await run("run.stop", { run: "find_tasks" });
      await run("run.stop", { run: "write_current_state" });
      expect(calls.some(([c]) => c === "find_stop") && calls.some(([c]) => c === "current_state_stop")).toBe(true);
    });
  });

  it("refuses an action it doesn't know", async () => {
    await expect(run("nope")).rejects.toThrow(/doesn't know the action/);
  });
});
