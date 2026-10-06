// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// What an assistant does through Brainstead's MCP server (§10 stage 9). The server writes a request
// for the running app (src-tauri/src/bridge.rs), which hands it here; each action runs the same
// functions the screens call, so undo, log.md, the read-only switch, Templater and run history
// behave as they do on screen. Changes made straight away say so in a toast with Undo. Prose,
// renames, deletes, and task, Inbox and project edits (D-20261005-10) come as agent changes: worked
// out here or by the MCP server, then made or held by the rule in src-tauri/src/changes.rs, each
// recorded in Changes with Revert.

import { invoke } from "@tauri-apps/api/core";
import moment from "moment";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  ChangeKind,
  ChangeOrigin,
  ChangeOutcome,
  ChangeSubmit,
  CurrentStateRun,
  Instruction,
  FindSuggestion,
  FixNameRequest,
  InboxItem,
  ProjectRow,
  TaskDateKind,
  TaskLineEdit,
  TaskRow,
  WeeklyState,
  WeekPrepSuggestion,
} from "./api";
import { contextName, projectName } from "./gtd";
import { taskLine, unclarified } from "./Inbox";
import { appendAsReference, newReferenceNote, settleInboxItem } from "./inboxActions";
import { byRun, fixOf, makePage, originLabel, safeFixes } from "./knowledge";
import { localToday } from "./md/taskQuery";
import { composeFilename } from "./notes/filename";
import { Ask, Env, freeName, runTemplate, StopRun } from "./notes/templater";
import { vaultEnv } from "./notes/TemplateRun";
import { todayRows, toggleTaskEdit, undoAction, viewRows, VIEWS } from "./taskModel";
import { cancelled, completion, inQuote, LineChange, reopened, started, waitingToggled, withPriority } from "./tasksq/edits";
import type { PriorityName } from "./tasksq/fields";
import { toast } from "./Toast";
import { keepsPaused, reviewWeek, scheduleLabel, STEPS } from "./Weekly";
import { ask, isSaved, keepChat } from "./askState";
import { settings } from "./store";
import { choice, prepStep, WEEKLY_STATE_CHANGED } from "./weeklyPrep";
import { draftNotes, followThrough } from "./meetingFlow";

const TODO_LIST = "Me. To Do List.md";

/** A request as Rust hands it on (core/src/bridge.rs). */
export interface McpRequest {
  id: string;
  action: string;
  args: Record<string, unknown>;
  chat?: string | null;
  model?: string | null;
}

type Args = Record<string, unknown>;
const str = (a: Args, k: string): string | undefined =>
  typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : undefined;
const has = (a: Args, k: string) => k in a && a[k] !== undefined;

/** Says in the app what an assistant changed, with Undo. */
function told(what: string) {
  toast(`An assistant: ${what}`, undoAction, "ok");
}

/** As told, for what ⌘Z doesn't undo (runs, decisions in Changes, settings, Start over, Retire). */
function noted(what: string) {
  toast(`An assistant: ${what}`, undefined, "ok");
}

// ---- tasks

/** A task's words, without its tags, dates, fields and ids, to compare what a model gives with the
 *  line (the MCP server has the same rule). */
