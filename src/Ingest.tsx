// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Ingest runs (stage 7b): started from the Sources screen or a note's menu, one source at a time
// in the background. Each run shows its steps as they go (read, correct names, find the pages,
// draft, check the quotes, make the changes), can be stopped, and ends with its changes made and
// listed in Changes (a run from the nightly check holds the ones that fail a check).

import { useEffect, useState } from "react";
import { api, IngestRun } from "./api";
import { Icon } from "./icons";
import { changes, pageName, startKnowledge } from "./knowledge";
import { nav } from "./nav";
import { Store, useStore } from "./store";
import { Dialog } from "./ui";
import { reportEditError } from "./taskModel";
import { toast } from "./Toast";
import { DocButton, useIsGone } from "./docButton";

export const runs = new Store<IngestRun[] | null>(null);
let started = false;

/** Keeps the runs list current: loaded once, then updated from each run's events. */
export function startRuns() {
  if (started) return;
  started = true;
  void api
    .ingestRuns()
    .then((r) => runs.set(r))
    .catch(() => runs.set([]));
  api
    .onIngestChanged((r) => {
      const was = (runs.get() ?? []).find((x) => x.id === r.id);
      runs.set(merge(runs.get() ?? [], r));
      // A meeting note made: offer to ingest it and trash the transcript. A note held in Changes
      // is offered when it's accepted there instead.
      if (r.kind === "meeting" && r.status === "done" && was?.status !== "done" && r.note && meetingNoteMade(r))
        offerFollowUp({ note: `${r.note.type.trim()}. ${r.note.name.trim()} - ${r.note.date.trim()}.md`, transcript: r.source });
    })
    .catch(() => {});
}

/** The list with `r` in place of its old copy, or at the top when it's new. */
export function merge(list: IngestRun[], r: IngestRun): IngestRun[] {
  const i = list.findIndex((x) => x.id === r.id);
  if (i < 0) return [r, ...list];
  const n = list.slice();
  n[i] = r;
  return n;
}

/** Whether a finished meeting run made its note, rather than holding it in Changes (its last step says which). */
export function meetingNoteMade(r: IngestRun): boolean {
  const last = r.steps[r.steps.length - 1];
  return !!last && last.status === "done" && !/held in changes/i.test(last.detail ?? "");
}

export const isActive = (r: IngestRun) => r.status === "running" || r.status === "queued";

/** Starts ingesting these files; says so. */
export function ingest(paths: string[]) {
  if (!paths.length) return toast("There's nothing here to ingest", undefined, "bad");
  startRuns();
  api
    .ingestStart(paths)
    .then((ids) =>
      toast(ids.length === 1 ? `Ingesting ${pageName(paths[0])}` : `Ingesting ${ids.length} sources, one after another`, {
        label: "Sources",
        run: () => nav.go("sources"),
      }),
    )
    .catch(reportEditError);
}

const STEP_ICON: Record<string, string> = { done: "check", failed: "x", skipped: "minus", running: "refresh", waiting: "" };

