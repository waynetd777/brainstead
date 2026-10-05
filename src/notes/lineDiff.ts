// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Which lines differ between two texts, for the conflict banner's Compare: the longest common run
// of lines is kept, and every other line on each side is marked changed.

/** Past this many line pairs in the part that differs, every line in it is marked changed. */
const MAX_CELLS = 4_000_000;

export function lineDiff(a: string, b: string): { a: boolean[]; b: boolean[] } {
  const A = a.split(/\r?\n/),
    B = b.split(/\r?\n/);
  const ca = A.map(() => true),
    cb = B.map(() => true);
  // The same lines at the start and the end.
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) ca[s] = cb[s++] = false;
  let ea = A.length,
    eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) ca[--ea] = cb[--eb] = false;
  const n = ea - s,
    m = eb - s;
  if (!n || !m || n * m > MAX_CELLS) return { a: ca, b: cb };
  // The longest common subsequence of the middle, then walked back to mark what it keeps.
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i * w + j] = A[s + i] === B[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (A[s + i] === B[s + j]) {
      ca[s + i++] = false;
      cb[s + j++] = false;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  return { a: ca, b: cb };
}
