// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Tasks-format lines: `- [ ] text 📅 due ⏳ scheduled 🛫 start ➕ created ✅ done #tag ^rank-N`.
//! Ported from the previous app's `parseTaskLine` (bff/src/services/tasks-index.ts), including its
//! rule for a task unticked in another editor that still carries its ✅ date. Any one-character status
//! counts, as in the Tasks plugin: `x` (and `X`) is done, `-` cancelled, `/` in progress, and an
//! unknown symbol is a to-do. The other fields (priority, recurrence, ids) are read by the query
//! language in the window (src/tasksq/), from `line_text`. Contexts are `#context/<name>` tags and
//! effort is a Dataview field, `[effort:: 15m]` or `(effort:: 15m)`. A task inside a quote or callout
//! (`> - [ ] …`, nested `> > `) counts too: the `>` markers are its container, kept in `line_text`
//! and put back by every edit (`split_quote`).

use std::sync::LazyLock;

use regex::Regex;

use crate::links::tags_in;
use crate::markdown::{heading, Line};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Task {
    /// 0-based line in the file.
    pub line: usize,
    /// The whole line as it is in the file, to check it hasn't moved before a write.
    pub line_text: String,
    /// The character between the brackets.
    pub status: String,
    /// Done or cancelled: off the lists of things to do.
    pub done: bool,
    /// The text after the checkbox, without `^rank-N`.
    pub text: String,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub start: Option<String>,
    pub created: Option<String>,
    pub done_on: Option<String>,
    /// ❌: the day it was cancelled.
    pub cancelled: Option<String>,
    pub rank: Option<i64>,
    pub tags: Vec<String>,
    /// From `#context/<name>` tags: the names, nested ones kept as `a/b`.
    pub contexts: Vec<String>,
    /// As written in `[effort:: …]`.
    pub effort: Option<String>,
    /// The effort in minutes, when it reads as a duration.
    pub effort_min: Option<i64>,
    /// The nearest heading above it.
    pub heading: Option<String>,
}

static TASK_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s*)([-*+]|\d+[.)])\s+\[([^\]])\]\s+(.+)$").unwrap());
static QUOTE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:[ \t]{0,3}>[ \t]?)+").unwrap());
static RANK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\^rank-(\d+)\s*$").unwrap());
static DONE_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*✅\s*\d{4}-\d{2}-\d{2}").unwrap());
static EFFORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[effort::\s*([^\]]*?)\s*\]|\(effort::\s*([^)]*?)\s*\)").unwrap());
static DURATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\s*").unwrap());

/// `[effort:: …]` (or the round-bracket form) in a task's text, as written.
pub fn effort_in(text: &str) -> Option<String> {
    let c = EFFORT.captures(text)?;
    let v = c.get(1).or(c.get(2))?.as_str().trim();
    (!v.is_empty()).then(|| v.to_string())
}

/// A duration in minutes: `15m`, `1h`, `1h30m`, `90 min`, `1.5h`, `2d` (a day is eight hours).
/// None when any of it doesn't read.
pub fn effort_minutes(s: &str) -> Option<i64> {
    let mut rest = s.trim();
    if rest.is_empty() {
        return None;
    }
    let mut total = 0.0;
    while !rest.is_empty() {
        let c = DURATION.captures(rest)?;
        let n: f64 = c[1].parse().ok()?;
        let per = match c[2].to_ascii_lowercase().chars().next()? {
            'd' => 8.0 * 60.0,
            'h' => 60.0,
            _ => 1.0,
        };
        total += n * per;
        rest = &rest[c.get(0).unwrap().end()..];
    }
    Some(total.round() as i64)
}

/// The names of `#context/<name>` tags.
pub fn contexts_of(tags: &[String]) -> Vec<String> {
    tags.iter().filter_map(|t| t.strip_prefix("context/")).filter(|n| !n.is_empty()).map(String::from).collect()
}

fn date_after(text: &str, emoji: &str) -> Option<String> {
    let i = text.find(emoji)? + emoji.len();
    let rest = text[i..].trim_start_matches([' ', '\u{fe0f}']);
    let d = rest.get(..10)?;
    let b = d.as_bytes();
    let ok = b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
    ok.then(|| d.to_string())
}

