// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// A remark plugin for wikilinks: `[[Note]]`, `[[Note|shown]]`, `[[Note#Heading]]`,
// `[[Note#^block]]`, `[[#Heading]]` and embeds `![[...]]`. The same shapes as
// src-tauri/core/src/links.rs reads, so the index and the page agree on what is a link. Code is
// left alone (remark never hands it over as text).

import type { Link, Image, PhrasingContent, Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";

export interface WikiTarget {
  /** The note part as written ("" for this note). */
  target: string;
  heading?: string;
  block?: string;
  alias?: string;
  embed: boolean;
}

const WIKILINK = /(!?)\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g;

export function parseWikilink(embed: boolean, inner: string): WikiTarget | null {
  const raw = inner.replace(/\\\|/g, "|");
  const bar = raw.indexOf("|");
  const dest = (bar < 0 ? raw : raw.slice(0, bar)).trim();
  const alias = bar < 0 ? undefined : raw.slice(bar + 1).trim() || undefined;
  const hash = dest.indexOf("#");
  const target = (hash < 0 ? dest : dest.slice(0, hash)).trim();
  const frag = hash < 0 ? "" : dest.slice(hash + 1).trim();
  const out: WikiTarget = { target: target.normalize("NFC"), alias, embed };
  if (frag.startsWith("^")) out.block = frag.slice(1);
  else if (frag) out.heading = frag;
  if (!out.target && !out.heading && !out.block) return null;
  return out;
}

/** What a link shows: its alias, else the target and heading as they're written. */
export function wikiLabel(t: WikiTarget): string {
  if (t.alias) return t.alias;
  const base = t.target.split("/").pop() ?? t.target;
  if (t.heading) return base ? `${base} › ${t.heading}` : t.heading;
  if (t.block) return base || `^${t.block}`;
  return base;
}

/** File extensions shown as images when embedded. */
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i;

export function remarkWikilinks() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        WIKILINK,
        (_m: string, bang: string, inner: string): PhrasingContent | false => {
          const t = parseWikilink(!!bang, inner);
          if (!t) return false;
          const data = { hProperties: { "data-wiki": JSON.stringify(t) } };
          if (t.embed && IMAGE_EXT.test(t.target)) {
            const img: Image = { type: "image", url: `wiki:${t.target}`, alt: t.alias ?? t.target, data };
            return img;
          }
          const link: Link = { type: "link", url: `wiki:${t.target}`, children: [{ type: "text", value: wikiLabel(t) }], data };
          return link;
        },
      ],
    ]);
  };
}
