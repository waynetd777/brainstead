// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Projects (stage 6): every `Project. <name>.md` note, by status and area, with what moves each
// forward. A project with nothing to do next is flagged red, one that's gone quiet for two weeks
// amber. The open one shows its outcome, next actions, waiting-fors and the notes that link it.

import { FoundProjects } from "./Found";
import { useEffect, useMemo, useState } from "react";
import { api, ProjectRow, TaskRow } from "./api";
import { askAboutNote } from "./Ask";
import { prepareCapture } from "./Capture";
import { projectFlag, projectTasks, ProjectStatus, STATUS_LABEL, useProjects } from "./gtd";
import { Icon } from "./icons";
import { nav, openDoc, place, useViewState } from "./nav";
import { Store, useStore } from "./store";
import { trashFile } from "./notes/actions";
import { DraftNudge, GtdChips, TaskList } from "./TaskList";
import { useVaultVersion } from "./state";
import { reportEditError, undoLast, useAllTasks } from "./taskModel";
import { toast } from "./Toast";
import { askLink, askQuote, TopBar } from "./TopBar";
import { ago, Dialog, Seg, TableBand } from "./ui";

/** ⌘K's New project: the Projects screen opens with New project showing. */
export const newProjectAsked = new Store<boolean>(false);
export function startNewProject() {
  newProjectAsked.set(true);
  nav.go("projects");
}

const TABS: ProjectStatus[] = ["active", "on-hold", "someday", "done"];

