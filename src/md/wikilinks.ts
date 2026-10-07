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

/** An image's label split into its alt text and size, the way Obsidian writes them:
 *  `![[pic.png|400]]`, `![[pic.png|400x300]]`, `![[pic.png|A chart|400]]`, `![A chart|400](pic.png)`. */
export function imageSize(label: string | undefined): { alt: string; width?: number; height?: number } {
  const m = /^(?:(.*?)\s*(?:\\)?\|)?\s*(\d+)(?:x(\d+))?\s*$/.exec(label ?? "");
  if (!m) return { alt: label ?? "" };
  return { alt: m[1] ?? "", width: Number(m[2]), height: m[3] ? Number(m[3]) : undefined };
}

/** A raw `<img>` tag on its own (as the previous app wrote pasted images): its src, and its alt
 *  text and size as a label imageSize reads; null when the text is anything else. */
export function imgTag(text: string): { src: string; label: string } | null {
  if (!/^<img\b[^<>]*>$/i.test(text)) return null;
  const attr = (n: string) =>
    new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
      .exec(text)
      ?.slice(1)
      .find((v) => v !== undefined);
  const src = attr("src");
  if (!src) return null;
  const alt = attr("alt") ?? "";
  const w = attr("width")?.match(/^\d+/)?.[0];
  const h = attr("height")?.match(/^\d+/)?.[0];
  const size = w ? `${w}${h ? `x${h}` : ""}` : "";
  return { src, label: size ? `${alt ? `${alt}|` : ""}${size}` : alt };
}

/** An image's markdown (`![[...]]`, `![...](...)` or an `<img>` tag) with its width set, its alt text kept and any
 *  height dropped, so it keeps its proportions; null when the text isn't an image. */
export function setImageWidth(text: string, width: number): string | null {
  const w = Math.max(1, Math.round(width));
  const wiki = /^!\[\[([^[\]\n]+?)\]\]$/.exec(text);
  if (wiki) {
    // In a table the bar is escaped, `\|`.
    const sep = wiki[1].includes("\\|") ? "\\|" : "|";
    const at = wiki[1].indexOf(sep);
    const dest = at < 0 ? wiki[1] : wiki[1].slice(0, at);
    const { alt } = imageSize(at < 0 ? undefined : wiki[1].slice(at + sep.length));
    return `![[${dest}${sep}${alt ? `${alt}${sep}` : ""}${w}]]`;
  }
  if (imgTag(text)) {
    const bare = text.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return bare.replace(/^<img\b/i, `<img width="${w}"`);
  }
  const md = /^!\[([^\]]*)\](\(.*)$/s.exec(text);
  if (md) {
    const { alt } = imageSize(md[1]);
    return `![${alt ? `${alt}|` : ""}${w}]${md[2]}`;
  }
  return null;
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
            const size = imageSize(t.alias);
            const props: Record<string, string | number> = { ...data.hProperties };
            if (size.width) props.width = size.width;
            if (size.height) props.height = size.height;
            const img: Image = { type: "image", url: `wiki:${t.target}`, alt: size.alt || t.target, data: { hProperties: props } };
            return img;
          }
          const link: Link = { type: "link", url: `wiki:${t.target}`, children: [{ type: "text", value: wikiLabel(t) }], data };
          return link;
        },
      ],
    ]);
  };
}
