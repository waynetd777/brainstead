// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Inline `$…$` maths by pandoc's rule, so money stays money: the opening `$` has a non-space
// after it, the closing `$` a non-space before it and no digit after it, and `\$` is a dollar.
// "costs $5 and $10" is text; "$x^2$" is maths. It makes the same tokens as remark-math's own
// `$` construct (which is told to leave single dollars alone), so remark-math turns them into
// `inlineMath` nodes. `$$…$$` stays remark-math's, and `remarkDisplayMath` shows it as a block.

import type { Root } from "mdast";
// Its token types (mathText and the rest), declared for micromark.
import type {} from "micromark-extension-math";
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from "micromark-util-types";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";

const DOLLAR = 36;
const BACKSLASH = 92;
const isSpace = (c: Code) => c === null || c === 32 || c === 9 || c < 0 || c === 10 || c === 13;
const isDigit = (c: Code) => c !== null && c >= 48 && c <= 57;

/** The closing `$`: one, with no digit after it. */
const closing: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      return (after: Code) => (after === DOLLAR || isDigit(after) ? nok(after) : ok(after));
    };
  },
};

const mathText: Construct = {
  name: "pandocMathText",
  // Not straight after another `$` (that's `$$`, remark-math's) or after `\$` (an escape).
  previous(this: TokenizeContext, code: Code) {
    return code !== DOLLAR || this.events[this.events.length - 1]?.[1].type === "characterEscape";
  },
  tokenize(effects: Effects, ok, nok) {
    let prev: Code = null;
    const start: State = (code) => {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      return open;
    };
    const open: State = (code) => {
      if (isSpace(code) || code === DOLLAR) return nok(code);
      effects.enter("mathTextData");
      return data(code);
    };
    const data: State = (code) => {
      // One line only, and it must close.
      if (code === null || code < 0 || code === 10 || code === 13) return nok(code);
      if (code === DOLLAR && !isSpace(prev)) {
        effects.exit("mathTextData");
        return effects.attempt(closing, done, notClosing)(code);
      }
      prev = code;
      effects.consume(code);
      return code === BACKSLASH ? escaped : data;
    };
    // `\$` (or `\` and any character) inside: both are the formula's.
    const escaped: State = (code) => {
      if (code === null || code < 0 || code === 10 || code === 13) return nok(code);
      prev = code;
      effects.consume(code);
      return data;
    };
    const notClosing: State = (code) => {
      effects.enter("mathTextData");
      prev = code;
      effects.consume(code);
      return data;
    };
    const done: State = (code) => {
      effects.exit("mathText");
      return ok(code);
    };
    return start;
  },
};

/** The micromark extension: our `$` runs before remark-math's. */
export const pandocMath: Extension = { text: { [DOLLAR]: { ...mathText, add: "before" } } };

/** remark plugin: single-dollar maths by pandoc's rule. Use after remark-math with
 *  `singleDollarTextMath: false`. */
export function remarkPandocMath(this: unknown) {
  const data = (this as { data(): { micromarkExtensions?: Extension[] } }).data();
  (data.micromarkExtensions ??= []).push(pandocMath);
}

/** `$$…$$` within a line is shown as a block, as on its own lines. */
export function remarkDisplayMath() {
  return (tree: Root, file: VFile) => {
    const src = String(file.value ?? "");
    visit(tree, "inlineMath", (node) => {
      const at = node.position?.start.offset;
      if (at === undefined || !src.startsWith("$$", at)) return;
      node.data = { ...node.data, hProperties: { className: ["language-math"], dataMath: "display" } };
    });
  };
}
