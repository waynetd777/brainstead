// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "search" ? { hits: [], total: 0, ms: 0, truncated: false } : [])),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import { nav } from "./nav";
import { SearchScreen } from "./Search";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Search box", () => {
  it("keeps what's typed after the query goes into the history", async () => {
    vi.useFakeTimers();
    nav.go("search");
    render(<SearchScreen />);
    const box = document.querySelector<HTMLInputElement>(".sbar input")!;
    fireEvent.change(box, { target: { value: "orb" } });
    // The query is searched, then put in the history for Back…
    await act(async () => void vi.advanceTimersByTime(400));
    // …while the user goes on typing.
    fireEvent.change(box, { target: { value: "orbi" } });
    await act(async () => void vi.advanceTimersByTime(700));
    fireEvent.change(box, { target: { value: "orbit" } });
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(box.value).toBe("orbit");
  });
});
