// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Names: the corrections for names a notetaker gets wrong (`substitutions.json` in the app data
//! folder, moved there from the vault's `scripts/` on 2026-10-03; read as the previous app's
//! `normalize.py` reads it, rules and guards included), which wiki pages a text mentions (`ingest_check.py` and
//! `find_unlinked_entities.py`, aliases added), and which page a name means (the MCP server's
//! `resolve_entity`). Nothing here writes: applying corrections gives new text for a proposal.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::index::Index;

/// The corrections file's name, in the app data folder.
pub const SUBSTITUTIONS: &str = "substitutions.json";
/// Where the vault kept them before: copied to the app data folder once (`migrate`).
pub const LEGACY: &str = "scripts/substitutions.json";
/// The name undo knows the file by: it's outside the vault.
pub const UNDO_NAME: &str = "@data/substitutions.json";

/// The corrections file in the app data folder `data`.
pub fn path(data: &Path) -> PathBuf {
    data.join(SUBSTITUTIONS)
}

/// Copies the vault's old `scripts/substitutions.json` into the app data folder when there's none
/// there yet; the old file is left where it is. Whether it copied.
pub fn migrate(data: &Path, vault: &Path) -> std::io::Result<bool> {
    let (to, from) = (path(data), vault.join(LEGACY));
    if to.exists() || !from.is_file() {
        return Ok(false);
    }
    std::fs::create_dir_all(data)?;
    std::fs::copy(&from, &to)?;
    Ok(true)
}

fn one_or_many<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum V {
        One(String),
        Many(Vec<String>),
        None,
    }
    Ok(match Option::<V>::deserialize(d)? {
        Some(V::One(s)) => vec![s],
        Some(V::Many(v)) => v,
        _ => vec![],
    })
}

/// One correction: `wrong` becomes `right`, unless a guard says this file or occurrence is
/// somebody else's.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Substitution {
    pub wrong: String,
    pub right: String,
    /// Each occurrence is confirmed rather than swept.
    #[serde(default)]
    pub ambiguous: bool,
    /// Where the correction came from ("confirmed 2026-08-18 via a 1-1").
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// Skipped for a file whose name holds one of these (case ignored).
    #[serde(default, deserialize_with = "one_or_many", skip_serializing_if = "Vec::is_empty")]
    pub skip_if_filename_contains: Vec<String>,
    /// Skipped for a file whose text holds one of these (case ignored).
    #[serde(default, deserialize_with = "one_or_many", skip_serializing_if = "Vec::is_empty")]
    pub skip_if_body_contains: Vec<String>,
    /// An occurrence straight after one of these (exact) is left alone.
    #[serde(default, deserialize_with = "one_or_many", skip_serializing_if = "Vec::is_empty")]
    pub skip_if_preceded_by: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct File {
    #[serde(default)]
    pub substitutions: Vec<Substitution>,
}

/// The corrections in `file` (`path(data)`); none when there's no file (or it doesn't read).
pub fn load(file: &Path) -> Vec<Substitution> {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice::<File>(&b).ok()).map(|f| f.substitutions).unwrap_or_default()
}

fn word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Python's `\b` at byte `i`: a word character on one side and not on the other.
fn boundary(text: &str, i: usize) -> bool {
    let before = text[..i].chars().next_back().is_some_and(word);
    let after = text[i..].chars().next().is_some_and(word);
    before != after
}

/// Where `s` matches in `text`, as normalize.py's pattern finds them: whole words, not straight
/// after a `skip_if_preceded_by`, and, when `right` is `wrong` plus a surname, not already
/// followed by one.
fn matches(text: &str, s: &Substitution) -> Vec<std::ops::Range<usize>> {
    if s.wrong.is_empty() {
        return vec![];
    }
    let extends = s.right.starts_with(&format!("{} ", s.wrong));
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(off) = text[from..].find(&s.wrong) {
        let i = from + off;
        let j = i + s.wrong.len();
        let ok = boundary(text, i)
            && boundary(text, j)
            && !s.skip_if_preceded_by.iter().any(|m| text[..i].ends_with(m.as_str()))
            && !(extends && followed_by_name(&text[j..]));
        if ok {
            out.push(i..j);
            from = j;
        } else {
            from = i + text[i..].chars().next().map_or(1, char::len_utf8);
        }
    }
    out
}

/// `\s+[A-Z]`.
fn followed_by_name(rest: &str) -> bool {
    let t = rest.trim_start();
    t.len() < rest.len() && t.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

fn replace(text: &str, ranges: &[std::ops::Range<usize>], with: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for r in ranges {
        out.push_str(&text[last..r.start]);
        out.push_str(with);
        last = r.end;
    }
    out.push_str(&text[last..]);
    out
}

/// What a correction did to a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub wrong: String,
    pub right: String,
    /// Occurrences changed.
    pub count: usize,
    /// It was ambiguous and confirmed.
    pub confirmed: bool,
}

