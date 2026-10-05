// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Evaluating Dataview expressions against a row, with Dataview's operators and its function
// library (https://blacksmithgu.github.io/obsidian-dataview/reference/functions/).

import { DateTime, Duration } from "luxon";
import { dateKeyword, Expr, linkParts } from "./parse";
import { compare, DvObject, equals, Fn, Link, parseDuration, toText, truthy, typeOf, Value } from "./values";

export interface Context {
  /** The row's own fields: a page, a task, or a group. */
  row: DvObject;
  /** The page the query is in. */
  self: DvObject | null;
  /** A page by path, for `[[link]].field`. */
  page: (path: string) => DvObject | null;
  /** Where a link target goes. */
  resolve: (target: string) => string | null;
  /** Variables bound by lambdas, innermost last. */
  scope?: Record<string, Value>[];
}

export class EvalError extends Error {}

const DATE_FIELDS: Record<string, (d: DateTime) => Value> = {
  year: (d) => d.year,
  month: (d) => d.month,
  day: (d) => d.day,
  hour: (d) => d.hour,
  minute: (d) => d.minute,
  second: (d) => d.second,
  millisecond: (d) => d.millisecond,
  week: (d) => d.weekNumber,
  weekyear: (d) => d.weekYear,
  weekday: (d) => d.weekday,
  quarter: (d) => d.quarter,
  ordinal: (d) => d.ordinal,
  zone: (d) => d.zoneName,
  offset: (d) => d.offset,
  daysInMonth: (d) => d.daysInMonth ?? null,
};

