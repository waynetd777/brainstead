// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The vault's own lists, read the way the previous app reads them: bookmarks (`Me. Bookmarks.md`,
//! bff/src/services/bookmarks.ts), saved searches (`Me. Smart Lists.md`, services/smart-lists.ts)
//! and which sources a wiki page cites (services/wiki-index.ts).

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use rusqlite::OptionalExtension;

use crate::index::{Index, Result};
use crate::links::nfc;

fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}

pub const BOOKMARKS: &str = "Me. Bookmarks.md";
pub const SMART_LISTS: &str = "Me. Smart Lists.md";

static BOOKMARK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*[-*+]\s+)\\?\[\\?\[([^\]|]+?)(?:\|[^\]]*)?\\?\]\\?\](\s*)$").unwrap());
static SMART: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*[-*+]\s+\*\*(.+?)\*\*\s*[—–-]\s*`([^`]+)`(?:\s*·\s*`([^`]*)`)?\s*$").unwrap());
static CITE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]|#\n]+)").unwrap());

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    /// As written in the list.
    pub target: String,
    /// The file it opens, or None when nothing has that name (renamed or deleted).
    pub path: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartList {
    pub name: String,
    pub query: String,
    /// "note", "wiki", "source"; empty means all.
    pub layers: Vec<String>,
}

/// Only lines that are a single wikilink count; the order is the file's.
pub fn parse_bookmarks(text: &str) -> Vec<String> {
    text.lines().filter_map(|l| BOOKMARK.captures(l).map(|c| nfc(c[2].trim()))).collect()
}

/// The bookmarks note with `target` bookmarked, or with its bookmark taken out when it's there.
/// A new one goes after the last bookmark line, in the same list style. Returns the text and
/// whether it's bookmarked now.
pub fn toggle_bookmark(text: &str, target: &str) -> (String, bool) {
    let (mut lines, eol, trailing) = crate::write::split_lines(text);
    let want = crate::links::key(target);
    if let Some(i) = lines.iter().position(|l| BOOKMARK.captures(l).is_some_and(|c| crate::links::key(c[2].trim()) == want)) {
        lines.remove(i);
        return (crate::write::join_lines(&lines, &eol, trailing), false);
    }
    let last = lines.iter().rposition(|l| BOOKMARK.is_match(l));
    let bullet = last.and_then(|i| BOOKMARK.captures(&lines[i]).map(|c| c[1].to_string())).unwrap_or_else(|| "* ".into());
    let item = format!("{bullet}[[{target}]]");
    match last {
        Some(i) => lines.insert(i + 1, item),
        None => {
            while lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.pop();
            }
            if !lines.is_empty() {
                lines.push(String::new());
            }
            lines.push(item);
        }
    }
    (crate::write::join_lines(&lines, &eol, trailing || text.is_empty()), true)
}

/// The smart lists note with a saved search added after the last one: `- **name** — `query``,
/// with ` · `layers`` when it's for some layers only. Refuses a name that's taken.
pub fn add_smart_list(text: &str, name: &str, query: &str, layers: &[String]) -> Result<String> {
    let name = name.trim();
    let query = query.trim();
    if name.is_empty() || query.is_empty() || name.contains("**") || query.contains('`') {
        return Err("A saved search needs a name and a query (no backticks).".into());
    }
    if parse_smart_lists(text).iter().any(|l| l.name.eq_ignore_ascii_case(name)) {
        return Err(format!("There's a saved search called {name} already."));
    }
    let (mut lines, eol, trailing) = crate::write::split_lines(text);
    let mut item = format!("- **{name}** — `{query}`");
    if !layers.is_empty() && layers.len() < 3 {
        item.push_str(&format!(" · `{}`", layers.join(",")));
    }
    match lines.iter().rposition(|l| SMART.is_match(l)) {
        Some(i) => lines.insert(i + 1, item),
        None => {
            while lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.pop();
            }
            if !lines.is_empty() {
                lines.push(String::new());
            }
            lines.push(item);
        }
    }
    Ok(crate::write::join_lines(&lines, &eol, trailing || text.is_empty()))
}

