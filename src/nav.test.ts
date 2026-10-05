// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { nav, place, restorePlaces, useViewState } from "./nav";
import { History } from "./nav";
import { settings } from "./store";

describe("History", () => {
  it("goes back and forward, and a new step drops what was ahead", () => {
    const h = new History({ screen: "today" });
    h.go({ screen: "notes" });
    h.go({ screen: "settings", pane: "vault" });
    expect(h.canBack).toBe(true);
    expect(h.move(-1)).toBe(true);
    expect(h.current).toEqual({ screen: "notes" });
    expect(h.canForward).toBe(true);
    h.go({ screen: "wiki" });
    expect(h.canForward).toBe(false);
    expect(h.stack.map((p) => p.screen)).toEqual(["today", "notes", "wiki"]);
  });

  it("ignores going where you already are, but not another settings pane", () => {
    const h = new History({ screen: "settings", pane: "general" });
    expect(h.go({ screen: "settings", pane: "general" })).toBe(false);
    expect(h.go({ screen: "settings", pane: "vault" })).toBe(true);
    expect(h.move(1)).toBe(false);
  });

  it("keeps at most max steps", () => {
    const h = new History({ screen: "today" }, 3);
    h.go({ screen: "notes" });
    h.go({ screen: "wiki" });
    h.go({ screen: "sources" });
    expect(h.stack.map((p) => p.screen)).toEqual(["notes", "wiki", "sources"]);
    expect(h.i).toBe(2);
  });
});

describe("kept across restarts", () => {
  it("restores the history and where in it, and keeps each move", () => {
    const at = restorePlaces({ stack: [{ screen: "today" }, { screen: "doc", path: "A.md" }, { screen: "tasks" }], i: 1 });
    expect(at).toEqual({ screen: "doc", path: "A.md" });
    expect(place.get()).toMatchObject({ canBack: true, canForward: true });
    nav.back();
    expect(settings.get().places).toEqual({ stack: [{ screen: "today" }, { screen: "doc", path: "A.md" }, { screen: "tasks" }], i: 0 });
  });
  it("ignores nothing saved", () => {
    expect(restorePlaces(undefined)).toBeUndefined();
  });
});

describe("a screen's choices", () => {
  it("come back with back and forward, and start a fresh visit from the last one", () => {
    restorePlaces({ stack: [{ screen: "notes" }], i: 0 });
    const { result } = renderHook(() => useViewState("list:notes:q", ""));
    act(() => result.current[1]("launch"));
    act(() => nav.go("tasks"));
    act(() => nav.go("notes"));
    expect(result.current[0]).toBe("launch");
    act(() => result.current[1]("garden"));
    act(() => nav.back());
    act(() => nav.back());
    expect(result.current[0]).toBe("launch");
    act(() => nav.forward());
    act(() => nav.forward());
    expect(result.current[0]).toBe("garden");
    expect(settings.get().places?.stack.at(-1)?.view).toEqual({ "list:notes:q": "garden" });
  });
});