/// An ambiguous occurrence to confirm: which correction, and the line (from 0) as it reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub sub: usize,
    pub line: usize,
    pub text: String,
}

/// The file's text with the corrections applied in order, as `apply_substitutions` does: each
/// one sees what the ones before it made. An ambiguous one is put to `confirm` line by line
/// (every occurrence on a confirmed line changes); `filename` is the file's name for the guards.
pub fn apply(text: &str, subs: &[Substitution], filename: &str, mut confirm: impl FnMut(&Ask) -> bool) -> (String, Vec<Change>) {
    let mut text = text.to_string();
    let mut changes = Vec::new();
    let fname = filename.to_lowercase();
    for (k, s) in subs.iter().enumerate() {
        let lower = text.to_lowercase();
        if s.skip_if_filename_contains.iter().any(|m| !fname.is_empty() && fname.contains(&m.to_lowercase()))
            || s.skip_if_body_contains.iter().any(|m| !text.is_empty() && lower.contains(&m.to_lowercase()))
        {
            continue;
        }
        if !s.ambiguous {
            let r = matches(&text, s);
            if !r.is_empty() {
                text = replace(&text, &r, &s.right);
                changes.push(Change { wrong: s.wrong.clone(), right: s.right.clone(), count: r.len(), confirmed: false });
            }
            continue;
        }
        let mut accepted = 0;
        let mut out = String::with_capacity(text.len());
        for (i, line) in text.split_inclusive('\n').enumerate() {
            let r = matches(line, s);
            if !r.is_empty() && confirm(&Ask { sub: k, line: i, text: line.trim_end().to_string() }) {
                out.push_str(&replace(line, &r, &s.right));
                accepted += r.len();
            } else {
                out.push_str(line);
            }
        }
        text = out;
        if accepted > 0 {
            changes.push(Change { wrong: s.wrong.clone(), right: s.right.clone(), count: accepted, confirmed: true });
        }
    }
    (text, changes)
}

/// The ambiguous occurrences `apply` would ask about, with nothing confirmed.
pub fn questions(text: &str, subs: &[Substitution], filename: &str) -> Vec<Ask> {
    let mut asks = Vec::new();
    apply(text, subs, filename, |a| {
        asks.push(a.clone());
        false
    });
    asks
}

/// A wiki page a text mentions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub page: String,
    /// The name or alias found.
    pub name: String,
    /// The text links it already.
    pub linked: bool,
}

/// The wiki pages (entities, concepts and summaries) whose name of 4 characters or more, or an
/// alias of 2 or more, the text's body mentions as a whole word: by name case ignored, as
/// `ingest_check.py` does; by alias with its own case (a short alias like "OA" would otherwise
/// match "oa" in any word). `pages` is (path, aliases).
pub fn mentions(text: &str, pages: &[(String, Vec<String>)]) -> Vec<Mention> {
    let body = crate::lint::body(text);
    let linked: std::collections::HashSet<String> = crate::lint::WIKILINK.captures_iter(text).map(|c| c[1].trim().to_lowercase()).collect();
    let lower = body.to_lowercase();
    let mut out = Vec::new();
    for (path, aliases) in pages {
        let stem = crate::lint::stem(crate::lint::name_of(path)).to_string();
        let mut found: Option<String> = None;
        if stem.chars().count() >= 4 && whole_word(&lower, &stem.to_lowercase()) {
            found = Some(stem.clone());
        }
        if found.is_none() {
            found = aliases.iter().find(|a| a.chars().count() >= 2 && whole_word(body, a)).cloned();
        }
        if let Some(name) = found {
            let is_linked = linked.contains(&stem.to_lowercase()) || aliases.iter().any(|a| linked.contains(&a.to_lowercase()));
            out.push(Mention { page: path.clone(), name, linked: is_linked });
        }
    }
    out.sort_by(|a, b| a.page.cmp(&b.page));
    out
}

/// `(?<!\w)name(?!\w)`.
fn whole_word(hay: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    hay.match_indices(name)
        .any(|(i, _)| !hay[..i].chars().next_back().is_some_and(word) && !hay[i + name.len()..].chars().next().is_some_and(word))
}

