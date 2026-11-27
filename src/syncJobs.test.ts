// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";

let jobs: unknown[] = [];
const invoke = vi.fn(async (cmd: string): Promise<unknown> => {
  if (cmd === "sync_jobs") return jobs;
  throw new Error(`unexpected ${cmd}`);
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string) => invoke(c), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { passGoing, POLL_MS, waitJob } from "./syncJobs";

const job = (over: Record<string, unknown>) => ({ id: "sync-1", kind: "now", status: "running", started: "2026-11-27T09:00:00", ...over });

afterEach(() => {
  vi.useRealTimers();
  invoke.mockClear();
});

describe("syncJobs", () => {
  it("waits for a run to finish and gives it back with its result", async () => {
    vi.useFakeTimers();
    jobs = [job({})];
    const wait = waitJob("sync-1");
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    jobs = [job({ status: "done", report: { chats: 1 } })];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await wait).toMatchObject({ status: "done", report: { chats: 1 } });
  });

  it("gives the run as it is once the wait is up, and null for a run it doesn't know", async () => {
    vi.useFakeTimers();
    jobs = [job({})];
    const wait = waitJob("sync-1", 2500);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await wait).toMatchObject({ status: "running" });
    const calls = invoke.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(calls).toBeLessThanOrEqual(4);
    expect(await waitJob("sync-9")).toBeNull();
  });

  it("finds the Sync now or Fetch again going, not a pull", async () => {
    jobs = [job({ id: "sync-3", kind: "pull" }), job({ id: "sync-2", kind: "fetch_again" })];
    expect((await passGoing())?.id).toBe("sync-2");
    jobs = [job({ id: "sync-3", kind: "pull" }), job({ id: "sync-2", status: "done" })];
    expect(await passGoing()).toBeNull();
    invoke.mockRejectedValueOnce(new Error("no app"));
    expect(await passGoing()).toBeNull();
  });
});