pub fn parse_smart_lists(text: &str) -> Vec<SmartList> {
    text.lines()
        .filter_map(|l| {
            let c = SMART.captures(l)?;
            let layers: Vec<String> = c
                .get(3)
                .map(|m| {
                    m.as_str()
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| ["wiki", "note", "source"].contains(&s.as_str()))
                        .collect()
                })
                .unwrap_or_default();
            // All three is the same as none.
            let layers = if layers.len() == 3 { vec![] } else { layers };
            Some(SmartList { name: c[1].trim().to_string(), query: c[2].trim().to_string(), layers })
        })
        .collect()
}

impl Index {
    fn path_exists(&self, p: &str) -> Result<bool> {
        self.conn().query_row("SELECT count(*) FROM files WHERE path = ?1", [p], |r| r.get::<_, i64>(0)).map(|n| n > 0).map_err(e)
    }

    /// A bookmark's file: `wiki/<target>`, then `sources/<target>`, then a note by its full path,
    /// then (for a bare name) a note of that name in any folder, the shortest path first. Failing
    /// those, the same lookup as a wikilink (a wiki title or an alias).
    pub fn resolve_bookmark(&self, target: &str) -> Result<Option<String>> {
        let exts = |base: &str| [format!("{base}.md"), format!("{base}.txt"), base.to_string()];
        for p in exts(&format!("wiki/{target}")) {
            if self.path_exists(&p)? {
                return Ok(Some(p));
            }
        }
        let src = if target.starts_with("sources/") { target.to_string() } else { format!("sources/{target}") };
        for p in exts(&src) {
            if self.path_exists(&p)? {
                return Ok(Some(p));
            }
        }
        for p in [format!("{target}.md"), format!("{target}.txt")] {
            if self.path_exists(&p)? {
                return Ok(Some(p));
            }
        }
        if !target.contains('/') {
            let hit: Option<String> = self
                .conn()
                .query_row(
                    "SELECT path FROM files WHERE layer = 'note' AND (path LIKE '%/' || ?1 || '.md' ESCAPE '\\' OR path LIKE '%/' || ?1 || '.txt' ESCAPE '\\') ORDER BY length(path) LIMIT 1",
                    // `_` and `%` in a name are themselves, not wildcards.
                    [crate::search::like_escape(target)],
                    |r| r.get(0),
                )
                .ok();
            if hit.is_some() {
                return Ok(hit);
            }
        }
        Ok(self.resolve(&[target.to_string()])?.pop().flatten())
    }

    pub fn bookmarks(&self, text: &str) -> Result<Vec<Bookmark>> {
        parse_bookmarks(text)
            .into_iter()
            .map(|t| {
                let path = self.resolve_bookmark(&t)?;
                let title = match &path {
                    Some(p) => self.summary(p)?.map(|s| s.title).unwrap_or_else(|| t.clone()),
                    None => t.rsplit('/').next().unwrap_or(&t).to_string(),
                };
                Ok(Bookmark { target: t, path, title })
            })
            .collect()
    }

    /// Names a wiki page's `sources:` property cites as `[[X]]`, lower-cased.
    fn cited_sources(&self) -> Result<HashSet<String>> {
        let mut st = self.conn().prepare("SELECT frontmatter FROM files WHERE layer = 'wiki' AND frontmatter IS NOT NULL").map_err(e)?;
        let mut out = HashSet::new();
        for fm in st.query_map([], |r| r.get::<_, String>(0)).map_err(e)? {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&fm.map_err(e)?) else { continue };
            let items: Vec<String> = match v.get("sources") {
                Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                Some(serde_json::Value::String(s)) => vec![s.clone()],
                _ => vec![],
            };
            for it in items {
                for c in CITE.captures_iter(&it) {
                    let name = c[1].trim();
                    out.insert(nfc(name.rsplit('/').next().unwrap_or(name)).to_lowercase());
                }
            }
        }
        Ok(out)
    }

    /// Whether each source is cited by a wiki page, by its file name with or without the
    /// extension (the previous app's ingested / pending).
    pub fn ingested(&self, paths: &[String]) -> Result<Vec<bool>> {
        let cited = self.cited_sources()?;
        Ok(paths
            .iter()
            .map(|p| {
                let base = nfc(p.rsplit('/').next().unwrap_or(p)).to_lowercase();
                let stem = base.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| base.clone());
                cited.contains(&base) || cited.contains(&stem)
            })
            .collect())
    }
}