/// A name with accents, case, spaces and punctuation taken out.
pub fn fold(s: &str) -> String {
    s.nfkd().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Which page a name means.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    /// The page, and how: "file name" or "alias".
    pub exact: Option<(String, &'static str)>,
    /// Otherwise the close ones, best first, with how alike (0–1).
    pub close: Vec<(String, f64)>,
}

/// By file name, then alias (the index's own link resolution), else the pages whose names are
/// alike once case, spaces and accents go (88% or more, Jaro–Winkler), templates left out.
pub fn resolve(ix: &Index, name: &str) -> crate::index::Result<Resolution> {
    if let Some(rel) = ix.resolve(&[name.to_string()])?.into_iter().next().flatten() {
        let how = if crate::links::key(crate::filename::stem(&rel)) == crate::links::key(name) { "file name" } else { "alias" };
        return Ok(Resolution { exact: Some((rel, how)), close: vec![] });
    }
    let want = fold(name);
    let mut close: Vec<(String, f64)> = ix
        .list(None)?
        .into_iter()
        .filter(|f| f.layer != "template")
        .filter_map(|f| {
            let n = fold(crate::filename::stem(&f.path));
            let s = if n == want { 1.0 } else { strsim::jaro_winkler(&n, &want) };
            (s >= 0.88).then_some((f.path, s))
        })
        .collect();
    close.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    close.truncate(5);
    Ok(Resolution { exact: None, close })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_from_the_vault_once() {
        let t = tempfile::tempdir().unwrap();
        let (data, vault) = (t.path().join("data"), t.path().join("vault"));
        std::fs::create_dir_all(vault.join("scripts")).unwrap();
        assert!(!migrate(&data, &vault).unwrap(), "nothing to move");
        std::fs::write(vault.join(LEGACY), r#"{"substitutions": [{"wrong": "Zarah", "right": "Zara"}]}"#).unwrap();
        assert!(migrate(&data, &vault).unwrap());
        assert_eq!(load(&path(&data))[0].right, "Zara");
        assert!(vault.join(LEGACY).exists(), "the old file stays");
        std::fs::write(path(&data), r#"{"substitutions": []}"#).unwrap();
        assert!(!migrate(&data, &vault).unwrap(), "once only");
        assert!(load(&path(&data)).is_empty());
    }

    /// The cases in `tests/fixtures/names/cases.json`, run through normalize.py by
    /// `tests/fixtures/names/freeze.py`: everything confirmed, and nothing confirmed.
    #[test]
    fn matches_normalize_py() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/names");
        let cases: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("cases.json")).unwrap()).unwrap();
        let want: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
        let subs: Vec<Substitution> = serde_json::from_value(cases["substitutions"].clone()).unwrap();
        for c in cases["files"].as_array().unwrap() {
            let (name, text) = (c["name"].as_str().unwrap(), c["text"].as_str().unwrap());
            for (mode, yes) in [("yes", true), ("no", false)] {
                let (got, changes) = apply(text, &subs, name, |_| yes);
                let w = &want[name][mode];
                assert_eq!(got, w["text"].as_str().unwrap(), "{name} {mode}");
                let counts: Vec<(String, String, usize)> = changes.iter().map(|c| (c.wrong.clone(), c.right.clone(), c.count)).collect();
                let wc: Vec<(String, String, usize)> = w["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| (x[0].as_str().unwrap().into(), x[1].as_str().unwrap().into(), x[2].as_u64().unwrap() as usize))
                    .collect();
                assert_eq!(counts, wc, "{name} {mode}");
            }
        }
    }

    #[test]
    fn questions_list_ambiguous_lines() {
        let subs = vec![Substitution { wrong: "Zarah".into(), right: "Zara".into(), ambiguous: true, ..Default::default() }];
        let q = questions("Zarah said hi.\nNothing.\nAsk Zarah and Zarah.\n", &subs, "x.md");
        assert_eq!(q.iter().map(|a| a.line).collect::<Vec<_>>(), [0, 2]);
        // Confirming the third line changes both there.
        let (t, _) = apply("Zarah said hi.\nNothing.\nAsk Zarah and Zarah.\n", &subs, "x.md", |a| a.line == 2);
        assert_eq!(t, "Zarah said hi.\nNothing.\nAsk Zara and Zara.\n");
    }

    #[test]
    fn mentions_by_name_and_alias() {
        let pages = vec![
            ("wiki/entities/Orbit App.md".to_string(), vec!["OA".to_string()]),
            ("wiki/concepts/Hub Platform.md".to_string(), vec![]),
            ("wiki/entities/Sam Carter.md".to_string(), vec![]),
            ("wiki/entities/Ops.md".to_string(), vec![]),
        ];
        let m = mentions("---\nname: Hub Platform\n---\nThe orbit app and OA, see [[Sam Carter]]. OAuth and ops.\n", &pages);
        let got: Vec<(&str, &str, bool)> = m.iter().map(|m| (m.page.as_str(), m.name.as_str(), m.linked)).collect();
        assert_eq!(got, [("wiki/entities/Orbit App.md", "Orbit App", false), ("wiki/entities/Sam Carter.md", "Sam Carter", true)]);
    }
}
