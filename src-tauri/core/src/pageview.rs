// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! A page as a model is shown it within a budget (D-20261006-04). Its `sources:` list is left out
//! (it can run to thousands of characters and says nothing about the subject). A page that then
//! fits is shown whole. A bigger one is shown as an outline, every heading in order, with these
//! sections in full: the opening text, the ones that sum the page up (Current state, Summary,
//! Status…), and then the newest, from the end back, until the budget is spent. The rest show
//! only their heading and how much is left out, so the model knows they're there and doesn't
//! rewrite what it can't see: `View::full` names the sections shown whole.

use crate::markdown;

/// Sections that sum a page up: shown first.
const SUMMING: &[&str] = &[
    "current state",
    "summary",
    "overview",
    "status",
    "key facts",
    "at a glance",
    "tl;dr",
    "executive summary",
    "open questions",
    "risks",
];
/// Sections that close a page: never "the newest".
const CLOSING: &[&str] = &["see also", "related", "references", "sources", "links"];

pub struct View {
    pub text: String,
    /// Shown whole (no part left out).
    pub whole: bool,
    /// The headings (their text, lower case) whose sections, subsections and all, are shown in full.
    pub full: Vec<String>,
}

impl View {
    /// Whether the section under `heading` was shown in full, or isn't on the page at all.
    pub fn can_rewrite(&self, page: &str, heading: &str) -> bool {
        let want = norm(heading);
        self.whole || self.full.contains(&want) || !blocks(body(page).1).iter().any(|b| b.title.as_deref() == Some(want.as_str()))
    }
}

fn norm(h: &str) -> String {
    h.trim().trim_start_matches('#').trim().to_lowercase()
}

/// The frontmatter without its `sources:` list (a line saying how many there are instead), and the body.
fn body(page: &str) -> (String, &str) {
    let fm = crate::frontmatter::split(page);
    if fm.body_start == 0 {
        return (String::new(), page);
    }
    let n = crate::frontmatter::list(&fm.data, &["sources"], false).len();
    let mut out = Vec::new();
    let mut skipping = false;
    for line in page[..fm.body_start].lines() {
        if skipping && (line.starts_with(' ') || line.starts_with('\t') || line.starts_with('-')) {
            continue;
        }
        skipping = false;
        if line.starts_with("sources:") {
            out.push(format!("sources: ({n} sources, not shown)"));
            skipping = !line.contains('[');
            continue;
        }
        out.push(line.to_string());
    }
    (out.join("\n") + "\n", &page[fm.body_start..])
}

struct Block<'a> {
    /// The heading's text, lower case; None for the text before the first heading.
    title: Option<String>,
    level: usize,
    text: &'a str,
}

/// The body cut at every heading (outside code), each piece its heading and the lines under it.
fn blocks(body: &str) -> Vec<Block<'_>> {
    let mut out = Vec::new();
    let (mut start, mut title, mut level) = (0, None, 0);
    for l in markdown::lines(body, 0) {
        if l.code {
            continue;
        }
        if let Some((n, t)) = markdown::heading(l.text) {
            if l.start > start || title.is_some() {
                out.push(Block { title: title.take(), level, text: &body[start..l.start] });
            }
            (start, title, level) = (l.start, Some(norm(t)), n);
        }
    }
    out.push(Block { title, level, text: &body[start..] });
    out
}

/// The page within `budget` characters (roughly: an outline line per section left out is extra).
pub fn view(page: &str, budget: usize) -> View {
    let (front, rest) = body(page);
    let bs = blocks(rest);
    let size = |b: &Block| b.text.chars().count();
    if front.chars().count() + bs.iter().map(size).sum::<usize>() <= budget {
        let full = bs.iter().filter_map(|b| b.title.clone()).collect();
        return View { text: format!("{front}{rest}"), whole: true, full };
    }
    let mut shown = vec![false; bs.len()];
    let mut left = budget.saturating_sub(front.chars().count());
    let take = |i: usize, shown: &mut Vec<bool>, left: &mut usize| {
        if !shown[i] && size(&bs[i]) <= *left {
            shown[i] = true;
            *left -= size(&bs[i]);
        }
    };
    // The opening text, the summing-up sections, then the newest from the end back.
    if bs.first().is_some_and(|b| b.title.is_none()) {
        take(0, &mut shown, &mut left);
    }
    for (i, b) in bs.iter().enumerate() {
        if b.title.as_deref().is_some_and(|t| SUMMING.contains(&t)) {
            take(i, &mut shown, &mut left);
        }
    }
    for i in (0..bs.len()).rev() {
        if !bs[i].title.as_deref().is_some_and(|t| CLOSING.contains(&t)) {
            take(i, &mut shown, &mut left);
        }
    }
    let mut text = front;
    for (i, b) in bs.iter().enumerate() {
        if shown[i] {
            text.push_str(b.text);
        } else {
            let head = b.text.lines().next().unwrap_or("");
            let more = size(b).saturating_sub(head.chars().count() + 1);
            if b.title.is_some() {
                text.push_str(&format!("{head}\n[… not shown: {more} characters]\n\n"));
            } else {
                text.push_str(&format!("[… opening text not shown: {more} characters]\n\n"));
            }
        }
    }
    // A section is in full when it and every subsection under it were shown.
    let mut full = Vec::new();
    for (i, b) in bs.iter().enumerate() {
        let Some(t) = &b.title else { continue };
        let end = (i + 1..bs.len()).find(|&j| bs[j].level <= b.level).unwrap_or(bs.len());
        if shown[i..end].iter().all(|&s| s) {
            full.push(t.clone());
        }
    }
    View { text, whole: false, full }
}

