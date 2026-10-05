// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

import { AskPanel } from "./TemplateRun";
import { templaterRanges } from "./templaterSyntax";

afterEach(cleanup);

describe("a template's questions", () => {
  it("answers a prompt with Enter, keeping the default", () => {
    const got: unknown[] = [];
    render(
      <AskPanel
        q={{ kind: "prompt", text: "Name?", value: "Bob", multiline: false, selectAll: false }}
        onAnswer={(a) => got.push(a)}
        onStop={() => {}}
      />,
    );
    const box = screen.getByLabelText("Name?");
    fireEvent.change(box, { target: { value: "Ada" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(got).toEqual(["Ada"]);
  });
  it("chooses with the arrows, filters, and cancels to no answer", () => {
    const got: unknown[] = [];
    render(
      <AskPanel
        q={{ kind: "suggest", text: "Level", labels: ["One", "Two", "Three"], chosen: [] }}
        onAnswer={(a) => got.push(a)}
        onStop={() => {}}
      />,
    );
    const f = screen.getByLabelText("Filter");
    fireEvent.keyDown(f, { key: "ArrowDown" });
    fireEvent.keyDown(f, { key: "Enter" });
    fireEvent.change(f, { target: { value: "thr" } });
    fireEvent.keyDown(f, { key: "Enter" });
    fireEvent.click(screen.getByText("Cancel"));
    expect(got).toEqual([[1], [2], null]);
  });
  it("ticks several in a multi suggester", () => {
    const got: unknown[] = [];
    render(
      <AskPanel
        q={{ kind: "multi", text: "Pick", labels: ["a", "b", "c"], chosen: [2] }}
        onAnswer={(a) => got.push(a)}
        onStop={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("a"));
    fireEvent.click(screen.getByText("Done (2)"));
    expect(got).toEqual([[2, 0]]);
  });
  it("stops the run", () => {
    const stop = vi.fn();
    render(<AskPanel q={{ kind: "prompt", text: "", value: "", multiline: true, selectAll: false }} onAnswer={() => {}} onStop={stop} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(stop).toHaveBeenCalled();
  });
});

describe("template colouring", () => {
  it("marks delimiters, code and comments, across lines", () => {
    const t = "a <%* const x = 1\n-%> b <%# note %>";
    expect(templaterRanges(t).map(([a, b, k]) => [t.slice(a, b), k])).toEqual([
      ["<%*", "tag"],
      [" const x = 1\n", "code"],
      ["-%>", "tag"],
      ["<%#", "tag"],
      [" note ", "comment"],
      ["%>", "tag"],
    ]);
  });
});
