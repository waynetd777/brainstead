// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Three-way merge by lines, for a file changed on disk (another editor, a sync client) while it has unsaved
// edits here: both sides' changes go in when they touch different lines; otherwise it's a conflict
// and nothing is merged. Lines keep their own endings, so the merge never rewrites one.

/** A run of `base` lines [start, end) replaced by `lines`. */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** Lines with their endings, so joining them gives the text back exactly. */
export const splitKeep = (t: string): string[] => t.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const MAX_CELLS = 25_000_000;

/** What changed from a to b, as hunks over a. Null when the files are too big to compare. */
export function diffLines(a: string[], b: string[]): Hunk[] | null {
  // Same lines at both ends need no table.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (!A.length && !B.length) return [];
  if ((A.length + 1) * (B.length + 1) > MAX_CELLS) return null;
  // Longest common subsequence, from the end.
  const w = B.length + 1;
  const L = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      flush();
      i++;
      j++;
    } else if (j < B.length && (i === A.length || L[i * w + j + 1] >= L[(i + 1) * w + j])) {
      cur ??= { start: pre + i, end: pre + i, lines: [] };
      cur.lines.push(B[j++]);
    } else {
      cur ??= { start: pre + i, end: pre + i, lines: [] };
      i++;
      cur.end = pre + i;
    }
  }
  flush();
  return hunks;
}

export type MergeResult = { ok: true; text: string } | { ok: false };

/** Mine and theirs, both edited from base. */
export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === base) return { ok: true, text: theirs };
  if (theirs === base || theirs === mine) return { ok: true, text: mine };
  const b = splitKeep(base);
  const m = diffLines(b, splitKeep(mine));
  const t = diffLines(b, splitKeep(theirs));
  if (!m || !t) return { ok: false };
  const all = [...m.map((h) => ({ ...h, mine: true })), ...t.map((h) => ({ ...h, mine: false }))].sort(
    (x, y) => x.start - y.start || x.end - y.end,
  );
  // Two hunks clash if they overlap, or are both insertions at the same place, or touch.
  for (let k = 1; k < all.length; k++) {
    const p = all[k - 1];
    const q = all[k];
    if (p.mine === q.mine) continue;
    if (q.start < p.end || q.start === p.start || q.start === p.end) {
      // The same change on both sides is no conflict.
      const same = p.start === q.start && p.end === q.end && p.lines.join("") === q.lines.join("");
      if (!same) return { ok: false };
    }
  }
  const out: string[] = [];
  let at = 0;
  let last: (typeof all)[number] | null = null;
  for (const h of all) {
    if (last && h.start === last.start && h.end === last.end && h.lines.join("") === last.lines.join("")) continue;
    out.push(...b.slice(at, h.start), ...h.lines);
    at = h.end;
    last = h;
  }
  out.push(...b.slice(at));
  return { ok: true, text: out.join("") };
}
