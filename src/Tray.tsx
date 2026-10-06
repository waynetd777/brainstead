// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The menu-bar window (§10 stage 10; src-tauri/src/tray.rs opens it under the icon): how today
// stands, a capture box, what's running with Stop, what waits for you, and the few things worth
// doing from the menu bar, with their keys. It also tells Rust which icon to show, so the icon
// is right while the window is closed.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, IngestRun, NightlyStatus, ReviewsStatus, TaskRow } from "./api";
import { CaptureBox } from "./Capture";
import { unclarified } from "./Inbox";
import { Icon, Mark } from "./icons";
import { localToday } from "./md/taskQuery";
import { pageName } from "./knowledge";
import { ReadOnlyPill } from "./Sidebar";
import { applyTheme, settings, useStore } from "./store";
import { Switch } from "./ui";
import { deferredPast, todayRows, viewRows, VIEWS } from "./taskModel";

export interface Running {
  key: string;
  label: string;
  doing: string;
  /** 0 to 1, or null when there's no measure. */
  progress: number | null;
  stop: () => Promise<unknown>;
}

export interface TrayData {
  /** Null when the tasks, the Inbox or Changes couldn't be read: shown as such, never as 0. */
  overdue: number | null;
  due: number | null;
  waiting: number | null;
  inbox: number | null;
  /** Changes held for you. */
  held: number | null;
  running: Running[];
  nextReview: string | null;
}

/** What couldn't be loaded, in words. */
export function trayFailed(d: TrayData): string[] {
  return [d.overdue === null && "tasks", d.inbox === null && "the Inbox", d.held === null && "Changes"].filter(Boolean) as string[];
}

/** The headline and the icon's state. The tiles and rows below give the numbers, so the headline doesn't repeat them. */
export function trayStatus(d: TrayData): { headline: string; busy: boolean; attention: boolean } {
  const failed = trayFailed(d);
  const busy = d.running.length > 0;
  const attention = !!d.overdue || !!d.held || !!d.inbox;
  const headline = failed.length
    ? `Couldn't load ${failed.length > 1 ? `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}` : failed[0]}`
    : busy
      ? d.running.length === 1
        ? "1 run going"
        : `${d.running.length} runs going`
      : attention
        ? "Things need you"
        : "All clear";
  return { headline, busy, attention };
}

const when = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === today.toDateString()
    ? `today at ${time}`
    : `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
};

function runningOf(ingests: IngestRun[], nightly: NightlyStatus, reviews: ReviewsStatus, contradictions: boolean): Running[] {
  const out: Running[] = [];
  for (const r of ingests.filter((x) => x.status === "running" || x.status === "queued")) {
    const steps = r.steps.length;
    const done = r.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    out.push({
      key: `ingest:${r.id}`,
      label: `Ingesting ${pageName(r.source)}`,
      doing: r.status === "queued" ? "Waiting its turn" : (r.steps.find((s) => s.status === "running")?.name ?? "Starting"),
      progress: steps ? done / steps : null,
      stop: () => api.ingestStop(r.id),
    });
  }
  if (nightly.running)
    out.push({
      key: "nightly",
      label: "Running the nightly check",
      doing: nightly.doing,
      progress: nightly.progress,
      stop: () => api.nightlyStop(),
    });
  for (const k of reviews.running)
    out.push({
      key: `review:${k}`,
      label: `Writing the ${k} summary`,
      doing: "The model is writing it",
      progress: null,
      stop: () => api.reviewsStop(k),
    });
  if (contradictions)
    out.push({
      key: "contradictions",
      label: "Checking for contradictions",
      doing: "Reading the wiki",
      progress: null,
      stop: () => api.contradictionsStop(),
    });
  return out;
}

async function load(): Promise<TrayData> {
  const [tasks, inbox, changes, ingests, nightly, reviews, contra] = await Promise.all([
    api.tasksAll().catch(() => null as TaskRow[] | null),
    api.inboxList().catch(() => null),
    api.changesList().catch(() => null),
    api.ingestRuns().catch(() => []),
    api.nightlyStatus().catch(() => ({ running: false }) as NightlyStatus),
    api.reviewsStatus().catch(() => ({ runs: [], next: { daily: null, weekly: null }, running: [] }) as ReviewsStatus),
    api.contradictionsReport().catch(() => null),
  ]);
  const today = localToday();
  const t = tasks && todayRows(tasks, today);
  const waitingView = VIEWS.find((v) => v.id === "waiting");
  const next = (
    [
      [reviews.next.daily, "daily summary"],
      [reviews.next.weekly, "weekly summary"],
    ].filter(([at]) => at) as [string, string][]
  ).sort(([a], [b]) => a.localeCompare(b))[0];
  return {
    overdue: t ? t.overdue.length : null,
    due: t ? t.due.length : null,
    waiting: tasks ? (waitingView ? viewRows(tasks, waitingView, today).filter((r) => !deferredPast(r, today)).length : 0) : null,
    inbox: inbox && inbox.filter(unclarified).length,
    held: changes && changes.filter((c) => c.status === "held").length,
    running: runningOf(ingests, nightly, reviews, !!contra?.last?.running),
    nextReview: next ? `${next[1]} ${when(next[0])}` : null,
  };
}

const hide = () => void getCurrentWindow().hide();
const show = (screen?: string) => void invoke("main_show", { screen: screen ?? null });

function Item({
  label,
  keys,
  icon,
  onClick,
  strong,
  keepOpen,
}: {
  label: string;
  keys?: string;
  icon: string;
  onClick: () => void;
  strong?: boolean;
  /** Stay open after the click, to show what happened. */
  keepOpen?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tray-item${strong ? " strong" : ""}`}
      title={keys ? `${label} (${keys})` : label}
      onClick={() => {
        onClick();
        if (!keepOpen) hide();
      }}
    >
      <Icon name={icon} size={14} />
      <span className="grow">{label}</span>
      {keys && <span className="kbd">{keys}</span>}
    </button>
  );
}

