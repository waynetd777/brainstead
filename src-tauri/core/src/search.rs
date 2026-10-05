// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Search over the index's FTS5 table, with the previous app's query syntax (`parse_query` in
//! scripts/search_wiki.py): bare words, `+required`, `-excluded`, `"phrase"`, `AND`, `OR`, `NOT`,
//! `tag:x` / `-tag:x`, and Brainstead's `since:YYYY-MM-DD` / `before:YYYY-MM-DD` (a month,
//! `YYYY-MM`, works too) on the file's date, or the day it last changed when it has none. One hit per file, ranked by its best passage, with that passage as the
//! snippet. Unlike the previous app, words are stemmed (FTS5's porter tokenizer), so "launching"
//! finds "launch".

use std::collections::HashMap;
use std::time::Instant;

use rusqlite::{params_from_iter, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::index::{Index, Result};
use crate::read::FileSummary;

fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Query {
    pub bare: Vec<String>,
    pub required: Vec<String>,
    pub excluded: Vec<String>,
    pub phrases: Vec<String>,
    pub tags: Vec<String>,
    pub excluded_tags: Vec<String>,
    /// On or after this date (YYYY-MM-DD).
    pub since: Option<String>,
    /// Before this date (YYYY-MM-DD).
    pub before: Option<String>,
}

/// `2026-09-18` as it is; `2026-09` as its first day; anything else None.
fn date_arg(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    match b.len() {
        10 if digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10) => Some(s.to_string()),
        7 if digits(0..4) && b[4] == b'-' && digits(5..7) => Some(format!("{s}-01")),
        _ => None,
    }
}

