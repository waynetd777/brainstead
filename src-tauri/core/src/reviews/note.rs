// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The guided weekly review's own note, one per week: `Me. Weekly Review - 2026-W40.md` in the
//! vault root, written when you finish the review (src-tauri/src/weekly.rs) and read by the weekly
//! summary as one of its inputs. It isn't a summary: the summaries are `Me. Weekly Summaries -
//! YYYY-MM.md` (once `Me. Weekly Reviews - YYYY-MM.md`, with an `s`, which is why this name has
//! none). Nor is it a system note: the user may edit, rename or delete it.
//!
//! Finishing the week again rewrites the note above the [`KEPT`] heading and keeps everything from
//! that heading on. If the heading is gone, the whole old note is kept under a new one: nothing
//! the user wrote is lost.

use chrono::{Datelike, NaiveDateTime};

use super::Window;

/// The heading under which the user's own additions are kept when the review is finished again.
pub const KEPT: &str = "## Added later";

const KEPT_HINT: &str = "Write anything else here: finishing this week's review again keeps it.";

/// The note's file name for a week label (`2026-W40`).
pub fn file_name(week: &str) -> String {
    format!("Me. Weekly Review - {week}.md")
}

/// "28 Sep – 4 Oct 2026"; both years when the week spans two.
fn dates(w: &Window) -> String {
    let (a, b) = (w.first_day(), w.last_day());
    let first = if a.year() == b.year() { a.format("%-d %b") } else { a.format("%-d %b %Y") };
    format!("{first} – {}", b.format("%-d %b %Y"))
}

/// The note's text: its title, the week's dates and when it was finished, `body` (what the review
/// did and the user's notes), then the [`KEPT`] section, taken from `old` (the note on file) when
/// there is one.
pub fn compose(w: &Window, finished: NaiveDateTime, body: &str, old: Option<&str>) -> String {
    let head = format!("# Weekly review {}\n\n{} · finished {}", w.label(), dates(w), finished.format("%Y-%m-%d %H:%M"));
    let kept = match old.map(|o| o.replace("\r\n", "\n")).filter(|o| !o.trim().is_empty()) {
        None => format!("{KEPT}\n\n{KEPT_HINT}"),
        Some(o) => {
            let lines: Vec<&str> = o.lines().collect();
            match lines.iter().position(|l| l.trim() == KEPT) {
                Some(i) => lines[i..].join("\n").trim_end().to_string(),
                None => format!("{KEPT}\n\n{}", o.trim()),
            }
        }
    };
    let body = body.trim();
    let parts: Vec<&str> = [head.as_str(), body, kept.as_str()].into_iter().filter(|p| !p.is_empty()).collect();
    parts.join("\n\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reviews::target::{window, Target};

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn the_name_is_its_own_and_not_a_summary() {
        assert_eq!(file_name("2026-W40"), "Me. Weekly Review - 2026-W40.md");
        // Not read as the summaries' old name, and no date taken from the week.
        assert_eq!(crate::reviews::target::new_name(&file_name("2026-W40")), None);
        let n = crate::filename::parse(&file_name("2026-W40"));
        assert_eq!((n.kind.as_deref(), n.title.as_str(), n.date), (Some("Me"), "Weekly Review - 2026-W40", None));
    }

    #[test]
    fn writes_the_review() {
        let w = window(Target::parse("2026-W40").unwrap());
        let body = "11 of 11 steps done.\n\n- Orbit App launch completed\n\nA good week.";
        assert_eq!(
            compose(&w, at("2026-10-04 17:32"), body, None),
            "# Weekly review 2026-W40\n\n28 Sep – 4 Oct 2026 · finished 2026-10-04 17:32\n\n11 of 11 steps done.\n\n- Orbit App launch completed\n\nA good week.\n\n## Added later\n\nWrite anything else here: finishing this week's review again keeps it.\n"
        );
        let w = window(Target::parse("2026-W01").unwrap());
        assert!(compose(&w, at("2026-01-02 09:00"), "x", None).contains("29 Dec 2025 – 4 Jan 2026"));
    }

    #[test]
    fn finishing_again_keeps_what_was_added() {
        let w = window(Target::parse("2026-W40").unwrap());
        let first = compose(&w, at("2026-10-03 17:00"), "Old.", None);
        let edited = first.replace(
            "finishing this week's review again keeps it.",
            "finishing this week's review again keeps it.\n\n- Ask Lena about the venue",
        );
        let again = compose(&w, at("2026-10-04 09:00"), "New.", Some(&edited.replace('\n', "\r\n")));
        assert!(
            again.starts_with("# Weekly review 2026-W40\n\n28 Sep – 4 Oct 2026 · finished 2026-10-04 09:00\n\nNew.\n\n## Added later\n")
        );
        assert!(again.ends_with("- Ask Lena about the venue\n"));
        assert!(!again.contains("Old."));
        // The heading taken away: the whole old note is kept under a new one.
        let bare = "# My week\n\nThoughts.\n";
        assert!(compose(&w, at("2026-10-04 09:00"), "New.", Some(bare)).ends_with("New.\n\n## Added later\n\n# My week\n\nThoughts.\n"));
    }
}
