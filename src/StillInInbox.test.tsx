// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The strip on Draft reply and Ask about this source: Done, keep in Sources is the Inbox's own Keep in
// Sources, so a transcript kept there is recorded as kept (and the daily check's catch-up leaves it).

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() =>
  vi.fn(async (cmd: string): Promise<unknown> => {
    if (cmd === "inbox_list")
      return [
        {
          kind: "capture",
          path: "sources/Teams. Transcript. Orbit App standup.md",
          line: 0,
          text: "Orbit App standup",
          lineText: "",
          stamp: null,
        },
      ];
    return /list|transcripts|^runs/.test(cmd) ? [] : undefined;
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));

import { StillInInbox } from "./StillInInbox";

afterEach(cleanup);

describe("StillInInbox", () => {
  it("keeps a transcript in Sources as the Inbox does, recorded as kept", async () => {
    const path = "sources/Teams. Transcript. Orbit App standup.md";
    render(<StillInInbox path={path} />);
    fireEvent.click(await screen.findByText("Done, keep in Sources"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("inbox_capture_kept", { path }));
    expect(invoke.mock.calls.some(([c]) => c === "inbox_capture_done")).toBe(false);
  });
});
