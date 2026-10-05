// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Knowledge health (stage 7a): the previous app's eight wiki checks, ported to Rust, and
// "More checks", Brainstead's own three (possible duplicates, stale pages others rely on, sources changed since
// they were cited). They rerun in the background whenever the index changes. Safe fixes
// (cross-links, `updated:` dates, log lines) apply straight away and can be undone; anything that
// needs judgement goes to Ask, whose changes are listed in Changes.

import { useEffect, useState } from "react";
import { api, LintCheck, LintItem, LintReport } from "./api";
import { askWith } from "./askState";
import { ingest } from "./Ingest";
import { Icon } from "./icons";
import { ingestable } from "./Lists";
import { useGlance, WikiGlance } from "./Glance";
import { decisions, fixOf, fixWithAskPrompt, health, pageName, reloadHealth, safeFixes, startKnowledge, trendPoints } from "./knowledge";
import { nav, openDoc } from "./nav";
import { reportEditError, undoLast } from "./taskModel";
import { toast } from "./Toast";
import { TopBar } from "./TopBar";
import { Dialog } from "./ui";
import { Store, useStore } from "./store";

const undo = { label: "Undo", kbd: "⌘Z", run: () => void undoLast() };

/** Actions under way, by key: their buttons show a spinner until the work and the recheck after it are done. */
const busy = new Store<ReadonlySet<string>>(new Set());
const setBusy = (key: string, on: boolean) => {
  const n = new Set(busy.get());
  if (on) n.add(key);
  else n.delete(key);
  busy.set(n);
};

/** Resolves when the checks next report (they rerun in the background after a fix), or after 15 s. */
function nextReport(): Promise<void> {
  return new Promise((done) => {
    const t = setTimeout(finish, 15_000);
    const off = health.subscribe(finish);
    function finish() {
      clearTimeout(t);
      off();
      done();
    }
  });
}

/** Runs an action with its button busy; with `recheck`, until the checks have run again. */
export function act<T>(key: string, run: () => Promise<T>, then: (r: T) => void, recheck = true): void {
  if (busy.get().has(key)) return;
  setBusy(key, true);
  const report = recheck ? nextReport() : Promise.resolve();
  run()
    .then(async (r) => {
      then(r);
      await report;
    })
    .catch(reportEditError)
    .finally(() => setBusy(key, false));
}