/// A note's text within `n` characters, its `sources:` list left out: whole if it fits, else its
/// start (a quarter) and its end (the rest), cut at lines, with what's left out between. Notes
/// grow at the end (dated sections, new entries, a meeting's actions), so the end matters most.
pub fn excerpt(text: &str, n: usize) -> String {
    let (front, rest) = body(text);
    let all = format!("{front}{rest}");
    let len = all.chars().count();
    if len <= n {
        return all;
    }
    let chars: Vec<char> = all.chars().collect();
    let (head, tail) = (n / 4, n - n / 4);
    let mut a = head;
    while a > 0 && chars[a - 1] != '\n' {
        a -= 1;
    }
    let mut b = len - tail;
    while b < len && chars[b - 1] != '\n' {
        b += 1;
    }
    let (a, b) = if a == 0 || b <= a { (head, (len - tail).max(head)) } else { (a, b) };
    let start: String = chars[..a].iter().collect();
    let end: String = chars[b..].iter().collect();
    format!("{start}\n[… {} characters not shown …]\n\n{end}", b - a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_excerpt_keeps_the_start_and_more_of_the_end() {
        let note = format!(
            "---\nsources: [\"[[A]]\"]\n---\n# 1-1 Maya\n\n{}## 3 Oct\n\n- Lena takes the comms plan.\n",
            "- old line\n".repeat(500)
        );
        let e = excerpt(&note, 400);
        assert!(e.starts_with("---\nsources: (1 sources, not shown)\n---\n# 1-1 Maya"));
        assert!(e.contains("characters not shown"));
        assert!(e.ends_with("## 3 Oct\n\n- Lena takes the comms plan.\n"));
        assert!(e.chars().count() < 500);
        assert_eq!(excerpt("short\n", 400), "short\n");
    }

    fn big() -> String {
        let mut p = String::from("---\ntype: entity\nsources:\n  - \"[[Roadmap Update 2026-09-18]]\"\n  - \"[[Steerco 2026-09-30]]\"\nupdated: 2026-10-01\n---\n# Orbit App\n\nThe Orbit App is the new customer app.\n\n## Current state\n\nSoft launch end of October.\n\n");
        for m in ["May", "Jun", "Jul", "Aug", "Sep"] {
            p.push_str(&format!("## {m} 2026 update\n\n{}\n\n", "Old news. ".repeat(200)));
        }
        p.push_str("## Oct 2026 update\n\nRecon testing moves to 16 Oct.\n\n## See also\n\n- [[Lena]]\n");
        p
    }

    #[test]
    fn a_small_page_is_shown_whole_without_its_sources() {
        let p = "---\ntype: entity\nsources: [\"[[A]]\", \"[[B]]\"]\n---\n# Lena\n\n## Current state\n\nLeads design.\n";
        let v = view(p, 4_000);
        assert!(v.whole);
        assert!(v.text.contains("sources: (2 sources, not shown)\n---\n# Lena"));
        assert!(!v.text.contains("[[A]]"));
        assert!(v.can_rewrite(p, "Current state"));
    }

    #[test]
    fn a_big_page_keeps_its_outline_summary_and_newest() {
        let p = big();
        let v = view(&p, 4_000);
        assert!(!v.whole);
        assert!(v.text.contains("sources: (2 sources, not shown)"));
        assert!(v.text.contains("The Orbit App is the new customer app."));
        assert!(v.text.contains("## Current state\n\nSoft launch end of October."));
        assert!(v.text.contains("## Oct 2026 update\n\nRecon testing moves to 16 Oct."));
        // The middle is an outline: its headings, and what's left out.
        assert!(v.text.contains("## May 2026 update\n[… not shown: "));
        assert!(v.text.contains("## See also"));
        assert!(v.can_rewrite(&p, "Current state") && v.can_rewrite(&p, "## Oct 2026 update"));
        assert!(!v.can_rewrite(&p, "May 2026 update"));
        // A section that isn't there yet can be added.
        assert!(v.can_rewrite(&p, "Nov 2026 update"));
    }

    #[test]
    fn a_section_is_only_full_with_its_subsections() {
        let p = format!("# X\n\n## History\n\n### Early\n\n{}\n\n### Late\n\nRecent.\n", "Long ago. ".repeat(400));
        let v = view(&p, 200);
        assert!(v.full.contains(&"late".to_string()));
        assert!(!v.can_rewrite(&p, "History"));
    }
}