/// A wiki page that cites a source: listed in its `sources:`, and the lines of its text that link to
/// the source (each a cited passage, with the heading in the source it points at).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Citer {
    pub path: String,
    pub title: String,
    /// Named in the page's `sources:`.
    pub listed: bool,
    pub passages: Vec<Passage>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    /// 0-based line in the citing page.
    pub line: i64,
    /// The heading (or `page=N`) in the source it points at.
    pub anchor: Option<String>,
    /// The line's text, filled from the file (`fill_passages`).
    pub context: String,
}

/// What the index knows of a source for its provenance pane.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFacts {
    pub sha256: String,
    pub size: i64,
    pub mtime: i64,
    /// Passages indexed for search.
    pub chunks: i64,
    pub citers: Vec<Citer>,
}

impl Index {
    /// The source at `path`: its hash, size, indexed passages, and the wiki pages citing it.
    pub fn source_facts(&self, path: &str) -> Result<Option<SourceFacts>> {
        let c = self.conn();
        let Some((id, sha256, size, mtime)) = c
            .query_row("SELECT id, sha256, coalesce(size, 0), coalesce(mtime, 0) FROM files WHERE path = ?1", [path], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))
            })
            .optional()
            .map_err(e)?
        else {
            return Ok(None);
        };
        let chunks: i64 = c.query_row("SELECT count(*) FROM chunks WHERE file_id = ?1", [id], |r| r.get(0)).map_err(e)?;
        let base = nfc(path.rsplit('/').next().unwrap_or(path)).to_lowercase();
        let stem = base.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| base.clone());
        let mut citers: Vec<Citer> = Vec::new();
        // Pages whose sources: name it.
        let mut st = c
            .prepare("SELECT path, coalesce(title, path), frontmatter FROM files WHERE layer = 'wiki' AND frontmatter IS NOT NULL")
            .map_err(e)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(e)?;
        for row in rows {
            let (p, title, fm) = row.map_err(e)?;
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&fm) else { continue };
            let items: Vec<String> = match v.get("sources") {
                Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                Some(serde_json::Value::String(s)) => vec![s.clone()],
                _ => vec![],
            };
            let names = items.iter().flat_map(|it| {
                CITE.captures_iter(it).map(|c| nfc(c[1].trim().rsplit('/').next().unwrap_or("")).to_lowercase()).collect::<Vec<_>>()
            });
            if names.into_iter().any(|n| n == base || n == stem) {
                citers.push(Citer { path: p, title, listed: true, passages: vec![] });
            }
        }
        // Lines in wiki pages that link to it.
        let mut st = c
            .prepare(
                "SELECT f.path, coalesce(f.title, f.path), l.line, l.heading FROM links l JOIN files f ON f.id = l.src
                 WHERE l.target_id = ?1 AND f.layer = 'wiki' AND l.line IS NOT NULL ORDER BY f.path, l.line",
            )
            .map_err(e)?;
        let rows = st
            .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?)))
            .map_err(e)?;
        for row in rows {
            let (p, title, line, anchor) = row.map_err(e)?;
            let i = match citers.iter().position(|x| x.path == p) {
                Some(i) => i,
                None => {
                    citers.push(Citer { path: p, title, listed: false, passages: vec![] });
                    citers.len() - 1
                }
            };
            if !citers[i].passages.iter().any(|x| x.line == line) {
                citers[i].passages.push(Passage { line, anchor, context: String::new() });
            }
        }
        citers.sort_by(|a, b| b.passages.len().cmp(&a.passages.len()).then(a.title.cmp(&b.title)));
        Ok(Some(SourceFacts { sha256, size, mtime, chunks, citers }))
    }
}