/** A button that shows a spinner while its action runs. */
function BusyButton({
  id,
  icon,
  className = "btn sm",
  disabled,
  title,
  onClick,
  children,
}: {
  id: string;
  icon?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const on = useStore(busy).has(id);
  return (
    <button type="button" className={className} disabled={disabled || on} aria-busy={on} title={title} onClick={onClick}>
      {on ? <span className="spin" /> : icon ? <Icon name={icon} size={className.includes("sm") ? 12 : 14} /> : null}
      {children}
    </button>
  );
}

const fixed = (label: string) => toast(label, undo, "ok");

export function HealthScreen() {
  useEffect(startKnowledge, []);
  const h = useStore(health);
  const r = h?.report ?? null;
  const [open, setOpen] = useState<string | null>("missing-pages");
  const [trash, setTrash] = useState<string | null>(null);
  const [linking, setLinking] = useState<LintItem | null>(null);
  const fixes = safeFixes(r);
  const need = decisions(r);

  const recheck = () =>
    act(
      "recheck",
      () => reloadHealth(true),
      () => {},
      false,
    );
  const fixWithAsk = () => {
    if (!r) return;
    askWith(fixWithAskPrompt(r));
    nav.go("ask");
  };
  const classic = r?.checks.filter((c) => c.classic) ?? [];
  const ours = r?.checks.filter((c) => !c.classic) ?? [];
  const history = h?.history ?? [];
  const pts = trendPoints(history, 280, 52);

  return (
    <main className="main">
      <TopBar
        title="Knowledge health"
        sub={r ? `${r.wikiPages} wiki pages · ${r.sources} sources · rechecks when the vault changes` : "Checking…"}
        ask={{ about: "the wiki's health", prompt: "About my wiki's health: " }}
      >
        <button
          type="button"
          className="btn"
          title="Show places where wiki pages disagree with each other"
          onClick={() => nav.go("contradictions")}
        >
          <Icon name="info" size={14} />
          Contradictions
        </button>
        <BusyButton id="recheck" icon="refresh" className="btn" onClick={recheck}>
          Check now
        </BusyButton>
        <BusyButton
          id="fix-all"
          icon="check"
          className="btn"
          disabled={!fixes.length}
          onClick={() => act("fix-all", () => api.healthFix(fixes), fixed)}
        >
          Fix safe issues{fixes.length ? ` (${fixes.length})` : ""}
        </BusyButton>
        <button
          type="button"
          className="btn pri"
          disabled={!need}
          onClick={fixWithAsk}
          title="Asks the assistant to fix them; its changes are listed in Changes, where you can revert them"
        >
          <Icon name="ask" size={14} />
          Fix with Ask
        </button>
      </TopBar>
      <div className="body health">
        <div className="hmain">
          <div className="card hsum">
            <div className="hnum">
              <span className="eyebrow">Need a decision</span>
              <b>{r ? need : "…"}</b>
              <span className="faint small">{fixes.length ? `${fixes.length} more are safe to fix` : "nothing safe to fix"}</span>
            </div>
            {pts ? (
              <svg
                width="280"
                height="52"
                viewBox="0 0 280 52"
                role="img"
                aria-label={`Issues needing a decision, the last ${history.length} days`}
              >
                <polyline points={pts} className="trend" />
              </svg>
            ) : (
              <span className="faint small">The trend shows after a second day.</span>
            )}
          </div>
          {r && <Group title="Wiki checks" checks={classic} open={open} setOpen={setOpen} on={{ setTrash, setLinking }} />}
          {r && <Group title="More checks" checks={ours} open={open} setOpen={setOpen} on={{ setTrash, setLinking }} />}
        </div>
        <aside className="hside">{r && <SideCards r={r} />}</aside>
      </div>
      {trash && (
        <Dialog onClose={() => setTrash(null)} width={440} label="Move image to Trash">
          <div className="confirm">
            <h2 className="h2">Move {pageName(trash)} to the Trash?</h2>
            <p className="muted">No note embeds or links it. You can restore it from the Trash.</p>
            <div className="row">
              <span className="grow" />
              <button type="button" className="btn lg" title="Keep the image" onClick={() => setTrash(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn lg pri"
                title="Move the image to the Trash; you can restore it from there"
                onClick={() => {
                  const p = trash;
                  setTrash(null);
                  act(
                    `trash:${p}`,
                    () => api.healthTrashImage(p),
                    () => toast("Moved to the Trash", { label: "Open Trash", run: () => nav.go("trash") }, "ok"),
                  );
                }}
              >
                Move to the Trash
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {linking && <LinkGhost item={linking} onClose={() => setLinking(null)} />}
    </main>
  );
}

/** What each check looks for, in a line: the title alone doesn't say. */
export const CHECK_TIPS: Record<string, string> = {
  "missing-pages": "Links to pages that don't exist yet",
  "broken-sources": "A page's sources: list names a note or file that isn't in the vault",
  orphans: "Wiki pages no other page links to, so they're hard to come across",
  "missing-crossrefs": "A page mentions another page by name without linking to it",
  "stale-dates": "A page's “updated:” date is older than its last change; Fix sets it to the day it changed",
  "unlogged-writes": "Wiki pages changed after the last entry in log.md, so the log doesn't record the change; Fix adds the log lines",
  "uningested-sources": "Files in sources/ that no wiki page cites yet",
  "unreferenced-images": "Images that no note embeds or links to",
  duplicates: "Pages so alike in name or text that they may be about the same thing",
  "stale-pages": "Pages many others link to that haven't changed in 90 days or more",
  "changed-sources": "Sources that changed after the pages citing them were written",
  "system-callouts": 'System notes whose "This is a system note" header has gone; Fix puts it back as Brainstead last saw it',
};

type Handlers = { setTrash: (p: string) => void; setLinking: (i: LintItem) => void };

function Group({
  title,
  checks,
  open,
  setOpen,
  on,
}: {
  title: string;
  checks: LintCheck[];
  open: string | null;
  setOpen: (id: string | null) => void;
  on: Handlers;
}) {
  return (
    <div className="card hchecks">
      <div className="hgroup eyebrow">{title}</div>
      {checks.map((c) => {
        const n = c.items.length;
        const isOpen = open === c.id && n > 0;
        return (
          <div key={c.id}>
            <button
              type="button"
              className={`ck ${n ? "" : "zero"} ${isOpen ? "open" : ""}`}
              aria-expanded={isOpen}
              title={n ? (isOpen ? "Hide the issues" : "Show the issues") : "Nothing to fix here"}
              onClick={() => setOpen(isOpen ? null : c.id)}
            >
              <Icon name={n ? "info" : "check"} size={14} className={n ? (c.items.some((i) => !i.safe) ? "amber" : "") : "green"} />
              <span className="grow" title={CHECK_TIPS[c.id]}>
                {c.title}
              </span>
              <span className="c">{n}</span>
              {n > 0 && <Icon name="chevdown" size={12} style={{ transform: isOpen ? undefined : "rotate(-90deg)" }} />}
            </button>
            {isOpen && (
              <div className="ckitems">
                {c.items.slice(0, 200).map((i) => (
                  <Row key={i.text} check={c.id} i={i} on={on} />
                ))}
                {n > 200 && <p className="faint small">and {n - 200} more</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One issue, with what can be done about it. */
function Row({ check, i, on }: { check: string; i: LintItem; on: Handlers }) {
  const page = i.page;
  const open = page && !page.startsWith("images/") ? () => openDoc(page) : undefined;
  const label = (() => {
    switch (check) {
      case "missing-pages":
        return `[[${i.name}]]`;
      case "missing-crossrefs":
        return `${pageName(page ?? "")}: “${i.name}” not linked`;
      case "duplicates":
        return i.text;
      case "stale-dates":
        return `${pageName(page ?? "")}: updated says older than the file (${i.detail})`;
      case "stale-pages":
        return `${pageName(page ?? "")} · ${i.count} backlinks · ${i.detail}`;
      default:
        return page ? (check === "uningested-sources" || check === "unreferenced-images" ? page : pageName(page)) : i.text;
    }
  })();
  return (
    <div className="ckitem">
      {open ? (
        <button type="button" className="blink grow" title={`Open ${page}`} onClick={open}>
          {label}
        </button>
      ) : (
        <span className="grow">{label}</span>
      )}
      {check === "missing-pages" && <span className="faint small">{i.pages?.length === 1 ? "1 page" : `${i.pages?.length} pages`}</span>}
      {check === "duplicates" && i.detail && <span className="faint small">{i.detail}</span>}
      {i.safe && page && (
        <BusyButton id={`fix:${i.text}`} onClick={() => act(`fix:${i.text}`, () => api.healthFix([fixOf(check, i)]), fixed)}>
          Fix
        </BusyButton>
      )}
      {check === "missing-pages" && i.name && (
        <>
          <BusyButton
            id={`create:${i.name}`}
            onClick={() =>
              act(
                `create:${i.name}`,
                () => api.healthCreatePage(i.name!, "entities"),
                (p) => {
                  toast(`Created ${pageName(p)}`, undo, "ok");
                  openDoc(p);
                },
                false,
              )
            }
          >
            Create
          </BusyButton>
          <button
            type="button"
            className="btn sm"
            title="Point this missing link at a page that already exists"
            onClick={() => on.setLinking(i)}
          >
            Link to…
          </button>
        </>
      )}
      {check === "duplicates" && page && i.pages?.[0] && (
        <>
          <button type="button" className="btn sm" title={`Open ${i.pages![0]}`} onClick={() => openDoc(i.pages![0])}>
            Open the other
          </button>
          <BusyButton
            id={`dismiss:${i.text}`}
            className="btn sm ghost"
            onClick={() =>
              act(
                `dismiss:${i.text}`,
                () => api.healthDismiss(page, i.pages![0]),
                () => {},
              )
            }
          >
            Not duplicates
          </BusyButton>
        </>
      )}
      {check === "unreferenced-images" && page && (
        <BusyButton id={`trash:${page}`} onClick={() => on.setTrash(page)}>
          Move to the Trash
        </BusyButton>
      )}
      {check === "uningested-sources" && page && <IngestButton path={page} />}
    </div>
  );
}

function IngestButton({ path }: { path: string }) {
  // As on Sources: only files an ingest can read get the button.
  if (!ingestable(path))
    return (
      <span className="faint small" title="Ingest reads notes, text, PDFs, Office files and images, not this kind of file">
        Can't ingest
      </span>
    );
  return (
    <button
      type="button"
      className="btn sm"
      title="Ingest this source into the wiki; its page changes are listed in Changes"
      onClick={() => ingest([path])}
    >
      Ingest
    </button>
  );
}

function SideCards({ r }: { r: LintReport }) {
  const get = (id: string) => r.checks.find((c) => c.id === id)?.items ?? [];
  const pendingSources = get("uningested-sources");
  const changed = get("changed-sources");
  const glance = useGlance();
  return (
    <>
      {glance && <WikiGlance g={glance} />}
      <div className="card hq">
        <div className="row">
          <span className="eyebrow grow">Pending sources</span>
          <span className="faint small">{pendingSources.length + changed.length}</span>
        </div>
        {!pendingSources.length && !changed.length && <p className="faint small">Every source is cited.</p>}
        {pendingSources.slice(0, 6).map((i) => (
          <div key={i.text} className="hqi">
            <span className="lb source" />
            <span className="grow ell">{pageName(i.page ?? "")}</span>
            <IngestButton path={i.page ?? ""} />
          </div>
        ))}
        {changed.slice(0, 4).map((i) => (
          <div key={i.text} className="hqi">
            <span className="lb source" />
            <span className="grow ell">{pageName(i.page ?? "")}</span>
            <span className="chip amber sm">Changed</span>
          </div>
        ))}
      </div>
      <p className="faint small">
        Safe fixes (cross-links, dates, log lines) apply straight away and can be undone with ⌘Z. Anything that changes meaning is an agent
        change, listed in Changes with Revert.
      </p>
    </>
  );
}

/** Points a ghost link's links at a page that exists, one change per page (revertable in Changes). */
function LinkGhost({ item, onClose }: { item: LintItem; onClose: () => void }) {
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const go = async () => {
    if (working) return;
    setWorking(true);
    try {
      const [to] = await api.linksResolve([name.trim()]);
      if (!to) return toast(`There's no page called ${name.trim()}.`, undefined, "bad");
      const n = await api.healthLinkGhost(item.name!, to, item.pages ?? []);
      onClose();
      toast(`Linked on ${n} page${n === 1 ? "" : "s"}`, { label: "Changes", run: () => nav.go("review") }, "ok");
    } catch (e) {
      reportEditError(e);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog onClose={onClose} width={460} label="Link to a page">
      <div className="confirm">
        <h2 className="h2">Link [[{item.name}]] to…</h2>
        <p className="muted small">
          On each page linking it, [[{item.name}]] becomes a link to the page you name, still reading “{item.name}”. Revertable in Changes.
        </p>
        <label className="inp">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void go()}
            placeholder="Orbit App"
          />
        </label>
        <div className="row">
          <span className="grow" />
          <button type="button" className="btn lg" title="Close without changing anything" onClick={onClose}>
            Cancel
          </button>
          <span
            title={
              working ? "Linking…" : name.trim() ? "Change each linking page (↩); revertable in Changes" : "Name the page to link to first"
            }
          >
            <button type="button" className="btn lg pri" disabled={!name.trim() || working} aria-busy={working} onClick={() => void go()}>
              {working && <span className="spin" />}
              Link them
            </button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
