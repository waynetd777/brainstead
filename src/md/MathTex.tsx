// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Maths in View, drawn by KaTeX. KaTeX (and its stylesheet and fonts, bundled, never from the
// web) loads the first time a note has maths, to keep startup light. Until then, and for a
// formula KaTeX can't read, the markdown shows as written.

import { useEffect, useState } from "react";

type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => (katex = k.default));
  return loading;
}

/** KaTeX's HTML for a formula, or null if it can't be drawn. */
export function renderMath(k: Katex, tex: string, display: boolean): string | null {
  try {
    return k.renderToString(tex, { displayMode: display, throwOnError: true, output: "htmlAndMathml" });
  } catch {
    return null;
  }
}

export function MathTex({ tex, display, raw }: { tex: string; display: boolean; raw: string }) {
  const [k, setK] = useState(katex);
  useEffect(() => {
    if (k) return;
    let live = true;
    loadKatex()
      .then((m) => live && setK(() => m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [k]);
  const html = k ? renderMath(k, tex, display) : null;
  // A span either way: `$$…$$` can be inside a paragraph. KaTeX's display output is a block.
  const cls = display ? "math math-display" : "math math-inline";
  if (html === null) return <span className={`${cls} math-raw`}>{raw}</span>;
  return <span className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}
