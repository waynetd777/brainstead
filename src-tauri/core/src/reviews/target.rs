// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The day or ISO week a review covers: its window, heading and monthly file, as the previous app's
//! `scripts/review_window.py` resolves them. A daily block goes in the target day's month; a
//! weekly block goes in its Sunday's month, so a week across a month boundary lands in one file.
//!
//! The files were `Me. Daily Reviews - YYYY-MM.md` and `Me. Weekly Reviews - YYYY-MM.md`, with
//! `## Daily review …` and `## Weekly review …` blocks, until they became the daily and weekly
//! summaries. New runs write the new names; everything that reads them accepts both
//! ([`old_name`], [`Window::locate`]).

use std::sync::LazyLock;

use chrono::{Datelike, Duration, NaiveDate};
use regex::Regex;
use serde::Serialize;

static ISO_WEEK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{4})-W(\d{2})$").unwrap());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Day(NaiveDate),
    Week { year: i32, week: u32 },
}

impl Target {
    /// `2026-09-30` or `2026-W40`.
    pub fn parse(s: &str) -> Result<Target, String> {
        if s.trim().to_uppercase().contains('W') {
            let (year, week) = parse_iso_week(s)?;
            return Ok(Target::Week { year, week });
        }
        NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map(Target::Day).map_err(|_| format!("expected a date like 2026-09-30, got {s:?}"))
    }

    /// The ISO week a day falls in.
    pub fn week_of(d: NaiveDate) -> Target {
        let w = d.iso_week();
        Target::Week { year: w.year(), week: w.week() }
    }

    pub fn label(&self) -> String {
        match self {
            Target::Day(d) => d.format("%Y-%m-%d").to_string(),
            Target::Week { year, week } => format!("{year:04}-W{week:02}"),
        }
    }
}

/// `2026-W21` as (year, week). Week 53 is refused in a year that has only 52.
pub fn parse_iso_week(s: &str) -> Result<(i32, u32), String> {
    let up = s.trim().to_uppercase();
    let m = ISO_WEEK.captures(&up).ok_or_else(|| format!("expected an ISO week like 2026-W21, got {s:?}"))?;
    let (year, week): (i32, u32) = (m[1].parse().unwrap(), m[2].parse().unwrap());
    if !(1..=53).contains(&week) {
        return Err(format!("ISO week out of range: {s:?}"));
    }
    NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon).ok_or_else(|| format!("{year} has no ISO week {week}"))?;
    Ok((year, week))
}

pub fn week_label(d: NaiveDate) -> String {
    let w = d.iso_week();
    format!("{:04}-W{:02}", w.year(), w.week())
}

fn ymd(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn month_of(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}

fn daily_file(d: NaiveDate) -> String {
    format!("Me. Daily Summaries - {}.md", month_of(d))
}

fn weekly_file(d: NaiveDate) -> String {
    format!("Me. Weekly Summaries - {}.md", month_of(d))
}

/// The new names' prefixes and what they were before.
const RENAMED: [(&str, &str); 4] = [
    ("Me. Daily Summaries - ", "Me. Daily Reviews - "),
    ("Me. Weekly Summaries - ", "Me. Weekly Reviews - "),
    ("## Daily summary ", "## Daily review "),
    ("## Weekly summary ", "## Weekly review "),
];

/// A summary file's name or block heading as it was before the rename (`Me. Daily Summaries -
/// 2026-10.md` → `Me. Daily Reviews - 2026-10.md`, `## Weekly summary 2026-W40` → `## Weekly
/// review 2026-W40`); None for anything else. A path keeps its folder.
pub fn old_name(s: &str) -> Option<String> {
    swap(s, false)
}

/// The reverse of [`old_name`]: an old file name or heading as it is now.
pub fn new_name(s: &str) -> Option<String> {
    swap(s, true)
}

fn swap(s: &str, to_new: bool) -> Option<String> {
    let (folder, name) = match s.rsplit_once('/') {
        Some((f, n)) => (Some(f), n),
        None => (None, s),
    };
    RENAMED.iter().find_map(|&(new, old)| {
        let (from, to) = if to_new { (old, new) } else { (new, old) };
        let renamed = format!("{to}{}", name.strip_prefix(from)?);
        Some(folder.map_or(renamed.clone(), |f| format!("{f}/{renamed}")))
    })
}

/// `name` and its old form: the names to read, newest first.
pub fn with_old(name: &str) -> Vec<String> {
    let mut v = vec![name.to_string()];
    v.extend(old_name(name));
    v
}

/// review_window.py's output, with the same keys.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Window {
    /// `day` or `week`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub week: Option<String>,
    /// First and last day, inclusive.
    pub start: String,
    pub end: String,
    pub days: Vec<String>,
    pub heading: String,
    /// The monthly file the block goes in, at the vault root.
    pub file: String,
    pub prev: String,
    pub prev_heading: String,
    pub prev_file: String,
    /// A week's daily summary files, both months for a week across a boundary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_files: Option<Vec<String>>,
}

