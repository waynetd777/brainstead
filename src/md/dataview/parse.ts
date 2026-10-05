// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Dataview's query language (DQL) and expressions, parsed by hand: the query types (TABLE, LIST,
// TASK, CALENDAR), FROM sources, the data commands (WHERE, SORT, GROUP BY, FLATTEN, LIMIT) and the
// expression grammar with Dataview's precedence, literals (`date(today)`, `dur(3 days)`, links,
// lists, objects) and lambdas. https://blacksmithgu.github.io/obsidian-dataview/queries/structure/

import { DateTime, Duration } from "luxon";
import { Link, parseDuration, parseIsoDate, Value } from "./values";

export type Expr =
  | { t: "lit"; v: Value }
  | { t: "var"; name: string }
  | { t: "field"; obj: Expr; key: string }
  | { t: "index"; obj: Expr; idx: Expr }
  | { t: "call"; fn: Expr; args: Expr[] }
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "not"; e: Expr }
  | { t: "neg"; e: Expr }
  | { t: "list"; items: Expr[] }
  | { t: "obj"; entries: [string, Expr][] }
  | { t: "lambda"; params: string[]; body: Expr }
  /** A link written in a query, resolved when it's run. */
  | { t: "link"; text: string };

export type Source =
  | { t: "tag"; tag: string }
  | { t: "folder"; folder: string }
  | { t: "link"; text: string; outgoing: boolean }
  | { t: "and" | "or"; l: Source; r: Source }
  | { t: "not"; s: Source }
  | { t: "all" };

export interface Field {
  expr: Expr;
  name: string;
}

export type Op =
  | { t: "where"; expr: Expr }
  | { t: "sort"; keys: { expr: Expr; desc: boolean }[] }
  | { t: "group"; expr: Expr; name: string }
  | { t: "flatten"; expr: Expr; name: string }
  | { t: "limit"; n: number };

export interface Query {
  type: "table" | "list" | "task" | "calendar";
  withoutId: boolean;
  fields: Field[];
  from: Source;
  ops: Op[];
}

export class ParseError extends Error {
  constructor(
    msg: string,
    public pos: number,
  ) {
    super(msg);
  }
}

/** A date written in `date(...)`: today, now, tomorrow, yesterday, sow/eow, som/eom, soy/eoy, or ISO. */
export function dateKeyword(s: string, now = DateTime.now()): DateTime | null {
  const t = s.trim().toLowerCase();
  const today = now.startOf("day");
  switch (t) {
    case "now":
      return now;
    case "today":
      return today;
    case "tomorrow":
      return today.plus({ days: 1 });
    case "yesterday":
      return today.minus({ days: 1 });
    case "sow":
      return now.startOf("week");
    case "eow":
      return now.endOf("week");
    case "som":
      return now.startOf("month");
    case "eom":
      return now.endOf("month");
    case "soy":
      return now.startOf("year");
    case "eoy":
      return now.endOf("year");
  }
  return parseIsoDate(s);
}

const ID_START = /[\p{L}\p{Emoji_Presentation}_]/u;
const ID_CHAR = /[\p{L}\p{N}\p{Emoji_Presentation}\p{M}_-]/u;
const KEYWORDS = ["from", "where", "sort", "group", "flatten", "limit"];

class P {
  pos = 0;
  constructor(public s: string) {}

