// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Doc check (the vault's `doc-check` skill, §4): checks a document against the version of a
// governing document in force, taken from the canonical docs register (`Me. Canonical Docs.md`),
// never from a file name, and says which version it used and which it left out. A second mode
// checks whether a revision took in the user's earlier feedback. It reports; it changes nothing
// but a note you choose to save.

import { useEffect, useMemo, useState } from "react";
import { api, CanonicalEntry, CanonicalRegister, CheckResult, FileSummary, Finding } from "../api";
import { Icon } from "../icons";
import { openDoc, place, useViewState } from "../nav";
import { useStore } from "../store";
import { reportEditError } from "../taskModel";
import { toast } from "../Toast";
import { TopBar } from "../TopBar";
import { Seg } from "../ui";
import { ASSISTANT_FRONTMATTER } from "../md/scripts";

type Mode = "standard" | "callouts";

/** The canonical docs register, and what Start the register makes it with (doc_check too). */
export const REGISTER = "Me. Canonical Docs.md";
export const REGISTER_STUB = `# Canonical docs

Which version of each governing document is in force. Doc check reads this table: one row per version; status is canonical (in force), draft or superseded; path is in the vault, \`~/…\` or a full path.

| key | title | version | status | path | aliases |
|---|---|---|---|---|---|
`;

const KIND: Record<string, [string, string]> = {
  diverges: ["Conflict", "red"],
  "not-covered": ["Not covered", "amber"],
  "superseded-term": ["Superseded term", "amber"],
  "beyond-scope": ["Beyond scope", ""],
  aligned: ["Agrees", "green"],
};

/** A register row's status as the screen names it. */
export const STATUS: Record<string, [string, string]> = {
  canonical: ["In force", "green"],
  draft: ["Draft", "amber"],
  superseded: ["Superseded", ""],
};

/** Where Save as note puts a check of the document `name` (its file name), dated today. */
export function findingsNote(name: string, d = new Date()): string {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `Doc check. ${name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|#^[\]]/g, " ")} - ${date}.md`;
}

/** The findings as markdown, for Copy findings and Save as note. */
export function findingsMarkdown(name: string, r: CheckResult): string {
  const lines = [`# Doc check: ${name}`, ""];
  if (r.against) lines.push(`Checked against ${r.against.title} ${r.against.version} (in force).`);
  if (r.excluded.length)
    lines.push(`Not used: ${r.excluded.map((e) => `${e.title} ${e.version} (${STATUS[e.status]?.[0] ?? e.status})`).join(", ")}.`);
  lines.push("", `**${r.verdict}**`, "", r.summary, "");
  for (const f of r.findings.filter((x) => x.kind !== "aligned")) {
    lines.push(`## ${KIND[f.kind]?.[0] ?? f.kind}${f.material ? " (material)" : ""}: ${f.title}`, "");
    if (f.where) lines.push(`*${f.where}*`, "");
    if (f.candidate) lines.push(`> This document: ${f.candidate}`, "");
    if (f.canonical) lines.push(`> In force: ${f.canonical}`, "");
  }
  const ok = r.findings.filter((x) => x.kind === "aligned");
  if (ok.length) lines.push(`## Agrees`, "", ...ok.map((f) => `- ${f.title}`), "");
  return lines.join("\n");
}

