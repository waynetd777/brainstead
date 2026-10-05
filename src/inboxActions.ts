// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Taking an item out of the Inbox once it's clarified: the writes the Inbox screen makes, kept
// here so the MCP bridge (src/mcpActions.ts) makes the same ones.

import { api, InboxItem } from "./api";

/** Takes the item out of the Inbox: a thought's block goes; a task's line becomes `line` (or goes);
 *  a capture is marked done. With `toProject`, the new line goes under the project's `heading`. */
export async function settleInboxItem(
  i: InboxItem,
  line: string | null,
  toProject?: string | null,
  heading = "Next actions",
): Promise<unknown> {
  if (i.kind === "task") {
    if (toProject && line) return api.inboxMoveTask(i.line, i.lineText, toProject, heading, line);
    return api.taskReplace({ path: i.path, line: i.line, lineText: i.lineText }, line ? [line] : [], line ? "Clarified" : "Deleted");
  }
  if (line) {
    if (toProject) await api.projectAddTask(toProject, line.replace(/^- \[ \] /, ""), heading);
    else await api.capture("task", line.replace(/^- \[ \] /, ""), "");
  }
  if (i.kind === "capture") return api.inboxCaptureDone(i.path);
  return api.inboxRemoveThought(i.line, i.block ?? i.lineText);
}

/** Adds the item's text as a bullet at the end of a note (File as reference). */
export async function appendAsReference(path: string, text: string): Promise<void> {
  const d = await api.docRead(path);
  const body = d.content.replace(/\s*$/, "");
  const eol = d.content.includes("\r\n") ? "\r\n" : "\n";
  await api.docSave(path, `${body}${eol}${eol}- ${text.replace(/\n/g, " ")}${eol}`, d.version);
}

/** A new note holding the item (File as reference, to a note that isn't there yet). */
export async function newReferenceNote(title: string, text: string): Promise<string> {
  const path = `${title.replace(/[/\\:*?"<>|]/g, "")}.md`;
  await api.docCreate(path, `${text}\n`);
  return path;
}