export function ProjectsScreen() {
  const projects = useProjects();
  const all = useAllTasks();
  const here = useStore(place).place;
  const [tab, setTab] = useViewState<ProjectStatus>("projects:tab", "active");
  const asked = useStore(newProjectAsked);
  const [creating, setCreatingState] = useState(false);
  const setCreating = (v: boolean) => {
    setCreatingState(v);
    if (!v) newProjectAsked.set(false);
  };
  const showNew = creating || asked;
  const sel = here.path ?? null;
  const counts = useMemo(() => new Map(TABS.map((s) => [s, (projects ?? []).filter((p) => p.status === s).length])), [projects]);
  const shown = (projects ?? []).filter((p) => p.status === tab);
  const areas = useMemo(() => {
    const m = new Map<string, ProjectRow[]>();
    for (const p of shown) m.set(p.area ?? "", [...(m.get(p.area ?? "") ?? []), p]);
    return [...m].sort((a, b) => (a[0] ? (b[0] ? a[0].localeCompare(b[0]) : -1) : 1));
  }, [shown]);
  const open = projects?.find((p) => p.path === sel) ?? null;
  const pick = (p: ProjectRow) => nav.replace({ screen: "projects", path: p.path });

  return (
    <main className="main">
      <TopBar
        title="Projects"
        sub={projects ? `${counts.get("active")} active · ${counts.get("on-hold")} on hold · ${counts.get("someday")} someday` : undefined}
        ask={
          open
            ? { about: `the project ${askQuote(open.name)}`, prompt: `About ${askLink(open.path)}: ` }
            : { about: "your projects", prompt: "About my projects: " }
        }
      >
        <Seg<ProjectStatus>
          label="Show"
          value={tab}
          options={TABS.map((s) => [s, projects ? `${STATUS_LABEL[s]} ${counts.get(s) ?? 0}` : STATUS_LABEL[s]])}
          onChange={setTab}
        />
        <button
          type="button"
          className="btn pri"
          title="Make a new Project. note with a name, outcome and area"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={14} />
          New project
        </button>
      </TopBar>
      <div className="body projects">
        <div className="plistcol">
          {tab === "active" && <FoundProjects />}
          {projects === null && <p className="faint pad">Loading…</p>}
          {projects && !shown.length && (
            <p className="faint pad">
              {tab === "active"
                ? "No active projects. A project is a note named “Project. …”; New project makes one."
                : `No ${STATUS_LABEL[tab].toLowerCase()} projects.`}
              {TABS.filter((t) => t !== tab && counts.get(t)).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="blink"
                  title={`Show the ${STATUS_LABEL[t].toLowerCase()} projects`}
                  onClick={() => setTab(t)}
                >
                  {counts.get(t)} {STATUS_LABEL[t].toLowerCase()}
                </button>
              ))}
            </p>
          )}
          {!!shown.length && (
            <div className="ptable" role="table" aria-label={`${STATUS_LABEL[tab]} projects`}>
              <div className="prow tb-head" role="row">
                <span role="columnheader">Project</span>
                <span role="columnheader">Next</span>
                <span role="columnheader">Waiting</span>
                <span role="columnheader">Last change</span>
              </div>
              {areas.map(([area, ps]) => (
                <div key={area} className="tb-group" role="rowgroup">
                  <TableBand
                    icon="folder"
                    label={area || "No area"}
                    none={!area}
                    n={ps.length}
                    tip={`${ps.length} ${ps.length === 1 ? "project" : "projects"} in this area`}
                  />
                  {ps
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => {
                      const flag = projectFlag(p);
                      return (
                        <button
                          key={p.path}
                          type="button"
                          role="row"
                          className={`prow tb-row ${p.path === sel ? "sel" : ""}`}
                          title={`Show ${p.name}: its tasks, notes and activity`}
                          onClick={() => pick(p)}
                        >
                          <span className="nm" role="cell">
                            <span className="flag">
                              {flag && <Icon name="alert" size={13} style={{ color: flag === "none" ? "var(--red)" : "var(--amber)" }} />}
                            </span>
                            <span className="ell">{p.name}</span>
                            {flag && (
                              <span
                                className={`pflag ${flag === "none" ? "red" : "amber"}`}
                                title={flag === "none" ? "Stuck: it has no next action" : "Quiet: nothing has happened for two weeks"}
                              >
                                {flag === "none" ? "Stuck" : "Quiet"}
                              </span>
                            )}
                          </span>
                          <span role="cell" className={`m ${p.status === "active" && !p.next ? "red" : ""}`}>
                            {p.next || (p.status === "active" ? "None" : "–")}
                          </span>
                          <span role="cell" className="m">
                            {p.waiting || "–"}
                          </span>
                          <span role="cell" className={`m ${flag === "quiet" ? "amber" : ""}`}>
                            {ago(p.lastTouched)}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pdetail">
          {open ? (
            <ProjectDetail p={open} all={all} />
          ) : (
            <p className="faint">{shown.length ? "Choose a project to see what moves it forward." : ""}</p>
          )}
        </div>
      </div>
      {showNew && <NewProject onClose={() => setCreating(false)} onMade={(path) => nav.replace({ screen: "projects", path })} />}
    </main>
  );
}

function ProjectDetail({ p, all }: { p: ProjectRow; all: ReturnType<typeof useAllTasks> }) {
  const t = useMemo(() => projectTasks(all ?? [], p.path), [all, p.path]);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<"outcome" | "area" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const set = (key: "status" | "area" | "outcome", value: string | null, done?: string) =>
    api
      .projectSet(p.path, key, value)
      .then(() => done && toast(done, undefined, "ok"))
      .catch(reportEditError);
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    setAdding("");
    api
      .projectAddTask(p.path, prepareCapture("task", text))
      .then((r) => r.undo && toast(r.undo, undefined, "ok"))
      .catch(reportEditError);
  };
  const field = (key: "outcome" | "area", label: string, value: string | null) =>
    editing === key ? (
      <input
        className="pin"
        autoFocus
        defaultValue={value ?? ""}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(null);
            void set(key, e.currentTarget.value.trim() || null);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(null);
          }
        }}
        onBlur={() => setEditing(null)}
      />
    ) : (
      <button type="button" className="pval" onClick={() => setEditing(key)} title={`Change the ${label.toLowerCase()}`}>
        {value || <span className="faint">Add {label.toLowerCase()}…</span>}
      </button>
    );

  return (
    <div className="pgrid">
      <div className="pmain">
        <div className="phead">
          <div className="row">
            <span className={`chip ${p.status === "active" ? "green" : ""}`}>{STATUS_LABEL[p.status]}</span>
            <span className="faint small">{p.path}</span>
          </div>
          <h1 className="h1">{p.name}</h1>
          <div className="pkv">
            <span className="faint">Done looks like</span>
            {field("outcome", "Outcome", p.outcome)}
            <span className="faint">Area</span>
            {field("area", "Area", p.area)}
          </div>
        </div>
        <section>
          <div className="ghead">
            <h2 className="h3">Next actions</h2>
            <span className="faint">{t.next.length}</span>
          </div>
          <div className="card tcard">
            <TaskList rows={t.next} manual keys hideProject showNote={false} empty="Nothing to do next: what's the next physical step?" />
            <div className="padd">
              <Icon name="plus" size={14} />
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="Add a next action — @context, effort:15m, due:fri"
                aria-label="Add a next action"
              />
            </div>
          </div>
        </section>
        {!!t.waiting.length && (
          <section>
            <div className="ghead">
              <h2 className="h3">Waiting for</h2>
              <span className="faint">{t.waiting.length}</span>
            </div>
            <div className="card tcard">
              <TaskList rows={t.waiting} manual={false} keys hideProject showNote={false} rowAction={(w) => <DraftNudge t={w} />} />
            </div>
          </section>
        )}
        {!!t.someday.length && (
          <section>
            <div className="ghead">
              <h2 className="h3">Someday / maybe</h2>
              <span className="faint">{t.someday.length}</span>
            </div>
            <div className="card tcard">
              <TaskList rows={t.someday} manual={false} keys hideProject showNote={false} />
            </div>
          </section>
        )}
        <div className="row pacts">
          {p.status !== "done" && (
            <button
              type="button"
              className="btn"
              title="Mark the project done; it moves to the Completed tab"
              onClick={() => void set("status", "done", `${p.name} completed`)}
            >
              <Icon name="check" size={14} />
              Mark complete
            </button>
          )}
          {p.status !== "active" && (
            <button
              type="button"
              className="btn"
              title="Move the project back to the active list"
              onClick={() => void set("status", "active", `${p.name} is active`)}
            >
              <Icon name="refresh" size={14} />
              Make active
            </button>
          )}
          {p.status === "active" && (
            <button
              type="button"
              className="btn"
              title="Pause the project; it moves to the On hold tab"
              onClick={() => void set("status", "on-hold", `${p.name} on hold`)}
            >
              <Icon name="waiting" size={14} />
              Put on hold
            </button>
          )}
          {p.status !== "someday" && (
            <button
              type="button"
              className="btn"
              title="Park the project for some day; it moves to the Someday tab"
              onClick={() => void set("status", "someday", `${p.name} moved to someday`)}
            >
              <Icon name="someday" size={14} />
              Someday
            </button>
          )}
          <span className="grow" />
          <button
            type="button"
            className="btn ghost"
            title="Open Ask with the project note attached, to ask the model about it"
            onClick={() => askAboutNote(p.path)}
          >
            <Icon name="ask" size={14} />
            Ask about this project
          </button>
          <button
            type="button"
            className="btn ghost danger"
            title="Move the project note to the Trash, after asking first"
            onClick={() => setDeleting(true)}
          >
            <Icon name="trash" size={14} />
            Move to the Trash
          </button>
        </div>
      </div>
      <aside className="pside">
        <div className="card side-card">
          <div className="eyebrow">The project note</div>
          <button type="button" className="blink" title={`Open ${p.path}`} onClick={() => openDoc(p.path)}>
            <span className="lb note">{p.name}</span>
            <span className="faint">Changed {ago(p.lastTouched)}</span>
          </button>
        </div>
        <div className="card side-card">
          <div className="eyebrow">Notes that link it</div>
          {!p.links.length && <p className="faint small">Any note that links [[Project. {p.name}]] shows here.</p>}
          {p.links.slice(0, 12).map((l) => (
            <button key={l} type="button" className="blink" title={`Open ${l}`} onClick={() => openDoc(l)}>
              <span className="lb note">{l.replace(/\.md$/, "").split("/").pop()}</span>
            </button>
          ))}
        </div>
        <ProjectWiki path={p.path} />
        <RecentActivity links={p.links} done={t.done} />
        {!!t.done.length && (
          <div className="card side-card">
            <div className="eyebrow">Done</div>
            {t.done.slice(0, 8).map((d) => (
              <div key={`${d.path}:${d.line}`} className={`pdone ${d.status === "-" ? "cancelled" : ""}`}>
                {d.status === "-" ? (
                  <Icon name="cancelled" size={12} style={{ color: "var(--ink3)" }} />
                ) : (
                  <Icon name="check" size={12} style={{ color: "var(--green)" }} />
                )}
                <span className="ell">{doneText(d)}</span>
                {d.status === "-" && <span className="faint small">Cancelled</span>}
                <GtdChips t={d} project={false} />
              </div>
            ))}
          </div>
        )}
      </aside>
      {deleting && <DeleteProject p={p} tasks={t} onClose={() => setDeleting(false)} />}
    </div>
  );
}

/** A finished task's words, without its ✅ or ❌ date and what follows. */
const doneText = (d: TaskRow) => d.text.replace(/\s*[✅❌].*$/u, "");

/** The wiki pages the project note links to. */
function ProjectWiki({ path }: { path: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const v = useVaultVersion();
  useEffect(() => {
    let live = true;
    void api
      .docRead(path)
      .then(
        (d) => live && setPages([...new Set(d.meta.links.map((l) => l.resolved).filter((r): r is string => !!r && r.startsWith("wiki/")))]),
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path, v]);
  if (!pages.length) return null;
  return (
    <div className="card side-card">
      <div className="eyebrow">Wiki pages</div>
      {pages.slice(0, 10).map((w) => (
        <button key={w} type="button" className="blink" title={`Open ${w}`} onClick={() => openDoc(w)}>
          <span className="lb wiki">{w.replace(/\.md$/, "").split("/").pop()}</span>
        </button>
      ))}
    </div>
  );
}

/** What happened lately: notes linking the project that changed, and tasks done, newest first. */
function RecentActivity({ links, done }: { links: string[]; done: TaskRow[] }) {
  const [mtimes, setMtimes] = useState<Map<string, number>>(new Map());
  const v = useVaultVersion();
  useEffect(() => {
    let live = true;
    void api
      .filesList(null)
      .then((f) => live && setMtimes(new Map(f.map((x) => [x.path, x.mtime]))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [v]);
  const items = [
    ...links
      .filter((l) => mtimes.has(l))
      .map((l) => ({ at: mtimes.get(l)!, key: l, text: l.replace(/\.md$/, "").split("/").pop()!, path: l, kind: "note" })),
    ...done
      .filter((d) => d.doneOn)
      .map((d) => ({
        at: Date.parse(`${d.doneOn}T12:00:00`),
        key: `${d.path}:${d.line}`,
        text: doneText(d),
        path: d.path,
        kind: d.status === "-" ? "cancelled" : "done",
      })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);
  if (!items.length) return null;
  return (
    <div className="card side-card">
      <div className="eyebrow">Recent activity</div>
      {items.map((i) => (
        <button key={i.key} type="button" className="blink" title={`Open ${i.path}`} onClick={() => openDoc(i.path)}>
          <span className={i.kind === "note" ? "lb note" : "pdone ell"}>
            {i.kind === "done" && <Icon name="check" size={12} style={{ color: "var(--green)" }} />}
            {i.kind === "cancelled" && <Icon name="cancelled" size={12} style={{ color: "var(--ink3)" }} />} {i.text}
          </span>
          <span className="faint">
            {i.kind === "done" ? "Done" : i.kind === "cancelled" ? "Cancelled" : "Changed"} {ago(i.at)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Delete project: asks first, then moves the project's note to the Trash (Undo, or restore from Trash). */
function DeleteProject({ p, tasks, onClose }: { p: ProjectRow; tasks: ReturnType<typeof projectTasks>; onClose: () => void }) {
  const all = [...tasks.next, ...tasks.waiting, ...tasks.someday, ...tasks.done];
  const inNote = all.filter((t) => t.path === p.path).length;
  const elsewhere = all.length - inNote;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const del = () => {
    onClose();
    void trashFile(p.path).then(() => nav.replace({ screen: "projects" }));
  };
  return (
    <Dialog onClose={onClose} width={460} label="Move the project to the Trash">
      <div className="confirm">
        <h2 className="h2">Move “{p.name}” to the Trash?</h2>
        <p className="muted">
          Moves its note, {p.path}, to the Trash
          {inNote ? `, with the ${plural(inNote, "task")} written in it` : ""}. You can undo it or restore it from the Trash.
        </p>
        {elsewhere > 0 && (
          <p className="muted">
            {plural(elsewhere, "task")} in other notes link it; they stay where they are, and their link shows as missing until the project
            comes back.
          </p>
        )}
        <div className="row">
          <span className="grow" />
          <button type="button" className="btn lg" autoFocus title="Keep the project" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn lg danger-pri" title={`Move ${p.path} to the Trash; Undo brings it back`} onClick={del}>
            Move to the Trash
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** New project: a name, its outcome and area. Writes the Project. note. */
export function NewProject({ onClose, onMade, name: start = "" }: { onClose: () => void; onMade?: (path: string) => void; name?: string }) {
  const projects = useProjects();
  const [name, setName] = useState(start);
  const [outcome, setOutcome] = useState("");
  const [area, setArea] = useState("");
  const areas = [...new Set((projects ?? []).map((p) => p.area).filter(Boolean))] as string[];
  const make = () => {
    if (!name.trim()) return;
    api
      .projectCreate(name.trim(), "active", area.trim() || null, outcome.trim() || null)
      .then(({ path, undo }) => {
        toast(undo || `Made ${path.replace(/\.md$/, "")}`, { label: "Undo", kbd: "⌘Z", run: () => void undoLast() }, "ok");
        onMade?.(path);
        onClose();
      })
      .catch(reportEditError);
  };
  return (
    <Dialog onClose={onClose} width={480} label="New project">
      <div className="confirm">
        <h2 className="h2">New project</h2>
        <label className="nnf">
          <span className="faint">Name</span>
          <span className="inp">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && make()}
              placeholder="Orbit App launch"
            />
          </span>
        </label>
        <label className="nnf">
          <span className="faint">Done looks like</span>
          <span className="inp">
            <input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && make()}
              placeholder="What's true when it's finished"
            />
          </span>
        </label>
        <label className="nnf">
          <span className="faint">Area</span>
          <span className="inp">
            <input
              list="project-areas"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && make()}
              placeholder="Work, Personal…"
            />
          </span>
          <datalist id="project-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <p className="faint small">Makes “Project. {name.trim() || "…"}.md” with Next actions, Waiting for and Notes headings.</p>
        <div className="row">
          <span className="grow" />
          <button type="button" className="btn lg" title="Close without making a project" onClick={onClose}>
            Cancel
          </button>
          <span title={name.trim() ? `Make “Project. ${name.trim()}.md”` : "Give the project a name first"}>
            <button type="button" className="btn lg pri" disabled={!name.trim()} onClick={make}>
              Make project
            </button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
