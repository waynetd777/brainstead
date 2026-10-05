// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Contradictions between wiki pages, on the previous app's `contradictions.py` design: the model
//! never compares pages. Each page is read once into claims (subject, attribute, value, as of,
//! quote), cached by the page's content; grouping them by subject and attribute is code; only the
//! groups whose values disagree at about the same time go to a model to judge. The rules here
//! (attribute names and synonyms, value normalising, the fuzzy quote check, the subject index that
//! drops contested aliases, the 45-day window) are the script's, compared with its output.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::lint::{fm_field, frontmatter_block, lint_key, WIKILINK};

/// Bump when what's extracted changes: every page is read again.
pub const EXTRACTOR_VERSION: &str = "1";
pub const WINDOW_DAYS: i64 = 45;
const QUOTE_MAX: usize = 300;

/// Single-valued attributes only; `other:<snake_case>` for the rest.
pub const ATTRIBUTES: [&str; 17] = [
    "role",
    "team",
    "reports_to",
    "employer",
    "location",
    "status",
    "owner",
    "sponsor",
    "start_date",
    "end_date",
    "go_live_date",
    "deadline",
    "budget",
    "headcount",
    "vendor",
    "version",
    "decision",
];

fn synonym(a: &str) -> Option<&'static str> {
    Some(match a {
        "title" | "job_title" | "position" => "role",
        "manager" | "line_manager" => "reports_to",
        "company" | "organisation" | "organization" => "employer",
        "state" => "status",
        "go_live" | "launch_date" | "release_date" => "go_live_date",
        "due_date" => "deadline",
        "cost" => "budget",
        "team_size" => "headcount",
        "joined" => "start_date",
        "left" => "end_date",
        _ => return None,
    })
}

