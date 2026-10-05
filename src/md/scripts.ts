// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Which rendered markdown may run scripts: dataviewjs blocks, inline `$=` and the Tasks plugin's
// `filter/sort/group by function`. They run with the app's full access, so only in notes the user
// wrote; never in captured email or Teams (sources/), the model-kept wiki, Ask's answers, review
// proposals, notes an assistant wrote or any other text that came from outside (decided 2026-10-03).

/** What's drawn where a script was skipped. */
export const SCRIPTS_OFF = "Scripts don't run in captured or AI content";

/** The property marking a note an assistant wrote (Rust adds it to new notes from the review
 *  queue: brainstead_core::proposals::ASSISTANT_MARK). */
export const ASSISTANT_PROPERTY = "created-by";

/** The frontmatter that starts a note Brainstead saves from an assistant's text. */
export const ASSISTANT_FRONTMATTER = `---\n${ASSISTANT_PROPERTY}: assistant\n---\n`;

/** Whether a vault note may run its scripts when drawn: a markdown note outside sources/ and wiki/
 *  that an assistant didn't write. Its properties say so (`created-by: assistant`, or a saved chat's
 *  `type: chat`), as do the summary notes Brainstead keeps (`Me. Daily Summaries - 2026-10.md`, or
 *  `Me. Daily Reviews - …` before the rename). */
export function scriptsAllowed(path: string, frontmatter?: Record<string, unknown> | null): boolean {
  const rel = path.replace(/^\/+/, "");
  if (!/\.md$/i.test(rel) || /^(sources|wiki)\//i.test(rel)) return false;
  if (/^Me\. (Daily|Weekly) (Summaries|Reviews) - /.test(rel.split("/").pop() ?? "")) return false;
  const fm = frontmatter ?? {};
  return String(fm[ASSISTANT_PROPERTY] ?? "").toLowerCase() !== "assistant" && String(fm.type ?? "").toLowerCase() !== "chat";
}
