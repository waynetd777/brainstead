// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// The help topics: the markdown files beside this one, which Rust embeds too (core/src/help.rs)
// for Ask. Each is frontmatter (`title`, `kind`: screen or guide, `screens`, `order`, `summary`)
// and `##` sections; a guide's sections are its steps. Links into the app are `app:` links.

import type { Place, Screen, SettingsPane } from "../nav";
import { defaultUrlTransform } from "react-markdown";

export interface HelpSection {
  title: string;
  body: string;
}

export interface HelpTopic {
  /** The file name without `.md`. */
  id: string;
  title: string;
  kind: "screen" | "guide";
  /** The screens (and `settings/<pane>`) it's the help for. */
  screens: string[];
  order: number;
  summary: string;
  /** The section to open first when the topic is shown for an open document of its kind (a
   *  template, a wiki page, a source), from `page:` in the frontmatter. */
  page: string;
  intro: string;
  sections: HelpSection[];
}

/** One file parsed. A simple reading of the frontmatter: `key: value` and `key: [a, b]`. */
export function parseTopic(id: string, text: string): HelpTopic {
  const src = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  const meta: Record<string, string> = {};
  for (const l of (m?.[1] ?? "").split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(l);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  const list = (v = "") =>
    v
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const body = m ? src.slice(m[0].length) : src;
  let intro = "";
  const sections: HelpSection[] = [];
  for (const line of body.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) sections.push({ title: h[1].trim(), body: "" });
    else if (sections.length) sections[sections.length - 1].body += `${line}\n`;
    else intro += `${line}\n`;
  }
  for (const s of sections) s.body = s.body.trim();
  return {
    id,
    title: meta.title || id,
    kind: meta.kind === "guide" ? "guide" : "screen",
    screens: list(meta.screens),
    order: Number(meta.order) || 0,
    summary: meta.summary ?? "",
    page: meta.page ?? "",
    intro: intro.trim(),
    sections,
  };
}

const FILES = import.meta.glob<string>("./*.md", { query: "?raw", import: "default", eager: true });

/** Every topic: screens first, then guides, each in their order. */
export const TOPICS: HelpTopic[] = Object.entries(FILES)
  .map(([p, text]) => parseTopic(p.replace(/^\.\//, "").replace(/\.md$/, ""), text))
  .sort((a, b) => Number(a.kind === "guide") - Number(b.kind === "guide") || a.order - b.order || a.title.localeCompare(b.title));

export const GUIDES = TOPICS.filter((t) => t.kind === "guide");

/** The help topic for an open document's kind: a template's, a wiki page's or a source's is that
 *  list's topic (which covers the page too); a note's is "doc". */
function docTopic(path: string | undefined): string {
  const rel = (path ?? "").replace(/^\/+/, "");
  if (/^Templates\//i.test(rel)) return "templates";
  if (/^wiki\//i.test(rel)) return "wiki";
  if (/^sources\//i.test(rel)) return "sources";
  return "doc";
}

/** The section to open first: the page type's when a document is open and its topic names one
 *  (`page:`), else the first. */
export function openSection(topic: HelpTopic, p: Pick<Place, "screen">): string | undefined {
  const page = p.screen === "doc" && topic.page ? topic.sections.find((s) => s.title === topic.page) : undefined;
  return (page ?? topic.sections[0])?.title;
}

/** The topic for where the user is: Settings' pane first, then the screen (an open document by its
 *  kind); Today's when none. */
export function topicFor(p: Pick<Place, "screen" | "pane" | "path">): HelpTopic | undefined {
  const screen = p.screen === "doc" ? docTopic(p.path) : p.screen;
  const keys = [p.screen === "settings" && p.pane ? `settings/${p.pane}` : null, screen].filter(Boolean) as string[];
  for (const k of keys) {
    const t = TOPICS.find((x) => x.kind === "screen" && x.screens.includes(k));
    if (t) return t;
  }
  return TOPICS.find((x) => x.screens.includes("today"));
}

/** A link's href as the drawer keeps it: `app:` and `help:` as written, anything else through
 * react-markdown's own check (which would otherwise blank those two, leaving the links dead). */
export const helpUrl = (url: string) => (/^(app|help):/.test(url) ? url : defaultUrlTransform(url));

/** Where an `app:` link goes: `app:inbox`, `app:settings/vault`. Null when it isn't one. */
export function appLink(href: string): { screen: Screen; pane?: SettingsPane } | null {
  const m = /^app:([a-z]+)(?:\/([a-z]+))?$/.exec(href.trim());
  if (!m) return null;
  return m[1] === "settings" && m[2] ? { screen: "settings", pane: m[2] as SettingsPane } : { screen: m[1] as Screen };
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "how",
  "can",
  "you",
  "what",
  "does",
  "with",
  "this",
  "that",
  "from",
  "into",
  "are",
  "use",
  "where",
  "when",
  "why",
]);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/s$/, ""));

export interface HelpHit {
  topic: HelpTopic;
  section: HelpSection;
  score: number;
}

/** Sections matching every word typed (as prefixes), best first: a title match counts most. */
export function searchHelp(q: string, topics: HelpTopic[] = TOPICS): HelpHit[] {
  const want = words(q);
  if (!want.length) return [];
  const hits: HelpHit[] = [];
  for (const topic of topics) {
    const head = words(`${topic.title} ${topic.summary}`);
    for (const section of topic.sections) {
      const title = words(section.title);
      const body = words(section.body);
      const has = (ws: string[], w: string) => ws.some((x) => x.startsWith(w));
      if (!want.every((w) => has(title, w) || has(body, w) || has(head, w))) continue;
      const score = want.reduce(
        (n, w) => n + (has(title, w) ? 3 : 0) + (has(head, w) ? 2 : 0) + Math.min(3, body.filter((x) => x.startsWith(w)).length),
        0,
      );
      hits.push({ topic, section, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** A keyboard section's rows (`- \`⌘K\` — Search`), as [keys joined by two spaces, what they do]. */
export function keyRows(body: string): [string, string][] {
  const out: [string, string][] = [];
  for (const l of body.split("\n")) {
    const m = /^- ((?:`[^`]+`\s*)+)—\s*(.+)$/.exec(l.trim());
    if (m) out.push([[...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]).join("  "), m[2].trim()]);
  }
  return out;
}

/** The shortcut list (keyboard.md), by where the keys work. */
export const KEYS: [string, [string, string][]][] = (TOPICS.find((t) => t.id === "keyboard")?.sections ?? []).map((s) => [
  s.title,
  keyRows(s.body),
]);