const DUR_FIELDS = ["years", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds"] as const;

/** `obj.key` / `obj[key]`, as Dataview reads it: a link reads the page it goes to, a list reads
 *  the key from each element. */
export function getField(v: Value, key: Value, ctx: Context): Value {
  if (v === null || v === undefined) return null;
  const t = typeOf(v);
  if (typeof key === "number") {
    if (t === "array") return (v as Value[])[key < 0 ? (v as Value[]).length + key : key] ?? null;
    if (t === "string") return (v as string)[key] ?? null;
    if (t === "object") return (v as DvObject)[String(key)] ?? null;
    return null;
  }
  const k = String(key);
  switch (t) {
    case "object": {
      const o = v as DvObject;
      if (k in o) return o[k] ?? null;
      // Fields are offered under their own name and Dataview's lower-case one.
      const low = k.toLowerCase();
      return low in o ? (o[low] ?? null) : null;
    }
    case "link": {
      const p = ctx.page((v as Link).path);
      return p ? getField(p, k, ctx) : null;
    }
    case "array":
      return (v as Value[]).map((x) => getField(x, k, ctx));
    case "date": {
      const f = DATE_FIELDS[k];
      return f ? f(v as DateTime) : null;
    }
    case "duration": {
      const d = v as Duration;
      if ((DUR_FIELDS as readonly string[]).includes(k)) return d.shiftTo(...DUR_FIELDS).get(k as (typeof DUR_FIELDS)[number]);
      return null;
    }
    case "string":
      return k === "length" ? (v as string).length : null;
    default:
      return null;
  }
}

function lookup(name: string, ctx: Context): Value {
  for (let i = (ctx.scope?.length ?? 0) - 1; i >= 0; i--) if (name in ctx.scope![i]) return ctx.scope![i][name];
  if (name === "row") return ctx.row;
  if (name === "this") return ctx.self;
  return getField(ctx.row, name, ctx);
}

function arith(op: string, a: Value, b: Value): Value {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (op === "+" && (ta === "string" || tb === "string"))
    return (ta === "null" ? "" : toText(a, true)) + (tb === "null" ? "" : toText(b, true));
  if (ta === "null" || tb === "null") return null;
  const n = (x: Value) => x as number;
  if (ta === "number" && tb === "number") {
    switch (op) {
      case "+":
        return n(a) + n(b);
      case "-":
        return n(a) - n(b);
      case "*":
        return n(a) * n(b);
      case "/":
        return n(b) === 0 ? null : n(a) / n(b);
      case "%":
        return n(b) === 0 ? null : n(a) % n(b);
    }
  }
  if (ta === "date" && tb === "duration") {
    if (op === "+") return (a as DateTime).plus(b as Duration);
    if (op === "-") return (a as DateTime).minus(b as Duration);
  }
  if (ta === "duration" && tb === "date" && op === "+") return (b as DateTime).plus(a as Duration);
  if (ta === "date" && tb === "date" && op === "-")
    return (a as DateTime).diff(b as DateTime, ["years", "months", "days", "hours", "minutes", "seconds", "milliseconds"]).normalize();
  if (ta === "duration" && tb === "duration") {
    if (op === "+") return (a as Duration).plus(b as Duration);
    if (op === "-") return (a as Duration).minus(b as Duration);
  }
  if (ta === "duration" && tb === "number") {
    if (op === "*") return Duration.fromMillis((a as Duration).toMillis() * n(b));
    if (op === "/") return n(b) === 0 ? null : Duration.fromMillis((a as Duration).toMillis() / n(b));
  }
  if (ta === "number" && tb === "duration" && op === "*") return Duration.fromMillis((b as Duration).toMillis() * n(a));
  if (ta === "string" && tb === "number" && op === "*") return (a as string).repeat(Math.max(0, n(b)));
  if (ta === "array" && tb === "array" && op === "+") return [...(a as Value[]), ...(b as Value[])];
  if (ta === "object" && tb === "object" && op === "+") return { ...(a as DvObject), ...(b as DvObject) };
  throw new EvalError(`No implementation found for '${ta} ${op} ${tb}'`);
}

export function evaluate(e: Expr, ctx: Context): Value {
  switch (e.t) {
    case "lit":
      return e.v;
    case "link": {
      const p = linkParts(e.text);
      return new Link(
        p.target ? (ctx.resolve(p.target) ?? p.target) : ((ctx.self?.file as DvObject | undefined)?.path as string) || "",
        p.display,
        p.sub,
        p.embed,
      );
    }
    case "var":
      return lookup(e.name, ctx);
    case "field":
      return getField(evaluate(e.obj, ctx), e.key, ctx);
    case "index":
      return getField(evaluate(e.obj, ctx), evaluate(e.idx, ctx), ctx);
    case "not":
      return !truthy(evaluate(e.e, ctx));
    case "neg": {
      const v = evaluate(e.e, ctx);
      if (typeof v === "number") return -v;
      if (Duration.isDuration(v)) return v.negate();
      return null;
    }
    case "list":
      return e.items.map((x) => evaluate(x, ctx));
    case "obj":
      return Object.fromEntries(e.entries.map(([k, x]) => [k, evaluate(x, ctx)]));
    case "lambda": {
      const f: Fn = (...args: Value[]) => {
        const bound: Record<string, Value> = {};
        e.params.forEach((p, i) => (bound[p] = args[i] ?? null));
        return evaluate(e.body, { ...ctx, scope: [...(ctx.scope ?? []), bound] });
      };
      return f;
    }
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.l, ctx)) && truthy(evaluate(e.r, ctx));
      if (e.op === "or") return truthy(evaluate(e.l, ctx)) || truthy(evaluate(e.r, ctx));
      const a = evaluate(e.l, ctx);
      const b = evaluate(e.r, ctx);
      switch (e.op) {
        case "=":
          return equals(a, b);
        case "!=":
          return !equals(a, b);
        case "<":
          return compare(a, b) < 0;
        case "<=":
          return compare(a, b) <= 0;
        case ">":
          return compare(a, b) > 0;
        case ">=":
          return compare(a, b) >= 0;
        default:
          return arith(e.op, a, b);
      }
    }
    case "call": {
      if (e.fn.t === "var") {
        const bound = ctx.scope?.some((s) => e.fn.t === "var" && e.fn.name in s);
        const f = !bound ? FUNCTIONS[e.fn.name.toLowerCase()] : undefined;
        if (f) return f(ctx, ...e.args.map((a) => evaluate(a, ctx)));
      }
      const fv = evaluate(e.fn, ctx);
      if (typeof fv === "function") return (fv as Fn)(...e.args.map((a) => evaluate(a, ctx)));
      throw new EvalError(`No function named '${e.fn.t === "var" ? e.fn.name : "?"}'`);
    }
  }
}

// ── The function library ────────────────────────────────────────────────────────────────────

type Builtin = (ctx: Context, ...args: Value[]) => Value;

const arr = (v: Value): Value[] => (Array.isArray(v) ? v : v === null ? [] : [v]);
const str = (v: Value) => (v === null ? "" : typeof v === "string" ? v : toText(v, true));
const num = (v: Value): number | null => (typeof v === "number" ? v : null);
const call = (f: Value, ...args: Value[]) => {
  if (typeof f !== "function") throw new EvalError("Expected a function, e.g. (x) => x");
  return (f as Fn)(...args);
};

/** Applies `f` to each element when the first argument is a list (Dataview "vectorises"). */
const vec =
  (f: (ctx: Context, v: Value, ...rest: Value[]) => Value): Builtin =>
  (ctx, v, ...rest) =>
    Array.isArray(v) ? v.map((x) => f(ctx, x, ...rest)) : f(ctx, v, ...rest);

