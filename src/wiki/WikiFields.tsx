// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A wiki page's details while it's being edited (§4 Wiki edit): aliases and tags as chips, the
// description, and the sources it rests on. Each change goes into the editor's text (props.ts
// rewrites only that property), so the unsaved banner, drafts and ⌘S work as for any edit.
// Wiki page view (sources and their citation numbers) is in SourcesCard.

import { useEffect, useState } from "react";
import { api, Layer } from "../api";
import { Icon } from "../icons";
import { openDoc } from "../nav";
import { useSearch } from "../Search";
import { vaultTags } from "../Capture";
import { getList, getScalar, setList, setScalar } from "./props";

const linkName = (v: string) => v.replace(/^\[\[|\]\]$/g, "").split(/[|#]/)[0];

function Chips({
  values,
  onChange,
  label,
  prefix = "",
  options,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  label: string;
  prefix?: string;
  /** Suggestions while typing (the vault's tags). */
  options?: string[];
}) {
  const [adding, setAdding] = useState("");
  const listId = `wf-${label}-options`;
  const add = () => {
    const v = adding.trim().replace(/^#/, "");
    if (v && !values.includes(v)) onChange([...values, v]);
    setAdding("");
  };
  return (
    <span className="chips wfchips">
      {values.map((v) => (
        <span key={v} className="chip">
          {prefix}
          {v}
          <button
            type="button"
            className="chipx"
            aria-label={`Remove ${v}`}
            title={`Remove ${prefix}${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <input
        className="chipin"
        value={adding}
        placeholder={`+ ${label}`}
        aria-label={`Add ${label}`}
        list={options ? listId : undefined}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      {options && (
        <datalist id={listId}>
          {options
            .filter((o) => !values.includes(o))
            .map((o) => (
              <option key={o} value={o} />
            ))}
        </datalist>
      )}
    </span>
  );
}

export function WikiFields({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [allTags, setAllTags] = useState<string[]>([]);
  useEffect(() => {
    vaultTags()
      .then(setAllTags)
      .catch(() => setAllTags([]));
  }, []);
  const aliases = getList(text, "aliases");
  const tags = getList(text, "tags");
  const sources = getList(text, "sources");
  const [desc, setDesc] = useState(getScalar(text, "description"));
  useEffect(() => setDesc(getScalar(text, "description")), [text]);
  const [finding, setFinding] = useState("");
  const found = useSearch(finding, ["source", "note"] as Layer[], 8);
  const addSource = (path: string) => {
    const name = (path.split("/").pop() ?? path).replace(/\.md$/, "");
    const link = `[[${name}]]`;
    if (!sources.includes(link)) onChange(setList(text, "sources", [...sources, link]));
    setFinding("");
  };
  return (
    <div className="card wikifields" data-no-print>
      <span className="eyebrow">Page details</span>
      <div className="wf">
        <span>Aliases</span>
        <Chips values={aliases} label="alias" onChange={(v) => onChange(setList(text, "aliases", v))} />
      </div>
      <div className="wf">
        <span>Tags</span>
        <Chips values={tags} label="tag" prefix="#" options={allTags} onChange={(v) => onChange(setList(text, "tags", v))} />
      </div>
      <div className="wf">
        <span>Description</span>
        <textarea
          className="wfdesc"
          value={desc}
          rows={2}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc.trim() !== getScalar(text, "description") && onChange(setScalar(text, "description", desc))}
          placeholder="One line: what it is"
        />
      </div>
      <div className="wf">
        <span>Sources</span>
        <div className="wfsrc">
          {sources.map((s) => (
            <div key={s} className="wfsrow">
              <Icon name="source" size={13} />
              <button
                type="button"
                className="blink grow ell"
                title={`Open ${linkName(s)}`}
                onClick={() => void api.linksResolve([linkName(s)]).then(([p]) => p && openDoc(p))}
              >
                {linkName(s)}
              </button>
              <button
                type="button"
                className="ibtn"
                aria-label={`Remove ${linkName(s)}`}
                title={`Remove ${linkName(s)} from this page's sources`}
                onClick={() =>
                  onChange(
                    setList(
                      text,
                      "sources",
                      sources.filter((x) => x !== s),
                    ),
                  )
                }
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <label className="inp">
            <Icon name="plus" size={12} />
            <input value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="Add a source: find a source or note" />
          </label>
          {finding.trim().length > 1 &&
            (found?.hits ?? []).slice(0, 6).map((h) => (
              <button
                key={h.file.path}
                type="button"
                className="blink"
                title={`Add ${h.file.title} to this page's sources`}
                onClick={() => addSource(h.file.path)}
              >
                <span className={`lb ${h.file.layer}`}>{h.file.title}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

/** A wiki page's sources in their citation order, for the side pane. */
export function SourcesCard({ cites }: { cites: string[] }) {
  if (!cites.length) return null;
  return (
    <section className="card side-card">
      <div className="eyebrow">Sources · {cites.length}</div>
      {cites.map((p, i) => (
        <button
          key={p}
          type="button"
          className="blink srccite"
          title={`Open ${(p.split("/").pop() ?? p).replace(/\.md$/, "")}`}
          onClick={() => openDoc(p)}
        >
          <span className="cite">{i + 1}</span>
          <span className="grow">
            <span className={`lb ${p.startsWith("sources/") ? "source" : p.startsWith("wiki/") ? "wiki" : "note"}`}>
              {(p.split("/").pop() ?? p).replace(/\.md$/, "")}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}