export function taskWords(s: string): string {
  return s
    .replace(
      /#[^\s#]+|[📅⏳🛫➕✅❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}|[🔺⏫🔼🔽⏬🔁🏁⛔🆔]\uFE0F?|[[(]\w+::[^\])]*[\])]|\^[\w-]+|\[\[([^\]|]*\|)?|\]\]|^\s*[-*+]\s+\[.\]\s*/gu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** `path:line` (1-based, as the tasks are listed) to a task, checked by its words. */
export function findTask(all: TaskRow[], id: string, text?: string): TaskRow {
  const m = /^(.*):(\d+)$/.exec(id.trim());
  if (!m) throw new Error(`“${id}” isn't a task id: use the path:line that list_tasks gives, as in Me. To Do List.md:12.`);
  const [, path, n] = m;
  const want = text ? taskWords(text) : "";
  const fits = (t: TaskRow) => {
    const have = taskWords(t.text);
    return !want || have.includes(want) || (!!have && want.includes(have));
  };
  const at = all.find((t) => t.path === path && t.line === Number(n) - 1);
  if (at && fits(at)) return at;
  if (want) {
    const same = all.filter((t) => t.path === path && fits(t));
    if (same.length === 1) return same[0];
  }
  throw new Error(`There's no task at ${id}${text ? ` reading “${text}”` : ""} any more. List the tasks again for its current place.`);
}

const taskId = (t: TaskRow) => `${t.path}:${t.line + 1}`;

/** A task's text as a list shows it: its tags, dates and effort come after it as fields. */
const shownText = (text: string) =>
  text
    .replace(/#[^\s#]+|[📅⏳🛫➕✅❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}|[[(]effort::[^\])]*[\])]|\^[\w-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** One line per task: its words, then its dates and chips, and its id to act on it by. */
export function taskLineOut(t: TaskRow, detail = false): string {
  const bits = [`[${t.status ?? (t.done ? "x" : " ")}] ${shownText(t.text)}`];
  if (t.due) bits.push(`due ${t.due}`);
  if (t.scheduled) bits.push(`deferred until ${t.scheduled}`);
  if (t.start) bits.push(`starts ${t.start}`);
  for (const c of t.contexts ?? []) bits.push(`@${c}`);
  if (t.effort) bits.push(`effort ${t.effort}`);
  for (const g of t.tags.map((x) => x.replace(/^#/, ""))) if (["waiting-for", "followup", "someday-maybe"].includes(g)) bits.push(`#${g}`);
  if (t.project) bits.push(`project ${projectName(t.project)}`);
  if (detail) {
    if (t.heading) bits.push(`under “${t.heading}”`);
    if (t.created) bits.push(`created ${t.created}`);
    if (t.doneOn) bits.push(`done ${t.doneOn}`);
  }
  return `- ${bits.join(" · ")}  (${taskId(t)})`;
}

/** A view's id as the assistants know it: the Deferred list is `deferred`. */
const viewName = (id: string) => (id === "scheduled" ? "deferred" : id);

async function listTasks(a: Args): Promise<string> {
  const all = await api.tasksAll();
  const today = localToday();
  // The Deferred list's id is `scheduled` (saved lists keep it); `deferred` is its name.
  const asked = str(a, "view") ?? "next";
  const view = asked === "deferred" ? "scheduled" : asked;
  let rows: TaskRow[];
  if (view === "today") {
    const r = todayRows(all, today);
    rows = [...r.overdue, ...r.due, ...r.scheduled];
  } else if (view === "all") {
    rows = all.filter((t) => !t.done);
  } else {
    const v = VIEWS.find((x) => x.id === view);
    if (!v) throw new Error(`No view “${view}”. Views: today, all, ${VIEWS.map((x) => viewName(x.id)).join(", ")}.`);
    rows = viewRows(all, v, today, view === "next" ? await api.inboxList() : null);
  }
  const project = str(a, "project")?.toLowerCase();
  if (project) rows = rows.filter((t) => t.project && projectName(t.project).toLowerCase() === project.replace(/^project\. /, ""));
  const context = str(a, "context");
  if (context) rows = rows.filter((t) => (t.contexts ?? []).includes(contextName(context)));
  const q = str(a, "query")?.toLowerCase();
  if (q) rows = rows.filter((t) => t.text.toLowerCase().includes(q));
  const limit = Math.min(Number(a.limit) || 50, 300);
  const shown = viewName(view);
  if (!rows.length) return `No tasks in ${shown}${project || context || q ? " with those filters" : ""}.`;
  const head = `${rows.length} task${rows.length === 1 ? "" : "s"} in ${shown}${rows.length > limit ? `, the first ${limit} (narrow with project, context or query, or raise limit)` : ""}:`;
  return [head, ...rows.slice(0, limit).map((t) => taskLineOut(t, a.detail === true))].join("\n");
}

const DATE_KEYS: [string, TaskDateKind][] = [
  ["due", "due"],
  ["defer", "scheduled"],
  ["start", "start"],
  ["created", "created"],
];

// ---- agent changes for tasks, the Inbox and projects (D-20261005-10)

/** Where an assistant's change comes from: the session the MCP server says (with unattended), else this chat. */
const originOf = (a: Args, r: McpRequest): ChangeOrigin =>
  (a.origin as ChangeOrigin | undefined) ?? { kind: "chat", chat: r.chat ?? undefined, run: r.chat ?? undefined };

/** A change to submit for this request. */
function sub(a: Args, r: McpRequest, page: string, kind: ChangeKind, title: string, instruction: Instruction): ChangeSubmit {
  return { page, kind, title, reason: str(a, "reason") ?? "", instruction, origin: originOf(a, r), model: r.model ?? null };
}

/** Submits changes that belong together; made, or held together when any is held. */
async function submitAll(list: ChangeSubmit[]): Promise<{ applied: boolean; message: string; outs: ChangeOutcome[] }> {
  const outs = await api.changesSubmitMany(list);
  const applied = outs.every((o) => o.applied);
  const message = applied
    ? outs.map((o) => o.message).join(" ")
    : `Held for the user in Changes: ${outs.map((o) => o.flags.join(" ")).find(Boolean) ?? "a check didn't pass."} Nothing is changed until they accept it.`;
  return { applied, message, outs };
}

async function editTask(a: Args, r: McpRequest): Promise<string> {
  const id = str(a, "task");
  if (!id) throw new Error("Which task? Give its id from list_tasks (path:line).");
  const t = findTask(await api.tasksAll(), id, str(a, "text"));
  const today = localToday();
  const day = moment(today, "YYYY-MM-DD");
  // The line worked out edit by edit (a recurring tick makes two; the rest act on the last), then
  // made as one change.
  let lines = [t.lineText];
  const done: string[] = [];
  const last = () => lines[lines.length - 1];
  const put = (next: string[]) => (lines = [...lines.slice(0, -1), ...next]);
  const rust = async (edit: TaskLineEdit) => put([await api.changeTaskLine(last(), edit)]);
  const ts = (f: (l: string) => LineChange) => put(inQuote(last(), f).lines);
  if (has(a, "done")) {
    const c = a.done ? inQuote(last(), (l) => completion(l, day)) : null;
    if (c) put(c.lines);
    else await rust({ op: "toggle", done: !!a.done, today });
    done.push(a.done ? "ticked" : "unticked");
  }
  for (const [k, kind] of DATE_KEYS) {
    if (!has(a, k)) continue;
    const v = a[k] === null || a[k] === "" ? null : String(a[k]);
    await rust({ op: "date", kind, date: v });
    done.push(v ? `${k} ${v}` : `cleared ${k}`);
  }
  if (has(a, "priority")) {
    ts((l) => withPriority(l, String(a.priority) as PriorityName));
    done.push(`priority ${a.priority}`);
  }
  if (has(a, "contexts")) {
    const cs = (Array.isArray(a.contexts) ? a.contexts : [a.contexts]).filter(Boolean).map((c) => contextName(String(c)));
    await rust({ op: "contexts", names: cs });
    done.push(cs.length ? `contexts ${cs.join(", ")}` : "cleared contexts");
  }
  if (has(a, "effort")) {
    await rust({ op: "effort", effort: a.effort ? String(a.effort) : null });
    done.push(a.effort ? `effort ${a.effort}` : "cleared effort");
  }
  if (has(a, "project")) {
    const p = a.project ? await projectPath(String(a.project)) : null;
    await rust({ op: "project", project: p });
    done.push(p ? `project ${projectName(p)}` : "no project");
  }
  if (has(a, "waiting")) {
    const now = t.tags.some((g) => g === "waiting-for" || g === "#waiting-for");
    if (!!a.waiting !== now) {
      ts(waitingToggled);
      done.push(a.waiting ? "waiting for" : "no longer waiting");
    }
  }
  const status = str(a, "status");
  if (status) {
    const how = ({ cancelled: (l: string) => cancelled(l, day), open: reopened, in_progress: started } as const)[
      status as "cancelled" | "open" | "in_progress"
    ];
    if (!how) throw new Error("status is cancelled, open or in_progress.");
    ts(how);
    done.push(status.replace("_", " "));
  }
  if (!done.length)
    throw new Error("Nothing to change: give done, due, defer, start, created, priority, contexts, effort, project, waiting or status.");
  const words = taskWords(t.text);
  const o = await submitAll([
    sub(a, r, t.path, "task", `Edit “${words}”: ${done.join(", ")}`, { op: "lines", at: t.line, old: [t.lineText], new: lines }),
  ]);
  told(o.applied ? `${done.join(", ")}: “${words}”` : `held a change to “${words}” for you in Changes`);
  if (!o.applied) return o.message;
  const now = (await api.tasksAll()).find((x) => x.path === t.path && x.lineText === last()) ?? t;
  return `Done (${done.join(", ")}). The task is now:\n${taskLineOut(now)}\n${o.message}`;
}

async function moveTask(a: Args, r: McpRequest): Promise<string> {
  const all = await api.tasksAll();
  const t = findTask(all, str(a, "task") ?? "", str(a, "text"));
  const ref = (k: string) => (str(a, k) ? findTask(all, str(a, k)!) : null);
  const after = ref("after");
  const before = ref("before");
  if (!after && !before) throw new Error("Give after or before: the id of the task it should follow or come ahead of.");
  const line = await api.changeTaskLine(t.lineText, { op: "rank", prev: after?.rank ?? null, next: before?.rank ?? null });
  const where = `${after ? ` after “${after.text}”` : ""}${before ? ` before “${before.text}”` : ""}`;
  const o = await submitAll([
    sub(a, r, t.path, "task", `Move “${taskWords(t.text)}”${where}`, { op: "lines", at: t.line, old: [t.lineText], new: [line] }),
  ]);
  told(o.applied ? `moved “${t.text}”` : `held a move of “${t.text}” for you in Changes`);
  return o.applied ? `Moved “${t.text}”${where}. ${o.message}` : o.message;
}

async function projectPath(name: string): Promise<string> {
  const want = name
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^Project\. /, "")
    .replace(/\.md$/, "")
    .toLowerCase();
  const p = (await api.projectsList()).find((x) => x.name.toLowerCase() === want);
  if (!p) throw new Error(`There's no project called ${name}. list_projects shows them.`);
  return p.path;
}

// ---- inbox

const inboxKey = (i: InboxItem) => `${i.kind}:${i.line + 1}`;

async function listInbox(): Promise<string> {
  const items = (await api.inboxList()).filter(unclarified);
  if (!items.length) return "The Inbox is empty.";
  const where = (i: InboxItem) =>
    i.kind === "capture" ? `capture ${i.path}` : i.kind === "thought" ? `Scratchpad ${i.stamp ?? ""}` : "To Do list › Other";
  return [
    `${items.length} item${items.length === 1 ? "" : "s"} to clarify:`,
    ...items.map((i) => `- ${i.text.replace(/\n/g, " ").slice(0, 200)} — ${where(i)}  (${inboxKey(i)})`),
  ].join("\n");
}

async function clarify(a: Args, r: McpRequest): Promise<string> {
  const key = str(a, "item") ?? "";
  const items = (await api.inboxList()).filter(unclarified);
  const i = items.find((x) => inboxKey(x) === key);
  if (!i) throw new Error(`No Inbox item ${key}. list_inbox shows them, each with its id.`);
  const { said, changes, after } = await clarifyChanges(i, a, r);
  if (!changes.length) {
    await after?.();
    told(`clarified “${i.text.slice(0, 60)}” as ${said}`);
    return `Clarified as ${said}.`;
  }
  const o = await submitAll(changes);
  if (o.applied) await after?.();
  told(o.applied ? `clarified “${i.text.slice(0, 60)}” as ${said}` : `held clarifying “${i.text.slice(0, 60)}” for you in Changes`);
  return o.applied
    ? `Clarified as ${said}. ${o.message}`
    : `${o.message}${i.kind === "capture" ? " The capture stays in the Inbox until then." : ""}`;
}

/** An Inbox item's block or line, to find it by. */
const itemLines = (i: InboxItem) =>
  (i.kind === "thought" ? (i.block ?? i.lineText) : i.lineText).replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");

/** What clarifying an item does to the vault, as agent changes (the Inbox screen's writes, from
 *  src/inboxActions.ts), and what to do once they're made (a capture marked done, an ingest). */
export async function clarifyChanges(
  i: InboxItem,
  a: Args,
  r: McpRequest,
): Promise<{ said: string; changes: ChangeSubmit[]; after?: () => Promise<unknown> }> {
  const becomes = str(a, "becomes");
  const text = str(a, "text") ?? (i.kind === "capture" ? `Follow up on [[${i.text}]]` : i.text.trim());
  const proj = str(a, "project") ? await projectPath(str(a, "project")!) : null;
  const fields = { text, project: proj, context: str(a, "context") ?? null, effort: str(a, "effort") ?? null, due: str(a, "due") ?? null };
  const short = i.text.replace(/\s+/g, " ").trim().slice(0, 60);
  const captureDone = i.kind === "capture" ? () => api.inboxCaptureDone(i.path) : undefined;
  // The item out of the Inbox: a task's line, a thought's block; a capture is marked done after.
  const takeOut = (): ChangeSubmit[] =>
    i.kind === "capture"
      ? []
      : [
          sub(a, r, i.path, i.kind === "task" ? "task" : "edit", `Take “${short}” out of the Inbox`, {
            op: "lines",
            at: i.line,
            old: itemLines(i),
            new: [],
          }),
        ];
  const addTask = (page: string, line: string) => sub(a, r, page, "task", `Add “${taskWords(line)}”`, { op: "add_task", line });
  // The item settled as a task line (src/inboxActions.ts's settleInboxItem).
  const settle = (line: string, toProject: string | null): ChangeSubmit[] =>
    i.kind === "task"
      ? toProject
        ? [...takeOut(), addTask(toProject, line)]
        : [sub(a, r, i.path, "task", `Clarify “${short}”`, { op: "lines", at: i.line, old: [i.lineText], new: [line] })]
      : [addTask(toProject ?? TODO_LIST, line), ...takeOut()];
  switch (becomes) {
    case "next":
      return {
        said: `a next action${proj ? ` in ${projectName(proj)}` : ""}`,
        changes: settle(taskLine(fields), proj),
        after: captureDone,
      };
    case "waiting":
      return { said: "waiting for", changes: settle(taskLine({ ...fields, tag: "waiting-for" }), proj), after: captureDone };
    case "someday":
      return { said: "someday / maybe", changes: settle(taskLine({ ...fields, tag: "someday-maybe" }), proj), after: captureDone };
    case "project": {
      const name = str(a, "project_name") ?? text;
      const note = await api.changeProjectNote(name, "active", str(a, "area") ?? null, str(a, "outcome") ?? null);
      const made = sub(a, r, note.path, "new", `New project ${projectName(note.path)}`, { op: "page", content: note.content });
      const rest = i.kind === "task" ? [...takeOut(), addTask(note.path, taskLine({ text: i.text.trim() }))] : takeOut();
      return { said: `the project ${projectName(note.path)}`, changes: [made, ...rest], after: captureDone };
    }
    case "done": {
      if (i.kind === "capture") return { said: "done", changes: [], after: captureDone };
      if (i.kind === "thought") return { said: "done", changes: takeOut() };
      const c = inQuote(i.lineText, (l) => completion(l, moment(localToday(), "YYYY-MM-DD")));
      const lines = c ? c.lines : [await api.changeTaskLine(i.lineText, { op: "toggle", done: true, today: localToday() })];
      return {
        said: "done",
        changes: [sub(a, r, i.path, "task", `Tick “${short}”`, { op: "lines", at: i.line, old: [i.lineText], new: lines })],
      };
    }
    case "reference": {
      if (i.kind === "capture") return { said: "kept in Sources", changes: [], after: captureDone };
      const note = str(a, "note");
      const title = str(a, "new_note");
      const body = i.text.trim();
      let filed: ChangeSubmit;
      if (note) {
        const path = note.endsWith(".md") ? note : `${note}.md`;
        filed = sub(a, r, path, "edit", `File “${short}” as reference`, { op: "append", text: `- ${body.replace(/\n/g, " ")}` });
      } else if (title) {
        const path = `${title.replace(/[/\\:*?"<>|]/g, "")}.md`;
        filed = sub(a, r, path, "new", `New note ${path.replace(/\.md$/, "")}`, { op: "page", content: `${body}\n` });
      } else throw new Error("To file it as reference, give note (a note's path to add it to) or new_note (a title).");
      return { said: `filed in ${note ?? title}`, changes: [filed, ...takeOut()] };
    }
    case "ingest":
      if (i.kind !== "capture") throw new Error("Only a capture (an email or Teams chat in Sources) can be ingested.");
      return {
        said: "ingesting; its changes are listed in Changes",
        changes: [],
        after: async () => {
          await api.ingestStart([i.path], originOf(a, r).trigger === "scheduled");
          await api.inboxCaptureDone(i.path);
        },
      };
    case "delete":
      if (i.kind === "capture")
        return {
          said: "deleted",
          changes: [sub(a, r, i.path, "trash", `Move ${i.path.replace(/\.md$/, "").split("/").pop()} to the Trash`, { op: "trash" })],
          after: captureDone,
        };
      return { said: "deleted", changes: takeOut() };
    default:
      throw new Error("becomes is next, waiting, someday, project, done, reference, ingest or delete.");
  }
}

/** Clarifies one Inbox item as `a` says (becomes, text, project…) and returns what it became, for
 *  the caller to say: the MCP server's clarify, and the weekly review's suggestions. */
export async function clarifyItem(i: InboxItem, a: Args): Promise<string> {
  const becomes = str(a, "becomes");
  const text = str(a, "text") ?? (i.kind === "capture" ? `Follow up on [[${i.text}]]` : i.text.trim());
  const proj = str(a, "project") ? await projectPath(str(a, "project")!) : null;
  const fields = { text, project: proj, context: str(a, "context") ?? null, effort: str(a, "effort") ?? null, due: str(a, "due") ?? null };
  let said: string;
  switch (becomes) {
    case "next":
      await settleInboxItem(i, taskLine(fields), proj);
      said = `a next action${proj ? ` in ${projectName(proj)}` : ""}`;
      break;
    case "waiting":
      await settleInboxItem(i, taskLine({ ...fields, tag: "waiting-for" }), proj);
      said = "waiting for";
      break;
    case "someday":
      await settleInboxItem(i, taskLine({ ...fields, tag: "someday-maybe" }), proj);
      said = "someday / maybe";
      break;
    case "project": {
      const name = str(a, "project_name") ?? text;
      const made = await api.projectCreate(name, "active", str(a, "area") ?? null, str(a, "outcome") ?? null);
      await settleInboxItem(i, i.kind === "task" ? taskLine({ text: i.text.trim() }) : null, made.path);
      said = `the project ${projectName(made.path)}`;
      break;
    }
    case "done":
      if (i.kind === "task") await toggleTaskEdit({ path: i.path, line: i.line, lineText: i.lineText }, true);
      else if (i.kind === "capture") await api.inboxCaptureDone(i.path);
      else await api.inboxRemoveThought(i.line, i.block ?? i.lineText);
      said = "done";
      break;
    case "reference": {
      if (i.kind === "capture") {
        await api.inboxCaptureDone(i.path);
        said = "kept in Sources";
        break;
      }
      const note = str(a, "note");
      const title = str(a, "new_note");
      if (note) await appendAsReference(note.endsWith(".md") ? note : `${note}.md`, i.text.trim());
      else if (title) await newReferenceNote(title, i.text.trim());
      else throw new Error("To file it as reference, give note (a note's path to add it to) or new_note (a title).");
      await settleInboxItem(i, null);
      said = `filed in ${note ?? title}`;
      break;
    }
    case "ingest":
      if (i.kind !== "capture") throw new Error("Only a capture (an email or Teams chat in Sources) can be ingested.");
      await api.ingestStart([i.path]);
      await api.inboxCaptureDone(i.path);
      said = "ingesting; its changes are listed in Changes";
      break;
    case "delete":
      if (i.kind === "capture") {
        await api.trashMove(i.path);
        await api.inboxCaptureDone(i.path);
      } else await settleInboxItem(i, null);
      said = "deleted";
      break;
    default:
      throw new Error("becomes is next, waiting, someday, project, done, reference, ingest or delete.");
  }
  return said;
}

// ---- projects

const projectOut = (p: ProjectRow) =>
  `- ${p.name} · ${p.status}${p.area ? ` · ${p.area}` : ""} · ${p.next} next, ${p.waiting} waiting, ${p.someday} someday, ${p.done} done${p.outcome ? ` · outcome: ${p.outcome}` : ""}  (${p.path})`;

async function updateProject(a: Args, r: McpRequest): Promise<string> {
  const path = await projectPath(str(a, "project") ?? "");
  const set: [string, string | null][] = [];
  const said: string[] = [];
  for (const k of ["status", "area", "outcome"] as const) {
    if (!has(a, k)) continue;
    const v = a[k] ? String(a[k]).trim() : null;
    if (k === "status" && !["active", "on-hold", "someday", "done"].includes(v ?? ""))
      throw new Error("status is active, on-hold, someday or done.");
    if (v?.includes("\n")) throw new Error(`The ${k} is one line.`);
    set.push([k, v || null]);
    said.push(v ? `${k} ${v}` : `cleared ${k}`);
  }
  if (!said.length) throw new Error("Give status (active, on-hold, someday, done), area or outcome.");
  const name = projectName(path);
  const o = await submitAll([sub(a, r, path, "edit", `Set ${said.join(", ")} for ${name}`, { op: "properties", set })]);
  told(o.applied ? `${said.join(", ")} for ${name}` : `held a change to ${name} for you in Changes`);
  return o.applied ? `Set ${said.join(", ")} for ${name}. ${o.message}` : o.message;
}

async function createProject(a: Args, r: McpRequest): Promise<string> {
  const name = str(a, "name");
  if (!name) throw new Error("Give the project's name.");
  const note = await api.changeProjectNote(name, str(a, "status") ?? "active", str(a, "area") ?? null, str(a, "outcome") ?? null);
  const o = await submitAll([sub(a, r, note.path, "new", `New project ${projectName(note.path)}`, { op: "page", content: note.content })]);
  told(o.applied ? `made the project ${name}` : `held the project ${name} for you in Changes`);
  return o.message;
}

// ---- notes

/** Runs a template as New note does, answering its questions from `answers` in order, and puts
 *  the note (an agent change, in Changes). */
async function noteFromTemplate(a: Args, chat: string | null): Promise<string> {
  const origin: ChangeOrigin = (a.origin as ChangeOrigin | undefined) ?? { kind: "chat", chat: chat ?? undefined, run: chat ?? undefined };
  const template = str(a, "template") ?? "";
  const files = (await api.filesList(null)).map((f) => f.path);
  const tpath = files.find(
    (p) =>
      p.startsWith("Templates/") &&
      (p === template || p.replace(/^Templates\//, "").replace(/\.md$/, "") === template.replace(/^Templates\//, "").replace(/\.md$/, "")),
  );
  if (!tpath)
    throw new Error(
      `No template “${template}”. The templates: ${
        files
          .filter((p) => p.startsWith("Templates/") && p.endsWith(".md"))
          .map((p) => p.slice(10, -3))
          .join(", ") || "none"
      }.`,
    );
  const answers = (Array.isArray(a.answers) ? a.answers : []).map(String);
  let n = 0;
  const asked: string[] = [];
  // Past the answers given, a question about the type, name or date takes the note's own.
  const guess = (text: string) =>
    /prefix|type|kind/i.test(text)
      ? str(a, "type")
      : /date|day|when/i.test(text)
        ? str(a, "date")
        : /name|title|topic|subject|who|with/i.test(text)
          ? str(a, "title")
          : undefined;
  const ask = async (q: Ask): Promise<string | number[] | null> => {
    const ans = answers[n++] ?? guess(q.text);
    if (q.kind === "prompt") {
      const v = ans ?? q.value;
      asked.push(`“${q.text}” → ${v || "(nothing)"}`);
      return v;
    }
    asked.push(`“${q.text}” → ${ans ?? "(no choice)"}`);
    if (ans === undefined) return null;
    const at = q.labels.findIndex((l) => l.toLowerCase() === ans.toLowerCase());
    return [at >= 0 ? at : Number(ans)];
  };
  const env = await vaultEnv(tpath, ask as Env["ask"], async () => {
    throw new Error("This template makes other notes too; run it from New note in the app.");
  });
  let r;
  try {
    r = await runTemplate((await api.docRead(tpath)).content, env);
  } catch (e) {
    if (e instanceof StopRun) throw new Error("The template stopped.", { cause: e });
    throw e;
  }
  const folder = (str(a, "folder") ?? "").replace(/^\/+|\/+$/g, "");
  const named = composeFilename({ type: str(a, "type") ?? null, title: str(a, "title") ?? "", date: str(a, "date") ?? null });
  const taken = new Set(files.map((p) => p.toLowerCase()));
  const path = r.named ? r.path : named ? (folder ? `${folder}/${named}` : named) : freeName(r.path, (p) => taken.has(p.toLowerCase()));
  if (taken.has(path.toLowerCase())) throw new Error(`${path} exists already. To change it, use edit_page.`);
  const o = await makePage(path, r.content, `New note ${path.replace(/\.md$/, "")}`, origin);
  told(o.applied ? `made the note ${path.replace(/\.md$/, "")}` : `held the note ${path.replace(/\.md$/, "")} for you in Changes`);
  const qa = asked.length ? ` The template asked: ${asked.join("; ")}.` : "";
  return `${o.message} It was made from ${tpath}.${qa}`;
}

// ---- agent changes

/** A change the MCP server checked: made or held by the rule, told in a toast. */
async function submitChange(a: Args): Promise<string> {
  const c = a.change as ChangeSubmit | undefined;
  if (!c) throw new Error("No change given.");
  const o = await api.changeSubmit(c);
  const name = c.page.replace(/\.md$/, "").split("/").pop();
  told(o.applied ? `changed ${name}: ${c.title}` : `held a change to ${name} for you in Changes`);
  return o.message;
}

/** The changes tool: the feed and the held changes, one change, accept, reject, revert. */
async function changesTool(a: Args): Promise<string> {
  const action = str(a, "action") ?? "list";
  const id = str(a, "id");
  if (action === "list") {
    const rows = await api.changesList(str(a, "page"));
    const heldRows = rows.filter((c) => c.status === "held");
    const made = rows.filter((c) => c.status !== "held").slice(0, 30);
    if (!rows.length) return "No changes yet.";
    const line = (c: (typeof rows)[number]) =>
      `- ${c.title} · ${c.page} · ${c.kind} · ${c.status}${c.flags.length ? ` · ${c.flags.join(" ")}` : ""} · ${originLabel(c)}  (id ${c.id})`;
    return [
      heldRows.length ? `${heldRows.length} held for the user:` : "Nothing held.",
      ...byRun(heldRows).flatMap((g) => [`Run “${g.label}” (group ${g.group}):`, ...g.rows.map(line)]),
      ...(made.length
        ? [
            "Made lately (newest first; revert undoes one, revert_run a whole run by its group):",
            ...byRun(made).flatMap((g) => [`Run “${g.label}” (group ${g.group}):`, ...g.rows.map(line)]),
          ]
        : []),
    ].join("\n");
  }
  if (action === "history") {
    const cur = settings.get();
    const days = has(a, "days") ? Number(a.days) : undefined;
    const mb = has(a, "mb") ? Number(a.mb) : undefined;
    if (days !== undefined && ![30, 90, 180, 365].includes(days)) throw new Error("days is 30, 90, 180 or 365.");
    if (mb !== undefined && ![100, 250, 500, 1000, 2000].includes(mb)) throw new Error("mb is 100, 250, 500, 1000 or 2000.");
    const size = (m: number) => (m >= 1000 ? `${m / 1000} GB` : `${m} MB`);
    if (days === undefined && mb === undefined)
      return `Changes keeps its history for ${cur.changesKeepDays ?? 90} days or up to ${size(cur.changesKeepMb ?? 500)}, whichever comes first (Settings › AI assistants › Keep the history of agent changes). Held changes are kept however old.`;
    settings.update({ ...(days !== undefined ? { changesKeepDays: days } : {}), ...(mb !== undefined ? { changesKeepMb: mb } : {}) });
    const now = settings.get();
    noted(`set Changes to keep ${now.changesKeepDays ?? 90} days or ${size(now.changesKeepMb ?? 500)} of history`);
    return `Changes now keeps its history for ${now.changesKeepDays ?? 90} days or up to ${size(now.changesKeepMb ?? 500)}, whichever comes first. Older history goes at the next daily tidy.`;
  }
  // Assistants accept only while the user is there, and only what was held for a failed check (D-20261005-09).
  if ((action === "accept" || action === "accept_run") && a.unattended === true)
    throw new Error(
      "Nothing held can be accepted in a session nobody is watching: the user accepts held changes on Brainstead's Changes screen.",
    );
  if (action === "accept_run" || action === "reject_run") {
    const group = str(a, "group");
    if (!group) throw new Error("Which run? Give its group from list.");
    const m = action === "accept_run" ? await api.changesAcceptAll(group, true) : await api.changesRejectAll(group);
    noted(`${action === "accept_run" ? "accepted" : "rejected"} ${m.done} held change${m.done === 1 ? "" : "s"}`);
    return `${action === "accept_run" ? "Accepted" : "Rejected"} ${m.done}.${m.failed.length ? ` Couldn't: ${m.failed.join("; ")}` : ""}`;
  }
  if (action === "revert_run") {
    const group = str(a, "group");
    if (!group) throw new Error("Which run? Give its group from list.");
    const m = await api.changesRevertAll(group);
    noted(`reverted ${m.done} change${m.done === 1 ? "" : "s"} from a run`);
    return `Reverted ${m.done}.${m.failed.length ? ` Left as they are (edited since): ${m.failed.join("; ")}` : ""}`;
  }
  if (!id) throw new Error("Which change? Give its id from the list.");
  if (action === "show") {
    const v = await api.changeGet(id);
    const changes = v.changes.map(
      (h) => `${h.section || "Start of the page"}:\n${h.old.map((l) => `- ${l}`).join("\n")}\n${h.new.map((l) => `+ ${l}`).join("\n")}`,
    );
    const quotes = v.quotes.map(
      (q) =>
        `- “${q.text}” from ${q.source}${q.checked === false ? " (not found in the source)" : q.checked === null ? " (not checked)" : ""}`,
    );
    return [
      `${v.title} · ${v.to ?? v.page} · ${v.kind} · ${v.status}`,
      v.reason && `Why: ${v.reason}`,
      v.flags.length ? `${v.status === "held" ? "Held because" : "Flagged"}: ${v.flags.join(" ")}` : "",
      v.problem ? `Can't be made: ${v.problem}` : "",
      ...changes,
      quotes.length ? `Quotes:\n${quotes.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (action === "accept") {
    const o = await api.changeAccept(id, true);
    noted("accepted a held change");
    return o.message;
  }
  if (action === "reject") {
    await api.changeReject(id);
    noted("turned down a held change");
    return "Rejected: the page is left as it is.";
  }
  if (action === "revert") {
    const r = await api.changeRevert(id);
    if (r.ok) noted("reverted a change");
    return r.ok ? r.message : `${r.message} (The page as it was before is in Changes, for the user to copy from.)`;
  }
  throw new Error("action is list, show, accept, reject, accept_run, reject_run, revert or history.");
}

// ---- runs

/** The summaries' runs, by their names and the names they had before the rename. */
const SUMMARY_RUNS: Record<string, "daily" | "weekly"> = {
  daily_summary: "daily",
  weekly_summary: "weekly",
  daily_review: "daily",
  weekly_review: "weekly",
};

async function startRun(a: Args): Promise<string> {
  const run = str(a, "run");
  const summary = run ? SUMMARY_RUNS[run] : undefined;
  // Nobody watching: every run's changes that fail a check are held, as a scheduled run's are.
  const unattended = a.unattended === true;
  if (summary) {
    const day = str(a, "date") || undefined;
    const r = await api.reviewRunNow(summary, day, unattended);
    noted(`started the ${summary} summary${day ? ` for ${day}` : ""}`);
    return `The ${summary} summary has started (${r}). It's written when it finishes; run_status shows it, and summary reads it.`;
  }
  switch (run) {
    case "ingest": {
      const sources = (Array.isArray(a.sources) ? a.sources : []).map(String);
      if (!sources.length) throw new Error("Give sources: the paths in sources/ to ingest.");
      const ids = await api.ingestStart(sources, unattended);
      noted(`started ingesting ${sources.length} source${sources.length === 1 ? "" : "s"}`);
      return `Ingesting ${sources.join(", ")} (run ${ids.join(", ")}). Its page changes are made and listed in Changes${unattended ? "; any that fail a check are held for the user" : ""}; run_status shows how it's going.`;
    }
    case "nightly":
      await api.nightlyRunNow(unattended);
      noted("started the nightly check");
      return "The nightly check has started; run_status shows how it's going.";
    case "find_tasks":
      await api.findRun();
      noted("started looking for tasks and projects in the notes");
      return "Reading the user's notes from the last 90 days for tasks and projects; the suggestions show at the top of Tasks and Projects, and nothing changes until the user accepts one. suggestions lists them.";
    case "weekly_prep":
      await api.weekprepRun();
      noted("started preparing the weekly review");
      return "Preparing this week's review has started; its suggestions show in the Weekly review when it finishes, and nothing changes until the user accepts one. run_status shows how it's going.";
    case "contradictions":
      if (!(await api.contradictionsRun(unattended))) return "A contradictions check is running already.";
      noted("started a contradictions check");
      return "The contradictions check has started; run_status shows how it's going, and its report comes to the Contradictions screen.";
    case "meeting_note": {
      const transcript = str(a, "transcript");
      const all = await api.meetingTranscripts();
      const t = all.find((x) => x.path === transcript);
      if (!t)
        throw new Error(
          `No transcript to do at ${transcript ?? "(none given)"}. The transcripts still to do: ${
            all
              .filter((x) => !x.done)
              .map((x) => x.path)
              .join(", ") || "none"
          }.`,
        );
      if (t.inferred.dateCheck && !str(a, "date"))
        throw new Error(
          `The date in ${t.path}'s name (${t.inferred.date}) is the day it was captured, which may not be the meeting's: ask the user for the meeting date and give it as date.`,
        );
      const spec = {
        type: str(a, "type") ?? t.inferred.type ?? "Meeting",
        name: str(a, "name") ?? t.inferred.name ?? t.inferred.topic ?? "",
        date: str(a, "date") ?? t.inferred.date ?? localToday(),
      };
      if (!spec.name) throw new Error("Give name: who the 1-1 was with, or the meeting's name.");
      await draftNotes([[t.path, spec]], unattended);
      noted(`started a meeting note from ${t.path}`);
      const f = followThrough();
      const then = [f.ingest && "ingested", f.trash && "the transcript moved to the Trash"].filter(Boolean).join(" and ");
      return `Drafting the ${spec.type} note “${spec.name}” for ${spec.date}; it's made in the vault when it's ready (listed in Changes)${then ? `, then ${then}` : ""}.`;
    }
    default:
      throw new Error("run is ingest, nightly, daily_summary, weekly_summary, weekly_prep, contradictions or meeting_note.");
  }
}

async function runStatus(): Promise<string> {
  const [runs, nightly, reviews, prep] = await Promise.all([api.ingestRuns(), api.nightlyStatus(), api.reviewsStatus(), api.weekprepJob()]);
  const active = runs.filter((r) => r.status === "running" || r.status === "queued");
  const recent = runs.slice(0, 5);
  return [
    active.length ? `Ingest running: ${active.map((r) => `${r.source} (${r.status}, run ${r.id})`).join("; ")}` : "No ingest running.",
    `Recent ingests: ${recent.map((r) => `${r.source} — ${r.status}${r.error ? ` (${r.error})` : ""}, ${r.proposals.length} change${r.proposals.length === 1 ? "" : "s"}`).join("; ") || "none"}`,
    `Nightly check: ${nightly.running ? `running (${nightly.doing}, ${Math.round(nightly.progress * 100)}%)` : `last ${nightly.lastRun ?? "never"}, next ${nightly.next ?? "not scheduled"}`}${nightly.summary ? ` — ${nightly.summary}` : ""}`,
    `Daily and weekly summaries: ${reviews.running.length ? `running the ${reviews.running.join(" and ")} summary; ` : ""}next daily ${reviews.next.daily ?? "not scheduled"}, next weekly ${reviews.next.weekly ?? "not scheduled"}`,
    `Weekly review preparation: ${
      prep.running
        ? `preparing ${prep.running}`
        : `last ${prep.last ? `${prep.last.startedAt} for ${prep.last.week} (${prep.last.status === "done" ? `${prep.last.count} suggestions` : `${prep.last.status}${prep.last.error ? `: ${prep.last.error}` : ""}`})` : "never"}, next ${prep.next ?? "not scheduled"}`
    }`,
  ].join("\n");
}

async function stopRun(a: Args): Promise<string> {
  const run = str(a, "run");
  const summary = run ? SUMMARY_RUNS[run] : undefined;
  if (summary) {
    await api.reviewsStop(summary);
    noted(`stopped the ${summary} summary`);
    return `Stopping the ${summary} summary.`;
  }
  if (run === "ingest") {
    const id = str(a, "id") ?? (await api.ingestRuns()).find((r) => r.status === "running")?.id;
    if (!id) return "No ingest is running.";
    await api.ingestStop(id);
  } else if (run === "nightly") await api.nightlyStop();
  else if (run === "weekly_prep") await api.weekprepStop();
  else if (run === "contradictions") await api.contradictionsStop();
  else throw new Error("run is ingest, nightly, daily_summary, weekly_summary, weekly_prep or contradictions.");
  noted(`stopped the ${run.replace("_", " ")}`);
  return `Stopping the ${run.replace("_", " ")}.`;
}

// ---- the weekly review

/** The review in progress (a paused one keeps its week), or the week a new one would be for. */
async function weeklyNow(): Promise<{ week: string; st: WeeklyState | null }> {
  const today = localToday();
  const saved = await api.weeklyStateRead().catch(() => null);
  return keepsPaused(saved, today) ? { week: saved.week, st: saved } : { week: reviewWeek(today), st: null };
}

/** An Inbox item to file as reference without a note named: the screen sends it to the Inbox. */
const toFile = (s: WeekPrepSuggestion) =>
  s.action?.do === "clarify" && s.action.becomes === "reference" && !s.action.text && s.action.item.kind !== "capture";

/** What accepting a suggestion does, in words; a prompt has nothing to accept. */
function offers(s: WeekPrepSuggestion, week: string, projects: ProjectRow[]): string {
  if (!s.action) return "nothing, it's a prompt to think about";
  if (toFile(s)) return "nothing, file it as reference with clarify_inbox and a note";
  return choice(s, week, projects)?.title ?? s.action.do;
}

async function weeklyStatus(): Promise<string> {
  const { week, st } = await weeklyNow();
  const [prep, projects] = await Promise.all([api.weekprepStatus(week), api.projectsList()]);
  const active = projects.filter((p) => p.status === "active");
  const r = settings.get().reviews;
  const job = await api.weekprepJob().catch(() => null);
  const out = [
    `The weekly review for ${week}. It's scheduled for ${scheduleLabel(r?.weeklyReviewDay, r?.weeklyReviewTime)} (Settings › Jobs & schedule); the user can start it any time from its start page.`,
  ];
  if (job?.next) out.push(`Its suggestions are next prepared on schedule at ${job.next}.`);
  const note = await api.weeklyReviewNote(week).catch(() => null);
  if (note) out.push(`Finished: the user's review of the week is in ${note} (read it with read_section; finishing again rewrites it).`);
  if (st) {
    const done = st.done.map((i) => STEPS[i]?.title).filter(Boolean);
    out.push(
      `In progress: on step ${st.step + 1} of ${STEPS.length}, ${STEPS[st.step]?.title}; ${done.length} done${done.length ? ` (${done.join(", ")})` : ""}.`,
    );
    if (st.log.length) out.push("So far:", ...st.log.map((l) => `- ${l}`));
    if (st.notes.trim()) out.push(`Notes: ${st.notes.trim()}`);
  } else if (!note) out.push(`Not started: ${STEPS.length} steps, from ${STEPS[0].title} to ${STEPS[STEPS.length - 1].title}.`);
  if (prep.running) out.push("Its suggestions are being prepared now.");
  if (prep.error) out.push(`The suggestions couldn't be prepared: ${prep.error}`);
  if (!prep.prep) {
    if (!prep.running && !prep.error) out.push("No suggestions are prepared for this week; start_run weekly_prep prepares them.");
    return out.join("\n");
  }
  const handled = st?.handled ?? {};
  const open = prep.prep.suggestions.filter((x) => !handled[x.id]);
  out.push(
    `Suggestions prepared ${prep.prep.preparedAt}: ${open.length} still to decide, ${prep.prep.suggestions.length - open.length} accepted or skipped.`,
  );
  for (const step of STEPS) {
    const rows = open.filter((x) => x.step === prepStep(step.id));
    if (!rows.length) continue;
    out.push("", `${step.title}:`);
    for (const x of rows) {
      const src = x.source ? ` · from ${x.source.path}${x.source.quote ? ` (“${x.source.quote}”)` : ""}` : "";
      out.push(`- ${x.text}${src} · accepting: ${offers(x, week, active)}  (id ${x.id})`);
    }
  }
  return out.join("\n");
}

async function weeklySuggestion(a: Args): Promise<string> {
  const id = str(a, "id");
  const how = str(a, "action");
  if (!id) throw new Error("Which suggestion? Give its id from weekly_review.");
  if (how !== "accept" && how !== "skip") throw new Error("action is accept or skip.");
  const { week, st } = await weeklyNow();
  const prep = (await api.weekprepStatus(week)).prep;
  const s = prep?.suggestions.find((x) => x.id === id);
  if (!s) throw new Error(`No suggestion ${id} for ${week}. weekly_review lists them.`);
  if (st?.handled?.[id]) throw new Error(`That suggestion was ${st.handled[id]} already.`);
  let line = "";
  if (how === "accept") {
    const projects = (await api.projectsList()).filter((p) => p.status === "active");
    const c = toFile(s) ? null : choice(s, week, projects);
    if (!c) throw new Error(`Accepting it does ${offers(s, week, projects)}. Skip it once it's dealt with.`);
    line = await c.run();
  }
  // Kept with the review's progress, as the screen keeps it, so it stays hidden there.
  const cur: WeeklyState = st ?? { week, step: 0, done: [], log: [], notes: "", startedAt: Date.now() };
  await api.weeklyStateWrite({
    ...cur,
    handled: { ...cur.handled, [id]: how === "accept" ? "accepted" : "skipped" },
    log: line ? [...cur.log, line] : cur.log,
  });
  window.dispatchEvent(new Event(WEEKLY_STATE_CHANGED));
  if (how === "skip") {
    noted(`skipped a weekly review suggestion: “${s.text.slice(0, 60)}”`);
    return `Skipped “${s.text}”.`;
  }
  return s.action?.do === "link"
    ? `Accepted: ${line}; the link is made (revertable in Changes).`
    : `Accepted: ${line}. ⌘Z in the app undoes it.`;
}

/** The weekly review's Start over: its progress, notes, decisions and handled suggestions dropped,
 *  from step 1 for this week. */
async function weeklyStartOver(): Promise<string> {
  const week = reviewWeek(localToday());
  const saved = await api.weeklyStateRead().catch(() => null);
  await api.weeklyStateWrite({ week, step: 0, done: [], log: [], notes: "", startedAt: Date.now() });
  window.dispatchEvent(new Event(WEEKLY_STATE_CHANGED));
  noted(`started the weekly review over for ${week}`);
  return `Started the weekly review over for ${week}: it's at step 1 of ${STEPS.length}${saved ? `; the review of ${saved.week} that was paused on step ${saved.step + 1} is dropped` : ""}. What it changed in the vault stays.`;
}

/** Settings › General › Moving over: whether the previous app's skills and scripts are still in the
 *  vault, and its Retire them (D-20261005-12). */
async function movingOver(a: Args): Promise<string> {
  const action = str(a, "action") ?? "status";
  const st = await api.switchoverStatus();
  const left = [st.skills && ".claude/skills/", st.scripts && "scripts/"].filter(Boolean);
  if (action === "status")
    return left.length
      ? `The previous app's ${left.join(" and ")} ${left.length === 1 ? "is" : "are"} still in the vault. Retire them (Settings › General › Moving over) moves them to Brainstead's Trash and tells agents in CLAUDE.md to use these tools.`
      : `The previous app's skills and scripts are retired${st.claudeMd ? ", and CLAUDE.md tells agents to use these tools" : ""}.`;
  if (action !== "retire") throw new Error("action is status or retire.");
  if (!left.length && st.claudeMd) return "Nothing to retire: the previous app's skills and scripts are gone already.";
  const said = await api.switchoverRetire();
  noted(`retired the previous app's skills and scripts`);
  return `${said} They can be restored from there.`;
}

// ---- knowledge

async function healthFix(a: Args): Promise<string> {
  const v = await api.healthReport(true);
  const r = v.report;
  if (!r) throw new Error("Knowledge health has no report yet; try again in a moment.");
  const all = safeFixes(r);
  const wanted = Array.isArray(a.items) ? (a.items as unknown[]).map(String) : null;
  const fixes = wanted
    ? r.checks
        .filter((c) => c.id !== "page-shape")
        .flatMap((c) => c.items.filter((i) => i.safe && wanted.includes(i.text)).map((i) => fixOf(c.id, i)))
    : all;
  if (!fixes.length)
    return wanted
      ? "None of those items has a safe fix. lint lists the issues; the ones marked safe can be fixed here."
      : "Nothing to fix safely.";
  const said = await api.healthFix(fixes);
  told(`fixed ${fixes.length} Knowledge health issue${fixes.length === 1 ? "" : "s"}`);
  return `${said} ⌘Z in the app undoes it.`;
}

/** ignore_issue: Knowledge health's Ignore, or Show again with show_again. */
async function healthIgnore(a: Args): Promise<string> {
  const v = await api.healthReport(true);
  const r = v.report;
  if (!r) throw new Error("Knowledge health has no report yet; try again in a moment.");
  if (a.show_again) {
    const check = typeof a.check === "string" && a.check ? a.check : null;
    const n = await api.healthUnignore(check);
    told(`showed ${n} ignored Knowledge health issue${n === 1 ? "" : "s"} again`);
    return n ? `${n} ignored issue${n === 1 ? " is" : "s are"} listed again.` : "Nothing was ignored.";
  }
  const text = String(a.item ?? "");
  const c = r.checks.find((c) => c.items.some((i) => i.text === text));
  const i = c?.items.find((i) => i.text === text);
  if (!c || !i) return "That issue isn't in Knowledge health: give its text as lint gives it.";
  if (i.safe) return "That issue has a safe fix: use fix_health instead.";
  await api.healthIgnore(c.id, text);
  told("ignored a Knowledge health issue");
  return "Ignored: it's left out of Knowledge health until its page changes. show_again lists it again.";
}

/** reshape_pages: Reshape pages, as Knowledge health's Page shape check does it. */
async function reshapePages(a: Args): Promise<string> {
  const pages = Array.isArray(a.pages) ? (a.pages as unknown[]).map(String).filter((p) => p.trim()) : null;
  const r = await api.healthReshape(pages?.length ? pages : null);
  told(`reshaped ${r.applied} wiki page${r.applied === 1 ? "" : "s"}`);
  return [
    `Reshaped ${r.applied} page${r.applied === 1 ? "" : "s"}, each a change in Changes (run group ${r.run}; changes revert_run undoes them all).`,
    r.failed.length ? `Couldn't: ${r.failed.join("; ")}` : "",
    r.left ? `${r.left} page${r.left === 1 ? "" : "s"} need the user first; page_shape says why.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** write_current_state: Knowledge health's Write Current state run: start it, or its status, or stop it. */
async function writeCurrentState(a: Args): Promise<string> {
  const said = (r: CurrentStateRun) =>
    `${r.running ? "Running" : "Last run"}: ${r.done} of ${r.total} pages done, ${r.written} written, ${r.nothing} with nothing current to say${r.failed.length ? `; couldn't: ${r.failed.join("; ")}` : ""}${r.run ? ` (run group ${r.run}; changes revert_run undoes it)` : ""}.`;
  if (a.stop === true) {
    await api.currentStateStop();
    return "Stopping after the page it's on.";
  }
  if (a.status === true) return said(await api.currentStateStatus());
  const pages = Array.isArray(a.pages) ? (a.pages as unknown[]).map(String).filter((p) => p.trim()) : null;
  const limit = typeof a.limit === "number" && a.limit > 0 ? Math.floor(a.limit) : null;
  const ok = await api.currentStateStart(pages?.length ? pages : null, limit);
  if (!ok) return `Write Current state is running already. ${said(await api.currentStateStatus())}`;
  told("started Write Current state");
  const r = await api.currentStateStatus();
  return `Started on ${r.total} page${r.total === 1 ? "" : "s"} with ${r.model}; each is a change in Changes. Ask with status for progress.`;
}

async function fixName(a: Args): Promise<string> {
  const wrong = str(a, "wrong");
  const right = str(a, "right");
  if (!wrong || !right) throw new Error("Give wrong (the name as it's misspelt) and right.");
  const req: FixNameRequest = { wrong, right, rightPage: null, guards: [], ambiguous: false, note: "", skipSubstitution: !a.remember };
  const plan = await api.fixnamePlan(req);
  const rows = plan.rows.filter((r) => r.action !== "skip");
  if (!a.apply) {
    if (!rows.length) return `“${wrong}” isn't written anywhere it would be changed.`;
    return [
      `Fixing “${wrong}” → “${right}” would change ${rows.length} file${rows.length === 1 ? "" : "s"}:`,
      ...rows.slice(0, 40).map((r) => `- ${r.file}: ${r.count} × (${r.action})`),
      "Call again with apply true to make the change.",
    ].join("\n");
  }
  const said = await api.fixnameApply({ ...req, rightPage: plan.rightPage }, plan.rows);
  told(`fixed the name “${wrong}” → “${right}”`);
  return said;
}

// ---- the rest

async function trash(a: Args): Promise<string> {
  const action = str(a, "action") ?? "list";
  if (action === "list") {
    const rows = await api.trashList();
    return rows.length
      ? rows.map((t) => `- ${t.originalRel} · deleted ${t.deletedAt.slice(0, 10)}  (id ${t.id})`).join("\n")
      : "The Trash is empty.";
  }
  if (action === "restore") {
    const id = str(a, "id");
    if (!id) throw new Error("Give id: the Trash entry to restore, from the list.");
    const to = await api.trashRestore(id, null);
    told(`restored ${to} from the Trash`);
    return `Restored to ${to}.`;
  }
  throw new Error("action is list or restore. Moving a note to the Trash is trash_note, which asks the user first.");
}

async function bookmarks(a: Args): Promise<string> {
  const page = str(a, "page");
  const keep = str(a, "keep");
  if (keep) {
    await api.bookmarkKeep(keep);
    told(`kept the bookmark ${keep}`);
    return `Kept the bookmark ${keep}: it won't need triage for two weeks.`;
  }
  if (!page) {
    const rows = await api.bookmarks();
    return rows.length ? rows.map((b) => `- ${b.title}${b.path ? ` (${b.path})` : " (missing)"}`).join("\n") : "No bookmarks.";
  }
  const on = await api.bookmarkToggle(page);
  told(on ? `bookmarked ${page}` : `took the bookmark off ${page}`);
  return on ? `Bookmarked ${page}.` : `Took the bookmark off ${page}.`;
}

async function savedSearches(a: Args): Promise<string> {
  const name = str(a, "name");
  const query = str(a, "query");
  if (!name || !query) {
    const rows = await api.smartLists();
    return rows.length ? rows.map((s) => `- ${s.name}: ${s.query}`).join("\n") : "No saved searches.";
  }
  await api.smartListSave(name, query, (Array.isArray(a.layers) ? a.layers : []).map(String));
  told(`saved the search ${name}`);
  return `Saved the search “${name}”.`;
}

async function activity(a: Args): Promise<string> {
  const date = str(a, "date");
  if (date) {
    const files = await api.activityDay(date);
    return files.length
      ? [`${files.length} file${files.length === 1 ? "" : "s"} changed on ${date}:`, ...files.slice(0, 80).map((f) => `- ${f.path}`)].join(
          "\n",
        )
      : `Nothing changed on ${date}.`;
  }
  const { log } = await api.activity();
  return log.length
    ? log
        .slice(0, Math.min(Number(a.limit) || 30, 200))
        .map((e) => `- ${e.date}${e.time ? ` ${e.time}` : ""} ${e.action} ${e.title}${e.description ? ` — ${e.description}` : ""}`)
        .join("\n")
    : "log.md is empty.";
}

async function graph(a: Args): Promise<string> {
  const g = await api.graph(str(a, "page") ?? null, Math.min(Math.max(Number(a.depth) || 1, 1), 3));
  const name = new Map(g.nodes.map((n) => [n.id, n.title ?? n.id]));
  const lines = g.edges.slice(0, 200).map(([s, t]) => `- ${name.get(s)} → ${name.get(t)}`);
  return [`${g.nodes.length} pages, ${g.edges.length} links${g.edges.length > 200 ? " (the first 200)" : ""}:`, ...lines].join("\n");
}

async function status(): Promise<string> {
  const [s, v, u, sw] = await Promise.all([
    api.settingsRead(),
    api.vaultStatus(),
    api.undoPeek(),
    api.switchoverStatus().catch(() => null),
  ]);
  const old = sw && (sw.skills || sw.scripts);
  return [
    `Vault: ${s.vaultPath ?? "none chosen"}${s.readOnly ? " (read-only: Brainstead won't change it until Settings › Vault › Read-only is off)" : ""}`,
    `Index: ${v.state === "ready" ? `${v.stats.files} files, ${v.stats.openTasks} open tasks` : v.state}`,
    `Brainstead runs the daily and weekly summaries (Settings › Jobs & schedule): ${s.reviewsHere ? "on" : "off"}`,
    u ? `⌘Z would undo: ${u.label}` : "Nothing to undo.",
    old
      ? "The previous app's skills or scripts are still in the vault (.claude/skills, scripts/): don't use them; use these tools. The user can retire them in Settings › General › Moving over."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The user's tools that start Claude Code sessions: list them (and suggestions), add or remove one. */
async function automated(a: Args): Promise<string> {
  const action = str(a, "action") ?? "list";
  const list = await api.automatedList();
  if (action === "list") {
    const sugg = await api.automatedSuggest();
    const line = (t: (typeof list)[number]) =>
      `- ${t.label}${t.cwd_contains ? ` · folder contains ${t.cwd_contains}` : ""}${t.opening ? ` · opens with “${t.opening}”` : ""}`;
    return [
      list.length ? `${list.length} listed:` : "No tools listed.",
      ...list.map(line),
      ...(sugg.length
        ? [
            "Folders whose sessions in the last two weeks were nearly all one prompt and done, as a tool's (not listed):",
            ...sugg.map((g) => `- ${g.cwd} · ${g.count} single-prompt sessions of ${g.total}`),
          ]
        : []),
    ].join("\n");
  }
  const name = str(a, "name");
  if (!name) throw new Error("Give the tool's name.");
  if (action === "add") {
    const t = { label: name, cwd_contains: str(a, "folder") ?? "", opening: str(a, "opening") ?? "" };
    await api.automatedSave([...list.filter((x) => x.label !== name), t]);
    told(`listed ${name} as a tool that starts sessions`);
    return `Listed ${name}: its sessions count as automated in the daily summary.`;
  }
  if (action === "remove") {
    if (!list.some((x) => x.label === name))
      throw new Error(`No tool called ${name}. The tools: ${list.map((x) => x.label).join(", ") || "none"}.`);
    await api.automatedSave(list.filter((x) => x.label !== name));
    told(`took ${name} off the tools that start sessions`);
    return `Took ${name} off: its sessions count as the user's work again.`;
  }
  throw new Error("action is list, add or remove.");
}

/** Find tasks and projects' suggestions: list them, accept one (optionally reworded) or skip one. */
async function suggestions(a: Args): Promise<string> {
  const action = str(a, "action") ?? "list";
  const s = await api.findStatus();
  if (action === "list") {
    const r = s.run;
    const line = (g: FindSuggestion) =>
      g.kind === "task"
        ? `- task: ${g.text}${g.project ? ` · project ${g.project}` : ""}${g.waiting ? " · waiting for" : ""}${g.due ? ` · due ${g.due}` : ""} · from ${g.sources.map((x) => `${x.path} (“${x.quote}”)`).join(", ")}  (id ${g.id})`
        : `- project: ${g.text}${g.outcome ? ` · outcome: ${g.outcome}` : ""}${g.tasks.length ? ` · first: ${g.tasks.join("; ")}` : ""} · from ${g.sources.map((x) => x.path).join(", ")}  (id ${g.id})`;
    return [
      r
        ? `Last look: ${r.status}${r.status === "running" ? ` (${r.done} of ${r.batches} parts)` : ""}, ${r.notes} notes read.`
        : "No look yet: start_run find_tasks starts one.",
      s.suggestions.length ? `${s.suggestions.length} suggestions:` : "No suggestions waiting.",
      ...s.suggestions.map(line),
    ].join("\n");
  }
  const id = str(a, "id");
  if (!id) throw new Error("Which suggestion? Give its id from the list.");
  if (action === "accept") {
    const edit: Record<string, unknown> = {};
    if (str(a, "text")) edit.text = str(a, "text");
    if (str(a, "outcome")) edit.outcome = str(a, "outcome");
    const m = await api.findDecide(id, "accept", Object.keys(edit).length ? edit : null);
    noted("accepted a suggested task or project");
    return m ?? "Made it.";
  }
  if (action === "skip") {
    await api.findDecide(id, "skip", null);
    noted("skipped a suggestion");
    return "Skipped: it won't be suggested again.";
  }
  throw new Error("action is list, accept or skip.");
}

/** Each action by name. */
const ACTIONS: Record<string, (a: Args, r: McpRequest) => Promise<unknown>> = {
  "tasks.list": listTasks,
  "task.edit": editTask,
  "task.move": moveTask,
  "inbox.list": listInbox,
  "inbox.clarify": clarify,
  "projects.list": async () => {
    const rows = await api.projectsList();
    return rows.length ? rows.map(projectOut).join("\n") : "No projects.";
  },
  "project.create": createProject,
  "project.update": updateProject,
  "note.from_template": (a, r) => noteFromTemplate(a, r.chat ?? null),
  "change.submit": submitChange,
  changes: changesTool,
  "run.start": startRun,
  "run.status": runStatus,
  "run.stop": stopRun,
  "health.fix": healthFix,
  "health.ignore": healthIgnore,
  "health.reshape": reshapePages,
  "health.current_state": writeCurrentState,
  fix_name: fixName,
  trash: trash,
  bookmarks: bookmarks,
  saved_searches: savedSearches,
  activity: activity,
  graph: graph,
  status: status,
  automated: automated,
  suggestions: suggestions,
  "triage.list": async () => {
    const rows = await api.bookmarksStatus();
    return (
      rows
        .map((b) => `- ${b.title}${b.missing ? " (missing)" : b.stale ? ` (untouched ${b.days} days)` : ""}  (${b.path ?? b.target})`)
        .join("\n") || "No bookmarks."
    );
  },
  "triage.suggest": (a) => api.bookmarksSuggest((Array.isArray(a.items) ? a.items : []) as { target: string; path: string }[]),
  "reply.draft": (a) => api.draftReply(str(a, "thread") ?? null, str(a, "text") ?? null, str(a, "tone") ?? "neutral"),
  "doccheck.register": () => api.canonicalRegister(),
  "doccheck.run": (a) => api.docCheck(str(a, "candidate") ?? "", str(a, "doc") ?? "", a.mode === "callouts" ? "callouts" : "standard"),
  "weekly.status": weeklyStatus,
  "weekly.suggestion": weeklySuggestion,
  "weekly.start_over": weeklyStartOver,
  moving_over: movingOver,
  "chat.save": async (a) => {
    const title = str(a, "title");
    const s = ask.get();
    const c = title ? s.chats.find((x) => x.title.toLowerCase() === title.toLowerCase()) : s.chats.find((x) => x.id === s.active);
    if (!c)
      throw new Error(
        `No open chat${title ? ` called “${title}”` : ""}. The open chats: ${s.chats.map((x) => `“${x.title}”`).join(", ") || "none"}.`,
      );
    if (isSaved(c)) return `“${c.title}” is saved already, as ${c.filename}; it keeps up to date there.`;
    const f = await keepChat(c.id);
    told(`saved the chat “${c.title}”`);
    return `Saved “${c.title}” to the vault as ${f}; it keeps up to date there as the chat goes on.`;
  },
  "meeting.transcripts": async () => {
    const all = await api.meetingTranscripts();
    return (
      all
        .filter((t) => !t.done)
        .map(
          (t) =>
            `- ${t.path} · looks like ${t.inferred.type ?? "a meeting"} ${t.inferred.name ?? t.inferred.topic ?? ""} ${t.inferred.date ?? ""}${t.inferred.dateCheck ? " (the capture day: check the meeting date)" : ""}`,
        )
        .join("\n") || "No transcripts still to write up."
    );
  },
};

/** Runs one request; what it gives back goes to the server as is (a string is shown as text). */
export async function runAction(r: McpRequest): Promise<unknown> {
  const f = ACTIONS[r.action];
  if (!f) throw new Error(`Brainstead doesn't know the action ${r.action}.`);
  return f(r.args ?? {}, r);
}

/** Why it failed, as one line for the assistant. */
function why(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Listens for requests from the bridge once, at startup, and says it's ready. */
export async function startMcpBridge() {
  const off = await listen<McpRequest>("mcp-request", (ev) => {
    const r = ev.payload;
    runAction(r)
      .then((result) => invoke("mcp_reply", { id: r.id, ok: true, result: result ?? "Done." }))
      .catch((e) => invoke("mcp_reply", { id: r.id, ok: false, result: why(e) }));
  });
  await invoke("mcp_ready").catch(() => {});
  return off;
}