pub fn normalise_attribute(attr: &str) -> String {
    let lower = attr.trim().to_lowercase();
    let mut a = String::new();
    let mut gap = false;
    for c in lower.chars() {
        if c.is_whitespace() || c == '-' {
            gap = true;
        } else {
            if gap {
                a.push('_');
            }
            gap = false;
            a.push(c);
        }
    }
    if gap {
        a.push('_');
    }
    if let Some(rest) = a.strip_prefix("other:") {
        return format!("other:{}", rest.chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_').collect::<String>());
    }
    synonym(&a).map(str::to_string).unwrap_or(a)
}

pub fn valid_attribute(a: &str) -> bool {
    ATTRIBUTES.contains(&a) || (a.starts_with("other:") && a.len() > 6)
}

/// A value as compared: lower case, links as their target, spacing, a leading article and
/// trailing punctuation gone.
pub fn normalise_value(v: &str) -> String {
    let k = lint_key(v);
    let k = WIKILINK.replace_all(k.trim(), "$1");
    let k = k.split_whitespace().collect::<Vec<_>>().join(" ");
    let k = ["the ", "a ", "an "].iter().find_map(|p| k.strip_prefix(p)).map(str::to_string).unwrap_or(k);
    k.trim_matches(|c: char| " .,;:'\"".contains(c)).to_string()
}

/// YYYY, YYYY-MM or YYYY-MM-DD as a date (the middle of a partial period).
pub fn parse_as_of(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    let parts: Vec<&str> = s.split('-').collect();
    let num = |p: &str, n: usize| p.len() == n && p.chars().all(|c| c.is_ascii_digit());
    match parts.as_slice() {
        [y] if num(y, 4) => NaiveDate::from_ymd_opt(y.parse().ok()?, 7, 1),
        [y, m] if num(y, 4) && num(m, 2) => NaiveDate::from_ymd_opt(y.parse().ok()?, m.parse().ok()?, 15),
        [y, m, d] if num(y, 4) && num(m, 2) && num(d, 2) => NaiveDate::from_ymd_opt(y.parse().ok()?, m.parse().ok()?, d.parse().ok()?),
        _ => None,
    }
}

/// A quote or page as words: link targets dropped for the text shown, and anything but letters
/// and digits a gap.
fn quote_words(s: &str) -> Vec<String> {
    let k = lint_key(s);
    let shown = regex::Regex::new(r"\[\[[^\]|]*\|([^\]]*)\]\]").unwrap();
    let k = shown.replace_all(&k, "$1");
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in k.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            cur.push(c);
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Whether a claim's quote is in its page: word for word, or 80% of its words within a window
/// twice its length (extractors paraphrase a word or two).
pub fn quote_found(quote: &str, page: &str) -> bool {
    let q = quote_words(quote);
    if q.is_empty() {
        return false;
    }
    let text = quote_words(page);
    if format!(" {} ", text.join(" ")).contains(&format!(" {} ", q.join(" "))) || text.join(" ").contains(&q.join(" ")) {
        return true;
    }
    let need = (q.len() * 8).div_ceil(10);
    let mut want: HashMap<&str, usize> = HashMap::new();
    for w in &q {
        *want.entry(w).or_default() += 1;
    }
    let span = 2 * q.len();
    for (i, w) in text.iter().enumerate() {
        if !want.contains_key(w.as_str()) {
            continue;
        }
        let mut have: HashMap<&str, usize> = HashMap::new();
        for t in &text[i..(i + span).min(text.len())] {
            *have.entry(t.as_str()).or_default() += 1;
        }
        let got: usize = want.iter().map(|(t, n)| (*n).min(have.get(t).copied().unwrap_or(0))).sum();
        if got >= need {
            return true;
        }
    }
    false
}

/// One checkable fact a page states.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claim {
    #[serde(default)]
    pub page: String,
    pub subject: String,
    pub attribute: String,
    pub value: String,
    #[serde(default)]
    pub as_of: String,
    #[serde(default)]
    pub quote: String,
}

/// A raw claim checked against its page; Err says why it's refused.
pub fn validate(raw: &Claim, page_text: &str) -> Result<Claim, String> {
    let subject = raw.subject.trim();
    let value = raw.value.trim();
    if subject.is_empty() || value.is_empty() {
        return Err("subject and value are required".into());
    }
    let attr = normalise_attribute(&raw.attribute);
    if !valid_attribute(&attr) {
        return Err(format!("attribute {:?} not in the list (use other:<snake_case>)", raw.attribute));
    }
    let as_of = raw.as_of.trim();
    if !as_of.is_empty() && parse_as_of(as_of).is_none() {
        return Err(format!("as_of {as_of:?} is not YYYY, YYYY-MM or YYYY-MM-DD"));
    }
    let quote = raw.quote.trim();
    if !quote_found(quote, page_text) {
        return Err(format!("quote {:?} is not in {}", quote.chars().take(60).collect::<String>(), raw.page));
    }
    Ok(Claim {
        page: raw.page.clone(),
        subject: subject.into(),
        attribute: attr,
        value: value.chars().take(200).collect(),
        as_of: as_of.into(),
        quote: quote.chars().take(QUOTE_MAX).collect(),
    })
}

/// The cache key for a page's claims: the extractor's version, its path and its text.
pub fn page_hash(rel: &str, text: &str) -> String {
    hex::encode(Sha256::digest(format!("{EXTRACTOR_VERSION}\n{rel}\n{text}").as_bytes()))[..16].to_string()
}

/// `key(name or alias)` → page name. An alias two pages claim is dropped, never guessed: an
/// unresolved subject groups under its own spelling, a wrongly resolved one invents a clash.
pub fn name_index(pages: &[(String, Vec<String>)]) -> HashMap<String, String> {
    let mut index: HashMap<String, String> = HashMap::new();
    for (rel, _) in pages {
        let stem = crate::lint::stem(crate::lint::name_of(rel)).to_string();
        index.insert(lint_key(&stem), stem);
    }
    let mut contested: HashSet<String> = HashSet::new();
    for (rel, aliases) in pages {
        let stem = crate::lint::stem(crate::lint::name_of(rel)).to_string();
        for a in aliases {
            let k = lint_key(a);
            match index.get(&k) {
                Some(other) if *other != stem => {
                    if k != lint_key(other) {
                        contested.insert(k);
                    }
                }
                _ => {
                    index.insert(k, stem.clone());
                }
            }
        }
    }
    for k in contested {
        index.remove(&k);
    }
    index
}

pub fn resolve_subject(subject: &str, index: &HashMap<String, String>) -> String {
    let s = subject.trim();
    let s = WIKILINK.captures(s).map(|c| c[1].to_string()).unwrap_or_else(|| s.to_string());
    index.get(&lint_key(s.trim())).cloned().unwrap_or_else(|| s.trim().to_string())
}

/// A claim as grouped: with the date it held (its own, else its page's `updated:`).
#[derive(Debug, Clone)]
pub struct Dated {
    pub claim: Claim,
    pub date: Option<NaiveDate>,
}

/// A claim in a group: with its subject resolved and its value normalised.
type Member = (Dated, String, String);

/// Claims about one subject and attribute that disagree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clash {
    pub id: String,
    pub subject: String,
    pub attribute: String,
    pub claims: Vec<ClashClaim>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClashClaim {
    pub page: String,
    pub value: String,
    pub as_of: String,
    pub quote: String,
}

/// Stable while the evidence is unchanged; new when a page, value or quote changes.
pub fn clash_id(subject: &str, attribute: &str, claims: &[ClashClaim]) -> String {
    let mut evidence: Vec<String> =
        claims.iter().map(|c| format!("{}|{}|{}", c.page, normalise_value(&c.value), quote_words(&c.quote).join(" "))).collect();
    evidence.sort();
    let raw = [lint_key(subject), attribute.to_string()].into_iter().chain(evidence).collect::<Vec<_>>().join("\n");
    hex::encode(Sha256::digest(raw.as_bytes()))[..10].to_string()
}

/// The groups whose values disagree within `window` days of each other (undated claims always
/// compare): two pages giving different roles for June is one of them wrong; March and
/// September is history.
pub fn find_clashes(claims: &[Dated], index: &HashMap<String, String>, window: i64) -> Vec<Clash> {
    let mut groups: BTreeMap<(String, String), Vec<Member>> = BTreeMap::new();
    for d in claims {
        let subject = resolve_subject(&d.claim.subject, index);
        let norm = normalise_value(&d.claim.value);
        if norm.is_empty() {
            continue;
        }
        groups.entry((lint_key(&subject), d.claim.attribute.clone())).or_default().push((d.clone(), subject, norm));
    }
    let mut out = Vec::new();
    for ((_, attribute), members) in groups {
        if members.iter().map(|m| &m.2).collect::<HashSet<_>>().len() < 2 {
            continue;
        }
        let mut involved: Vec<usize> = Vec::new();
        for i in 0..members.len() {
            for j in i + 1..members.len() {
                let (a, b) = (&members[i], &members[j]);
                if a.2 == b.2 {
                    continue;
                }
                if let (Some(x), Some(y)) = (a.0.date, b.0.date) {
                    if (x - y).num_days().abs() > window {
                        continue;
                    }
                }
                involved.push(i);
                involved.push(j);
            }
        }
        if involved.is_empty() {
            continue;
        }
        involved.sort();
        involved.dedup();
        let mut seen = HashSet::new();
        let mut kept = Vec::new();
        for i in involved {
            let (d, _, norm) = &members[i];
            if !seen.insert((d.claim.page.clone(), norm.clone(), d.claim.as_of.clone())) {
                continue;
            }
            let as_of = if !d.claim.as_of.is_empty() {
                d.claim.as_of.clone()
            } else {
                d.date.map(|x| format!("{x} (page updated)")).unwrap_or_default()
            };
            kept.push(ClashClaim { page: d.claim.page.clone(), value: d.claim.value.clone(), as_of, quote: d.claim.quote.clone() });
        }
        let subject = members[0].1.clone();
        out.push(Clash { id: clash_id(&subject, &attribute, &kept), subject, attribute, claims: kept });
    }
    out.sort_by(|a, b| (lint_key(&a.subject), &a.attribute).cmp(&(lint_key(&b.subject), &b.attribute)));
    out
}

/// What a judge decides about a clash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub id: String,
    /// contradiction, evolution, compatible or unclear; resolved or ignored when the user says so.
    pub verdict: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub summary: String,
    /// The page that's right, when known.
    #[serde(default)]
    pub correct: String,
    /// The edit that would resolve it, in words.
    #[serde(default)]
    pub fix: String,
    /// The edit itself, as an agent change: on a wiki page, exact text to find and its
    /// replacement.
    #[serde(default)]
    pub patch: Option<FixPatch>,
    #[serde(default)]
    pub judged: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixPatch {
    pub page: String,
    pub find: String,
    pub replace: String,
}

/// The clashes whose fix has been made: a contradiction change for the clash (its origin's `chat`
/// is the clash id) that's applied now. Reverted or held, it's open again.
pub fn fixed(changes: &[crate::changes::Change]) -> HashSet<String> {
    changes
        .iter()
        .filter(|c| c.origin.kind == "contradiction" && c.status == crate::changes::Status::Applied)
        .filter_map(|c| c.origin.chat.clone())
        .collect()
}

/// The open contradictions a page is part of: judged a contradiction and not fixed since.
pub fn open_on<'a>(page: &str, clashes: &'a [Clash], verdicts: &HashMap<String, Verdict>, fixed: &HashSet<String>) -> Vec<&'a Clash> {
    clashes
        .iter()
        .filter(|x| x.claims.iter().any(|c| c.page == page))
        .filter(|x| verdicts.get(&x.id).is_some_and(|v| v.verdict == "contradiction") && !fixed.contains(&x.id))
        .collect()
}

