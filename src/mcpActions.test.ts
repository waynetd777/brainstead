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

  it("refuses an action it doesn't know", async () => {
    await expect(run("nope")).rejects.toThrow(/doesn't know the action/);
  });
});