export function TrayWindow() {
  const [d, setD] = useState<TrayData | null>(null);
  const [capKey, setCapKey] = useState(0);
  // The nightly check started from here: "starting", "started", or the error.
  const [nightly, setNightly] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const readOnly = !!useStore(settings).readOnly;
  // Open at login: null where macOS can't manage it for this copy of the app (`make dev`).
  const [login, setLogin] = useState<boolean | null>(null);
  const [loginErr, setLoginErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void load().then((x) => {
      setD(x);
      const s = trayStatus(x);
      void invoke("tray_set_state", { busy: s.busy, attention: s.attention }).catch(() => {});
    });
  }, []);

  // Fresh when opened (the theme too, which the main window may have changed), when the vault or
  // the queue changes, and every so often for runs: often while one is going.
  useEffect(() => {
    // Read again each time it opens: System Settings › Login Items can change it too.
    const loadLogin = () =>
      void api
        .loginItem()
        .then(setLogin)
        .catch(() => {});
    refresh();
    loadLogin();
    const offs = [
      listen("tray-opened", () => {
        loadLogin();
        setLoginErr(null);
        void api.settingsRead().then((s) => {
          settings.loadFrom(s);
          applyTheme(s.theme);
        });
        setCapKey((k) => k + 1);
        setNightly(null);
        refresh();
      }),
      api.onVaultChanged(() => refresh()),
      api.onChangesChanged(() => refresh()),
      // Runs starting and stopping, so the rows and the icon's dots don't wait for the poll.
      api.onIngestChanged(() => refresh()),
      api.onNightlyChanged(() => refresh()),
      api.onReviewsChanged(() => refresh()),
      api.onContradictionsChanged(() => refresh()),
      api.onLoginItemChanged(setLogin),
    ];
    return () => offs.forEach((o) => void o.then((f) => f()));
  }, [refresh]);
  useEffect(() => {
    const t = window.setInterval(refresh, d?.running.length ? 2000 : 15000);
    return () => window.clearInterval(t);
  }, [refresh, d?.running.length]);

  // Its keys while it's open.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") return hide();
      if (!e.metaKey || (e.target as HTMLElement)?.closest?.("textarea, input")) return;
      const act: Record<string, () => unknown> = {
        o: () => show(),
        t: () => show("today"),
        j: () => show("ask"),
        ",": () => show("settings"),
        q: () => invoke("tray_quit"),
      };
      const f = act[e.key.toLowerCase()];
      if (f) {
        e.preventDefault();
        f();
        hide();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // The window is as tall as what it shows.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(
      () =>
        void getCurrentWindow()
          .setSize(new LogicalSize(360, Math.ceil(el.getBoundingClientRect().height)))
          .catch(() => {}),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [d]);

  if (!d) return null;
  const s = trayStatus(d);
  return (
    <div ref={box} className="traywin">
      <div className="tray-head">
        <div className="tray-title">
          <Mark size={22} />
          <span className="ell grow">{s.headline}</span>
          {readOnly && <ReadOnlyPill onOpen={() => show("settings/vault")} />}
        </div>
        {trayFailed(d).length > 0 && <span className="muted small">It tries again in a moment.</span>}
      </div>
      <div className="tray-tiles">
        {(
          [
            ["Overdue", d.overdue, d.overdue ? "bad" : ""],
            ["Due today", d.due, ""],
            ["Waiting for", d.waiting, ""],
          ] as const
        ).map(([label, n, tone]) => (
          <button
            key={label}
            type="button"
            className={`tray-tile ${tone} ${n ? "" : "zero"}`}
            title={n === null ? "Couldn't load tasks. Open Today" : `Open Today: ${label.toLowerCase()}`}
            onClick={() => (show("today"), hide())}
          >
            <b>{n ?? "–"}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="tray-capture">
        <CaptureBox key={capKey} compact narrow />
      </div>
      {d.running.length > 0 && (
        <div className="tray-sec">
          {d.running.map((r) => (
            <div key={r.key} className="tray-run">
              <div className="tray-runhead">
                <span className="spin" aria-hidden="true" />
                <span className="grow ell">{r.label}</span>
                <button
                  type="button"
                  className="btn sm ghost"
                  title={`Stop: ${r.label.toLowerCase()}`}
                  onClick={() => void r.stop().then(refresh)}
                >
                  Stop
                </button>
              </div>
              <div className="tray-progress">
                <i style={{ width: `${Math.round((r.progress ?? 0.08) * 100)}%` }} className={r.progress === null ? "indef" : ""} />
              </div>
              <span className="faint small ell">{r.doing}</span>
            </div>
          ))}
        </div>
      )}
      {(!!d.held || !!d.inbox) && (
        <div className="tray-sec tray-list">
          {!!d.held && (
            <Item icon="review" label={`${d.held} ${d.held === 1 ? "change" : "changes"} held for you`} onClick={() => show("review")} />
          )}
          {!!d.inbox && (
            <Item icon="inbox" label={`${d.inbox} ${d.inbox === 1 ? "item" : "items"} in the Inbox`} onClick={() => show("inbox")} />
          )}
        </div>
      )}
      {login !== null && (
        <div className="tray-sec tray-switches">
          <div className="tray-switch">
            <Icon name="power" size={14} />
            <span className="grow">Open at login</span>
            <Switch
              label="Open at login"
              on={login}
              onChange={(v) => {
                setLoginErr(null);
                void api
                  .loginItemSet(v)
                  .then(setLogin)
                  .catch((e) => setLoginErr(String(e)));
              }}
            />
          </div>
          {loginErr && <div className="tray-err small">{loginErr}</div>}
        </div>
      )}
      <div className="tray-sec tray-list">
        <Item icon="today" label="Open Brainstead" keys="⌘O" strong onClick={() => show()} />
        <Item icon="calendar" label="Today" keys="⌘T" onClick={() => show("today")} />
        <Item icon="ask" label="Ask" keys="⌘J" onClick={() => show("ask")} />
        <Item
          icon="health"
          label={
            nightly === "starting"
              ? "Starting the nightly check…"
              : nightly === "started"
                ? "Nightly check started"
                : "Run the nightly check now"
          }
          keepOpen
          onClick={() => {
            if (nightly === "starting") return;
            setNightly("starting");
            void api
              .nightlyRunNow()
              .then(() => setNightly("started"))
              .catch((e) => setNightly(`Couldn't start it: ${String(e)}`))
              .finally(refresh);
          }}
        />
        {nightly && nightly !== "starting" && nightly !== "started" && <div className="tray-err small">{nightly}</div>}
        <div className="tray-rule" />
        <Item icon="settings" label="Settings…" keys="⌘," onClick={() => show("settings")} />
        <Item icon="x" label="Quit Brainstead" keys="⌘Q" onClick={() => void invoke("tray_quit")} />
      </div>
      <div className="tray-foot">
        {d.nextReview ? `Next: ${d.nextReview}. ` : ""}Brainstead keeps running here when its window is closed.
      </div>
    </div>
  );
}
