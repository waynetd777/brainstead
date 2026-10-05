// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDebounced } from "./ui";

describe("useDebounced", () => {
  it("waits for typing to pause, but clears at once", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 250), { initialProps: { v: "" } });
    rerender({ v: "b" });
    rerender({ v: "bl" });
    rerender({ v: "blu" });
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("blu");
    rerender({ v: "" });
    expect(result.current).toBe("");
    vi.useRealTimers();
  });
});