impl Query {
    pub fn is_empty(&self) -> bool {
        self.bare.is_empty()
            && self.required.is_empty()
            && self.phrases.is_empty()
            && self.tags.is_empty()
            && self.since.is_none()
            && self.before.is_none()
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Word {
        text: String,
        prefix: Option<char>,
    },
    /// A quoted phrase, with the `-` or `+` written right before its quote.
    Phrase {
        text: String,
        prefix: Option<char>,
    },
    Op(&'static str),
}

/// Same three phases as the previous app: lex, apply operators, sort into kinds.
pub fn parse_query(q: &str) -> Query {
    let mut toks = Vec::new();
    let cs: Vec<char> = q.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '"' || ((c == '-' || c == '+') && cs.get(i + 1) == Some(&'"')) {
            // `-"soft launch"` leaves the phrase out; `+"…"` requires it, as a phrase does anyway.
            let prefix = (c != '"').then_some(c);
            let start = if prefix.is_some() { i + 2 } else { i + 1 };
            let end = cs[start..].iter().position(|&x| x == '"').map(|p| start + p).unwrap_or(cs.len());
            let p: String = cs[start..end].iter().collect::<String>().trim().to_lowercase();
            if !p.is_empty() {
                toks.push(Tok::Phrase { text: p, prefix });
            }
            i = end + 1;
        } else {
            let prefix = (c == '+' || c == '-').then_some(c);
            let start = if prefix.is_some() { i + 1 } else { i };
            let mut end = start;
            while end < cs.len() && !cs[end].is_whitespace() && cs[end] != '"' {
                end += 1;
            }
            let w: String = cs[start..end].iter().collect();
            i = end;
            if w.is_empty() {
                continue;
            }
            match (prefix, w.to_uppercase().as_str()) {
                (None, "AND") => toks.push(Tok::Op("AND")),
                (None, "OR") => toks.push(Tok::Op("OR")),
                (None, "NOT") => toks.push(Tok::Op("NOT")),
                _ => toks.push(Tok::Word { text: w.to_lowercase(), prefix }),
            }
        }
    }
    // NOT and AND change their neighbours' prefixes.
    let n = toks.len();
    let is_op = |t: &Tok| matches!(t, Tok::Op(_));
    for k in 0..n {
        match toks[k] {
            Tok::Op("NOT") if k + 1 < n && !is_op(&toks[k + 1]) => {
                if let Tok::Word { prefix, .. } | Tok::Phrase { prefix, .. } = &mut toks[k + 1] {
                    *prefix = Some('-');
                }
            }
            Tok::Op("AND") => {
                for j in [k.wrapping_sub(1), k + 1] {
                    if j < n {
                        if let Tok::Word { prefix, .. } = &mut toks[j] {
                            if prefix.is_none() {
                                *prefix = Some('+');
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut q = Query::default();
    for t in toks {
        match t {
            // An excluded phrase is excluded whole: `lit` quotes it as one FTS phrase.
            Tok::Phrase { text, prefix: Some('-') } => q.excluded.push(text),
            Tok::Phrase { text, .. } => q.phrases.push(text),
            Tok::Op(_) => {}
            Tok::Word { text, prefix } => {
                if let Some(d) = text.strip_prefix("since:").and_then(date_arg) {
                    q.since = Some(d);
                    continue;
                }
                if let Some(d) = text.strip_prefix("before:").and_then(date_arg) {
                    q.before = Some(d);
                    continue;
                }
                if let Some(tag) = text.strip_prefix("tag:") {
                    let tag = tag.trim_start_matches('#').to_string();
                    if !tag.is_empty() {
                        if prefix == Some('-') {
                            q.excluded_tags.push(tag)
                        } else {
                            q.tags.push(tag)
                        }
                    }
                    continue;
                }
                match prefix {
                    Some('+') => q.required.push(text),
                    Some('-') => q.excluded.push(text),
                    _ => q.bare.push(text),
                }
            }
        }
    }
    q
}

/// An FTS5 string literal: every term is quoted, so nothing typed is read as FTS syntax.
fn lit(s: &str) -> Option<String> {
    let words: Vec<&str> = s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    (!words.is_empty()).then(|| format!("\"{}\"", words.join(" ")))
}

/// What a search asks of the full-text index. The index holds passages (a heading's section), but
/// what's required and what's left out is the whole file's: `+budget` in one section and `+launch`
/// in another is a match, and `-"soft launch"` anywhere in a file drops it.
#[derive(Debug, Clone, PartialEq)]
pub struct FtsPlan {
    /// The passages to rank: those with any word or phrase asked for.
    pub rank: String,
    /// Each a MATCH the file must have in some passage.
    pub must: Vec<String>,
    /// Each a MATCH no passage of the file may have.
    pub not: Vec<String>,
}

/// The full-text plan, or None when only tag or date filters were given.
pub fn fts_plan(q: &Query) -> Option<FtsPlan> {
    let req: Vec<String> = q.required.iter().chain(&q.phrases).filter_map(|w| lit(w)).collect();
    let any: Vec<String> = q.bare.iter().filter_map(|w| lit(w)).collect();
    let rank: Vec<String> = req.iter().chain(&any).cloned().collect();
    if rank.is_empty() {
        return None;
    }
    let mut must = req.clone();
    // With required words too, at least one of the bare ones (alone, the ranking already asks it).
    if !req.is_empty() && !any.is_empty() {
        must.push(any.join(" OR "));
    }
    Some(FtsPlan { rank: rank.join(" OR "), must, not: q.excluded.iter().filter_map(|w| lit(w)).collect() })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub q: String,
    /// "note", "wiki", "source", "template"; empty for all.
    #[serde(default)]
    pub layers: Vec<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    200
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seg {
    pub text: String,
    pub hit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub file: FileSummary,
    /// Higher is better.
    pub score: f64,
    /// The best passage's headings, outermost first.
    pub heading: String,
    pub snippet: Vec<Seg>,
    /// Passages in the file that matched.
    pub passages: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub hits: Vec<Hit>,
    /// Files that matched, before the limit.
    pub total: usize,
    pub ms: f64,
}

/// Column weights for bm25(): title, heading path, text, tags (the previous app boosts the name ×5
/// and tags ×2).
const WEIGHTS: &str = "5.0, 2.0, 1.0, 2.0";

impl Index {
    pub fn search(&self, req: &SearchRequest) -> Result<Results> {
        let t0 = Instant::now();
        let q = parse_query(&req.q);
        let empty = Results { hits: vec![], total: 0, ms: 0.0 };
        if req.q.trim().chars().count() < 2 || q.is_empty() {
            return Ok(empty);
        }
        let c = self.conn();
        // Files allowed by layer and tag filters, when there are any.
        let mut filter = String::from("1");
        let mut args: Vec<String> = Vec::new();
        if !req.layers.is_empty() {
            filter.push_str(&format!(" AND f.layer IN ({})", vec!["?"; req.layers.len()].join(",")));
            args.extend(req.layers.iter().cloned());
        }
        for t in &q.tags {
            filter.push_str(
                " AND EXISTS (SELECT 1 FROM tags g WHERE g.file_id = f.id AND (lower(g.tag) = ? OR lower(g.tag) LIKE ? ESCAPE '\\'))",
            );
            args.push(t.to_lowercase());
            args.push(format!("{}/%", like_escape(&t.to_lowercase())));
        }
        for t in &q.excluded_tags {
            filter.push_str(
                " AND NOT EXISTS (SELECT 1 FROM tags g WHERE g.file_id = f.id AND (lower(g.tag) = ? OR lower(g.tag) LIKE ? ESCAPE '\\'))",
            );
            args.push(t.to_lowercase());
            args.push(format!("{}/%", like_escape(&t.to_lowercase())));
        }
        // A file's date, else the local day it last changed.
        const DAY: &str = "COALESCE(f.date, date(f.mtime / 1000, 'unixepoch', 'localtime'))";
        if let Some(d) = &q.since {
            filter.push_str(&format!(" AND {DAY} >= ?"));
            args.push(d.clone());
        }
        if let Some(d) = &q.before {
            filter.push_str(&format!(" AND {DAY} < ?"));
            args.push(d.clone());
        }

        struct Best {
            score: f64,
            /// The best passage, or None for a tags-only search (then the file's first).
            chunk: Option<i64>,
            passages: usize,
        }
        let mut order: Vec<i64> = Vec::new();
        let mut best: HashMap<i64, Best> = HashMap::new();
        // What every file must have, and mustn't, anywhere in it.
        const HAS: &str = "SELECT c2.file_id FROM chunks_fts JOIN chunks c2 ON c2.id = chunks_fts.rowid WHERE chunks_fts MATCH ?";
        match fts_plan(&q) {
            Some(plan) => {
                for m in &plan.must {
                    filter.push_str(&format!(" AND f.id IN ({HAS})"));
                    args.push(m.clone());
                }
                for m in &plan.not {
                    filter.push_str(&format!(" AND f.id NOT IN ({HAS})"));
                    args.push(m.clone());
                }
                let sql = format!(
                    "SELECT c.file_id, bm25(chunks_fts, {WEIGHTS}) AS r, c.id
                     FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.id = c.file_id
                     WHERE chunks_fts MATCH ? AND {filter} ORDER BY r LIMIT 5000"
                );
                let mut all = vec![plan.rank];
                all.extend(args);
                let mut st = c.prepare_cached(&sql).map_err(e)?;
                let mut rows = st.query(params_from_iter(all.iter())).map_err(e)?;
                while let Some(r) = rows.next().map_err(e)? {
                    let id: i64 = r.get(0).map_err(e)?;
                    match best.get_mut(&id) {
                        Some(b) => b.passages += 1,
                        None => {
                            order.push(id);
                            let rank: f64 = r.get(1).map_err(e)?;
                            best.insert(id, Best { score: -rank, chunk: Some(r.get(2).map_err(e)?), passages: 1 });
                        }
                    }
                }
            }
            // Words that are all punctuation, with no tag or date: nothing to look for (not the
            // whole vault).
            None if q.tags.is_empty() && q.since.is_none() && q.before.is_none() => return Ok(empty),
            // Tags or dates only: every file that fits, newest date first, less those with an
            // excluded word or phrase.
            None => {
                for m in q.excluded.iter().filter_map(|w| lit(w)) {
                    filter.push_str(&format!(" AND f.id NOT IN ({HAS})"));
                    args.push(m);
                }
                let sql = format!(
                    "SELECT f.id FROM files f WHERE {filter}
                     ORDER BY COALESCE(f.date, '') DESC, f.mtime DESC LIMIT 5000"
                );
                let mut st = c.prepare_cached(&sql).map_err(e)?;
                let mut rows = st.query(params_from_iter(args.iter())).map_err(e)?;
                while let Some(r) = rows.next().map_err(e)? {
                    let id: i64 = r.get(0).map_err(e)?;
                    order.push(id);
                    best.insert(id, Best { score: 0.0, chunk: None, passages: 0 });
                }
            }
        }
        let total = order.len();
        let terms = highlight_terms(&q);
        let mut hits = Vec::new();
        let mut by_chunk = c.prepare_cached("SELECT heading_path, text FROM chunks WHERE id = ?1").map_err(e)?;
        let mut first_chunk =
            c.prepare_cached("SELECT heading_path, text FROM chunks WHERE file_id = ?1 ORDER BY start LIMIT 1").map_err(e)?;
        for id in order.into_iter().take(req.limit) {
            let b = &best[&id];
            let Some(file) = self.summary_by_id(id)? else { continue };
            let row = |r: &rusqlite::Row| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, String>(1)?));
            let (heading, text) = match b.chunk {
                Some(ch) => by_chunk.query_row([ch], row).optional().map_err(e)?,
                None => first_chunk.query_row([id], row).optional().map_err(e)?,
            }
            .unwrap_or_default();
            hits.push(Hit { file, score: b.score, heading, snippet: snippet(&text, &terms, 220), passages: b.passages });
        }
        Ok(Results { hits, total, ms: t0.elapsed().as_secs_f64() * 1000.0 })
    }
}

pub(crate) fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// The words to mark in a snippet, cut back to a rough stem so "launching" marks "launch" and
/// "launched" too, as the porter tokenizer matched them.
pub fn highlight_terms(q: &Query) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in q.bare.iter().chain(&q.required).chain(&q.phrases) {
        for part in w.split(|c: char| !c.is_alphanumeric()).filter(|p| p.chars().count() >= 2) {
            let s = rough_stem(part);
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out
}

fn rough_stem(w: &str) -> String {
    let w = w.to_lowercase();
    for suf in ["ings", "ing", "edly", "ed", "ies", "es", "s", "ly"] {
        if let Some(stem) = w.strip_suffix(suf) {
            if stem.chars().count() >= 3 {
                return stem.to_string();
            }
        }
    }
    w
}

/// About `width` characters of `text` around its first marked word, split into marked and
/// unmarked runs. Whitespace is collapsed.
pub fn snippet(text: &str, terms: &[String], width: usize) -> Vec<Seg> {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = flat.chars().collect();
    let lower: Vec<char> = flat.to_lowercase().chars().collect();
    // to_lowercase can change the length (rare: İ); then marking is skipped rather than misplaced.
    let same = lower.len() == chars.len();
    let mut marks = vec![false; chars.len()];
    let mut first: Option<usize> = None;
    if same {
        for t in terms {
            let tc: Vec<char> = t.chars().collect();
            let mut i = 0;
            while i + tc.len() <= lower.len() {
                let at_start = i == 0 || !lower[i - 1].is_alphanumeric();
                if at_start && lower[i..i + tc.len()] == tc[..] {
                    let mut j = i + tc.len();
                    while j < lower.len() && lower[j].is_alphanumeric() {
                        j += 1;
                    }
                    if marks[i..j].iter().all(|m| !m) {
                        marks[i..j].iter_mut().for_each(|m| *m = true);
                        first = Some(first.map_or(i, |f| f.min(i)));
                    }
                    i = j;
                } else {
                    i += 1;
                }
            }
        }
    }
    let start = match first {
        Some(f) if f > width / 3 => {
            let s = f - width / 3;
            // Start at a word.
            (s..f).find(|&k| k == 0 || chars[k - 1] == ' ').unwrap_or(s)
        }
        _ => 0,
    };
    let mut end = (start + width).min(chars.len());
    if end < chars.len() {
        end = (start..end).rev().find(|&k| chars[k] == ' ').filter(|&k| k > start + width / 2).unwrap_or(end);
    }
    let mut out: Vec<Seg> = Vec::new();
    if start > 0 {
        out.push(Seg { text: "…".into(), hit: false });
    }
    for k in start..end {
        match out.last_mut() {
            Some(s) if s.hit == marks[k] && !(s.text == "…" && k == start) => s.text.push(chars[k]),
            _ => out.push(Seg { text: chars[k].to_string(), hit: marks[k] }),
        }
    }
    if end < chars.len() {
        match out.last_mut() {
            Some(s) if !s.hit => s.text.push('…'),
            _ => out.push(Seg { text: "…".into(), hit: false }),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;
    use std::path::PathBuf;

    fn q(s: &str) -> Query {
        parse_query(s)
    }

    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn punctuation_only_finds_nothing() {
        let ix = ix();
        for t in ["!!", "-- ++", "?? !", "\"!!\""] {
            assert!(s(&ix, t, &[]).hits.is_empty(), "{t}");
        }
    }

    // Cases from the previous app's scripts/test_search_wiki.py.
    #[test]
    fn dates_since_and_before() {
        let t = q("launch since:2026-09 before:2026-10-01");
        assert_eq!(
            (t.since.as_deref(), t.before.as_deref(), t.bare.clone()),
            (Some("2026-09-01"), Some("2026-10-01"), vec!["launch".to_string()])
        );
        // Not a date: an ordinary word.
        assert_eq!(q("since:soon").bare, vec!["since:soon".to_string()]);
        let ix = ix();
        let all = s(&ix, "since:2026-09-30", &[]);
        assert!(!all.hits.is_empty());
        assert!(
            all.hits.iter().all(|h| h.file.date.as_deref().is_none_or(|d| d >= "2026-09-30")),
            "{:?}",
            all.hits.iter().map(|h| &h.file.path).collect::<Vec<_>>()
        );
        assert!(s(&ix, "steerco before:2000-01-01", &[]).hits.is_empty());
    }

    #[test]
    fn parses_like_the_previous_app() {
        assert_eq!(q(""), Query::default());
        assert_eq!(q("Apple").bare, ["apple"]);
        assert_eq!(q("\"Orbit App\"").phrases, ["orbit app"]);
        assert_eq!(q("\"unterminated phrase").phrases, ["unterminated phrase"]);
        assert!(q("\"\"").phrases.is_empty());
        let a = q("a AND b c");
        assert_eq!((a.required, a.bare), (v(&["a", "b"]), v(&["c"])));
        assert_eq!(q("apple and banana").required, ["apple", "banana"]);
        assert_eq!(q("a OR b").bare, ["a", "b"]);
        assert_eq!(q("a NOT b").excluded, ["b"]);
        let m = q("alpha AND \"beta gamma\" -delta +epsilon");
        assert_eq!((m.required, m.phrases, m.excluded), (v(&["alpha", "epsilon"]), v(&["beta gamma"]), v(&["delta"])));
        assert_eq!(q("AND"), Query::default());
        assert_eq!(q("- +"), Query::default());
        assert_eq!(q("+AND").required, ["and"]);
        // A phrase left out, by `-` or NOT; `+` before one changes nothing.
        let x = q("orbit -\"soft launch\"");
        assert_eq!((x.bare, x.phrases, x.excluded), (v(&["orbit"]), v(&[]), v(&["soft launch"])));
        assert_eq!(q("orbit NOT \"soft launch\"").excluded, ["soft launch"]);
        assert_eq!(q("+\"soft launch\"").phrases, ["soft launch"]);
        assert_eq!(fts_plan(&q("orbit -\"soft launch\"")).unwrap().not, ["\"soft launch\""]);
        let t = q("tag:hiring -tag:archived budget");
        assert_eq!((t.tags, t.excluded_tags, t.bare), (v(&["hiring"]), v(&["archived"]), v(&["budget"])));
    }

    #[test]
    fn plans_full_text_searches() {
        let p = fts_plan(&q("orbit app")).unwrap();
        assert_eq!((p.rank.as_str(), p.must.len(), p.not.len()), ("\"orbit\" OR \"app\"", 0, 0));
        let p = fts_plan(&q("+launch \"soft launch\" -customers date")).unwrap();
        assert_eq!(p.rank, "\"launch\" OR \"soft launch\" OR \"date\"");
        assert_eq!(p.must, ["\"launch\"", "\"soft launch\"", "\"date\""]);
        assert_eq!(p.not, ["\"customers\""]);
        assert_eq!(fts_plan(&q("+2026-05-21")).unwrap().must, ["\"2026 05 21\""]);
        assert_eq!(fts_plan(&q("tag:x")), None);
        // FTS syntax typed by the user is only words.
        assert_eq!(fts_plan(&q("a* OR NEAR(b)")).unwrap().rank, "\"a\" OR \"near b\"");
    }

    fn ix() -> Index {
        let v = Vault::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault"), vec!["archived".into()]);
        let mut ix = Index::open_in_memory().unwrap();
        ix.sync(&v).unwrap();
        ix
    }

    fn paths(r: &Results) -> Vec<&str> {
        r.hits.iter().map(|h| h.file.path.as_str()).collect()
    }

    fn s(ix: &Index, q: &str, layers: &[&str]) -> Results {
        ix.search(&SearchRequest { q: q.into(), layers: v(layers), limit: 50 }).unwrap()
    }

    #[test]
    fn searches_the_fixture() {
        let ix = ix();
        let r = s(&ix, "launching", &[]);
        assert!(paths(&r).contains(&"sources/Roadmap Update 2026-09-18.md"), "{:?}", paths(&r));
        // The title counts most: the Orbit App page comes first.
        assert_eq!(paths(&s(&ix, "orbit app", &["wiki"]))[0], "wiki/entities/Orbit App.md");
        assert!(s(&ix, "orbit app", &["wiki"]).hits.iter().all(|h| h.file.layer == "wiki"));
        // A phrase must be adjacent; excluded words drop the file.
        assert!(paths(&s(&ix, "\"soft launch\"", &[])).contains(&"wiki/entities/Orbit App.md"));
        assert!(!paths(&s(&ix, "\"launch soft\"", &[])).contains(&"wiki/entities/Orbit App.md"));
        assert!(!paths(&s(&ix, "launch -customers", &[])).contains(&"sources/Roadmap Update 2026-09-18.md"));
        // An excluded phrase drops a file that has it, and keeps the rest.
        let without = paths(&s(&ix, "orbit -\"soft launch\"", &[])).into_iter().map(String::from).collect::<Vec<_>>();
        assert!(!without.iter().any(|p| p == "wiki/entities/Orbit App.md"), "{without:?}");
        assert!(!without.is_empty());
        // Required words count anywhere in the file, not only in one passage.
        let page = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault/wiki/entities/Orbit App.md"),
        )
        .unwrap();
        assert!(page.contains("Soft launch") && page.contains("Pilot"));
        assert!(paths(&s(&ix, "+\"soft launch\" +pilot", &[])).contains(&"wiki/entities/Orbit App.md"));
        // Tags match themselves and their sub-tags.
        let t = s(&ix, "tag:project", &[]);
        assert!(paths(&t).contains(&"wiki/entities/Orbit App.md"));
        assert!(paths(&t).contains(&"Meeting. Orbit App Steerco - 2026-09-30.md"), "{:?}", paths(&t));
        assert!(s(&ix, "tag:proj", &[]).hits.is_empty());
        // With only a tag, excluded words and phrases still drop a file.
        assert!(!paths(&s(&ix, "tag:project -orbit", &[])).contains(&"wiki/entities/Orbit App.md"));
        assert!(!paths(&s(&ix, "tag:project -\"soft launch\"", &[])).contains(&"wiki/entities/Orbit App.md"));
        assert!(paths(&s(&ix, "tag:project -zzzunlikely", &[])).contains(&"wiki/entities/Orbit App.md"));
        assert!(s(&ix, "x", &[]).hits.is_empty());
        assert_eq!(s(&ix, "zzzunlikely", &[]).total, 0);
    }

    #[test]
    fn snippets_mark_the_words() {
        let t = highlight_terms(&q("launching date"));
        let sn = snippet("Staff soft launch remains on track. The launched date moved.", &t, 220);
        let marked: Vec<&str> = sn.iter().filter(|s| s.hit).map(|s| s.text.as_str()).collect();
        assert_eq!(marked, ["launch", "launched", "date"]);
        let long = format!("{} needle {}", "word ".repeat(100), "word ".repeat(100));
        let sn = snippet(&long, &v(&["needle"]), 120);
        assert_eq!(sn.first().unwrap().text, "…");
        assert!(sn.iter().any(|s| s.hit && s.text == "needle"));
        assert!(sn.last().unwrap().text.ends_with('…'));
    }
}
