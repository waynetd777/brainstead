// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Export PDF repeats a table's header row on each page it runs onto. WebKit's printing doesn't
// (checked 2026-10-03: a 120-row table's second page starts straight at a row), so just before
// printing the page is laid out as print lays it out, the rows are measured, and each table that
// crosses a page is split there into tables that start on a new page with the header again. The
// page is put back as it was once the PDF is written.
//
// The print layout: Export PDF prints to A4 with 36pt margins (platform::print_to_pdf), so
// 523 × 770pt of content, and WebKit lays a printed page out 1.25 times wider than that and
// shrinks it to fit (its minimum shrink factor), so a page is 653.75 CSS px wide and 962.5 tall.

export const PAGE_WIDTH_PX = 523 * 1.25;
export const PAGE_HEIGHT_PX = 770 * 1.25;
/** Room left at each page's foot, for what the measuring can't see (rounding, avoided breaks). */
export const SLACK_PX = 28;

export interface MeasuredTable {
  /** The table's top, in px from the top of the printed document. */
  top: number;
  /** The header row's height. */
  head: number;
  /** Each body row's top and bottom, in the same px. */
  rows: { top: number; bottom: number }[];
}

export interface TablePlan {
  /** The whole table starts on a new page (its header and first row don't fit where it is). */
  breakBefore: boolean;
  /** Body row indexes that start a continuation: a new page, with the header again. */
  splits: number[];
}

/**
 * Where each table (in document order) breaks. Positions are tracked on the printed pages: every
 * forced page start moves everything after it down to that page's top.
 */
export function planTables(tables: MeasuredTable[], pageH = PAGE_HEIGHT_PX, slack = SLACK_PX): TablePlan[] {
  // printed(y) = base + (y - from): measured px to px on the printed pages.
  let from = 0;
  let base = 0;
  const printed = (y: number) => base + (y - from);
  const pageEnd = (v: number) => (Math.floor(v / pageH) + 1) * pageH - slack;
  return tables.map((t) => {
    const plan: TablePlan = { breakBefore: false, splits: [] };
    if (!t.rows.length) return plan;
    let end = pageEnd(printed(t.top));
    // Not even the header and first row fit here: the table starts on the next page.
    if (printed(t.rows[0].bottom) > end && printed(t.top) % pageH > slack) {
      const next = Math.ceil(printed(t.top) / pageH) * pageH;
      base = next;
      from = t.top;
      plan.breakBefore = true;
      end = pageEnd(printed(t.top));
    }
    // The first row of a page always stays on it, however tall.
    let start = 0;
    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      if (i > start && printed(r.bottom) > end) {
        // Row i starts a new page, after a repeated header.
        const next = (Math.floor(printed(r.top) / pageH) + 1) * pageH;
        base = next + t.head;
        from = r.top;
        plan.splits.push(i);
        end = pageEnd(printed(r.top));
        start = i;
      }
    }
    return plan;
  });
}

/** Every rule inside an @media print block, rewritten to apply under `html.pm` instead. */
function printRulesAsClass(): string {
  const out: string[] = [];
  const scope = (sel: string) =>
    sel
      .split(",")
      .map((s) => {
        const x = s.trim();
        if (x.startsWith(":root")) return `html.pm${x.slice(5)}`;
        if (/^html\b/.test(x)) return `html.pm${x.slice(4)}`;
        return `html.pm ${x}`;
      })
      .join(", ");
  const walk = (rules: CSSRuleList, inPrint: boolean) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSMediaRule) walk(r.cssRules, inPrint || /\bprint\b/.test(r.media.mediaText));
      else if (inPrint && r instanceof CSSStyleRule) out.push(`${scope(r.selectorText)} { ${r.style.cssText} }`);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, false);
    } catch {
      // A sheet from another origin can't be read; Brainstead's own are all local.
    }
  }
  out.push(`html.pm body { width: ${PAGE_WIDTH_PX}px !important; }`);
  return out.join("\n");
}

const abs = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

/**
 * Splits the document's long tables for printing and returns how to put them back. Only tables
 * with a header row in the read view (`.prose`) are touched.
 */
export function splitTablesForPrint(root: ParentNode = document): { restore: () => void; forced: boolean } {
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>(".prose table")).filter(
    (t) => t.tHead && t.tBodies.length === 1 && t.tBodies[0].rows.length > 1,
  );
  if (!tables.length) return { restore: () => {}, forced: false };
  // Lay the page out as print does, measure, and put the screen layout back.
  const style = document.createElement("style");
  style.textContent = printRulesAsClass();
  document.head.appendChild(style);
  const html = document.documentElement;
  html.classList.add("pm");
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>(".body")).map((b) => [b, b.scrollTop] as const);
  let measured: MeasuredTable[];
  try {
    const top0 = abs(document.body);
    measured = tables.map((t) => ({
      top: abs(t) - top0,
      head: t.tHead!.getBoundingClientRect().height,
      rows: Array.from(t.tBodies[0].rows).map((r) => {
        const b = r.getBoundingClientRect();
        return { top: b.top + window.scrollY - top0, bottom: b.bottom + window.scrollY - top0 };
      }),
    }));
  } finally {
    html.classList.remove("pm");
    style.remove();
    scrollers.forEach(([b, y]) => (b.scrollTop = y));
  }
  const plans = planTables(measured);

  const undo: (() => void)[] = [];
  tables.forEach((t, k) => {
    const plan = plans[k];
    if (plan.breakBefore) {
      const was = t.style.breakBefore;
      t.style.breakBefore = "page";
      undo.push(() => (t.style.breakBefore = was));
    }
    if (!plan.splits.length) return;
    const body = t.tBodies[0];
    const rows = Array.from(body.rows);
    const bounds = [...plan.splits, rows.length];
    let after: Element = t;
    const parts: HTMLTableElement[] = [];
    for (let s = 0; s < plan.splits.length; s++) {
      const part = t.cloneNode(false) as HTMLTableElement;
      part.removeAttribute("id");
      part.style.breakBefore = "page";
      part.appendChild(t.tHead!.cloneNode(true));
      const tb = body.cloneNode(false) as HTMLTableSectionElement;
      for (const r of rows.slice(bounds[s], bounds[s + 1])) tb.appendChild(r);
      part.appendChild(tb);
      after.after(part);
      after = part;
      parts.push(part);
    }
    // Back as it was: the rows return to the table, in order, and the parts go.
    undo.push(() => {
      for (const r of rows) body.appendChild(r);
      parts.forEach((p) => p.remove());
    });
  });
  return { restore: () => undo.reverse().forEach((f) => f()), forced: undo.length > 0 };
}