/// A wiki page's sources count and aliases, for the wiki list.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WikiMeta {
    pub path: String,
    pub sources: usize,
    pub aliases: Vec<String>,
}

impl Index {
    pub fn wiki_meta(&self) -> Result<Vec<WikiMeta>> {
        let mut st = self.conn().prepare("SELECT path, frontmatter FROM files WHERE layer = 'wiki'").map_err(e)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).map_err(e)?;
        let list = |v: Option<&serde_json::Value>| -> Vec<String> {
            match v {
                Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
                Some(serde_json::Value::String(s)) if !s.trim().is_empty() => vec![s.clone()],
                _ => vec![],
            }
        };
        let mut out = Vec::new();
        for row in rows {
            let (path, fm) = row.map_err(e)?;
            let v = fm.and_then(|f| serde_json::from_str::<serde_json::Value>(&f).ok()).unwrap_or_default();
            out.push(WikiMeta { path, sources: list(v.get("sources")).len(), aliases: list(v.get("aliases")) });
        }
        Ok(out)
    }
}

/// Fills each passage's text from its page as it is on disk now.
pub fn fill_passages(root: &std::path::Path, citers: &mut [Citer]) {
    for c in citers {
        let Ok(text) = std::fs::read_to_string(root.join(&c.path)) else { continue };
        let lines: Vec<&str> = text.lines().collect();
        for p in &mut c.passages {
            if let Some(l) = lines.get(p.line as usize) {
                let t = l.trim().trim_start_matches(['-', '*', '+', '>']).trim();
                p.context = if t.chars().count() > 280 { format!("{}…", t.chars().take(280).collect::<String>()) } else { t.to_string() };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sources_citers_and_passages() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault");
        let mut ix = Index::open_in_memory().unwrap();
        ix.sync(&crate::vault::Vault::new(fixture.clone(), vec![])).unwrap();
        let src = ix.list(Some("source")).unwrap().into_iter().find(|f| f.path.contains("Roadmap Update 2026-09-18")).unwrap();
        let mut f = ix.source_facts(&src.path).unwrap().unwrap();
        assert!(!f.sha256.is_empty() && f.chunks > 0);
        let orbit = f.citers.iter().find(|c| c.path == "wiki/entities/Orbit App.md").expect("Orbit App cites it");
        assert!(orbit.listed);
        assert_eq!(orbit.passages[0].anchor.as_deref(), Some("Roadmap update"));
        fill_passages(&fixture, &mut f.citers);
        let orbit = f.citers.iter().find(|c| c.path == "wiki/entities/Orbit App.md").unwrap();
        assert!(orbit.passages[0].context.starts_with("Soft launch to staff"), "{:?}", orbit.passages);
        assert!(ix.source_facts("nope.md").unwrap().is_none());
        let meta = ix.wiki_meta().unwrap();
        let o = meta.iter().find(|m| m.path == "wiki/entities/Orbit App.md").unwrap();
        assert_eq!((o.sources, o.aliases.clone()), (1, vec!["OA".to_string(), "The Orbit App".to_string()]));
    }

    #[test]
    fn bookmarking() {
        let t = "> note\n\n* [[Me. To Do List]]\n* [[Me. Scratchpad]]\n\nTrailing words.\n";
        let (a, on) = toggle_bookmark(t, "Idea. Launch prep");
        assert!(on);
        assert_eq!(a, "> note\n\n* [[Me. To Do List]]\n* [[Me. Scratchpad]]\n* [[Idea. Launch prep]]\n\nTrailing words.\n");
        let (b, on) = toggle_bookmark(&a, "idea. launch prep");
        assert!(!on);
        assert_eq!(b, t);
        assert_eq!(toggle_bookmark("", "A").0, "* [[A]]\n");
    }

    #[test]
    fn saving_a_search() {
        let t = "> note\n\n- **Follow-ups** — `tag:followup`\n";
        let a = add_smart_list(t, "Launch", "launch -tag:archived", &["wiki".into()]).unwrap();
        assert_eq!(a, "> note\n\n- **Follow-ups** — `tag:followup`\n- **Launch** — `launch -tag:archived` · `wiki`\n");
        assert_eq!(parse_smart_lists(&a)[1].layers, ["wiki"]);
        assert!(add_smart_list(&a, "launch", "x", &[]).unwrap_err().contains("already"));
        assert!(add_smart_list(&a, "X", "", &[]).is_err());
    }
    use crate::vault::Vault;
    use std::path::PathBuf;

    fn ix() -> Index {
        let v = Vault::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault"), vec![]);
        let mut ix = Index::open_in_memory().unwrap();
        ix.sync(&v).unwrap();
        ix
    }

    #[test]
    fn bookmark_lines() {
        let t = "> **This is a system note** — [[Not]] a bookmark\n\n* [[Me. To Do List]]\n- \\[\\[Escaped\\]\\]\n+ [[With|alias]]  \n- [[A]] and text\n";
        assert_eq!(parse_bookmarks(t), ["Me. To Do List", "Escaped", "With"]);
    }

    #[test]
    fn a_bookmarks_underscore_isnt_a_wildcard() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("Notes")).unwrap();
        std::fs::write(d.path().join("Notes/PlanX1.md"), "x\n").unwrap();
        let mut ix = Index::open_in_memory().unwrap();
        ix.sync(&Vault::new(d.path(), vec![])).unwrap();
        assert_eq!(ix.resolve_bookmark("Plan_1").unwrap(), None);
        assert_eq!(ix.resolve_bookmark("Plan%").unwrap(), None);
        assert_eq!(ix.resolve_bookmark("PlanX1").unwrap().as_deref(), Some("Notes/PlanX1.md"));
    }

    #[test]
    fn resolves_bookmarks() {
        let ix = ix();
        assert_eq!(ix.resolve_bookmark("Me. To Do List").unwrap().as_deref(), Some("Me. To Do List.md"));
        assert_eq!(ix.resolve_bookmark("entities/Orbit App").unwrap().as_deref(), Some("wiki/entities/Orbit App.md"));
        assert_eq!(ix.resolve_bookmark("Roadmap Update 2026-09-18").unwrap().as_deref(), Some("sources/Roadmap Update 2026-09-18.md"));
        assert_eq!(ix.resolve_bookmark("Me. Nested note").unwrap().as_deref(), Some("Victor/Me. Nested note.md"));
        assert_eq!(ix.resolve_bookmark("OA").unwrap().as_deref(), Some("wiki/entities/Orbit App.md"));
        assert_eq!(ix.resolve_bookmark("Gone").unwrap(), None);
        let b = ix.bookmarks("* [[Me. Scratchpad]]\n* [[Gone]]").unwrap();
        assert_eq!(b[0].title, "Scratchpad");
        assert_eq!((b[1].path.as_ref(), b[1].title.as_str()), (None, "Gone"));
    }

    #[test]
    fn smart_lists() {
        let l = parse_smart_lists("> note\n\n- **Follow-ups** — `tag:followup`\n- **Hiring (active)** — `tag:hiring -tag:archived` · `wiki,note`\n- **All** - `x` · `wiki,note,source`\n- not a list");
        assert_eq!(l.len(), 3);
        assert_eq!(l[0], SmartList { name: "Follow-ups".into(), query: "tag:followup".into(), layers: vec![] });
        assert_eq!(l[1].layers, ["wiki", "note"]);
        assert!(l[2].layers.is_empty());
    }

    #[test]
    fn ingested_sources() {
        let ix = ix();
        let r = ix
            .ingested(&[
                "sources/Roadmap Update 2026-09-18.md".into(),
                "sources/emails/Email. Steerco minutes - 2026-09-28.md".into(),
                "sources/Programme Update Steerco 2026-09-28.pdf".into(),
            ])
            .unwrap();
        assert_eq!(r, [true, false, false]);
    }
}