  err(msg: string, at = this.pos): never {
    throw new ParseError(msg, at);
  }
  ws() {
    for (;;) {
      while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
      // `// comment` to the end of the line.
      if (this.s.startsWith("//", this.pos) && (this.pos === 0 || /\s/.test(this.s[this.pos - 1]))) {
        const nl = this.s.indexOf("\n", this.pos);
        this.pos = nl < 0 ? this.s.length : nl;
        continue;
      }
      return;
    }
  }
  peek(t: string) {
    this.ws();
    return this.s.startsWith(t, this.pos);
  }
  eat(t: string) {
    if (this.peek(t)) {
      this.pos += t.length;
      return true;
    }
    return false;
  }
  expect(t: string) {
    if (!this.eat(t)) this.err(`Expected "${t}"`);
  }
  /** A whole word, case-insensitive, not followed by an identifier character. */
  peekWord(w: string) {
    this.ws();
    const s = this.s.slice(this.pos, this.pos + w.length);
    const after = this.s[this.pos + w.length];
    return s.toLowerCase() === w && (after === undefined || !ID_CHAR.test(after));
  }
  eatWord(w: string) {
    if (this.peekWord(w)) {
      this.pos += w.length;
      return true;
    }
    return false;
  }
  ident(): string | null {
    this.ws();
    const c = this.s[this.pos];
    if (!c || !ID_START.test(c)) return null;
    let e = this.pos + c.length;
    for (const ch of this.s.slice(e)) {
      if (!ID_CHAR.test(ch)) break;
      e += ch.length;
    }
    // A trailing `-` is subtraction, not part of the name.
    while (this.s[e - 1] === "-") e--;
    const id = this.s.slice(this.pos, e);
    this.pos = e;
    return id;
  }
  string(): string | null {
    this.ws();
    if (this.s[this.pos] !== '"') return null;
    let i = this.pos + 1;
    let out = "";
    while (i < this.s.length && this.s[i] !== '"') {
      if (this.s[i] === "\\" && i + 1 < this.s.length) {
        const n = this.s[i + 1];
        out += n === "n" ? "\n" : n === "t" ? "\t" : n;
        i += 2;
      } else out += this.s[i++];
    }
    if (i >= this.s.length) this.err("Unterminated string");
    this.pos = i + 1;
    return out;
  }
  number(): number | null {
    this.ws();
    const m = /^\d+(\.\d+)?/.exec(this.s.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return +m[0];
  }
  linkText(): string | null {
    this.ws();
    const m = /^!?\[\[[^[\]\n]+?\]\]/.exec(this.s.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }
  atKeyword() {
    return KEYWORDS.some((k) => this.peekWord(k));
  }

  // ── Expressions, lowest precedence first ─────────────────────────────────────────────────
  expr(): Expr {
    return this.or();
  }
  or(): Expr {
    let l = this.and();
    for (;;) {
      if (this.eatWord("or") || this.eat("||")) l = { t: "bin", op: "or", l, r: this.and() };
      else if (!this.peek("||") && this.eat("|")) l = { t: "bin", op: "or", l, r: this.and() };
      else return l;
    }
  }
  and(): Expr {
    let l = this.cmp();
    for (;;) {
      if (this.eatWord("and") || this.eat("&&")) l = { t: "bin", op: "and", l, r: this.cmp() };
      else if (this.eat("&")) l = { t: "bin", op: "and", l, r: this.cmp() };
      else return l;
    }
  }
  cmp(): Expr {
    let l = this.add();
    for (;;) {
      const op = ["<=", ">=", "!=", "=", "<", ">"].find((o) => this.peek(o) && !this.s.startsWith("=>", this.pos));
      if (!op) return l;
      this.pos += op.length;
      l = { t: "bin", op, l, r: this.add() };
    }
  }
  add(): Expr {
    let l = this.mul();
    for (;;) {
      if (this.peek("+")) {
        this.pos++;
        l = { t: "bin", op: "+", l, r: this.mul() };
      } else if (this.peek("-") && !this.s.startsWith("->", this.pos)) {
        this.pos++;
        l = { t: "bin", op: "-", l, r: this.mul() };
      } else return l;
    }
  }
  mul(): Expr {
    let l = this.unary();
    for (;;) {
      const op = ["*", "/", "%"].find((o) => this.peek(o) && !(o === "/" && this.s.startsWith("//", this.pos)));
      if (!op) return l;
      this.pos++;
      l = { t: "bin", op, l, r: this.unary() };
    }
  }
  unary(): Expr {
    if (this.peek("!") && !this.peek("!=") && !this.peek("![[")) {
      this.pos++;
      return { t: "not", e: this.unary() };
    }
    if (this.peek("-") && !/\d/.test(this.s[this.pos + 1] ?? "")) {
      this.pos++;
      return { t: "neg", e: this.unary() };
    }
    return this.postfix();
  }
  postfix(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.peek(".") && ID_START.test(this.s[this.pos + 1] ?? "")) {
        this.pos++;
        const k = this.ident();
        if (!k) this.err("Expected a field name");
        e = { t: "field", obj: e, key: k };
      } else if (this.peek("[") && !this.peek("[[")) {
        this.pos++;
        const idx = this.expr();
        this.expect("]");
        e = { t: "index", obj: e, idx };
      } else if (this.peek("(") && (e.t === "var" || e.t === "field" || e.t === "lambda")) {
        e = this.call(e);
      } else return e;
    }
  }
  call(fn: Expr): Expr {
    this.expect("(");
    // date(today), date(2026-10-02), dur(3 days): bare text Dataview reads as a literal.
    if (fn.t === "var" && (fn.name === "date" || fn.name === "dur")) {
      const close = this.matching(this.pos - 1);
      const raw = this.s.slice(this.pos, close);
      const lit = fn.name === "date" ? dateKeyword(raw) : /^\s*-?\d/.test(raw) && !/[(),"]/.test(raw) ? parseDuration(raw) : null;
      if (lit && !/^\s*"/.test(raw)) {
        this.pos = close + 1;
        return { t: "lit", v: lit };
      }
    }
    const args: Expr[] = [];
    if (!this.eat(")")) {
      do args.push(this.expr());
      while (this.eat(","));
      this.expect(")");
    }
    return { t: "call", fn, args };
  }
  /** The `)` that closes the `(` at `open`. */
  matching(open: number): number {
    let depth = 0;
    let q = false;
    for (let i = open; i < this.s.length; i++) {
      const c = this.s[i];
      if (c === '"' && this.s[i - 1] !== "\\") q = !q;
      if (q) continue;
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return i;
    }
    return this.err("Missing )", open);
  }
  atom(): Expr {
    this.ws();
    const start = this.pos;
    const lt = this.linkText();
    if (lt) return { t: "link", text: lt };
    const str = this.string();
    if (str !== null) return { t: "lit", v: str };
    const n = this.number();
    if (n !== null) {
      // `3 days` straight after a number isn't Dataview syntax; leave it to the error.
      return { t: "lit", v: n };
    }
    if (this.peek("-") && /\d/.test(this.s[this.pos + 1] ?? "")) {
      this.pos++;
      return { t: "lit", v: -(this.number() as number) };
    }
    if (this.peek("(")) {
      // A lambda, `(x, y) => …`, or a parenthesised expression.
      const save = this.pos;
      this.pos++;
      const params: string[] = [];
      let ok = true;
      if (!this.eat(")")) {
        do {
          const id = this.ident();
          if (!id) {
            ok = false;
            break;
          }
          params.push(id);
        } while (this.eat(","));
        ok = ok && this.eat(")");
      }
      if (ok && this.eat("=>")) return { t: "lambda", params, body: this.expr() };
      this.pos = save + 1;
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (this.eat("[")) {
      const items: Expr[] = [];
      if (!this.eat("]")) {
        do items.push(this.expr());
        while (this.eat(","));
        this.expect("]");
      }
      return { t: "list", items };
    }
    if (this.eat("{")) {
      const entries: [string, Expr][] = [];
      if (!this.eat("}")) {
        do {
          const k = this.string() ?? this.ident();
          if (k === null) this.err("Expected a key");
          this.expect(":");
          entries.push([k, this.expr()]);
        } while (this.eat(","));
        this.expect("}");
      }
      return { t: "obj", entries };
    }
    const id = this.ident();
    if (id !== null) {
      // A single-parameter lambda without brackets: `x => x + 1`.
      if (this.peek("=>")) {
        this.pos += 2;
        return { t: "lambda", params: [id], body: this.expr() };
      }
      const low = id.toLowerCase();
      if (low === "true" || low === "false") return { t: "lit", v: low === "true" };
      if (low === "null") return { t: "lit", v: null };
      return { t: "var", name: id };
    }
    return this.err(this.pos >= this.s.length ? "Unexpected end of query" : `Unexpected "${this.s[this.pos]}"`, start);
  }

  // ── Sources ──────────────────────────────────────────────────────────────────────────────
  source(): Source {
    let l = this.srcAnd();
    while (this.eatWord("or") || this.eat("|")) l = { t: "or", l, r: this.srcAnd() };
    return l;
  }
  srcAnd(): Source {
    let l = this.srcNot();
    while (this.eatWord("and") || this.eat("&")) l = { t: "and", l, r: this.srcNot() };
    return l;
  }
  srcNot(): Source {
    if (this.eat("-") || (this.peek("!") && !this.peek("![[") && this.eat("!"))) return { t: "not", s: this.srcNot() };
    return this.srcAtom();
  }
  srcAtom(): Source {
    this.ws();
    if (this.eat("(")) {
      const s = this.source();
      this.expect(")");
      return s;
    }
    if (this.s[this.pos] === "#") {
      const m = /^#[^\s,()"]+/u.exec(this.s.slice(this.pos))!;
      this.pos += m[0].length;
      return { t: "tag", tag: m[0] };
    }
    const str = this.string();
    if (str !== null) return { t: "folder", folder: str };
    const lt = this.linkText();
    if (lt) return { t: "link", text: lt, outgoing: false };
    if (this.eatWord("outgoing")) {
      this.expect("(");
      const l = this.linkText();
      if (!l) this.err("Expected a [[link]]");
      this.expect(")");
      return { t: "link", text: l, outgoing: true };
    }
    if (this.eatWord("incoming")) {
      this.expect("(");
      const l = this.linkText();
      if (!l) this.err("Expected a [[link]]");
      this.expect(")");
      return { t: "link", text: l, outgoing: false };
    }
    return this.err('Expected a source: #tag, "folder", [[link]] or outgoing([[link]])');
  }

  // ── The query ────────────────────────────────────────────────────────────────────────────
  query(): Query {
    this.ws();
    let type: Query["type"];
    if (this.eatWord("table")) type = "table";
    else if (this.eatWord("list")) type = "list";
    else if (this.eatWord("task")) type = "task";
    else if (this.eatWord("calendar")) type = "calendar";
    else return this.err("Expected a query type: TABLE, LIST, TASK or CALENDAR");
    let withoutId = false;
    if (this.peekWord("without")) {
      this.eatWord("without");
      if (!this.eatWord("id")) this.err("Expected ID after WITHOUT");
      withoutId = true;
    }
    const fields: Field[] = [];
    const fieldEnd = () => this.pos >= this.s.length || this.atKeyword();
    if (type === "table") {
      this.ws();
      if (!fieldEnd()) {
        do fields.push(this.namedField());
        while (this.eat(","));
      }
    } else if (type === "list" || type === "calendar") {
      this.ws();
      if (!fieldEnd()) fields.push(this.namedField());
      else if (type === "calendar") this.err("CALENDAR needs a date field");
    }
    let from: Source = { t: "all" };
    if (this.eatWord("from")) from = this.source();
    const ops: Op[] = [];
    for (;;) {
      this.ws();
      if (this.pos >= this.s.length) break;
      if (this.eatWord("where")) ops.push({ t: "where", expr: this.expr() });
      else if (this.eatWord("sort")) {
        const keys: { expr: Expr; desc: boolean }[] = [];
        do {
          const expr = this.expr();
          let desc = false;
          if (this.eatWord("descending") || this.eatWord("desc")) desc = true;
          else if (this.eatWord("ascending") || this.eatWord("asc")) desc = false;
          keys.push({ expr, desc });
        } while (this.eat(","));
        ops.push({ t: "sort", keys });
      } else if (this.eatWord("group")) {
        if (!this.eatWord("by")) this.err("Expected BY after GROUP");
        const f = this.namedField();
        ops.push({ t: "group", expr: f.expr, name: f.named ? f.name : "key" });
      } else if (this.eatWord("flatten")) {
        const f = this.namedField();
        ops.push({ t: "flatten", expr: f.expr, name: f.name });
      } else if (this.eatWord("limit")) {
        const n = this.number();
        if (n === null) this.err("Expected a number after LIMIT");
        ops.push({ t: "limit", n });
      } else if (this.eatWord("from")) this.err("FROM must come straight after the query type");
      else this.err(`Unrecognised query operation "${this.s.slice(this.pos).split(/\s/)[0]}"`);
    }
    return { type, withoutId, fields, from, ops };
  }
  namedField(): Field & { named: boolean } {
    this.ws();
    const start = this.pos;
    const expr = this.expr();
    const text = this.s.slice(start, this.pos).trim();
    if (this.eatWord("as")) {
      const n = this.string() ?? this.ident();
      if (n === null) this.err("Expected a name after AS");
      return { expr, name: n, named: true };
    }
    return { expr, name: text, named: false };
  }
}

export function parseQuery(src: string): Query {
  return new P(src).query();
}

/** A FROM source on its own, as `dv.pages("#tag and -\"folder\"")` takes it; "" is every page. */
export function parseSource(src: string): Source {
  if (!src.trim()) return { t: "all" };
  const p = new P(src);
  const s = p.source();
  p.ws();
  if (p.pos < src.length) p.err(`Unexpected "${src.slice(p.pos, p.pos + 12)}"`);
  return s;
}

export function parseExpr(src: string): Expr {
  const p = new P(src);
  const e = p.expr();
  p.ws();
  if (p.pos < src.length) p.err(`Unexpected "${src.slice(p.pos, p.pos + 12)}"`);
  return e;
}

/** Dataview's parse error box: the line, a caret, and what went wrong. */
export function describeError(src: string, e: unknown): string {
  if (!(e instanceof ParseError)) return `Dataview: ${e instanceof Error ? e.message : String(e)}`;
  const before = src.slice(0, e.pos);
  const lineNo = before.split("\n").length;
  const col = before.length - before.lastIndexOf("\n") - 1;
  const lines = src.split("\n");
  const w = String(lines.length).length;
  const shown = lines
    .map((l, i) => `${i + 1 === lineNo ? ">" : " "} ${String(i + 1).padStart(w)} | ${l}`)
    .slice(Math.max(0, lineNo - 3), lineNo)
    .concat(`  ${" ".repeat(w)} | ${" ".repeat(col)}^`);
  return `Dataview: Error:\n-- PARSING FAILED --------------------------------------------------\n\n${shown.join("\n")}\n\n${e.message}`;
}

/** For `link(...)` literals written in a query: the parts of `[[a#b|c]]`. */
export function linkParts(text: string): { target: string; sub?: string; display?: string; embed: boolean } {
  const embed = text.startsWith("!");
  const inner = text.replace(/^!?\[\[|\]\]$/g, "");
  const [dest, display] = inner.split("|");
  const hash = dest.indexOf("#");
  return {
    target: (hash < 0 ? dest : dest.slice(0, hash)).trim(),
    sub: hash < 0 ? undefined : dest.slice(hash + 1).trim() || undefined,
    display: display?.trim() || undefined,
    embed,
  };
}

export { Duration, Link };
