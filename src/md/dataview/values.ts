// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Dataview's values (https://blacksmithgu.github.io/obsidian-dataview/annotation/types-of-metadata/):
// null, numbers, text, booleans, dates and durations (luxon, as Dataview), links, lists, objects
// and functions; how they compare, what counts as true, and how text is read into them.

import { DateTime, Duration } from "luxon";

export class Link {
  constructor(
    /** Vault-relative path, or the target as written for a ghost link. */
    public path: string,
    public display?: string,
    /** A heading or `^block`. */
    public subpath?: string,
    public embed = false,
  ) {}
  get type(): "file" | "header" | "block" {
    return !this.subpath ? "file" : this.subpath.startsWith("^") ? "block" : "header";
  }
  /** The file's name without folders or `.md`. */
  fileName(): string {
    return (this.path.split("/").pop() ?? this.path).replace(/\.md$/i, "");
  }
  withDisplay(d?: string) {
    return new Link(this.path, d, this.subpath, this.embed);
  }
  withSubpath(s?: string) {
    return new Link(this.path, this.display, s, this.embed);
  }
  toEmbed(e = true) {
    return new Link(this.path, this.display, this.subpath, e);
  }
  withHeader(h: string) {
    return this.withSubpath(h);
  }
  /** As markdown: `[[path#sub|display]]`. */
  markdown(): string {
    const target = this.path.replace(/\.md$/i, "") + (this.subpath ? `#${this.subpath}` : "");
    return `${this.embed ? "!" : ""}[[${target}${this.display ? `|${this.display}` : ""}]]`;
  }
  toString() {
    return this.markdown();
  }
  equals(o: Link) {
    return o.path === this.path && (o.subpath ?? "") === (this.subpath ?? "");
  }
  /** What a link shows: its display, else the file's name (and the heading). */
  label(): string {
    if (this.display) return this.display;
    const name = this.fileName();
    return this.subpath ? `${name} > ${this.subpath.replace(/^\^/, "")}` : name;
  }
}

/** A lambda from an expression: `(x) => x + 1`. */
export type Fn = ((...args: Value[]) => Value) & { dvFn?: true };

export type Value = null | number | string | boolean | DateTime | Duration | Link | Value[] | Fn | DvObject;
export interface DvObject {
  [k: string]: Value;
}

export type TypeName = "null" | "number" | "string" | "boolean" | "date" | "duration" | "link" | "array" | "object" | "function" | "widget";

export function typeOf(v: unknown): TypeName {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "function") return "function";
  if (DateTime.isDateTime(v)) return "date";
  if (Duration.isDuration(v)) return "duration";
  if (v instanceof Link) return "link";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object" && "dvArray" in (v as object)) return "array";
  return "object";
}

export function truthy(v: Value): boolean {
  switch (typeOf(v)) {
    case "null":
      return false;
    case "number":
      return v !== 0;
    case "string":
      return (v as string).length > 0;
    case "boolean":
      return v as boolean;
    case "date":
      return true;
    case "duration":
      return (v as Duration).toMillis() !== 0;
    case "link":
      return !!(v as Link).path;
    case "array":
      return (v as Value[]).length > 0;
    case "object":
      return Object.keys(v as object).length > 0;
    case "function":
      return true;
    default:
      return !!v;
  }
}

const ORDER: TypeName[] = ["null", "boolean", "number", "string", "date", "duration", "link", "array", "object", "function", "widget"];

/** Dataview's ordering: by type first (null lowest), then within the type. */
export function compare(a: Value, b: Value): number {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    // A date and a link to a dated note don't mix; text and numbers stay apart, as in Dataview.
    return ORDER.indexOf(ta) - ORDER.indexOf(tb);
  }
  switch (ta) {
    case "null":
      return 0;
    case "boolean":
    case "number":
      return (a as number) === (b as number) ? 0 : (a as number) < (b as number) ? -1 : 1;
    case "string":
      return (a as string).localeCompare(b as string);
    case "date":
      return Math.sign((a as DateTime).toMillis() - (b as DateTime).toMillis());
    case "duration":
      return Math.sign((a as Duration).toMillis() - (b as Duration).toMillis());
    case "link": {
      const x = a as Link;
      const y = b as Link;
      return x.path.localeCompare(y.path) || (x.subpath ?? "").localeCompare(y.subpath ?? "");
    }
    case "array": {
      const x = a as Value[];
      const y = b as Value[];
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = compare(x[i], y[i]);
        if (c) return c;
      }
      return x.length - y.length;
    }
    case "object": {
      const x = a as DvObject;
      const y = b as DvObject;
      const kx = Object.keys(x).sort();
      const ky = Object.keys(y).sort();
      const c = compare(kx, ky);
      if (c) return c;
      for (const k of kx) {
        const d = compare(x[k], y[k]);
        if (d) return d;
      }
      return 0;
    }
    default:
      return 0;
  }
}

export const equals = (a: Value, b: Value) => compare(a, b) === 0;

/** Text as Dataview shows it in a cell or a list. */
export function toText(v: Value, nested = false): string {
  switch (typeOf(v)) {
    case "null":
      return nested ? "null" : "-";
    case "string":
      return v as string;
    case "number":
    case "boolean":
      return String(v);
    case "date": {
      const d = v as DateTime;
      const midnight = d.hour === 0 && d.minute === 0 && d.second === 0 && d.millisecond === 0;
      return midnight ? d.toFormat("MMMM dd, yyyy") : d.toFormat("h:mm a - MMMM dd, yyyy");
    }
    case "duration":
      return durationText(v as Duration);
    case "link":
      return (v as Link).markdown();
    case "array":
      return (v as Value[]).map((x) => toText(x, true)).join(", ");
    case "function":
      return "<function>";
    default:
      return `{ ${Object.entries(v as DvObject)
        .map(([k, x]) => `${k}: ${toText(x, true)}`)
        .join(", ")} }`;
  }
}