pub const VERDICTS: [&str; 4] = ["contradiction", "evolution", "compatible", "unclear"];

/// A judge's verdict checked: a known clash, a verdict from the list, a severity for a
/// contradiction, and a fix only on a wiki page in the clash.
pub fn check_verdict(mut v: Verdict, clashes: &HashMap<String, Clash>, today: &str) -> Result<Verdict, String> {
    let c = clashes.get(&v.id).ok_or_else(|| format!("unknown clash id {}", v.id))?;
    if !VERDICTS.contains(&v.verdict.as_str()) {
        return Err(format!("verdict must be one of {}", VERDICTS.join(", ")));
    }
    if v.verdict == "contradiction" && !["high", "medium", "low"].contains(&v.severity.as_str()) {
        return Err("a contradiction needs severity high, medium or low".into());
    }
    if let Some(p) = &v.patch {
        if !p.page.starts_with("wiki/") || !c.claims.iter().any(|x| x.page == p.page) || p.find.trim().is_empty() {
            v.patch = None;
        }
    }
    v.judged = today.to_string();
    Ok(v)
}

/// The app data folder's contradiction state: `claims/<hash>.json` per page, `clashes.json`, and
/// `verdicts.jsonl` (the latest line for an id wins).
pub struct State {
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cached {
    pub page: String,
    pub claims: Vec<Claim>,
}

impl State {
    pub fn new(data: &Path) -> Self {
        State { dir: data.join("contradictions") }
    }
    fn claims_file(&self, hash: &str) -> PathBuf {
        self.dir.join("claims").join(format!("{hash}.json"))
    }
    pub fn cached(&self, rel: &str, text: &str) -> Option<Cached> {
        std::fs::read(self.claims_file(&page_hash(rel, text))).ok().and_then(|b| serde_json::from_slice(&b).ok())
    }
    pub fn cache(&self, rel: &str, text: &str, claims: Vec<Claim>) -> Result<(), String> {
        let p = self.claims_file(&page_hash(rel, text));
        std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
        let j = serde_json::to_vec(&Cached { page: rel.into(), claims }).map_err(|e| e.to_string())?;
        crate::write::write_atomic(&p, &j, false).map_err(|e| e.to_string())
    }
    pub fn verdicts(&self) -> HashMap<String, Verdict> {
        let mut out = HashMap::new();
        if let Ok(t) = std::fs::read_to_string(self.dir.join("verdicts.jsonl")) {
            for l in t.lines().filter(|l| !l.trim().is_empty()) {
                if let Ok(v) = serde_json::from_str::<Verdict>(l) {
                    out.insert(v.id.clone(), v);
                }
            }
        }
        out
    }
    pub fn add_verdict(&self, v: &Verdict) -> Result<(), String> {
        use std::io::Write;
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut f =
            std::fs::OpenOptions::new().create(true).append(true).open(self.dir.join("verdicts.jsonl")).map_err(|e| e.to_string())?;
        writeln!(f, "{}", serde_json::to_string(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }
}

/// The wiki pages checked, with their text and aliases.
pub fn pages(root: &Path) -> Vec<(String, String, Vec<String>)> {
    let mut out = Vec::new();
    for sub in crate::lint::WIKI_SUBDIRS {
        let Ok(rd) = std::fs::read_dir(root.join("wiki").join(sub)) else { continue };
        let mut names: Vec<String> =
            rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".md")).collect();
        names.sort();
        for n in names {
            let rel = format!("wiki/{sub}/{n}");
            let text = std::fs::read(root.join(&rel)).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let fm = crate::frontmatter::split(&text);
            let aliases = crate::frontmatter::list(&fm.data, &["aliases"], false);
            out.push((rel, text, aliases));
        }
    }
    out
}

/// Every cached claim for the pages as they are now, dated, and the pages not read yet.
pub fn current(state: &State, pages: &[(String, String, Vec<String>)]) -> (Vec<Dated>, Vec<String>) {
    let mut claims = Vec::new();
    let mut missing = Vec::new();
    for (rel, text, _) in pages {
        let Some(c) = state.cached(rel, text) else {
            missing.push(rel.clone());
            continue;
        };
        let updated = parse_as_of(fm_field(frontmatter_block(text), "updated"));
        for mut cl in c.claims {
            cl.page = rel.clone();
            let date = parse_as_of(&cl.as_of).or(updated);
            claims.push(Dated { claim: cl, date });
        }
    }
    (claims, missing)
}

/// Batches of pages to extract, about `words` words each, at most `max` pages.
pub fn batches(missing: &[String], texts: &HashMap<String, String>, words: usize, max: usize) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    let mut n = 0;
    for p in missing {
        let w = texts.get(p).map_or(0, |t| t.split_whitespace().count());
        if !cur.is_empty() && (n + w > words || cur.len() >= max) {
            out.push(std::mem::take(&mut cur));
            n = 0;
        }
        cur.push(p.clone());
        n += w;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// The extraction prompt for a batch: the subjects known, then each page.
pub fn extract_prompt(batch: &[String], texts: &HashMap<String, String>, pages: &[(String, String, Vec<String>)]) -> String {
    let mut names = String::new();
    for (rel, _, aliases) in pages {
        let stem = crate::lint::stem(crate::lint::name_of(rel));
        if aliases.is_empty() {
            names.push_str(&format!("{stem}\n"));
        } else {
            names.push_str(&format!("{stem} | {}\n", aliases.join(", ")));
        }
    }
    let mut out = format!("{}\n\n# Known subjects (page name | aliases)\n\n{names}\n# The pages\n\n", EXTRACT.trim());
    for p in batch {
        out.push_str(&format!("## {p}\n\n{}\n\n", texts.get(p).map(String::as_str).unwrap_or("")));
    }
    out
}

/// The judging prompt for some clashes.
pub fn judge_prompt(clashes: &[Clash]) -> String {
    let mut out = format!("{}\n\n# The clashes\n\n", JUDGE.trim());
    for c in clashes {
        out.push_str(&format!("## {} — {} · {}\n\n", c.id, c.subject, c.attribute));
        for x in &c.claims {
            out.push_str(&format!(
                "- {} says “{}” (as of {}): “{}”\n",
                x.page,
                x.value,
                if x.as_of.is_empty() { "no date" } else { &x.as_of },
                x.quote
            ));
        }
        out.push('\n');
    }
    out
}

pub const EXTRACT: &str = include_str!("../workflows/contradictions-extract.md");
pub const JUDGE: &str = include_str!("../workflows/contradictions-judge.md");

/// JSON objects in an answer: a JSON array, or one object per line.
pub fn parse_lines<T: for<'de> Deserialize<'de>>(text: &str) -> Vec<T> {
    parse_answer_lines(text).unwrap_or_default()
}

/// Like `parse_lines`, but None when the answer holds no JSON at all (a refusal, an error, garbled
/// output), as against an empty array: a page read that way isn't known to have no claims.
pub fn parse_answer_lines<T: for<'de> Deserialize<'de>>(text: &str) -> Option<Vec<T>> {
    let t = text.trim();
    if let (Some(a), Some(b)) = (t.find('['), t.rfind(']')) {
        if let Ok(v) = serde_json::from_str::<Vec<T>>(&t[a..=b]) {
            return Some(v);
        }
    }
    let v: Vec<T> = t.lines().filter_map(|l| serde_json::from_str::<T>(l.trim().trim_end_matches(',')).ok()).collect();
    (!v.is_empty()).then_some(v)
}

/// Claims on a wiki page whose line has no citation: neither a link nor a `sources:` entry it
/// could rest on. Found where the quote's first words are.
pub fn uncited(claims: &[Dated], texts: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for d in claims {
        let Some(text) = texts.get(&d.claim.page) else { continue };
        let words = quote_words(&d.claim.quote);
        if words.is_empty() {
            continue;
        }
        let head = words.iter().take(4).cloned().collect::<Vec<_>>().join(" ");
        let line = crate::lint::body(text).lines().find(|l| quote_words(l).join(" ").contains(&head));
        if let Some(l) = line {
            if !l.contains("[[") && !l.contains("](") {
                out.push((d.claim.page.clone(), l.trim().chars().take(160).collect()));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fixed_contradiction_is_no_longer_open() {
        use crate::changes::{Change, Instruction, Status};
        use crate::proposals::{Kind, Origin};
        let claim = |page: &str| ClashClaim { page: page.into(), value: "x".into(), as_of: String::new(), quote: "q".into() };
        let clash = Clash {
            id: "c1".into(),
            subject: "Orbit App".into(),
            attribute: "owner".into(),
            claims: vec![claim("wiki/a.md"), claim("wiki/b.md")],
        };
        let verdicts: HashMap<String, Verdict> = [(
            "c1".to_string(),
            Verdict {
                id: "c1".into(),
                verdict: "contradiction".into(),
                severity: "high".into(),
                summary: String::new(),
                correct: String::new(),
                fix: String::new(),
                patch: None,
                judged: String::new(),
            },
        )]
        .into();
        let all = [clash];
        let fix = |status| {
            let origin = Origin { kind: "contradiction".into(), chat: Some("c1".into()), ..Default::default() };
            let mut c = Change::new("wiki/a.md", Kind::Edit, "Owner", "", origin, None, Instruction::Page { content: "y".into() });
            c.status = status;
            c
        };
        assert_eq!(open_on("wiki/b.md", &all, &verdicts, &fixed(&[])).len(), 1);
        assert!(open_on("wiki/c.md", &all, &verdicts, &fixed(&[])).is_empty());
        // Applied: closed for both pages. Held or reverted: still open.
        assert!(open_on("wiki/b.md", &all, &verdicts, &fixed(&[fix(Status::Applied)])).is_empty());
        assert_eq!(open_on("wiki/a.md", &all, &verdicts, &fixed(&[fix(Status::Held), fix(Status::Reverted)])).len(), 1);
    }

    #[test]
    fn matches_contradictions_py() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/contradictions");
        let cases: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("cases.json")).unwrap()).unwrap();
        let want: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
        for (i, a) in cases["attributes"].as_array().unwrap().iter().enumerate() {
            assert_eq!(normalise_attribute(a.as_str().unwrap()), want["attributes"][i], "{a}");
        }
        for (i, v) in cases["values"].as_array().unwrap().iter().enumerate() {
            assert_eq!(normalise_value(v.as_str().unwrap()), want["values"][i], "{v}");
        }
        for (i, q) in cases["quotes"].as_array().unwrap().iter().enumerate() {
            assert_eq!(quote_found(q[0].as_str().unwrap(), q[1].as_str().unwrap()), want["quotes"][i], "{q}");
        }
        let pages: Vec<(String, Vec<String>)> = cases["pages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                (
                    p["path"].as_str().unwrap().to_string(),
                    p["aliases"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect(),
                )
            })
            .collect();
        let index = name_index(&pages);
        let claims: Vec<Dated> = cases["claims"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let claim: Claim = serde_json::from_value(c.clone()).unwrap();
                let date = parse_as_of(&claim.as_of).or_else(|| c["updated"].as_str().and_then(parse_as_of));
                Dated { claim: Claim { attribute: normalise_attribute(&claim.attribute), ..claim }, date }
            })
            .collect();
        let got: Vec<serde_json::Value> = find_clashes(&claims, &index, WINDOW_DAYS)
            .into_iter()
            .map(|c| serde_json::json!({"subject": c.subject, "attribute": c.attribute, "claims": c.claims.iter().map(|x| serde_json::json!({"page": x.page, "value": x.value, "as_of": x.as_of, "quote": x.quote})).collect::<Vec<_>>()}))
            .collect();
        assert_eq!(serde_json::Value::Array(got), want["clashes"]);
    }