impl Window {
    pub fn is_week(&self) -> bool {
        self.kind == "week"
    }

    /// The target, as `/daily-review` and `/weekly-review` took it.
    pub fn label(&self) -> &str {
        self.date.as_deref().or(self.week.as_deref()).unwrap_or("")
    }

    pub fn first_day(&self) -> NaiveDate {
        NaiveDate::parse_from_str(&self.start, "%Y-%m-%d").unwrap_or_default()
    }

    pub fn last_day(&self) -> NaiveDate {
        NaiveDate::parse_from_str(&self.end, "%Y-%m-%d").unwrap_or_default()
    }

    /// The system-note text a monthly file starts with when this review creates it, as the skills
    /// passed it to `upsert_review_block.py --header`.
    pub fn header(&self) -> String {
        let ym = &self.file[self.file.len() - 10..self.file.len() - 3];
        if self.is_week() {
            format!("Append-only log of the weekly summary for {ym}. Newest at top. Each `## Weekly summary YYYY-Www` block is the full summary for that ISO week; re-runs replace the block in place.")
        } else {
            format!("Append-only log of the daily summary for {ym}. Newest at top. Read by the weekly summary when it sums up the week.")
        }
    }

    /// The `log.md` detail for a run: `daily-summary 2026-09-30`, `weekly-summary 2026-W40`.
    pub fn log_detail(&self) -> String {
        format!("{}-summary {}", if self.is_week() { "weekly" } else { "daily" }, self.label())
    }

    /// Where this window's block is on file, as (file, heading): the first of the new and old file
    /// names whose text, from `read`, has it under the new or old heading; else the new names,
    /// where a new block goes. `read` takes a vault-relative path.
    pub fn locate(&self, read: impl Fn(&str) -> Option<String>) -> (String, String) {
        for file in with_old(&self.file) {
            if let Some(text) = read(&file) {
                for heading in with_old(&self.heading) {
                    if text.lines().any(|l| l.trim() == heading) {
                        return (file, heading);
                    }
                }
            }
        }
        (self.file.clone(), self.heading.clone())
    }
}

