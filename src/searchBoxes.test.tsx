// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The lists' search boxes (Tasks, Notes; Activity's works the same way) keep what's typed quickly, character by character (the Search page's
// box once lost it to its own history write; see Search.test.tsx).

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
import { NotesScreen } from "./Lists";
import { nav } from "./nav";
import { TasksScreen } from "./Tasks";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function typeFast(box: HTMLInputElement, word: string) {
  for (let i = 1; i <= word.length; i++) {
    fireEvent.change(box, { target: { value: word.slice(0, i) } });
    await act(async () => void vi.advanceTimersByTime(90));
  }
  await act(async () => void vi.advanceTimersByTime(2000));
}

describe("search boxes", () => {
  for (const [name, screen, Screen] of [
    ["Tasks", "tasks", TasksScreen],
    ["Notes", "notes", NotesScreen],
  ] as const) {
    it(`keeps fast typing on ${name}`, async () => {
      vi.useFakeTimers();
      nav.go(screen);
      const { container } = render(<Screen />);
      await act(async () => void vi.advanceTimersByTime(50));
      const box = container.querySelector<HTMLInputElement>(".searchbox input")!;
      expect(box).toBeTruthy();
      await typeFast(box, "orbit");
      expect(box.value).toBe("orbit");
      // Esc clears it from anywhere on the page, too.
      box.blur();
      fireEvent.keyDown(document.body, { key: "Escape" });
      await act(async () => void vi.advanceTimersByTime(50));
      expect(box.value).toBe("");
      await typeFast(box, "orbit");
      // Esc in the box clears it, even when nothing matches.
      fireEvent.keyDown(box, { key: "Escape" });
      await act(async () => void vi.advanceTimersByTime(50));
      expect(box.value).toBe("");
    });
  }
});