    #[test]
    fn verdicts_are_checked() {
        let c = Clash {
            id: "abc".into(),
            subject: "Orbit App".into(),
            attribute: "go_live_date".into(),
            claims: vec![ClashClaim {
                page: "wiki/entities/Orbit App.md".into(),
                value: "14 November".into(),
                as_of: String::new(),
                quote: "q".into(),
            }],
        };
        let known = HashMap::from([("abc".to_string(), c)]);
        let v = |verdict: &str, severity: &str| Verdict {
            id: "abc".into(),
            verdict: verdict.into(),
            severity: severity.into(),
            summary: String::new(),
            correct: String::new(),
            fix: String::new(),
            patch: Some(FixPatch { page: "Meeting. X.md".into(), find: "a".into(), replace: "b".into() }),
            judged: String::new(),
        };
        assert!(check_verdict(v("contradiction", ""), &known, "2026-10-02").unwrap_err().contains("severity"));
        assert!(check_verdict(v("maybe", ""), &known, "2026-10-02").is_err());
        // A fix outside the wiki, or on a page not in the clash, is left out.
        let ok = check_verdict(v("contradiction", "high"), &known, "2026-10-02").unwrap();
        assert_eq!(ok.patch, None);
        assert_eq!(ok.judged, "2026-10-02");
    }

