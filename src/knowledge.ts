// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Changes (what assistants and runs changed, and what's held for you) and Knowledge health's last
// report, loaded once and reloaded when Rust says they changed: changes arrive from the MCP server
// and from runs in the background, and the checks rerun after the index changes.

import { api, ChangeOrigin, ChangeRow, HealthFix, HealthView, LintItem, LintReport } from "./api";
import { Store } from "./store";

export const changes = new Store<ChangeRow[] | null>(null);
export const health = new Store<HealthView | null>(null);

let started = false;

export function reloadChanges() {
  return api
    .changesList()
    .then((r) => changes.set(r))
    .catch(() => changes.set(changes.get() ?? []));
}

export function reloadHealth(fresh = false) {
  return api
    .healthReport(fresh)
    .then((r) => health.set(r))
    .catch(() => {});
}

/** Starts listening; safe to call from every screen that needs them. */
export function startKnowledge() {
  if (started) return;
  started = true;
  void reloadChanges();
  void reloadHealth();
  // Outside Tauri (tests) there are no events to listen to.
  api.onChangesChanged(() => void reloadChanges()).catch(() => {});
  api.onHealthChanged(() => void reloadHealth()).catch(() => {});
}

/** The changes waiting for you. */
export const held = (rows: ChangeRow[]) => rows.filter((c) => c.status === "held");

/** Where a change came from, for its row: "Ask · Sonnet", "Knowledge health", "Daily summary 2026-10-02". */
export function originLabel(c: ChangeRow): string {
  if (c.origin.kind === "lint") return c.origin.label === "Missing page" || !c.origin.label ? "Knowledge health" : c.origin.label;
  if (c.origin.kind === "review") return c.origin.label ? reviewLabel(c.origin.label) : "Scheduled run";
  if (c.origin.label) return c.origin.label;
  return c.origin.chat ? "Ask" : "An assistant";
}

/** A run's name in Changes: "Nightly check", "Ingest of Steerco", "Ask", "Terminal session". */
export function runLabel(c: ChangeRow): string {
  if (c.origin.run?.startsWith("nightly-")) return "Nightly check";
  if (c.origin.kind === "contradiction") return "Contradiction check";
  return originLabel(c);
}

/** Changes in runs, the runs newest first, each run's changes newest first. */
export function byRun(rows: ChangeRow[]): { group: string; label: string; rows: ChangeRow[] }[] {
  const m = new Map<string, ChangeRow[]>();
  for (const c of rows) m.set(c.group, [...(m.get(c.group) ?? []), c]);
  return [...m].map(([group, rs]) => ({ group, label: runLabel(rs[rs.length - 1]), rows: rs }));
}

/** A new page made at once, as an agent change (in Changes, revertable): "File this answer", a
 *  bookmark promoted to a wiki page, a note from a template. */
export function makePage(page: string, content: string, title: string, origin: ChangeOrigin) {
  return api.changeSubmit({ page, kind: "new", title, instruction: { op: "page", content }, origin });
}

/** `daily-summary 2026-10-02` → `Daily summary 2026-10-02`; `weekly-summary 2026-W40` → `Weekly summary 2026-W40`.
 *  Runs before the rename wrote `daily-review …` and `weekly-review …`, read the same. */
function reviewLabel(detail: string): string {
  const m = /^(daily|weekly)-(?:summary|review)\s+(.*)$/.exec(detail);
  return m ? `${m[1] === "daily" ? "Daily summary" : "Weekly summary"} ${m[2]}` : detail;
}

/** A page's name from its path. */
export const pageName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, "");

/** Checks that are worth a look but aren't problems: not counted in the sidebar. */
export const ADVISORY = new Set(["stale-pages", "uncited-claims", "no-current-state"]);

/** Issues that need you: everything Brainstead can't fix on its own. */
export function decisions(r: LintReport | null | undefined): number {
  if (!r) return 0;
  return r.checks.filter((c) => !ADVISORY.has(c.id)).reduce((n, c) => n + c.items.filter((i) => !i.safe).length, 0);
}

/** Every safe fix in the report, as health_fix takes them. */
export function safeFixes(r: LintReport | null | undefined): HealthFix[] {
  if (!r) return [];
  // Reshaping pages is its own action (Reshape pages), recorded in Changes rather than undone with ⌘Z.
  return r.checks.filter((c) => c.id !== "page-shape").flatMap((c) => c.items.filter((i) => i.safe && i.page).map((i) => fixOf(c.id, i)));
}

export const fixOf = (check: string, i: LintItem): HealthFix => ({ check, page: i.page!, name: i.name, detail: i.detail });

/** The trend line's points: one per day with a count, oldest first, scaled into w × h. */
export function trendPoints(history: [string, { decisions: number }][], w: number, h: number): string {
  if (history.length < 2) return "";
  const max = Math.max(1, ...history.map(([, d]) => d.decisions));
  return history
    .map(([, d], i) => `${((i / (history.length - 1)) * w).toFixed(1)},${(h - 4 - (d.decisions / max) * (h - 8)).toFixed(1)}`)
    .join(" ");
}

/** What Ask is asked to do about the issues that need judgement. */
export function fixWithAskPrompt(r: LintReport): string {
  const lines: string[] = [];
  for (const c of r.checks) {
    if (ADVISORY.has(c.id)) continue;
    const open = c.items.filter((i) => !i.safe);
    if (!open.length) continue;
    lines.push(`${c.title}:`);
    for (const i of open.slice(0, 15)) lines.push(`- ${i.text}`);
  }
  return [
    "Knowledge health found these issues in the wiki. For each one you can fix from the vault, make the fix with edit_page (one change per page; quote the source for any fact). Say which ones need me to decide.",
    "",
    ...lines,
  ].join("\n");
}
