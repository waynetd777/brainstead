// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The weekly review's task arithmetic, as the previous app's `scripts/stuck_tasks.py` does it. A task
//! is stuck when it's open now and also appears in the two most recent prior weekly reviews; the
//! comparison survives checkboxes, rank tokens, date emoji, tags and wikilinks, so a raw `- [ ]`
//! line matches its mention in a review's prose. Someday/Maybe picks rotate by the ISO week number,
//! so re-running a week picks the same tasks.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::taskquery::TaskRow;

/// A weekly block's heading, `## Weekly summary 2026-W40` or, before the rename, `## Weekly review …`.
static WEEK_HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^## Weekly (?:summary|review) (\d{4}-W\d{2})[ \t\r\f\v]*$").unwrap());
static CHECKBOX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*[-*]\s*\[[ xX/]\]\s*").unwrap());
static BULLET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*[-*]\s+").unwrap());
static RANK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*\^rank-\d+\s*$").unwrap());
static MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[📅⏳✅➕🛫⏫🔼🔽]\s*\d{4}-\d{2}-\d{2}").unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"#[\w/-]+").unwrap());
static WIKILINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]").unwrap());
static EMPHASIS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[`*_]").unwrap());
static SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

/// A task as the review sees it. `id` is `<path>:<0-based line>`, as the previous app's tasks have.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTask {
    pub id: String,
    pub text: String,
    pub path: String,
    pub heading: Option<String>,
    pub tags: Vec<String>,
    pub due: Option<String>,
    pub done_on: Option<String>,
}

impl From<&TaskRow> for ReviewTask {
    fn from(t: &TaskRow) -> Self {
        ReviewTask {
            id: format!("{}:{}", t.path, t.line),
            text: t.text.clone(),
            path: t.path.clone(),
            heading: t.heading.clone(),
            tags: t.tags.clone(),
            due: t.due.clone(),
            done_on: t.done_on.clone(),
        }
    }
}

/// A task line or a review's prose reduced to comparable text.
pub fn normalise(text: &str) -> String {
    let s = CHECKBOX.replace(text, "");
    let s = BULLET.replace(&s, "");
    let s = RANK.replace(&s, "");
    let s = MARKER.replace_all(&s, "");
    let s = TAG.replace_all(&s, "");
    let s = WIKILINK.replace_all(&s, |c: &regex::Captures| c.get(2).or(c.get(1)).map_or("", |m| m.as_str()).to_string());
    let s = EMPHASIS.replace_all(&s, "");
    let s = SPACE.replace_all(&s, " ");
    s.trim().trim_end_matches('.').to_lowercase()
}

/// `(week, block text)` for every weekly block in the monthly files' texts, newest first. A week
/// in more than one file (under its new name and its old) counts once, from the first text.
pub fn review_blocks(texts: &[String]) -> Vec<(String, String)> {
    let mut blocks = Vec::new();
    for text in texts {
        let marks: Vec<_> = WEEK_HEADING.captures_iter(text).collect();
        for (i, m) in marks.iter().enumerate() {
            let start = m.get(0).unwrap().start();
            let end = marks.get(i + 1).map_or(text.len(), |n| n.get(0).unwrap().start());
            blocks.push((m[1].to_string(), text[start..end].to_string()));
        }
    }
    // Zero-padded, so the labels sort as text. Stable, as Python's sort is.
    blocks.sort_by(|a, b| b.0.cmp(&a.0));
    blocks.dedup_by(|later, first| later.0 == first.0);
    blocks
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stuck {
    /// The first `top` of them.
    pub stuck: Vec<ReviewTask>,
    pub count: usize,
    /// The weeks compared against, newest first.
    pub prior_reviews: Vec<String>,
    /// False when there weren't enough prior reviews to tell.
    pub enough: bool,
    pub note: Option<String>,
}

/// Open tasks that also appear in each of the `prior` most recent blocks. The blocks are the
/// weeks before the one being reviewed: the script took the newest blocks on file, which on a
/// re-run included the old block for the week itself.
pub fn stuck(open: &[ReviewTask], blocks: &[(String, String)], before_week: &str, prior: usize, top: usize) -> Stuck {
    let blocks: Vec<&(String, String)> = blocks.iter().filter(|b| b.0.as_str() < before_week).take(prior).collect();
    let prior_reviews: Vec<String> = blocks.iter().map(|b| b.0.clone()).collect();
    if blocks.len() < prior {
        return Stuck {
            note: Some(format!(
                "only {} prior weekly review(s) on file; the check needs {prior}. Say so in the section rather than guessing.",
                blocks.len()
            )),
            prior_reviews,
            ..Default::default()
        };
    }
    let haystacks: Vec<String> = blocks.iter().map(|b| normalise(&b.1)).collect();
    let all: Vec<&ReviewTask> = open
        .iter()
        .filter(|t| {
            let needle = normalise(&t.text);
            // Too short to match reliably.
            needle.chars().count() >= 8 && haystacks.iter().all(|h| h.contains(&needle))
        })
        .collect();
    Stuck { count: all.len(), stuck: all.into_iter().take(top).cloned().collect(), prior_reviews, enough: true, note: None }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Someday {
    pub pool: usize,
    pub picks: Vec<ReviewTask>,
}

/// `count` Someday/Maybe tasks: ordered by id, starting at (week × count) mod the pool, wrapping.
pub fn someday(tasks: &[ReviewTask], week: u32, count: usize) -> Someday {
    let tagged: Vec<&ReviewTask> = tasks.iter().filter(|t| t.tags.iter().any(|g| g.to_lowercase().contains("someday"))).collect();
    let mut pool = if tagged.is_empty() { tasks.iter().collect() } else { tagged };
    if pool.is_empty() {
        return Someday::default();
    }
    pool.sort_by(|a, b| a.id.cmp(&b.id));
    let start = (week as usize * count) % pool.len();
    let picks = (0..count.min(pool.len())).map(|i| pool[(start + i) % pool.len()].clone()).collect();
    Someday { pool: pool.len(), picks }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reviews::fixture;

    fn tasks(v: &serde_json::Value) -> Vec<ReviewTask> {
        serde_json::from_value(v.clone()).unwrap()
    }

    fn ids(t: &[ReviewTask]) -> Vec<&str> {
        t.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn normalises_like_the_script() {
        assert_eq!(
            normalise("- [ ] Confirm the launch date with Sam 📅 2026-10-03 #followup ^rank-1024"),
            "confirm the launch date with sam"
        );
        assert_eq!(normalise("- Confirm the **launch date** with [[Sam Carter|Sam]] 📅 2026-10-03"), "confirm the launch date with sam");
        assert_eq!(normalise("* [x] Ship [[Orbit App]] `now`"), "ship orbit app now");
    }

    #[test]
    fn matches_stuck_tasks_py() {
        let input = fixture::json("tasks.json");
        let open = tasks(&input["open"]);
        let tmp = fixture::dir().join("reviews/vault");
        let texts: Vec<String> = ["Me. Weekly Reviews - 2026-10.md", "Me. Weekly Reviews - 2026-09.md"]
            .iter()
            .map(|f| std::fs::read_to_string(tmp.join(f)).unwrap_or_default())
            .collect();
        let blocks = review_blocks(&texts);
        let want = fixture::expected("stuck.json");
        let got = stuck(&open, &blocks, "2026-W40", 2, 5);
        assert!(got.enough);
        assert_eq!(serde_json::to_value(&got.prior_reviews).unwrap(), want["priorReviews"]);
        assert_eq!(got.count as u64, want["count"].as_u64().unwrap());
        let want_ids: Vec<&str> = want["stuck"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
        assert_eq!(ids(&got.stuck), want_ids);
        // Re-running week 39 compares against 38 only, which isn't enough.
        let rerun = stuck(&open, &blocks, "2026-W39", 2, 5);
        assert!(!rerun.enough);
        assert_eq!(rerun.note.unwrap(), want["notEnough"]["note"].as_str().unwrap());

        let pool = tasks(&input["someday"]);
        let want = fixture::expected("someday.json");
        let got = someday(&pool, 40, 3);
        assert_eq!(got.pool as u64, want["pool"].as_u64().unwrap());
        let want_ids: Vec<&str> = want["picks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
        assert_eq!(ids(&got.picks), want_ids);
    }

    #[test]
    fn reads_new_and_old_headings_once() {
        let texts = vec![
            "## Weekly summary 2026-W40\n\nNew.\n\n## Weekly summary 2026-W39\n\nNew 39.\n".to_string(),
            "## Weekly review 2026-W39\n\nOld 39.\n\n## Weekly review 2026-W38\n\nOld 38.\n".to_string(),
        ];
        let blocks = review_blocks(&texts);
        assert_eq!(blocks.iter().map(|b| b.0.as_str()).collect::<Vec<_>>(), ["2026-W40", "2026-W39", "2026-W38"]);
        assert!(blocks[1].1.contains("New 39."));
    }

    #[test]
    fn someday_rotates_by_week() {
        let t = |id: &str| ReviewTask {
            id: id.into(),
            text: id.into(),
            path: "a.md".into(),
            heading: None,
            tags: vec!["someday-maybe".into()],
            due: None,
            done_on: None,
        };
        let pool: Vec<ReviewTask> = ["e", "a", "d", "b", "c"].iter().map(|s| t(s)).collect();
        assert_eq!(ids(&someday(&pool, 1, 3).picks), ["d", "e", "a"]);
        assert_eq!(ids(&someday(&pool, 5, 3).picks), ["a", "b", "c"]);
        assert_eq!(ids(&someday(&pool[..2], 7, 3).picks), ["e", "a"]);
        assert!(someday(&[], 7, 3).picks.is_empty());
    }
}
