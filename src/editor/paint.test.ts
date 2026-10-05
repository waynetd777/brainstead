// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { paintLine } from "./paint";

const paint = (line: string, sel: string, c: Parameters<typeof paintLine>[3]) => {
  const from = line.indexOf(sel);
  const r = paintLine(line, from, from + sel.length, c);
  return r && { text: r.text, sel: r.text.slice(r.from, r.to) };
};

describe("paintLine", () => {
  it("writes yellow as == and other colours as marks", () => {
    expect(paint("a big word", "big", "yellow")).toEqual({ text: "a ==big== word", sel: "big" });
    expect(paint("a big word", "big", "red")).toEqual({ text: 'a <mark class="hl-red">big</mark> word', sel: "big" });
  });
  it("keeps spaces outside the marks", () => {
    expect(paint("a big word", " big ", "green")?.text).toBe('a <mark class="hl-green">big</mark> word');
  });
  it("recolours a highlight, and toggles it off in its own colour", () => {
    expect(paint("a ==big== word", "big", "blue")?.text).toBe('a <mark class="hl-blue">big</mark> word');
    expect(paint('a <mark class="hl-red">big</mark> word', "big", "red")?.text).toBe("a big word");
    expect(paint("a ==big== word", "big", null)?.text).toBe("a big word");
  });
  it("recolours the whole highlight from the caret", () => {
    const line = 'x <mark class="hl-red">one two</mark> y';
    const r = paintLine(line, line.indexOf("two"), line.indexOf("two"), "teal");
    expect(r?.text).toBe('x <mark class="hl-teal">one two</mark> y');
  });
  it("paints part of a highlight and keeps the rest", () => {
    expect(paint('<mark class="hl-red">one two three</mark>', "two", "blue")?.text).toBe(
      '<mark class="hl-red">one</mark> <mark class="hl-blue">two</mark> <mark class="hl-red">three</mark>',
    );
  });
  it("joins a highlight and its neighbour painted together", () => {
    expect(paint("==one== two", "one== two", "yellow")?.text).toBe("==one two==");
  });
  it("leaves the rest of the line exactly as it was", () => {
    const line = '<mark class="hl-yellow">kept</mark> and ==other== and new';
    expect(paint(line, "new", "red")?.text).toBe('<mark class="hl-yellow">kept</mark> and ==other== and <mark class="hl-red">new</mark>');
  });
  it("has nothing to do for a caret outside highlights", () => {
    expect(paintLine("plain", 2, 2, "red")).toBeNull();
  });
});