export function RunCard({ r }: { r: IngestRun }) {
  const gone = useIsGone(r.source);
  useEffect(startKnowledge, []);
  // The run's changes: made, or held for you.
  const rows = useStore(changes);
  const ids = new Set(r.proposals);
  const mine = rows?.filter((c) => ids.has(c.id)) ?? [];
  const queued = mine.filter((c) => c.status === "held").length;
  return (
    <div className={`card run ${r.status}`}>
      <div className="row">
        <span className="lb source" />
        <DocButton path={r.source} gone={gone} className="blink grow ell">
          {pageName(r.source)}
        </DocButton>
        {isActive(r) ? (
          <button
            type="button"
            className="btn sm"
            title="Stop this ingest; nothing more is changed from it"
            onClick={() => void api.ingestStop(r.id)}
          >
            <Icon name="stop" size={12} />
            Stop
          </button>
        ) : (
          <span className={`chip sm ${r.status === "done" ? "green" : r.status === "failed" ? "amber" : ""}`}>
            {r.status === "done" ? "Done" : r.status === "failed" ? "Failed" : r.status === "stopped" ? "Stopped" : r.status}
          </span>
        )}
      </div>
      <div className="runsteps">
        {r.steps.map((s) => (
          <div key={s.name} className={`runstep ${s.status}`}>
            <span className="sd">
              {s.status === "running" ? (
                <span className="spin" />
              ) : STEP_ICON[s.status] ? (
                <Icon name={STEP_ICON[s.status]} size={11} />
              ) : null}
            </span>
            <span className="grow">
              <span className="nm">{s.name}</span>
              {s.detail && <span className="faint small">{s.detail}</span>}
            </span>
            {s.ms > 0 && <span className="faint mono small">{s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}</span>}
          </div>
        ))}
      </div>
      {r.dropped.length > 0 && (
        <details className="faint small">
          <summary>{r.dropped.length} left out by the checks</summary>
          {r.dropped.map((d) => (
            <div key={d.page}>
              {pageName(d.page)}: {d.reason}
            </div>
          ))}
        </details>
      )}
      {r.status === "done" && mine.length > 0 && (
        <button
          type="button"
          className="btn sm"
          title={
            queued
              ? "Open Changes to accept or reject the changes held from this run"
              : "Open Changes to see what this run changed, with Revert"
          }
          onClick={() => nav.go("review")}
        >
          <Icon name="review" size={12} />
          {queued ? `Review ${queued} held change${queued === 1 ? "" : "s"}` : `See ${mine.length} change${mine.length === 1 ? "" : "s"}`}
        </button>
      )}
      <span className="faint small">
        {r.model.replace(/^[a-z]+:/, "")} · {r.started.slice(0, 16).replace("T", " ")}
      </span>
    </div>
  );
}

/** The side pane: the runs going now, then the last few. */
export function RunsPane() {
  useEffect(startRuns, []);
  const list = useStore(runs) ?? [];
  return (
    <aside className="runs">
      <div className="eyebrow">Ingest runs</div>
      {!list.length && <p className="faint small">Ingest a source to see its run here: each step, then its changes in Changes.</p>}
      {list.slice(0, 12).map((r) => (
        <RunCard key={r.id} r={r} />
      ))}
    </aside>
  );
}

export interface FollowUpOffer {
  note: string;
  transcript: string;
}

/** After a meeting note is made: what's offered next, one note at a time, oldest first. */
export const followUp = new Store<FollowUpOffer[]>([]);

/** Queues the offer for a note just made; a note already waiting isn't offered twice. */
export function offerFollowUp(f: FollowUpOffer) {
  followUp.set(queueOffer(followUp.get(), f));
}

/** The queue with `f` at the end, unless its note is already in it. */
export const queueOffer = (q: FollowUpOffer[], f: FollowUpOffer): FollowUpOffer[] => (q.some((x) => x.note === f.note) ? q : [...q, f]);

export function FollowUp() {
  useEffect(startRuns, []);
  const q = useStore(followUp);
  const f = q[0];
  if (!f) return null;
  // Keyed by the note, so each note's dialog starts with both boxes ticked.
  return <FollowUpDialog key={f.note} f={f} />;
}

function FollowUpDialog({ f }: { f: FollowUpOffer }) {
  const [ing, setIng] = useState(true);
  const [trash, setTrash] = useState(true);
  const close = () => followUp.set(followUp.get().filter((x) => x.note !== f.note));
  const go = async () => {
    close();
    if (ing) ingest([f.note]);
    if (trash)
      await api
        .trashMove(f.transcript)
        .then(() => toast("Transcript moved to the Trash", { label: "Open Trash", run: () => nav.go("trash") }))
        .catch(reportEditError);
  };
  return (
    <Dialog onClose={close} width={460} label="After the note">
      <div className="confirm">
        <h2 className="h2">{pageName(f.note)} is in the vault</h2>
        <label className="row">
          <input type="checkbox" checked={ing} onChange={() => setIng(!ing)} />
          <span>Ingest it into the wiki (its changes show in Changes)</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={trash} onChange={() => setTrash(!trash)} />
          <span>Move the transcript to the Trash ({pageName(f.transcript)})</span>
        </label>
        <div className="row">
          <span className="grow" />
          <button type="button" className="btn lg" title="Close without ingesting the note or trashing the transcript" onClick={close}>
            Neither
          </button>
          <span title={!ing && !trash ? "Tick at least one of the two above" : "Do what's ticked above"}>
            <button type="button" className="btn lg pri" disabled={!ing && !trash} onClick={() => void go()}>
              Go
            </button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
