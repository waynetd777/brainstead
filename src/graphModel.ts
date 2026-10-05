// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The Graph screen's state, apart from the drawing: what colour a node is, which kinds are shown,
// how big a node is and which get a label.

import type { Graph, GraphNode } from "./api";

/** What a node is drawn as: a wiki page by its type, a source, a note, or a link to nothing. */
export type Kind = "concept" | "entity" | "wiki" | "source" | "note" | "ghost";

export const KINDS: [Kind, string][] = [
  ["entity", "Entities"],
  ["source", "Sources and summaries"],
  ["concept", "Concepts"],
  ["wiki", "Other wiki"],
  ["note", "Notes"],
  ["ghost", "Not written yet"],
];

/** The colour token for each kind: the pie charts' palette, the same colour per type as the "Wiki
 *  pages by type" pie (WIKI_TYPE_TONE), notes in a colour of their own, and Other's grey for links
 *  to nothing. */
export const KIND_COLOUR: Record<Kind, string> = {
  entity: "--pie-1",
  source: "--pie-2",
  concept: "--pie-3",
  wiki: "--pie-4",
  note: "--pie-6",
  ghost: "--pie-other",
};

/** The pie slice for each wiki page type, so a type is the same colour on the pie and the graph. */
export const WIKI_TYPE_TONE: Record<string, string> = { entity: "p1", "source-summary": "p2", summary: "p2", concept: "p3" };

export function kindOf(n: Pick<GraphNode, "layer" | "type">): Kind {
  if (n.layer === "ghost") return "ghost";
  if (n.layer === "source") return "source";
  if (n.layer !== "wiki") return "note";
  const t = (n.type ?? "").toLowerCase();
  if (t === "concept") return "concept";
  if (t === "entity") return "entity";
  if (t === "summary" || t === "source" || t === "source-summary") return "source";
  return "wiki";
}

/** The graph without the hidden kinds; the centre always stays. */
export function visible(g: Graph, hidden: Kind[], center: string | null): Graph {
  if (!hidden.length) return g;
  const off = new Set(hidden);
  const nodes = g.nodes.filter((n) => n.id === center || !off.has(kindOf(n)));
  const ids = new Set(nodes.map((n) => n.id));
  return { ...g, nodes, edges: g.edges.filter(([a, b]) => ids.has(a) && ids.has(b)) };
}

/** What the side pane calls one node. */
export function kindLabel(n: Pick<GraphNode, "layer" | "type">): string {
  const k = kindOf(n);
  if (k === "source") return n.layer === "wiki" ? "Summary" : "Source";
  return { concept: "Concept", entity: "Entity", wiki: "Wiki page", note: "Note", ghost: "Not written yet" }[k];
}

/** The kinds present, for the filter chips. */
export function kindsIn(g: Graph): Kind[] {
  const here = new Set(g.nodes.map(kindOf));
  return KINDS.map(([k]) => k).filter((k) => here.has(k));
}

/** A node's radius in graph units, by its links across the vault. */
export const radius = (degree: number, isCenter = false) => (isCenter ? 11 : Math.min(16, 3.5 + Math.sqrt(degree) * 1.5));

/** Each node's neighbours in this graph. */
export function neighbours(g: Graph): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>(g.nodes.map((n) => [n.id, new Set()]));
  for (const [a, b] of g.edges) {
    m.get(a)?.add(b);
    m.get(b)?.add(a);
  }
  return m;
}

/** The nodes that always get a label: the centre, the biggest bubbles and the biggest hollow ones. Hovering labels the rest. */
export function labelled(g: Graph, center: string | null, max = 8): Set<string> {
  const out = new Set<string>();
  if (center) out.add(center);
  // The busiest pages, and as many of the busiest pages not written yet, so a hollow bubble says what it is.
  const top = (ns: GraphNode[]) =>
    [...ns]
      .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
      .slice(0, max)
      .forEach((n) => out.add(n.id));
  top(g.nodes.filter((n) => n.layer !== "ghost" && n.id !== center));
  top(g.nodes.filter((n) => n.layer === "ghost" && n.id !== center));
  return out;
}

/** The pages in a picker's list: titles containing every word typed, shortest first. */
export function pick<T extends { title: string }>(files: T[], q: string, max = 8): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return files
    .filter((f) => {
      const t = f.title.toLowerCase();
      return words.every((w) => t.includes(w));
    })
    .sort((a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title))
    .slice(0, max);
}
