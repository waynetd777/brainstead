// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! What Dataview knows about a page, read from its markdown: frontmatter, inline fields
//! (`key:: value` lines, `[key:: value]` and `(key:: value)`), tags, links, and every list item
//! and task with its own fields. Values stay as written; the window types them (src/md/dataview/)
//! as Dataview does. Pages are parsed on demand and cached by the app by modification time, so
//! the SQLite index needs nothing new.

use serde::Serialize;
use serde_json::Value;
use std::sync::LazyLock;

use regex::Regex;

use crate::frontmatter;
use crate::links::{parse_links, tags_in};
use crate::markdown::{blank_code_spans as blank_code_spans_pub, heading, lines};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DvLink {
    /// The note part as written ("" for this note).
    pub target: String,
    /// Where it goes, vault-relative (filled in by the caller), None for a ghost link.
    pub path: Option<String>,
    pub display: Option<String>,
    /// A heading or `^block` within the target.
    pub subpath: Option<String>,
    pub embed: bool,
    pub line: usize,
}

/// An inline field as written: the key, its value text, and the 0-based line.
#[derive(Debug, Clone, Serialize)]
pub struct DvField(pub String, pub String, pub usize);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DvItem {
    pub line: usize,
    pub line_count: usize,
    /// The whole line as in the file.
    pub line_text: String,
    /// After the list marker and checkbox.
    pub text: String,
    /// The character in `[ ]`, or None for a plain list item.
    pub status: Option<String>,
    /// The line of the item it's nested under.
    pub parent: Option<usize>,
    /// The heading above it.
    pub section: Option<String>,
    pub block_id: Option<String>,
    pub tags: Vec<String>,
    pub links: Vec<DvLink>,
    pub fields: Vec<DvField>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DvPage {
    pub path: String,
    pub title: String,
    pub size: i64,
    pub ctime: i64,
    pub mtime: i64,
    /// A date in the file name, `YYYY-MM-DD`.
    pub day: Option<String>,
    pub frontmatter: Value,
    pub aliases: Vec<String>,
    /// Explicit tags with `#`, frontmatter first, no repeats.
    pub etags: Vec<String>,
    pub links: Vec<DvLink>,
    pub fields: Vec<DvField>,
    pub lists: Vec<DvItem>,
}

static LIST_ITEM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([\s>]*)([-*+]|\d+[.)])\s+(?:\[(.)\]\s+)?(.*)$").unwrap());
static FULL_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\s>]*(?:(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?([^\s:\[\]()`][^:\[\]()`]*?)::\s*(.*?)\s*$").unwrap());
static BLOCK_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s\^([A-Za-z0-9-]+)\s*$").unwrap());
static FORMATTING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\*\*|__|~~|==|\*|_").unwrap());

/// A key as written, with bold, italics, strike and highlight marks taken off.
fn clean_key(k: &str) -> String {
    FORMATTING.replace_all(k, "").trim().to_string()
}

/// `[key:: value]` and `(key:: value)` in a line, brackets nested in the value allowed (links).
pub fn bracket_fields(line: &str) -> Vec<(String, String)> {
    let b = line.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let (open, close) = match b[i] {
            b'[' => (b'[', b']'),
            b'(' => (b'(', b')'),
            _ => {
                i += 1;
                continue;
            }
        };
        // `[[` starts a link, not a field.
        if open == b'[' && (b.get(i + 1) == Some(&b'[') || (i > 0 && b[i - 1] == b'[')) {
            i += 1;
            continue;
        }
        let mut depth = 0i32;
        let mut end = None;
        for (j, &c) in b.iter().enumerate().skip(i) {
            if c == b'[' || c == b'(' {
                depth += 1;
            } else if c == b']' || c == b')' {
                depth -= 1;
                if depth == 0 {
                    if c == close {
                        end = Some(j);
                    }
                    break;
                }
            }
        }
        if let Some(e) = end {
            let inner = &line[i + 1..e];
            if let Some(k) = inner.find("::") {
                let key = clean_key(&inner[..k]);
                if !key.is_empty() && !key.contains(['[', ']', '(', ')']) {
                    out.push((key, inner[k + 2..].trim().to_string()));
                    i = e + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

/// The field a line is, as `key:: value` on its own (a list marker or quote before it allowed).
pub fn full_line_field(line: &str) -> Option<(String, String)> {
    let c = FULL_LINE.captures(line)?;
    let key = clean_key(&c[1]);
    if key.is_empty() || key.contains("://") {
        return None;
    }
    Some((key, c[2].to_string()))
}

fn fields_in(text: &str, no: usize) -> Vec<DvField> {
    let mut f: Vec<DvField> = bracket_fields(text).into_iter().map(|(k, v)| DvField(k, v, no)).collect();
    if f.is_empty() {
        if let Some((k, v)) = full_line_field(text) {
            f.push(DvField(k, v, no));
        }
    }
    f
}

/// Values in the frontmatter written as `[[links]]`.
fn frontmatter_links(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            for c in Regex::new(r"\[\[([^\[\]\n]+?)\]\]").unwrap().captures_iter(s) {
                out.push(c[1].to_string());
            }
        }
        Value::Array(a) => a.iter().for_each(|x| frontmatter_links(x, out)),
        Value::Object(m) => m.values().for_each(|x| frontmatter_links(x, out)),
        _ => {}
    }
}

fn split_link(inner: &str) -> (String, Option<String>, Option<String>) {
    let (dest, alias) = match inner.split_once('|') {
        Some((d, a)) => (d.trim(), Some(a.trim().to_string()).filter(|a| !a.is_empty())),
        None => (inner.trim(), None),
    };
    match dest.split_once('#') {
        Some((t, f)) => (t.trim().to_string(), alias, Some(f.trim().to_string()).filter(|f| !f.is_empty())),
        None => (dest.to_string(), alias, None),
    }
}

/// One page. `title`, the times and the size come from the index and the file system.
pub fn parse_page(rel: &str, title: &str, src: &str, size: i64, ctime: i64, mtime: i64) -> DvPage {
    let fm = frontmatter::split(src);
    let ls = lines(src, fm.body_start);
    let data = if fm.data.is_object() { fm.data.clone() } else { Value::Object(Default::default()) };

    let mut etags: Vec<String> = Vec::new();
    let push_tag = |t: String, etags: &mut Vec<String>| {
        let t = if t.starts_with('#') { t } else { format!("#{t}") };
        if !etags.contains(&t) {
            etags.push(t);
        }
    };
    for t in frontmatter::list(&data, &["tags", "tag"], true) {
        push_tag(t.trim_start_matches('#').to_string(), &mut etags);
    }

    let mut links: Vec<DvLink> = parse_links(&ls)
        .into_iter()
        .map(|l| DvLink {
            target: l.target,
            path: None,
            display: l.alias,
            subpath: l.heading.or(l.block.map(|b| format!("^{b}"))),
            embed: matches!(l.kind, crate::links::LinkKind::Embed),
            line: l.line,
        })
        .collect();
    let mut fm_links = Vec::new();
    frontmatter_links(&data, &mut fm_links);
    for inner in fm_links {
        let (target, display, subpath) = split_link(&inner);
        links.push(DvLink { target, path: None, display, subpath, embed: false, line: 0 });
    }

    let mut fields = Vec::new();
    let mut lists: Vec<DvItem> = Vec::new();
    // Open list items by indent, for parents.
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut section: Option<String> = None;
    let mut last_item: Option<usize> = None;
    for l in &ls {
        if l.code {
            last_item = None;
            continue;
        }
        if let Some((_, h)) = heading(l.text) {
            section = Some(h.to_string());
            stack.clear();
            last_item = None;
        }
        let text = blank_code_spans_pub(l.text);
        for t in tags_in(&text) {
            push_tag(t, &mut etags);
        }
        let lf = fields_in(&text, l.no);
        fields.extend(lf.iter().cloned());
        if let Some(c) = LIST_ITEM.captures(l.text) {
            let indent = c[1].chars().map(|ch| if ch == '\t' { 4 } else { 1 }).sum::<usize>();
            while stack.last().is_some_and(|(i, _)| *i >= indent) {
                stack.pop();
            }
            let parent = stack.last().map(|(_, line)| *line);
            let body = c[4].to_string();
            let block_id = BLOCK_ID.captures(&body).map(|b| b[1].to_string());
            let item_text = blank_code_spans_pub(&body).into_owned();
            let item_links = links.iter().filter(|k| k.line == l.no).cloned().collect();
            lists.push(DvItem {
                line: l.no,
                line_count: 1,
                line_text: l.text.to_string(),
                text: body,
                status: c.get(3).map(|s| s.as_str().to_string()),
                parent,
                section: section.clone(),
                block_id,
                tags: tags_in(&item_text).into_iter().map(|t| format!("#{t}")).collect(),
                links: item_links,
                fields: fields_in(&item_text, l.no),
            });
            stack.push((indent, l.no));
            last_item = Some(lists.len() - 1);
        } else if let Some(k) = last_item {
            // An indented line after an item continues it.
            if !l.text.trim().is_empty() && l.text.starts_with([' ', '\t']) {
                lists[k].line_count += 1;
            } else {
                last_item = None;
                if l.text.trim().is_empty() {
                    continue;
                }
                stack.clear();
            }
        }
    }

    let name = crate::filename::parse(rel);
    DvPage {
        path: rel.to_string(),
        title: title.to_string(),
        size,
        ctime,
        mtime,
        day: name.date.filter(|d| d.len() == 10),
        aliases: frontmatter::list(&data, &["aliases", "alias"], false),
        frontmatter: data,
        etags,
        links,
        fields,
        lists,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_fields_lists_and_tags() {
        let src = "---\ntags: [project]\nrating: 4\nup: \"[[Orbit App]]\"\n---\n# Plan\n\nStatus:: active\n**Owner**:: Maya\nA line with [due:: 2026-10-05] and (hidden:: yes) and [[Link|L]].\n\n## Tasks\n\n- [ ] ship [priority:: high] #work ^b1\n  - [x] sub ✅ 2026-10-01\n    more text\n- plain item\n```\nnot:: a field\n```\n";
        let p = parse_page("Notes/Plan - 2026-10-02.md", "Plan", src, 10, 1, 2);
        assert_eq!(p.day.as_deref(), Some("2026-10-02"));
        let f: Vec<(&str, &str)> = p.fields.iter().map(|f| (f.0.as_str(), f.1.as_str())).collect();
        assert_eq!(f, [("Status", "active"), ("Owner", "Maya"), ("due", "2026-10-05"), ("hidden", "yes"), ("priority", "high")]);
        assert_eq!(p.etags, ["#project", "#work"]);
        assert_eq!(p.links.iter().map(|l| l.target.as_str()).collect::<Vec<_>>(), ["Link", "Orbit App"]);
        assert_eq!(p.lists.len(), 3);
        let t = &p.lists[0];
        assert_eq!((t.status.as_deref(), t.section.as_deref(), t.block_id.as_deref()), (Some(" "), Some("Tasks"), Some("b1")));
        assert_eq!(t.fields[0].0, "priority");
        assert_eq!(t.tags, ["#work"]);
        let sub = &p.lists[1];
        assert_eq!((sub.parent, sub.status.as_deref(), sub.line_count), (Some(t.line), Some("x"), 2));
        assert_eq!((p.lists[2].parent, p.lists[2].status.as_deref()), (None, None));
    }

    #[test]
    fn bracket_fields_nest() {
        assert_eq!(
            bracket_fields("[up:: [[A|b]]] (x:: (1)) [[not:: this]]"),
            [("up".into(), "[[A|b]]".into()), ("x".into(), "(1)".into())]
        );
        assert_eq!(full_line_field("- [ ] key:: value"), Some(("key".into(), "value".into())));
        assert_eq!(full_line_field("see https://x.y/a::b"), None);
    }
}
