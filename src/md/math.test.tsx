// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}`, invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), openPath: vi.fn() }));

import { Markdown } from "./Markdown";

afterEach(cleanup);

// KaTeX loads the first time it's needed, so tests wait for it.
const view = async (content: string) => render(<Markdown content={content} path="Note.md" root="/vault" />).container;

const formulas = (c: HTMLElement) =>
  [...c.querySelectorAll(".math")].map((m) => (m.classList.contains("math-display") ? "display" : "inline"));

describe("maths in View", () => {
  it.each(["costs $5 and $10", "$5-$10", "between $3.50 and $4", "price: $20.", "a $ b $ c"])("leaves money alone: %s", async (text) => {
    const c = await view(text);
    expect(c.querySelector(".math")).toBeNull();
    expect(c.textContent).toBe(text);
  });

  it("renders $x^2$ inline", async () => {
    const c = await view("so $x^2$ grows");
    await waitFor(() => expect(c.querySelector(".math-inline .katex")).toBeTruthy());
    expect(formulas(c)).toEqual(["inline"]);
    expect(c.textContent).toMatch(/^so .*x2.* grows$/s);
  });

  it("renders $$E=mc^2$$ as a block, on its line or on its own lines", async () => {
    const c = await view("$$E=mc^2$$\n\nand\n\n$$\nE=mc^2\n$$");
    await waitFor(() => expect(c.querySelectorAll(".katex-display")).toHaveLength(2));
    expect(formulas(c)).toEqual(["display", "display"]);
  });

  it("closes only on a $ with a non-space before it and no digit after", async () => {
    // KaTeX can't draw a bare $, so these show as written: the point is where they end.
    const c = await view("$a $ b$ and $c$1 d$");
    expect([...c.querySelectorAll(".math")].map((m) => m.textContent)).toEqual(["$a $ b$", "$c$1 d$"]);
  });

  it("treats \\$ as a dollar, outside maths and in it", async () => {
    const c = await view("\\$x$ and $\\$5 + y$");
    await waitFor(() => expect(c.querySelector(".katex")).toBeTruthy());
    expect([...c.querySelectorAll("annotation")].map((a) => a.textContent)).toEqual(["\\$5 + y"]);
    expect(c.textContent?.startsWith("$x$ and ")).toBe(true);
  });

  it("never renders maths in code spans or blocks", async () => {
    const c = await view("`$x^2$` and\n\n```\n$y^2$\n$$z$$\n```");
    expect(c.querySelector(".math")).toBeNull();
    expect(c.querySelector("code")?.textContent).toBe("$x^2$");
    expect(c.querySelector("pre")?.textContent).toContain("$$z$$");
  });

  it("shows a formula KaTeX can't read as written", async () => {
    const c = await view("bad $\\frac{1$ and good $y$");
    await waitFor(() => expect(c.querySelector(".katex")).toBeTruthy());
    expect(c.querySelector(".math-raw")?.textContent).toBe("$\\frac{1$");
  });

  it("renders the fixture's inline and block maths", async () => {
    const note = readFileSync("tests/fixtures/vault/Meeting. Orbit App Steerco - 2026-09-30.md", "utf8");
    const c = await view(note);
    await waitFor(() => expect(c.querySelectorAll(".katex")).toHaveLength(2));
    expect(formulas(c)).toEqual(["inline", "display"]);
    expect(c.querySelector(".math-raw")).toBeNull();
  });
});