/** "2 days, 3 hours", as Dataview writes durations. */
export function durationText(d: Duration): string {
  const units = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds"] as const;
  const o = d
    .shiftTo(...units)
    .normalize()
    .toObject();
  const parts = units
    .filter((u) => (o[u] ?? 0) !== 0)
    .map((u) => {
      const n = o[u]!;
      const name = n === 1 ? u.slice(0, -1) : u;
      return `${+n.toFixed(3)} ${name}`;
    });
  return parts.length ? parts.join(", ") : "0 seconds";
}

// ── Reading text into values ────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}(?:-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)?$/;

/** An ISO date (`2026-10-02`, `2026-10`, `2026-10-02T09:30`), else null. */
export function parseIsoDate(s: string): DateTime | null {
  const t = s.trim();
  if (!ISO_DATE.test(t)) return null;
  const d = DateTime.fromISO(t.replace(" ", "T"), { setZone: /Z|[+-]\d{2}:?\d{2}$/.test(t) });
  return d.isValid ? d : null;
}

const DUR_UNITS: Record<string, keyof DurationObj> = {
  s: "seconds",
  sec: "seconds",
  secs: "seconds",
  second: "seconds",
  seconds: "seconds",
  m: "minutes",
  min: "minutes",
  mins: "minutes",
  minute: "minutes",
  minutes: "minutes",
  h: "hours",
  hr: "hours",
  hrs: "hours",
  hour: "hours",
  hours: "hours",
  d: "days",
  day: "days",
  days: "days",
  w: "weeks",
  wk: "weeks",
  wks: "weeks",
  week: "weeks",
  weeks: "weeks",
  mo: "months",
  month: "months",
  months: "months",
  yr: "years",
  yrs: "years",
  year: "years",
  years: "years",
};
interface DurationObj {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** "3 days", "1 week, 2 days", "1h 30m", else null. */
export function parseDuration(s: string): Duration | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const re = /(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:,|and)?\s*/gy;
  const o: Partial<DurationObj> = {};
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(t))) {
    const u = DUR_UNITS[m[2]];
    if (!u) return null;
    o[u] = (o[u] ?? 0) + +m[1];
    at = re.lastIndex;
  }
  if (at !== t.length || !Object.keys(o).length) return null;
  return Duration.fromObject(o);
}

const LINK = /^(!?)\[\[([^[\]]+?)\]\]$/;

/** `[[target#sub|display]]`, resolved with `resolve` (target → path). */
export function parseLinkText(s: string, resolve: (target: string) => string | null): Link | null {
  const m = LINK.exec(s.trim());
  if (!m) return null;
  const [dest, display] = m[2].split("|");
  const hash = dest.indexOf("#");
  const target = (hash < 0 ? dest : dest.slice(0, hash)).trim();
  const sub = hash < 0 ? undefined : dest.slice(hash + 1).trim() || undefined;
  return new Link(resolve(target) ?? target, display?.trim() || undefined, sub, m[1] === "!");
}

/** Splits on commas outside brackets and quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q = false;
  let cur = "";
  for (const c of s) {
    if (c === '"') q = !q;
    if (!q && (c === "[" || c === "(")) depth++;
    if (!q && (c === "]" || c === ")")) depth--;
    if (!q && depth === 0 && c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** One literal from field text: a quoted string, a boolean, number, date, duration or link. */
function literal(s: string, resolve: (t: string) => string | null, numbers: boolean): { v: Value; typed: boolean } {
  const t = s.trim();
  if (/^".*"$/.test(t) && t.length >= 2) return { v: t.slice(1, -1).replace(/\\"/g, '"'), typed: true };
  if (/^(true|false)$/i.test(t)) return { v: t.toLowerCase() === "true", typed: true };
  if (numbers && /^-?\d+(\.\d+)?$/.test(t)) return { v: +t, typed: true };
  const d = parseIsoDate(t);
  if (d) return { v: d, typed: true };
  const l = parseLinkText(t, resolve);
  if (l) return { v: l, typed: true };
  if (/^-?\d/.test(t)) {
    const du = parseDuration(t);
    if (du) return { v: du, typed: true };
  }
  return { v: t, typed: false };
}

/** An inline field's value, typed as Dataview types it; a comma list of typed values is a list. */
export function parseFieldValue(raw: string, resolve: (t: string) => string | null): Value {
  const t = raw.trim();
  if (!t) return null;
  const parts = splitTop(t);
  if (parts.length > 1) {
    const vals = parts.map((p) => literal(p, resolve, true));
    if (vals.every((x) => x.typed)) return vals.map((x) => x.v);
  }
  return literal(t, resolve, true).v;
}

/** A frontmatter value from YAML: text that reads as a date, link or duration becomes one. */
export function fromYaml(v: unknown, resolve: (t: string) => string | null): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const l = literal(v, resolve, false);
    return l.typed && typeof l.v !== "boolean" ? l.v : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => fromYaml(x, resolve));
  if (typeof v === "object") {
    const o: DvObject = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = fromYaml(x, resolve);
    return o;
  }
  return String(v);
}

/** A key as Dataview also offers it: lower case, spaces as dashes, formatting dropped. */
export function canonicalKey(k: string): string {
  return k
    .replace(/\*\*|__|~~|==/g, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}_/-]/gu, "");
}