/// A line's quote or callout markers (`> `, `> > `) and the rest. The prefix is empty outside a quote.
pub fn split_quote(line: &str) -> (&str, &str) {
    let n = QUOTE.find(line).map_or(0, |m| m.end());
    line.split_at(n)
}

/// `f` applied to the line inside its quote markers, which are put back in front.
pub fn in_quote(line: &str, f: impl FnOnce(&str) -> String) -> String {
    let (pre, body) = split_quote(line);
    format!("{pre}{}", f(body))
}

pub fn parse_line(line_text: &str, line: usize) -> Option<Task> {
    let m = TASK_LINE.captures(split_quote(line_text).1)?;
    let status = m[3].to_string();
    let done = matches!(&*status, "x" | "X" | "-");
    let raw = m[4].trim();
    let mut rank = None;
    let mut text = raw.to_string();
    if let Some(r) = RANK.captures(raw) {
        rank = r[1].parse().ok();
        text = raw[..r.get(0).unwrap().start()].trim_end().to_string();
    }
    // Unticked in another editor, which leaves the ✅ date behind: it isn't done, and its old rank no
    // longer means anything. Only when the ✅ is there, so freshly ranked tasks keep their rank.
    if status == " " && DONE_DATE.is_match(&text) {
        text = DONE_DATE.replace_all(&text, "").trim().to_string();
        rank = None;
    }
    Some(Task {
        line,
        line_text: line_text.to_string(),
        status,
        done,
        due: date_after(&text, "📅"),
        scheduled: date_after(&text, "⏳"),
        start: date_after(&text, "🛫"),
        created: date_after(&text, "➕"),
        done_on: date_after(&text, "✅"),
        cancelled: date_after(&text, "❌"),
        tags: tags_in(&text),
        contexts: contexts_of(&tags_in(&text)),
        effort_min: effort_in(&text).as_deref().and_then(effort_minutes),
        effort: effort_in(&text),
        text,
        rank,
        heading: None,
    })
}

