// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// What a rendered note says when it's read aloud: one block per paragraph, heading, list item,
// table row or callout title, in order. One walk over the page makes both the spoken text and, for
// each spoken character, where it is on the page, so the word highlight lands on the words being
// said. Rewrites for the ear keep that map: a tag loses its `#`, a date chip gets its meaning
// ("due"), a ticked task starts "Done", and a query block is summed up ("3 tasks listed").

/** One block read aloud: its element, its spoken text, and per spoken character the text node and
 *  offset it stands for (null for words added for the ear). */
export interface SpeechBlock {
  el: HTMLElement;
  text: string;
  at: ([Text, number] | null)[];
}

/** The elements that are blocks of their own. A block's text leaves out the blocks inside it. */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, tr, .callout-head, .tq";
/** Never read: code, diagrams, maths, citation numbers, the embed mark, footnote markers, images. */
const SKIP = "pre, .mermaid, .katex, .katex-display, a.cite, .embedmark, sup.footnote-ref, [data-footnote-ref], img, svg, input, .tqhead";

/** What a date chip's value is, said before it. */
const DATE_WORD: Record<string, string> = {
  due: "due",
  scheduled: "deferred until",
  start: "starts",
  created: "created",
  done: "done",
  cancelled: "cancelled",
};

const EMOJI = /\p{Extended_Pictographic}|️|‍/u;

/** A query block (Tasks or Dataview) said in a few words: "No tasks listed", "4 tasks listed". */
export function querySummary(el: Element): string {
  const n = (k: number, one: string, many: string) => (k === 0 ? `No ${many} listed` : `${k} ${k === 1 ? one : many} listed`);
  const tasks = el.querySelectorAll(".trow").length;
  if (tasks || /no matching tasks/i.test(el.textContent ?? "")) return n(tasks, "task", "tasks");
  const rows = el.querySelectorAll(".dvtable tbody tr").length;
  if (el.querySelector(".dvtable")) return n(rows, "row", "rows");
  if (el.querySelector(".dvcal")) return "A calendar";
  const items = el.querySelectorAll(".dvlist li").length;
  if (el.querySelector(".dvlist")) return n(items, "item", "items");
  return "A query";
}

/** Whether a node is hidden from the reader: inside a folded callout's body or a closed system note. */
function folded(n: Node): boolean {
  const d = (n instanceof Element ? n : n.parentElement)?.closest("details:not([open])");
  return !!d && !(n instanceof Element ? n : n.parentElement)?.closest("summary");
}

export function speechBlocks(root: HTMLElement): SpeechBlock[] {
  const out: SpeechBlock[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(BLOCK)) {
    if (el.closest(SKIP) || folded(el)) continue;
    // A block inside a query block is part of its summary; a row of a query's table too.
    const inQuery = el.parentElement?.closest(".tq");
    if (inQuery) continue;
    const b = blockOf(el);
    if (b.text.trim()) out.push(b);
  }
  return out;
}

function blockOf(el: HTMLElement): SpeechBlock {
  const text: string[] = [];
  const at: ([Text, number] | null)[] = [];
  let space = true; // as if after a space, so leading spaces go
  const put = (c: string, where: [Text, number] | null) => {
    const ws = /\s/.test(c);
    if (ws && space) return;
    text.push(ws ? " " : c);
    at.push(where);
    space = ws;
  };
  const say = (words: string) => {
    for (const c of words) put(c, null);
  };
  if (el.matches(".tq")) {
    say(querySummary(el));
    return finish(el, text, at);
  }
  // A ticked task: its own checkbox, not one in a task nested under it.
  const box = el.matches("li.task-list-item")
    ? [...el.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) => i.closest("li") === el)
    : undefined;
  if (box?.checked) say("Done. ");
  const walk = (node: Node) => {
    for (const n of node.childNodes) {
      if (n instanceof Text) {
        const t = n.data;
        const tag = n.parentElement?.closest(".mdtag, [data-tag]");
        for (let i = 0; i < t.length; i++) {
          const c = t[i];
          if (EMOJI.test(c) || (c >= "\uD800" && c <= "\uDFFF" && EMOJI.test(t.slice(i, i + 2)))) {
            if (c >= "\uD800" && c <= "\uDBFF") i++;
            continue;
          }
          // A tag is said as its words: `#project/orbit` is "project orbit".
          if (tag && c === "#") continue;
          put(tag && c === "/" ? " " : c, [n, i]);
        }
        continue;
      }
      if (!(n instanceof HTMLElement)) continue;
      if (n.matches(SKIP) || n.matches(BLOCK) || folded(n)) continue;
      if (n.matches(".tdate")) {
        const kind = [...n.classList].find((k) => k in DATE_WORD);
        if (kind) say(` ${DATE_WORD[kind]} `);
      }
      // A table's cells are read with a pause between them.
      if ((n.matches("td, th") && n.previousElementSibling) || n.matches("br")) say(", ");
      walk(n);
      if (n.matches(".callout-title")) say(". ");
    }
  };
  walk(el);
  return finish(el, text, at);
}

function finish(el: HTMLElement, text: string[], at: ([Text, number] | null)[]): SpeechBlock {
  while (text.length && text[text.length - 1] === " ") {
    text.pop();
    at.pop();
  }
  return { el, text: text.join(""), at };
}

/** The page range of the word around spoken character `char` of a block, for the highlight; null
 *  when the word is one added for the ear. */
export function wordRange(b: SpeechBlock, char: number): Range | null {
  if (char < 0 || char >= b.text.length) return null;
  const word = (k: number) => k >= 0 && k < b.text.length && b.text[k] !== " ";
  if (!word(char)) return null;
  let a = char;
  let z = char;
  while (word(a - 1)) a--;
  while (word(z + 1)) z++;
  // Words added for the ear have no place on the page; trim them off the ends.
  while (a <= z && !b.at[a]) a++;
  while (z >= a && !b.at[z]) z--;
  if (a > z) return null;
  const [sn, so] = b.at[a]!;
  const [en, eo] = b.at[z]!;
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo + 1);
  return r;
}

/** What's said before a note's first paragraph: its title, then its date when it has one, as
 *  "Orbit App Steerco. 30 September 2026." */
export function spokenIntro(title: string, date: string | null): string {
  const t = title.trim();
  const m = date ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date) : null;
  if (!m) return t ? `${t}.` : "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
  const when = d.toLocaleDateString(
    "en-GB",
    m[3] ? { day: "numeric", month: "long", year: "numeric" } : { month: "long", year: "numeric" },
  );
  return t ? `${t}. ${when}.` : `${when}.`;
}
