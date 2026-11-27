// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! YAML frontmatter at the top of a note: `---` on the first line, closed by `---` or `...`.

use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct Frontmatter {
    /// The parsed YAML as JSON (an object), or Null when there is none or it doesn't parse.
    pub data: Value,
    /// Why the YAML didn't parse, for Wiki health later.
    pub error: Option<String>,
    /// Byte offset where the body starts (0 when there's no frontmatter).
    pub body_start: usize,
}

pub fn split(src: &str) -> Frontmatter {
    let src_nb = src.strip_prefix('\u{feff}').unwrap_or(src);
    let bom = src.len() - src_nb.len();
    let first = src_nb.split_inclusive('\n').next().unwrap_or("");
    if first.trim_end() != "---" {
        return Frontmatter::default();
    }
    let mut pos = bom + first.len();
    for line in src[pos..].split_inclusive('\n') {
        let t = line.trim_end();
        if t == "---" || t == "..." {
            let yaml = &src[bom + first.len()..pos];
            let body_start = pos + line.len();
            return match serde_yaml_ng::from_str::<Value>(yaml) {
                Ok(Value::Object(m)) => Frontmatter { data: Value::Object(m), error: None, body_start },
                Ok(Value::Null) => Frontmatter { data: Value::Null, error: None, body_start },
                Ok(_) => Frontmatter { data: Value::Null, error: Some("frontmatter is not a set of properties".into()), body_start },
                Err(e) => Frontmatter { data: Value::Null, error: Some(e.to_string()), body_start },
            };
        }
        pos += line.len();
    }
    // Never closed: other editors show it as text, so it's body.
    Frontmatter::default()
}

/// A list property that may be written as a list or as one string (`tags: a, b` or `tags: a b`).
pub fn list(data: &Value, keys: &[&str], split_spaces: bool) -> Vec<String> {
    let mut out = Vec::new();
    for k in keys {
        match data.get(*k) {
            Some(Value::Array(a)) => {
                for v in a {
                    match v {
                        Value::String(s) => out.push(s.trim().to_string()),
                        Value::Number(n) => out.push(n.to_string()),
                        _ => {}
                    }
                }
            }
            Some(Value::String(s)) => {
                let parts: Vec<&str> = if split_spaces { s.split([',', ' ']).collect() } else { s.split(',').collect() };
                out.extend(parts.into_iter().map(str::trim).filter(|p| !p.is_empty()).map(String::from));
            }
            _ => {}
        }
    }
    out.retain(|s| !s.is_empty());
    out
}