pub fn window(target: Target) -> Window {
    match target {
        Target::Day(d) => {
            let prev = d - Duration::days(1);
            Window {
                kind: "day".into(),
                date: Some(ymd(d)),
                week: None,
                start: ymd(d),
                end: ymd(d),
                days: vec![ymd(d)],
                heading: format!("## Daily summary {}", ymd(d)),
                file: daily_file(d),
                prev: ymd(prev),
                prev_heading: format!("## Daily summary {}", ymd(prev)),
                prev_file: daily_file(prev),
                daily_files: None,
            }
        }
        Target::Week { year, week } => {
            let monday = NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon).unwrap_or_default();
            let sunday = monday + Duration::days(6);
            let prev_monday = monday - Duration::days(7);
            let prev_sunday = sunday - Duration::days(7);
            let label = format!("{year:04}-W{week:02}");
            let mut daily = vec![daily_file(monday), daily_file(sunday)];
            daily.sort();
            daily.dedup();
            Window {
                kind: "week".into(),
                date: None,
                week: Some(label.clone()),
                start: ymd(monday),
                end: ymd(sunday),
                days: (0..7).map(|i| ymd(monday + Duration::days(i))).collect(),
                heading: format!("## Weekly summary {label}"),
                file: weekly_file(sunday),
                prev: week_label(prev_monday),
                prev_heading: format!("## Weekly summary {}", week_label(prev_monday)),
                prev_file: weekly_file(prev_sunday),
                daily_files: Some(daily),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reviews::fixture;

    #[test]
    fn matches_review_window_py() {
        // The script wrote the old names.
        let expected = fixture::renamed(fixture::expected("window.json"));
        let cases = expected.as_object().unwrap();
        assert!(cases.len() > 10);
        for (case, want) in cases {
            let (kind, arg) = case.split_once(':').unwrap();
            let got = if kind == "day" {
                Target::parse(arg).map(window)
            } else {
                parse_iso_week(arg).map(|(year, week)| window(Target::Week { year, week }))
            };
            match (got, want.get("error")) {
                (Ok(w), None) => assert_eq!(serde_json::to_value(&w).unwrap(), *want, "{case}"),
                (Err(_), Some(_)) => {}
                (got, _) => panic!("{case}: got {got:?}, the script said {want}"),
            }
        }
    }

    #[test]
    fn headers_and_details() {
        let d = window(Target::parse("2026-10-01").unwrap());
        assert_eq!(d.file, "Me. Daily Summaries - 2026-10.md");
        assert_eq!(d.heading, "## Daily summary 2026-10-01");
        assert_eq!(d.prev_file, "Me. Daily Summaries - 2026-09.md");
        assert!(d.header().starts_with("Append-only log of the daily summary for 2026-10. Newest"));
        assert_eq!(d.log_detail(), "daily-summary 2026-10-01");
        let w = window(Target::parse("2026-w40").unwrap());
        assert_eq!(w.file, "Me. Weekly Summaries - 2026-10.md");
        assert_eq!(w.prev_heading, "## Weekly summary 2026-W39");
        assert!(w.header().starts_with("Append-only log of the weekly summary for 2026-10."));
        assert_eq!(w.log_detail(), "weekly-summary 2026-W40");
        assert_eq!(Target::week_of(NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()).label(), "2026-W53");
    }

    #[test]
    fn old_names() {
        assert_eq!(old_name("Me. Daily Summaries - 2026-10.md").as_deref(), Some("Me. Daily Reviews - 2026-10.md"));
        assert_eq!(old_name("Victor/Me. Weekly Summaries - 2026-10.md").as_deref(), Some("Victor/Me. Weekly Reviews - 2026-10.md"));
        assert_eq!(old_name("## Weekly summary 2026-W40").as_deref(), Some("## Weekly review 2026-W40"));
        assert_eq!(new_name("## Daily review 2026-09-30").as_deref(), Some("## Daily summary 2026-09-30"));
        assert_eq!(new_name("Me. Weekly Reviews - 2026-09.md").as_deref(), Some("Me. Weekly Summaries - 2026-09.md"));
        assert_eq!(old_name("Me. Scratchpad.md"), None);
        assert_eq!(new_name("## Daily summary 2026-09-30"), None);
        assert_eq!(with_old("## Daily summary 2026-09-30"), ["## Daily summary 2026-09-30", "## Daily review 2026-09-30"]);
    }

    #[test]
    fn locates_the_block_under_either_name() {
        let w = window(Target::parse("2026-W40").unwrap());
        let files =
            |pairs: &'static [(&'static str, &'static str)]| move |p: &str| pairs.iter().find(|(f, _)| *f == p).map(|(_, t)| t.to_string());
        let new = ("Me. Weekly Summaries - 2026-10.md".to_string(), "## Weekly summary 2026-W40".to_string());
        // Nothing on file: the new names.
        assert_eq!(w.locate(files(&[])), new);
        // An old block in the old file.
        let old = files(&[("Me. Weekly Reviews - 2026-10.md", "> note\n\n## Weekly review 2026-W40\n\nBody.\n")]);
        assert_eq!(w.locate(old), ("Me. Weekly Reviews - 2026-10.md".into(), "## Weekly review 2026-W40".into()));
        // A new file without the week, beside an old one with it.
        let both = files(&[
            ("Me. Weekly Summaries - 2026-10.md", "## Weekly summary 2026-W41\n"),
            ("Me. Weekly Reviews - 2026-10.md", "## Weekly review 2026-W40\n"),
        ]);
        assert_eq!(w.locate(both).0, "Me. Weekly Reviews - 2026-10.md");
        // The new file wins when both have it; an old heading in the new file is found too.
        let moved = files(&[
            ("Me. Weekly Summaries - 2026-10.md", "## Weekly review 2026-W40\n"),
            ("Me. Weekly Reviews - 2026-10.md", "## Weekly review 2026-W40\n"),
        ]);
        assert_eq!(w.locate(moved), ("Me. Weekly Summaries - 2026-10.md".into(), "## Weekly review 2026-W40".into()));
    }
}