export function DocCheckScreen() {
  const here = useStore(place).place;
  const [reg, setReg] = useState<CanonicalRegister | null>(null);
  const [sources, setSources] = useState<FileSummary[]>([]);
  const [cand, setCand] = useViewState<string | null>("doccheck.candidate", null);
  const [doc, setDoc] = useViewState<string>("doccheck.doc", "");
  const [mode, setMode] = useViewState<Mode>("doccheck.mode", "standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [r, setR] = useState<CheckResult | null>(null);
  const [showOk, setShowOk] = useState(false);
  const candidate = here.path ?? cand;

  const load = () =>
    void api
      .canonicalRegister()
      .then(setReg)
      .catch((e) => setError(String(e)));
  useEffect(load, []);
  useEffect(() => {
    void api
      .filesList("source")
      .then((f) => setSources(f.sort((a, b) => b.mtime - a.mtime)))
      .catch(() => {});
  }, []);
  const docs = useMemo(() => {
    const m = new Map<string, CanonicalEntry>();
    for (const e of reg?.entries ?? []) if (!m.has(e.key) || e.status === "canonical") m.set(e.key, e);
    return [...m.values()];
  }, [reg]);
  useEffect(() => {
    if (!doc && docs.length) setDoc(docs[0].key);
  }, [docs]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const f = await open({
      multiple: false,
      directory: false,
      title: "A document to check",
      filters: [{ name: "Documents", extensions: ["pdf", "docx", "pptx", "xlsx", "md", "txt"] }],
    });
    if (typeof f === "string") setCand(f);
  };
  // Why Check can't run yet, shown beside it.
  const why = !candidate
    ? "Choose a document to check first."
    : mode === "standard" && !doc
      ? docs.length
        ? "Choose the governing document to check against."
        : "Add a governing document to the register first."
      : null;
  const run = async () => {
    if (!candidate) return;
    setBusy(true);
    setError("");
    setR(null);
    try {
      setR(await api.docCheck(candidate, doc, mode));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const name = candidate ? (candidate.split("/").pop() ?? candidate) : "";
  const count = (k: string) => r?.findings.filter((f) => f.kind === k).length ?? 0;
  const save = async () => {
    if (!r) return;
    const path = findingsNote(name);
    try {
      await api.docCreate(path, ASSISTANT_FRONTMATTER + findingsMarkdown(name, r));
      toast("Saved as a note", { label: "Open", run: () => openDoc(path) }, "ok");
    } catch (e) {
      reportEditError(e);
    }
  };
  const makeRegister = async () => {
    try {
      await api.docCreate(REGISTER, REGISTER_STUB);
      openDoc(REGISTER);
    } catch (e) {
      reportEditError(e);
    }
  };

  return (
    <main className="main">
      <TopBar title="Doc check" sub={name || undefined}>
        {r && (
          <>
            <button
              type="button"
              className="btn"
              title="Copy the findings to the clipboard as markdown"
              onClick={() =>
                void navigator.clipboard.writeText(findingsMarkdown(name, r)).then(() => toast("Findings copied", undefined, "ok"))
              }
            >
              <Icon name="copy" size={14} />
              Copy findings
            </button>
            <button
              type="button"
              className="btn pri"
              title="Save the findings as a new dated note in the vault"
              onClick={() => void save()}
            >
              <Icon name="plus" size={14} />
              Save as note
            </button>
          </>
        )}
      </TopBar>
      <div className="body doccheck">
        <section>
          <div className="row">
            <span className="eyebrow">Canonical docs register</span>
            <span className="faint small grow">which version of each governing document is in force · {REGISTER}</span>
            {reg?.exists ? (
              <button type="button" className="btn sm ghost" title="Open the register note to change it" onClick={() => openDoc(REGISTER)}>
                Edit register
              </button>
            ) : (
              <button
                type="button"
                className="btn sm"
                title="Create the register note from a starter table and open it"
                onClick={() => void makeRegister()}
              >
                Start the register
              </button>
            )}
          </div>
          {reg && reg.entries.length > 0 && (
            <div className="card dcreg">
              <div className="dcr th">
                <span>Document</span>
                <span>Version</span>
                <span>Status</span>
                <span>File</span>
              </div>
              {reg.entries.map((e) => (
                <div key={e.line} className={`dcr ${e.status}`}>
                  <span className="ell">{e.title}</span>
                  <span className="mono">{e.version}</span>
                  <span>
                    <span className={`chip ${STATUS[e.status][1]}`}>{STATUS[e.status][0]}</span>
                  </span>
                  <span className={`ell ${e.exists ? "muted" : "red"}`} title={e.resolvedPath}>
                    {e.path.split("/").pop()}
                    {!e.exists && " · not there"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {reg?.problems.map((p) => (
            <p key={p} className="err small">
              {REGISTER}: {p}
            </p>
          ))}
        </section>
        <section className="card dcform">
          <div className="row">
            <span className="eyebrow">Check</span>
            <select
              className="sel grow"
              aria-label="Document to check"
              value={candidate ?? ""}
              onChange={(e) => setCand(e.target.value || null)}
            >
              <option value="">Choose a source…</option>
              {candidate && !sources.some((s) => s.path === candidate) && <option value={candidate}>{name}</option>}
              {sources.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.path.split("/").pop()}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" title="Pick a document from anywhere on disk" onClick={() => void pick()}>
              Choose a file…
            </button>
          </div>
          <div className="row">
            <Seg<Mode>
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                ["standard", "Against the version in force", "Compare the document with the version of a governing document in force"],
                [
                  "callouts",
                  "Against my earlier feedback",
                  "For a revised document: check each point of the feedback you gave on the last version against this one",
                ],
              ]}
            />
            {mode === "standard" && (
              <select className="sel" aria-label="Governing document" value={doc} onChange={(e) => setDoc(e.target.value)}>
                {docs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.title}
                  </option>
                ))}
              </select>
            )}
            <span className="grow" />
            {why && <span className="faint small">{why}</span>}
            <span
              title={
                why ??
                (busy
                  ? "Checking the document…"
                  : mode === "standard"
                    ? "Have the AI compare the document with the version in force"
                    : "Have the AI check whether the document took your feedback")
              }
            >
              <button type="button" className="btn pri" disabled={busy || !!why} onClick={() => void run()}>
                <Icon name="ask" size={14} />
                {busy ? "Checking…" : "Check"}
              </button>
            </span>
          </div>
          {error && <p className="err">{error}</p>}
        </section>
        {r && (
          <div className="dcres">
            <section className="card dcverdict">
              <span className="eyebrow">Verdict</span>
              <div className="dcv">{r.verdict}</div>
              <p className="muted small">{r.summary}</p>
              {(
                [
                  ["diverges", "Conflicts", "red"],
                  ["not-covered", "Not covered", "amber"],
                  ["superseded-term", "Superseded terms", "amber"],
                  ["aligned", "Agrees", "green"],
                ] as const
              )
                .filter(([k]) => count(k))
                .map(([k, l, t]) => (
                  <div key={k} className="row small">
                    <span className="muted grow">{l}</span>
                    <span className={`chip ${t}`}>{count(k)}</span>
                  </div>
                ))}
              {r.against && (
                <p className="faint small">
                  Checked against {r.against.title} {r.against.version}.
                  {r.excluded.length > 0 && ` Not used: ${r.excluded.map((e) => `${e.version} (${e.status})`).join(", ")}.`}
                </p>
              )}
            </section>
            <section className="card dcfind">
              {r.findings
                .filter((f) => f.kind !== "aligned")
                .map((f, i) => (
                  <FindingRow key={i} f={f} against={r.against} />
                ))}
              {count("aligned") > 0 && (
                <div className="dcf">
                  <div className="row">
                    <span className="chip green">
                      <Icon name="check" size={11} />
                      Agrees
                    </span>
                    <span className="grow ell">
                      {r.findings
                        .filter((f) => f.kind === "aligned")
                        .map((f) => f.title)
                        .join(", ")}
                    </span>
                    <button
                      type="button"
                      className="btn sm ghost"
                      title={showOk ? "Hide the points where the document agrees" : "Show the points where the document agrees"}
                      onClick={() => setShowOk((x) => !x)}
                    >
                      {showOk ? "Hide" : `Show ${count("aligned")}`}
                    </button>
                  </div>
                  {showOk && r.findings.filter((f) => f.kind === "aligned").map((f, i) => <FindingRow key={i} f={f} against={r.against} />)}
                </div>
              )}
              {!r.findings.length && <p className="faint">No findings.</p>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function FindingRow({ f, against }: { f: Finding; against: CanonicalEntry | null }) {
  const [label, tone] = KIND[f.kind] ?? [f.kind, ""];
  return (
    <div className="dcf">
      <div className="row">
        <span className={`chip ${tone}`}>{label}</span>
        <b className="grow">{f.title}</b>
        {f.material && <span className="chip red">Material</span>}
        {f.where && <span className="faint small">{f.where}</span>}
      </div>
      {(f.candidate || f.canonical) && (
        <div className="dcq">
          {f.candidate && (
            <div className="q">
              <div className="faint small">This document</div>“{f.candidate}”
            </div>
          )}
          {f.canonical && (
            <div className="q">
              <div className="faint small">{against ? `In force · ${against.title} ${against.version}` : "Asked for"}</div>“{f.canonical}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}