pub fn string(data: &Value, key: &str) -> Option<String> {
    match data.get(key)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// The text with its properties repaired, when they don't read as YAML and one of the common
/// slips is why, or None. Only the lines at fault change, and only when the properties then read:
///
/// - a top-level value that YAML misreads: a colon followed by a space in a plain value
///   (`description: Estimates: by horizon`), or a quoted start with more after its closing quote
///   (`description: "Working with SFTX" — a guide`). It's quoted as a whole.
/// - a list item put between a `- >-` (or `- |`) and the folded lines under it, as an edit
///   adding to the list can: the item moves above the `- >-`.
pub fn repaired(text: &str) -> Option<String> {
    let fm = split(text);
    fm.error.as_ref()?;
    let bom = if text.starts_with('\u{feff}') { "\u{feff}" } else { "" };
    let src = &text[bom.len()..];
    let (mut lines, eol, trailing) = crate::write::split_lines(src);
    let end = lines.iter().skip(1).position(|l| matches!(l.trim_end(), "---" | "..."))? + 1;
    let ind = |l: &str| l.len() - l.trim_start().len();
    // Folded items split by an item put in among their lines.
    let mut i = 1;
    while i + 1 < end {
        let t = lines[i].trim();
        let folded = t.strip_prefix("- ").is_some_and(|v| matches!(v.trim(), ">" | ">-" | ">+" | "|" | "|-" | "|+"));
        if folded {
            let dash = ind(&lines[i]);
            let mut j = i + 1;
            while j < end && ind(&lines[j]) == dash && lines[j].trim_start().starts_with("- ") {
                j += 1;
            }
            if j > i + 1 && j < end && ind(&lines[j]) > dash && !lines[j].trim().is_empty() {
                let moved: Vec<String> = lines.drain(i + 1..j).collect();
                let n = moved.len();
                lines.splice(i..i, moved);
                i += n;
            }
        }
        i += 1;
    }
    // Top-level values YAML misreads.
    for line in lines.iter_mut().take(end).skip(1) {
        if line.starts_with([' ', '\t', '#', '-']) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let v = value.trim();
        if v.is_empty() || key.trim().is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b"_- ".contains(&b)) {
            continue;
        }
        if v.starts_with(['[', '{', '|', '>', '&', '*', '!']) {
            continue;
        }
        if serde_yaml_ng::from_str::<Value>(line.as_str()).is_ok() {
            continue;
        }
        *line = format!("{key}: \"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""));
    }
    let out = format!("{bom}{}", crate::write::join_lines(&lines, &eol, trailing));
    let again = split(&out);
    (again.error.is_none() && again.data.is_object() && out[again.body_start..] == text[fm.body_start..]).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits() {
        let f = split("---\ntitle: Orbit App\ntags: [project, hub]\naliases:\n  - OA\n---\n# Body\n");
        assert_eq!(f.data["title"], "Orbit App");
        assert_eq!(list(&f.data, &["tags"], true), ["project", "hub"]);
        assert_eq!(list(&f.data, &["aliases"], false), ["OA"]);
        assert_eq!(&"---\ntitle: Orbit App\ntags: [project, hub]\naliases:\n  - OA\n---\n# Body\n"[f.body_start..], "# Body\n");
    }

    #[test]
    fn none_or_bad() {
        assert_eq!(split("# Just a note\n---\n").body_start, 0);
        assert_eq!(split("---\nnever closed\n").body_start, 0);
        let bad = split("---\n: : :\n  - [\n---\nbody");
        assert!(bad.error.is_some());
        assert_eq!(&"---\n: : :\n  - [\n---\nbody"[bad.body_start..], "body");
        let crlf = split("---\r\ntags: a, b\r\n---\r\nx");
        assert_eq!(list(&crlf.data, &["tags"], true), ["a", "b"]);
        assert_eq!(split("---\n---\nx").body_start, 8);
    }

    #[test]
    fn repairs_the_common_slips_and_nothing_else() {
        // A colon in a plain value; a quoted start with more after it.
        let t =
            "---\nname: Date for a Date\ndescription: Estimates by horizon: a date, then a month\ntags: [planning]\n---\n# Body: kept\n";
        assert_eq!(
            repaired(t).unwrap(),
            "---\nname: Date for a Date\ndescription: \"Estimates by horizon: a date, then a month\"\ntags: [planning]\n---\n# Body: kept\n"
        );
        let t = "---\ndescription: \"Working with Orbit\" \u{2014} a short guide\n---\nBody\n";
        let r = repaired(t).unwrap();
        assert_eq!(string(&split(&r).data, "description").as_deref(), Some("\"Working with Orbit\" \u{2014} a short guide"));
        // A list item put between a folded item and its lines: moved above it.
        let t = "---\nsources:\n  - \"[[Kickoff]]\"\n  - >-\n  - \"[[Retro]]\"\n    [[Launch plan for the Orbit App -\n    2026-05-07]]\n  - \"[[Demo]]\"\n---\nBody\n";
        let r = repaired(t).unwrap();
        assert_eq!(
            list(&split(&r).data, &["sources"], false),
            ["[[Kickoff]]", "[[Retro]]", "[[Launch plan for the Orbit App - 2026-05-07]]", "[[Demo]]"]
        );
        // Properties that read, none, or a slip it doesn't know: left alone.
        assert_eq!(repaired("---\nname: Orbit\n---\nBody\n"), None);
        assert_eq!(repaired("No properties: here\n"), None);
        assert_eq!(repaired("---\nsources:\n  - [[a\n  b: [\n---\nBody\n"), None);
    }
}