/** `contains`, as Dataview defines it: substrings in text, keys in objects, deep in lists. */
function contains(h: Value, n: Value, fold: boolean, deep: boolean): boolean {
  const t = typeOf(h);
  if (t === "string") {
    if (typeof n !== "string") return false;
    return fold ? (h as string).toLowerCase().includes(n.toLowerCase()) : (h as string).includes(n);
  }
  if (t === "array") {
    return (h as Value[]).some((x) =>
      deep
        ? contains(x, n, fold, true)
        : fold && typeof x === "string" && typeof n === "string"
          ? x.toLowerCase() === n.toLowerCase()
          : equals(x, n),
    );
  }
  if (t === "object") {
    if (typeof n !== "string") return false;
    return fold ? Object.keys(h as DvObject).some((k) => k.toLowerCase() === n.toLowerCase()) : n in (h as DvObject);
  }
  if (t === "link" && typeOf(n) === "link") return (h as Link).equals(n as Link);
  return fold && typeof h === "string" ? false : equals(h, n);
}

function fold(list: Value, op: (a: number, b: number) => number, empty: number | null): Value {
  const xs = arr(list);
  if (!xs.length) return empty;
  if (xs.some((x) => x !== null && typeof x !== "number" && !Duration.isDuration(x))) {
    // Durations add as durations.
    if (xs.every((x) => Duration.isDuration(x))) return (xs as Duration[]).reduce((a, b) => a.plus(b));
    throw new EvalError("Expected numbers");
  }
  if (xs.some((x) => x === null)) return null;
  return (xs as number[]).reduce(op);
}

function minmax(args: Value[], sign: number): Value {
  const xs = args.length === 1 && Array.isArray(args[0]) ? (args[0] as Value[]) : args;
  if (!xs.length) return null;
  return xs.reduce((a, b) => (compare(b, a) * sign > 0 ? b : a));
}

function toDate(v: Value, ctx: Context, format?: Value): Value {
  if (v === null) return null;
  if (DateTime.isDateTime(v)) return v;
  if (v instanceof Link) {
    const p = ctx.page(v.path);
    const day = p ? getField(getField(p, "file", ctx), "day", ctx) : null;
    if (day) return day;
    return dateKeyword(v.fileName()) ?? parseDayInName(v.fileName());
  }
  if (typeof v === "string") {
    if (typeof format === "string") {
      const d = DateTime.fromFormat(v, format);
      return d.isValid ? d : null;
    }
    return dateKeyword(v) ?? null;
  }
  return null;
}

/** A date in a file name: 2026-10-02 or 20261002. */
export function parseDayInName(name: string): DateTime | null {
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(name);
  if (!m) return null;
  const d = DateTime.fromObject({ year: +m[1], month: +m[2], day: +m[3] });
  return d.isValid ? d : null;
}

function regex(p: Value): RegExp {
  try {
    return new RegExp(str(p), "u");
  } catch {
    throw new EvalError(`Invalid regex: ${str(p)}`);
  }
}

