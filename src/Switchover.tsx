// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The switch-over checklist (stage 8 item 9), in Settings › General: what's left before the other
// notes app can be switched off. Brainstead checks what it can (read-only, the reviews, the
// extensions' captures); the rest the user ticks. Nothing in Brainstead needs the other app.
// It shows only when the previous app's own files are in the vault (`switchover_status`).

import { useEffect, useState } from "react";
import { api, Captured } from "./api";
import { Icon } from "./icons";
import { nav, SettingsPane } from "./nav";
import { settings, useStore } from "./store";
import { toast } from "./Toast";
import { reportEditError } from "./taskModel";
import { Dialog } from "./ui";

interface Item {
  id: string;
  label: string;
  detail: string;
  /** Checked by Brainstead (true/false), or ticked by hand (undefined). */
  done?: boolean;
  optional?: boolean;
  /** The button: its label, what it does, and the tooltip. */
  action?: [string, () => void, string];
}

const goTo = (pane: SettingsPane) => () => nav.go({ screen: "settings", pane });

const lastOk = (recent: Captured[], ext: "outlook" | "teams") => recent.find((c) => c.extension === ext && c.path && !c.error);

export function Switchover() {
  const s = useStore(settings);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.switchoverStatus>> | null>(null);
  const [recent, setRecent] = useState<Captured[]>([]);
  const [confirm, setConfirm] = useState(false);
  const load = () =>
    void api
      .switchoverStatus()
      .then(setStatus)
      .catch(() => {});
  useEffect(() => {
    load();
    void api
      .captureStatus()
      .then((c) => setRecent(c.recent))
      .catch(() => {});
  }, []);
  const ticked = s.switchover ?? {};
  const retired = !!status && !status.skills && !status.scripts && status.claudeMd;
  const retire = () => {
    setConfirm(false);
    api
      .switchoverRetire()
      .then((m) => toast(m, { label: "Open Trash", run: () => nav.go("trash") }, "ok"))
      .then(load)
      .catch(reportEditError);
  };
  const outlook = lastOk(recent, "outlook");
  const teams = lastOk(recent, "teams");
  const when = (c?: Captured) =>
    c ? `Last capture ${new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "No capture yet.";

  const items: Item[] = [
    {
      id: "writes",
      label: "Brainstead can write to the vault",
      detail: s.readOnly
        ? "Read-only is on, so captures and ticks are refused, and scheduled summaries are held for you."
        : "Read-only is off.",
      done: !s.readOnly,
      action: ["Vault", goTo("vault"), "Open Settings › Vault, where read-only is switched"],
    },
    {
      id: "reviews",
      label: "Brainstead runs the daily and weekly summaries",
      detail: s.reviewsHere ? "The daily and weekly summaries are written here." : "Switch this on in Jobs & schedule.",
      done: !!s.reviewsHere,
      action: ["Jobs & schedule", goTo("jobs"), "Open Settings › Jobs & schedule to run the summaries here"],
    },
    {
      id: "automated",
      label: "Your tools that start sessions are listed",
      detail:
        status?.automated == null
          ? "List your tools that start Claude Code sessions, so the daily summary doesn't count them as your work."
          : `${status.automated} listed.`,
      done: (status?.automated ?? 0) > 0,
      optional: true,
      action: ["Jobs & schedule", goTo("jobs"), "Open Settings › Jobs & schedule, where you list your tools"],
    },
    {
      id: "outlook",
      label: "The Outlook extension captures here",
      detail: when(outlook),
      done: !!outlook,
      action: ["Capture extensions", goTo("capture"), "Open Settings › Capture extensions to set up and test the extension"],
    },
    {
      id: "teams",
      label: "The Teams extension captures here",
      detail: when(teams),
      done: !!teams,
      action: ["Capture extensions", goTo("capture"), "Open Settings › Capture extensions to set up and test the extension"],
    },
    { id: "otherReviews", label: "The other app's daily and weekly summaries are off", detail: "So only one app writes them." },
    { id: "otherExtensions", label: "The other app's browser extensions are removed", detail: "So a capture can't land twice." },
    { id: "otherStopped", label: "The other app is stopped", detail: "Brainstead doesn't need it running." },
    {
      id: "retire",
      label: "The other app's skills and scripts are retired",
      detail: retired
        ? "Agents working in the vault are told in CLAUDE.md to use Brainstead's tools, so every change shows in Changes."
        : "Its skills (.claude/skills) and scripts (scripts/) have agents write files directly, past Changes. Retiring them moves both to the Trash and tells agents in CLAUDE.md to use Brainstead's tools.",
      done: retired,
      action: retired
        ? undefined
        : [
            "Retire them",
            () => (ticked.otherStopped ? setConfirm(true) : toast("Stop the other app first, and tick it above.")),
            "Move the skills and scripts to the Trash and point agents at Brainstead's tools",
          ],
    },
  ];
  const isDone = (i: Item) => i.done ?? !!ticked[i.id];
  const needed = items.filter((i) => !i.optional);
  const n = needed.filter(isDone).length;

  if (!status?.previous) return null;
  return (
    <section className="sgroup">
      <div className="row">
        <h2 className="h3 grow">Moving over from another notes app</h2>
        <span className="faint">
          {n} of {needed.length} done
        </span>
      </div>
      <div className="card switchover">
        {items.map((i) => {
          const done = isDone(i);
          const manual = i.done === undefined;
          return (
            <div key={i.id} className="srow">
              {manual ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={i.label}
                  title={done ? "Ticked by you; click to untick" : "Tick once you have done this"}
                  className={`cb ${done ? "on" : ""}`}
                  onClick={() => settings.update({ switchover: { ...ticked, [i.id]: !done } })}
                >
                  {done && <Icon name="check" size={11} />}
                </button>
              ) : (
                // Checked by Brainstead: the same box, not clickable.
                <span
                  role="checkbox"
                  aria-checked={done}
                  aria-disabled="true"
                  aria-label={i.label}
                  className={`cb auto ${done ? "on" : ""}`}
                  title="Brainstead checks this itself"
                >
                  {done && <Icon name="check" size={11} />}
                </span>
              )}
              <div className="t">
                <div className="pt">
                  {i.label}
                  {i.optional && <span className="faint"> · optional</span>}
                </div>
                <div className="faint">{i.detail}</div>
              </div>
              {i.action && (
                <button type="button" className="btn sm" title={i.action[2]} onClick={i.action[1]}>
                  {i.action[0]}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {confirm && (
        <Dialog onClose={() => setConfirm(false)} width={480} label="Retire the other app's skills and scripts">
          <div className="confirm">
            <h2 className="h2">Retire the other app&apos;s skills and scripts?</h2>
            <p className="muted">
              .claude/skills and scripts/ go to Brainstead&apos;s Trash, where you can restore them. CLAUDE.md gets a section telling agents
              to change the vault only through Brainstead&apos;s tools (⌘Z undoes it). Your name corrections are kept.
            </p>
            <div className="row">
              <span className="grow" />
              <button type="button" className="btn lg" title="Leave them where they are" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn lg pri" title="Retire the skills and scripts" onClick={retire}>
                Retire them
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
