// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Meeting note from a transcript (stage 7b): a Teams transcript in sources/ becomes a meeting or
// 1-1 note. Its type, name and date are read from the file name (the previous app's rules), and
// can be changed; the model fills in the note from the template and Brainstead makes it (in
// Changes, revertable), then offers to ingest it and move the transcript to the Trash. Several can
// go at once.

import { useEffect, useMemo, useState } from "react";
import { api, NoteSpec, Transcript } from "./api";
import { Icon } from "./icons";
import { isActive, runs, RunsPane, startRuns } from "./Ingest";
import { useStore } from "./store";
import { pageName } from "./knowledge";
import { Markdown } from "./md/Markdown";
import { reportEditError } from "./taskModel";
import { toast } from "./Toast";
import { TopBar } from "./TopBar";
import { useVaultVersion } from "./state";
import { place, useViewState } from "./nav";
import { Seg } from "./ui";
import { draftNotes, noteFile, specOf, specOk } from "./meetingFlow";

export { noteFile, specOf, specOk };

/** The note types the screen offers (start_run meeting_note takes the same). */
export const TYPES = ["Meeting", "1-1", "Workshop", "Interview"];

/** The date is only the day the transcript was captured, and the user hasn't confirmed or changed
 *  it yet: the note waits until they do. */
export const needsDate = (t: Transcript, edits: Partial<NoteSpec> = {}) => t.inferred.dateCheck && edits.date === undefined;

/** Its note exists already (at the name read from the transcript, unchanged): there's nothing to
 *  draft, unless the name or date is changed. */
export const noteExists = (t: Transcript, edits: Partial<NoteSpec> = {}) =>
  t.inferred.exists && noteFile(specOf(t, edits)) === noteFile(specOf(t));

/** Why a transcript is done, as the list says it (list_transcripts too). */
export const DONE: Record<NonNullable<Transcript["done"]>, string> = { ingested: "ingested", linked: "linked from a note" };

