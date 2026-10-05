// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DatePicker, monthGrid, parseDateInput } from "./DatePicker";
import { localToday } from "./md/taskQuery";

afterEach(cleanup);

describe("DatePicker", () => {
  it("parses what's typed", () => {
    expect(parseDateInput("2026-10-05", "2026-10-02")).toBe("2026-10-05");
    expect(parseDateInput("tomorrow", "2026-10-02")).toBe("2026-10-03");
    expect(parseDateInput("2026-02-30", "2026-10-02")).toBeNull();
    expect(parseDateInput("  ", "2026-10-02")).toBeNull();
  });
  it("lays a month out Monday first, six weeks", () => {
    const g = monthGrid("2026-10-15");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-09-28"); // the Monday before 1 October (a Thursday)
    expect(g).toContain("2026-10-31");
  });
  it("picks a typed date on Enter, a day on click, and cancels on Escape", () => {
    const picked: string[] = [];
    let cancelled = 0;
    render(<DatePicker value={null} label="Due date" onPick={(d) => picked.push(d)} onCancel={() => cancelled++} />);
    const box = screen.getByLabelText("Due date");
    fireEvent.change(box, { target: { value: "2026-12-24" } });
    expect(screen.getByText(/24 Dec 2026/)).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(screen.getByLabelText(/25 Dec 2026/));
    fireEvent.keyDown(box, { key: "Escape" });
    expect(picked).toEqual(["2026-12-24", "2026-12-25"]);
    expect(cancelled).toBe(1);
  });
  it("picks today from the empty field on Enter", () => {
    const picked: string[] = [];
    render(<DatePicker value={null} label="Due date" onPick={(d) => picked.push(d)} />);
    fireEvent.keyDown(screen.getByLabelText("Due date"), { key: "Enter" });
    expect(picked).toEqual([localToday()]);
  });
});

describe("dates are picked in the app's picker", () => {
  it("leaves no browser date input anywhere", () => {
    const files = import.meta.glob<string>("./**/*.tsx", { query: "?raw", import: "default", eager: true });
    const native = Object.entries(files)
      .filter(([f, src]) => !f.endsWith(".test.tsx") && /type=["'](date|datetime-local|month|week)["']/.test(src))
      .map(([f]) => f);
    expect(native).toEqual([]);
  });
});