    #[test]
    fn answers_as_lines_or_arrays() {
        assert_eq!(parse_answer_lines::<Claim>("[]"), Some(vec![]));
        assert_eq!(parse_answer_lines::<Claim>("```json\n[]\n```"), Some(vec![]));
        assert_eq!(parse_answer_lines::<Claim>("I can't help with that [policy]."), None);
        assert_eq!(parse_answer_lines::<Claim>(""), None);
        let a: Vec<Claim> = parse_lines("[{\"subject\":\"A\",\"attribute\":\"role\",\"value\":\"x\"}]");
        assert_eq!(a.len(), 1);
        let b: Vec<Claim> = parse_lines("{\"subject\":\"A\",\"attribute\":\"role\",\"value\":\"x\"}\nnot json\n{\"subject\":\"B\",\"attribute\":\"team\",\"value\":\"y\"},");
        assert_eq!(b.len(), 2);
    }

    #[test]
    fn batching() {
        let texts =
            HashMap::from([("a".to_string(), "w ".repeat(20)), ("b".to_string(), "w ".repeat(20)), ("c".to_string(), "w ".repeat(5))]);
        assert_eq!(
            batches(&["a".into(), "b".into(), "c".into()], &texts, 30, 30),
            vec![vec!["a".to_string()], vec!["b".to_string(), "c".to_string()]]
        );
    }

    #[test]
    fn uncited_lines() {
        let texts =
            HashMap::from([("p".to_string(), "---\nx: 1\n---\nLaunch is on 14 November.\nOwner is Maya ([[Steerco]]).\n".to_string())]);
        let d = |q: &str| Dated {
            claim: Claim {
                page: "p".into(),
                subject: "s".into(),
                attribute: "owner".into(),
                value: "v".into(),
                as_of: String::new(),
                quote: q.into(),
            },
            date: None,
        };
        assert_eq!(
            uncited(&[d("Launch is on 14 November"), d("Owner is Maya")], &texts),
            [("p".to_string(), "Launch is on 14 November.".to_string())]
        );
    }
}