/** A small stable hash, for `hash(seed, text, variant)`. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const FUNCTIONS: Record<string, Builtin> = {
  // Constructors
  object: (_c, ...kv) => {
    const o: DvObject = {};
    for (let i = 0; i + 1 < kv.length; i += 2) o[str(kv[i])] = kv[i + 1];
    return o;
  },
  list: (_c, ...xs) => xs,
  array: (_c, ...xs) => xs,
  date: (ctx, v, f) => (Array.isArray(v) ? v.map((x) => toDate(x, ctx, f)) : toDate(v, ctx, f)),
  dur: vec((_c, v) => (v === null ? null : Duration.isDuration(v) ? v : typeof v === "string" ? parseDuration(v) : null)),
  number: vec((_c, v) => {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return null;
    const m = /-?\d+(\.\d+)?/.exec(v);
    return m ? +m[0] : null;
  }),
  string: vec((_c, v) => toText(v, true)),
  link: vec((ctx, p, d) => {
    if (p === null) return null;
    if (p instanceof Link) return typeof d === "string" ? p.withDisplay(d) : p;
    const parts = linkParts(`[[${str(p)}]]`);
    return new Link(ctx.resolve(parts.target) ?? parts.target, typeof d === "string" ? d : parts.display, parts.sub);
  }),
  embed: vec((_c, l, e) => (l instanceof Link ? l.toEmbed(e === null || e === undefined ? true : truthy(e)) : null)),
  elink: (_c, url, d) => (url === null ? null : `[${d === null || d === undefined ? str(url) : str(d)}](${str(url)})`),
  typeof: (_c, v) => typeOf(v),

  // Numbers
  round: vec((_c, v, digits) => {
    const n = num(v);
    if (n === null) return null;
    const p = Math.pow(10, num(digits ?? 0) ?? 0);
    return Math.round(n * p) / p;
  }),
  trunc: vec((_c, v) => (num(v) === null ? null : Math.trunc(v as number))),
  floor: vec((_c, v) => (num(v) === null ? null : Math.floor(v as number))),
  ceil: vec((_c, v) => (num(v) === null ? null : Math.ceil(v as number))),
  min: (_c, ...a) => minmax(a, -1),
  max: (_c, ...a) => minmax(a, 1),
  sum: (_c, l) => fold(l, (a, b) => a + b, null),
  product: (_c, l) => fold(l, (a, b) => a * b, null),
  average: (_c, l) => {
    const xs = arr(l);
    const s = fold(xs, (a, b) => a + b, null);
    return typeof s === "number" ? s / xs.length : s;
  },
  reduce: (_c, l, op) => {
    const xs = arr(l);
    if (!xs.length) return null;
    const ops: Record<string, (a: Value, b: Value) => Value> = {
      "+": (a, b) => arith("+", a, b),
      "-": (a, b) => arith("-", a, b),
      "*": (a, b) => arith("*", a, b),
      "/": (a, b) => arith("/", a, b),
      "&": (a, b) => truthy(a) && truthy(b),
      "|": (a, b) => truthy(a) || truthy(b),
    };
    const f = typeof op === "function" ? (a: Value, b: Value) => call(op, a, b) : ops[str(op)];
    if (!f) throw new EvalError(`reduce: unknown operand "${str(op)}"`);
    return xs.reduce(f);
  },
  minby: (_c, l, f) => {
    const xs = arr(l);
    return xs.length ? xs.reduce((a, b) => (compare(call(f, b), call(f, a)) < 0 ? b : a)) : null;
  },
  maxby: (_c, l, f) => {
    const xs = arr(l);
    return xs.length ? xs.reduce((a, b) => (compare(call(f, b), call(f, a)) > 0 ? b : a)) : null;
  },

  // Objects, lists and text
  contains: (_c, h, n) => contains(h, n, false, true),
  icontains: (_c, h, n) => contains(h, n, true, true),
  econtains: (_c, h, n) => {
    if (typeof h === "string") return typeof n === "string" && h.includes(n);
    if (Array.isArray(h)) return h.some((x) => equals(x, n));
    if (typeOf(h) === "object") return typeof n === "string" && n in (h as DvObject);
    return equals(h, n);
  },
  containsword: vec((_c, h, w) => {
    if (typeof h !== "string" || typeof w !== "string") return false;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(h);
  }),
  extract: (_c, o, ...keys) => {
    if (typeOf(o) !== "object") return null;
    const out: DvObject = {};
    for (const k of keys) out[str(k)] = (o as DvObject)[str(k)] ?? null;
    return out;
  },
  sort: (_c, l, f) => {
    const xs = [...arr(l)];
    return f ? xs.sort((a, b) => compare(call(f, a), call(f, b))) : xs.sort(compare);
  },
  reverse: (_c, l) => (typeof l === "string" ? [...l].reverse().join("") : [...arr(l)].reverse()),
  length: (_c, v) => {
    if (v === null) return 0;
    if (Array.isArray(v) || typeof v === "string") return v.length;
    if (typeOf(v) === "object") return Object.keys(v as DvObject).length;
    return 0;
  },
  nonnull: (_c, ...a) => (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).filter((x) => x !== null && x !== undefined),
  firstvalue: (_c, l) => arr(l).find((x) => x !== null && x !== undefined) ?? null,
  all: (_c, ...a) => {
    if (a.length === 2 && typeof a[1] === "function") return arr(a[0]).every((x) => truthy(call(a[1], x)));
    return (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).every(truthy);
  },
  any: (_c, ...a) => {
    if (a.length === 2 && typeof a[1] === "function") return arr(a[0]).some((x) => truthy(call(a[1], x)));
    return (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).some(truthy);
  },
  none: (_c, ...a) => {
    if (a.length === 2 && typeof a[1] === "function") return !arr(a[0]).some((x) => truthy(call(a[1], x)));
    return !(a.length === 1 && Array.isArray(a[0]) ? a[0] : a).some(truthy);
  },
  join: (_c, l, sep) =>
    Array.isArray(l) ? l.map((x) => toText(x, true)).join(sep === undefined || sep === null ? ", " : str(sep)) : str(l),
  filter: (_c, l, f) => arr(l).filter((x) => truthy(call(f, x))),
  map: (_c, l, f) => arr(l).map((x) => call(f, x)),
  flat: (_c, l, depth) => (arr(l) as unknown[]).flat((num(depth ?? 1) ?? 1) as 1) as Value[],
  slice: (_c, l, s, e) =>
    (typeof l === "string" ? l : arr(l)).slice(num(s ?? 0) ?? 0, e === undefined || e === null ? undefined : (num(e) ?? undefined)),
  unique: (_c, l) => {
    const out: Value[] = [];
    for (const x of arr(l)) if (!out.some((y) => equals(x, y))) out.push(x);
    return out;
  },

  // Text
  regextest: (_c, p, s) => (Array.isArray(s) ? s.map((x) => regex(p).test(str(x))) : regex(p).test(str(s))),
  regexmatch: (_c, p, s) => {
    const re = new RegExp(`^(?:${str(p)})$`, "u");
    return Array.isArray(s) ? s.map((x) => re.test(str(x))) : re.test(str(s));
  },
  regexreplace: vec((_c, s, p, r) => (s === null ? null : str(s).replace(new RegExp(str(p), "gu"), str(r)))),
  replace: vec((_c, s, p, r) => (s === null ? null : str(s).split(str(p)).join(str(r)))),
  lower: vec((_c, s) => (s === null ? null : str(s).toLowerCase())),
  upper: vec((_c, s) => (s === null ? null : str(s).toUpperCase())),
  split: vec((_c, s, d, limit) => {
    if (s === null) return null;
    const parts = str(s).split(new RegExp(str(d), "u"));
    return limit === undefined || limit === null ? parts : parts.slice(0, num(limit) ?? undefined);
  }),
  startswith: vec((_c, s, p) => typeof s === "string" && s.startsWith(str(p))),
  endswith: vec((_c, s, p) => typeof s === "string" && s.endsWith(str(p))),
  padleft: vec((_c, s, n, pad) => str(s).padStart(num(n) ?? 0, pad === undefined || pad === null ? " " : str(pad))),
  padright: vec((_c, s, n, pad) => str(s).padEnd(num(n) ?? 0, pad === undefined || pad === null ? " " : str(pad))),
  substring: vec((_c, s, a, b) =>
    s === null ? null : str(s).substring(num(a) ?? 0, b === undefined || b === null ? undefined : (num(b) ?? undefined)),
  ),
  truncate: vec((_c, s, n, suffix) => {
    if (s === null) return null;
    const t = str(s);
    const len = num(n) ?? t.length;
    const suf = suffix === undefined || suffix === null ? "..." : str(suffix);
    return t.length <= len ? t : t.slice(0, Math.max(0, len - suf.length)) + suf;
  }),

  // Utility
  default: (_c, v, d) => (Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? d : x)) : v === null || v === undefined ? d : v),
  ldefault: (_c, v, d) => (v === null || v === undefined ? d : v),
  display: vec((_c, v) => {
    if (v instanceof Link) return v.label();
    if (typeof v === "string")
      return v
        .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/!?\[\[([^\]]+)\]\]/g, (_m, t: string) => t.split("/").pop()!)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_~`]/g, "");
    return toText(v, true);
  }),
  choice: (_c, b, l, r) => (truthy(b) ? l : r),
  hash: (_c, seed, text, variant) => fnv(`${str(seed)}${str(text ?? "")}${str(variant ?? "")}`),
  striptime: vec((_c, d) => (DateTime.isDateTime(d) ? d.startOf("day") : null)),
  dateformat: vec((_c, d, f) => (DateTime.isDateTime(d) ? d.toFormat(str(f)) : null)),
  durationformat: vec((_c, d, f) =>
    Duration.isDuration(d)
      ? d
          .shiftTo(...DUR_FIELDS)
          .normalize()
          .toFormat(str(f).replace(/"([^"]*)"/g, "'$1'"))
      : null,
  ),
  currencyformat: vec((_c, n, cur) =>
    typeof n === "number"
      ? new Intl.NumberFormat(undefined, { style: "currency", currency: cur === undefined || cur === null ? "USD" : str(cur) }).format(n)
      : null,
  ),
  localtime: vec((_c, d) => (DateTime.isDateTime(d) ? d.toLocal() : null)),
  meta: (_c, l) =>
    l instanceof Link
      ? { display: l.display ?? null, embed: l.embed, path: l.path, subpath: l.subpath ?? null, type: l.type }
      : { display: null, embed: false, path: null, subpath: null, type: null },
};