export function MeetingScreen() {
  const [all, setList] = useState<Transcript[] | null>(null);
  // Only the transcripts still to do, unless the switch says all.
  const [show, setShow] = useViewState<"todo" | "all">("meeting:show", "todo");
  const list = useMemo(() => (all && show === "todo" ? all.filter((t) => !t.done) : all), [all, show]);
  // A transcript opened from elsewhere (the Inbox) starts selected.
  const [sel, setSel] = useState<string | null>(() => place.get().place.path ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Partial<NoteSpec>>>({});
  const [text, setText] = useState<string>("");
  const v = useVaultVersion();
  useEffect(() => {
    let live = true;
    api
      .meetingTranscripts()
      .then((l) => live && setList(l))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [v]);
  const cur = list?.find((t) => t.path === sel) ?? list?.[0] ?? null;
  useEffect(() => {
    if (!cur) return;
    let live = true;
    api
      .docRead(cur.path)
      .then((d) => live && setText(d.content))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [cur?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = cur ? specOf(cur, edits[cur.path]) : null;
  const set = (p: Partial<NoteSpec>) => cur && setEdits((e) => ({ ...e, [cur.path]: { ...e[cur.path], ...p } }));
  // Transcripts with a note being drafted (or sent to be): their buttons wait.
  useEffect(startRuns, []);
  const allRuns = useStore(runs);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const drafting = useMemo(
    () => new Set([...sending, ...(allRuns ?? []).filter((r) => r.kind === "meeting" && isActive(r)).map((r) => r.source)]),
    [allRuns, sending],
  );
  const drafted = useMemo(
    () => new Set((allRuns ?? []).filter((r) => r.kind === "meeting" && r.status === "done").map((r) => r.source)),
    [allRuns],
  );
  const batch = useMemo(
    () => (list ?? []).filter((t) => picked.has(t.path) && !drafting.has(t.path) && !noteExists(t, edits[t.path])),
    [list, picked, drafting, edits],
  );
  const draft = (items: Transcript[]) => {
    const pairs: [string, NoteSpec][] = items.map((t) => [t.path, specOf(t, edits[t.path])]);
    const bad = pairs.find(([, s]) => !specOk(s));
    if (bad) return toast(`${pageName(bad[0])} needs a name and a date.`, undefined, "bad");
    const unchecked = items.find((t) => needsDate(t, edits[t.path]));
    if (unchecked)
      return toast(
        `${pageName(unchecked.path)} is dated with the day it was captured: confirm or change its date first.`,
        undefined,
        "bad",
      );
    const paths = items.map((t) => t.path);
    setSending((x) => new Set([...x, ...paths]));
    draftNotes(pairs)
      .then((ids) => {
        toast(ids.length === 1 ? "Drafting the note: it'll be made in the vault" : `Drafting ${ids.length} notes, one after another`);
        setPicked(new Set());
      })
      .catch(reportEditError)
      .finally(() =>
        setSending((x) => {
          const n = new Set(x);
          paths.forEach((p) => n.delete(p));
          return n;
        }),
      );
  };

  return (
    <main className="main">
      <TopBar
        title="Meeting note from a transcript"
        sub={list ? `${list.length} transcript${list.length === 1 ? "" : "s"}${show === "todo" ? " to do" : ""}` : undefined}
      >
        <Seg
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            ["todo", "To do", "Transcripts not yet ingested or linked from a note"],
            ["all", `All${all ? ` · ${all.length}` : ""}`],
          ]}
        />
        {batch.length > 1 && (
          <button
            type="button"
            className="btn"
            title={`Have the AI draft a meeting note from each of the ${batch.length} ticked transcripts`}
            onClick={() => draft(batch)}
          >
            Draft all {batch.length}
          </button>
        )}
      </TopBar>
      <div className="body meeting">
        <div className="ilist">
          {list?.length === 0 &&
            (all?.length ? (
              <p className="faint pad">Every transcript in sources/ has been dealt with. All shows them.</p>
            ) : (
              <p className="faint pad">No Teams transcripts in sources/. The Teams extension, or a file you drop there, puts them there.</p>
            ))}
          {list?.map((t) => (
            <div key={t.path} className={`qrow mrow ${cur?.path === t.path ? "sel" : ""}`}>
              <input
                type="checkbox"
                aria-label={`Pick ${t.path}`}
                checked={picked.has(t.path)}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (n.has(t.path)) n.delete(t.path);
                    else n.add(t.path);
                    return n;
                  })
                }
              />
              <button
                type="button"
                className="mpick"
                title="Show this transcript and the note it will become"
                onClick={() => setSel(t.path)}
              >
                <span className="tt">{pageName(t.path).replace(/^Teams\. Transcript\. /, "")}</span>
                <span className="faint">
                  {t.inferred.type ?? "?"} · {t.inferred.date ?? "no date"}
                  {needsDate(t, edits[t.path]) ? " · check the date" : !t.inferred.confident && " · check"}
                  {t.done && ` · ${DONE[t.done]}`}
                  {!t.done && t.inferred.exists && " · note exists"}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="mtext selectable">{cur && <Markdown content={text} path={cur.path} root="" />}</div>
        <div className="mside">
          {cur && spec && (
            <div className="card mdetails">
              <span className="eyebrow">The note</span>
              <label className="nnf">
                <span className="faint">Type</span>
                <select className="sel" value={spec.type} onChange={(e) => set({ type: e.target.value })}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="nnf">
                <span className="faint">{spec.type === "1-1" ? "With" : "Name"}</span>
                <span className="inp">
                  <input value={spec.name} onChange={(e) => set({ name: e.target.value })} />
                </span>
              </label>
              <label className="nnf">
                <span className="faint">Date</span>
                <span className="inp">
                  <input value={spec.date} onChange={(e) => set({ date: e.target.value })} placeholder="YYYY-MM-DD" />
                </span>
                {needsDate(cur, edits[cur.path]) && (
                  <button
                    type="button"
                    className="btn sm"
                    title="The meeting was on this day: use it for the note"
                    onClick={() => set({ date: spec.date })}
                  >
                    Confirm
                  </button>
                )}
              </label>
              <span className="faint mono small">{noteFile(spec)}</span>
              {cur.inferred.ask.map((a) => (
                <p key={a} className="faint small">
                  <Icon name="info" size={12} /> {a}
                </p>
              ))}
              <button
                type="button"
                className="btn pri"
                disabled={!specOk(spec) || needsDate(cur, edits[cur.path]) || noteExists(cur, edits[cur.path]) || drafting.has(cur.path)}
                title={
                  noteExists(cur, edits[cur.path])
                    ? `${noteFile(spec)} exists already: open it to fill it in, or change the name or date for a new note`
                    : needsDate(cur, edits[cur.path])
                      ? "Confirm or change the date first: it's the day the transcript was captured"
                      : drafted.has(cur.path)
                        ? "A note was drafted from this transcript already: see Changes"
                        : "Have the AI draft the note from this transcript"
                }
                onClick={() => draft([cur])}
              >
                <Icon name="note" size={14} />
                {drafting.has(cur.path) ? "Drafting…" : drafted.has(cur.path) ? "Draft again" : "Draft the note"}
              </button>
              <p className="faint small">
                Then: the note is made (revertable in Changes), and you can ingest it and move the transcript to the Trash.
              </p>
            </div>
          )}
          <RunsPane />
        </div>
      </div>
    </main>
  );
}