pub fn parse_tasks(lines: &[Line]) -> Vec<Task> {
    let mut out = Vec::new();
    let mut current: Option<&str> = None;
    for l in lines.iter().filter(|l| !l.code) {
        if let Some((_, h)) = heading(l.text) {
            current = Some(h);
            continue;
        }
        if let Some(mut t) = parse_line(l.text, l.no) {
            t.heading = current.map(String::from);
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markdown::lines;

    #[test]
    fn fields() {
        let t = parse_line(
            "- [ ] Send Maya the layering 📅 2026-10-02 ⏳ 2026-10-01 🛫 2026-09-30 ➕ 2026-09-20 #project/rf #followup ^rank-2048",
            4,
        )
        .unwrap();
        assert!(!t.done);
        assert_eq!(t.text, "Send Maya the layering 📅 2026-10-02 ⏳ 2026-10-01 🛫 2026-09-30 ➕ 2026-09-20 #project/rf #followup");
        assert_eq!(t.due.as_deref(), Some("2026-10-02"));
        assert_eq!(t.scheduled.as_deref(), Some("2026-10-01"));
        assert_eq!(t.start.as_deref(), Some("2026-09-30"));
        assert_eq!(t.created.as_deref(), Some("2026-09-20"));
        assert_eq!(t.rank, Some(2048));
        assert_eq!(t.tags, ["project/rf", "followup"]);
        assert_eq!(t.line, 4);
    }

    #[test]
    fn done_and_unticked() {
        let d = parse_line("  * [x] Daily review ✅ 2026-10-02", 0).unwrap();
        assert!(d.done);
        assert_eq!(d.done_on.as_deref(), Some("2026-10-02"));
        let u = parse_line("- [ ] Reopened ✅ 2026-09-01 ^rank-5", 0).unwrap();
        assert!(!u.done);
        assert_eq!(u.text, "Reopened");
        assert_eq!((u.rank, u.done_on), (None, None));
        let r = parse_line("- [ ] Ranked ^rank-7", 0).unwrap();
        assert_eq!(r.rank, Some(7));
    }

    #[test]
    fn not_tasks() {
        assert!(parse_line("- [] nope", 0).is_none());
        assert!(parse_line("- [ ]", 0).is_none());
        assert!(parse_line("- [xx] two", 0).is_none());
        assert!(parse_line("[ ] bare", 0).is_none());
    }

    #[test]
    fn in_quotes_and_callouts() {
        let t = parse_line("> - [ ] Inside a callout 📅 2026-10-05", 3).unwrap();
        assert_eq!(t.text, "Inside a callout 📅 2026-10-05");
        assert_eq!(t.due.as_deref(), Some("2026-10-05"));
        assert_eq!(t.line_text, "> - [ ] Inside a callout 📅 2026-10-05");
        assert!(parse_line("> > * [x] Nested", 0).unwrap().done);
        assert!(parse_line(">- [ ] Tight", 0).is_some());
        assert!(parse_line(">   - [ ] Indented under a bullet", 0).is_some());
        assert!(parse_line("> [!todo] Title", 0).is_none());
        assert_eq!(split_quote("> > - [ ] x"), ("> > ", "- [ ] x"));
        assert_eq!(split_quote("- [ ] x"), ("", "- [ ] x"));
        assert_eq!(in_quote("> - [ ] x", |b| b.replace("[ ]", "[x]")), "> - [x] x");
    }

    #[test]
    fn statuses() {
        let c = parse_line("- [-] dropped ❌ 2026-10-01", 0).unwrap();
        assert_eq!((c.status.as_str(), c.done, c.cancelled.as_deref()), ("-", true, Some("2026-10-01")));
        let p = parse_line("1. [/] half way", 0).unwrap();
        assert_eq!((p.status.as_str(), p.done), ("/", false));
        let u = parse_line("- [?] odd one", 0).unwrap();
        assert!(!u.done);
        // Only an unticked to-do drops a leftover ✅.
        let x = parse_line("- [-] cancelled after ✅ 2026-09-01", 0).unwrap();
        assert_eq!(x.done_on.as_deref(), Some("2026-09-01"));
    }

    #[test]
    fn contexts_and_effort() {
        let t = parse_line("- [ ] Call Sam #context/calls #context/office/desk #contexts [effort:: 15m] 📅 2026-10-05", 0).unwrap();
        assert_eq!(t.contexts, ["calls", "office/desk"]);
        assert_eq!((t.effort.as_deref(), t.effort_min), (Some("15m"), Some(15)));
        // Tags stay as they were.
        assert_eq!(t.tags, ["context/calls", "context/office/desk", "contexts"]);
        let r = parse_line("- [ ] Draft (effort:: 1h 30m)", 0).unwrap();
        assert_eq!((r.effort.as_deref(), r.effort_min), (Some("1h 30m"), Some(90)));
        let odd = parse_line("- [ ] Think [effort:: a while]", 0).unwrap();
        assert_eq!((odd.effort.as_deref(), odd.effort_min), (Some("a while"), None));
        let none = parse_line("- [ ] Plain #context", 0).unwrap();
        assert!(none.contexts.is_empty() && none.effort.is_none());
    }

    #[test]
    fn durations() {
        for (s, m) in [("15m", 15), ("1h", 60), ("1h30m", 90), ("90m", 90), ("2d", 960), ("1.5h", 90), ("45 min", 45), ("2 hours", 120)] {
            assert_eq!(effort_minutes(s), Some(m), "{s}");
        }
        for s in ["", "15", "soon", "1h then some", "m"] {
            assert_eq!(effort_minutes(s), None, "{s}");
        }
    }

    #[test]
    fn headings_and_code() {
        let src = "#### To Do\n- [ ] one\n```\n- [ ] in code\n```\n## Other\n+ [X] two";
        let ts = parse_tasks(&lines(src, 0));
        assert_eq!(ts.len(), 2);
        assert_eq!(ts[0].heading.as_deref(), Some("To Do"));
        assert_eq!((ts[1].heading.as_deref(), ts[1].done, ts[1].line), (Some("Other"), true, 6));
    }
}
