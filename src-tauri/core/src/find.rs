// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Finding tasks and projects in the vault (decided 2026-10-05): the user's notes from the last 90
//! days, read by a model that suggests tasks they meant to do and projects their notes keep coming
//! back to. Each suggestion rests on a quote checked against its note, as the weekly review's
//! preparation checks its own (`reviews::prep`), and nothing that's already a task or a project is
//! suggested. Nothing here writes: the app makes an accepted suggestion as an agent change.

use std::path::Path;

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::index::Index;
use crate::reviews::prep::{already_a_task, array_items, quote_in, suggestion_id, task_words, Source};

pub const WORKFLOW: &str = include_str!("../workflows/find-tasks.md");
/// How far back a scan reads.
pub const DAYS: i64 = 90;
/// The most of one note the model is given, the most notes, and the most text in one call.
const NOTE_CHARS: usize = 6_000;
const MAX_NOTES: usize = 300;
const BATCH_CHARS: usize = 60_000;
/// The open tasks listed for the model, to keep it from suggesting them again.
const MAX_TASKS: usize = 300;
const MAX_TASK_SUGGESTIONS: usize = 12;
const MAX_PROJECT_SUGGESTIONS: usize = 3;
const MAX_FIRST_TASKS: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct Inputs {
    /// `YYYY-MM-DD`.
    pub today: String,
    /// Newest first.
    pub notes: Vec<Note>,
    /// Every project's name, any status: a project that exists isn't suggested again.
    pub projects: Vec<String>,
    /// Active projects' names, for a task's project.
    pub active: Vec<String>,
    /// Every task's words, open or done.
    pub known: Vec<String>,
    /// Open tasks' text, for the model.
    pub open: Vec<String>,
}

/// A note the scan reads: one of the user's own, not a system note, a template or a project note
/// (its tasks are already tasks).
fn readable(path: &str) -> bool {
    path.ends_with(".md")
        && !path.split('/').next().is_some_and(|f| f.eq_ignore_ascii_case("Templates"))
        && !crate::rename::is_system(path)
        && !crate::projects::is_project_path(path)
}

/// The day a note is dated, from the index's `date`: only an ISO `YYYY-MM-DD` at its start counts
/// (anything else, or a date in other characters, is no day and the note goes by when it changed).
fn note_day(date: Option<&str>) -> Option<String> {
    let d = date?.get(..10)?;
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok().map(|_| d.to_string())
}

/// What a scan on `today` reads, from the index alone: the tasks and projects there are already
/// (with no notes yet), and the paths of the notes changed or dated in the last `DAYS` days, newest
/// first. `read_notes` reads those, so the index isn't held while files are read.
pub fn gather(ix: &Index, today: NaiveDate) -> Result<(Inputs, Vec<String>), String> {
    let since = today - Duration::days(DAYS);
    let since_ms = since.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp_millis()).unwrap_or(0);
    let mut st = ix.conn().prepare("SELECT path, mtime, date FROM files WHERE layer = 'note'").map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64, Option<String>)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let since_day = since.format("%Y-%m-%d").to_string();
    let mut recent: Vec<(String, String)> = rows
        .into_iter()
        .filter(|(p, _, _)| readable(p))
        .filter_map(|(p, mtime, date)| {
            let day = note_day(date.as_deref());
            let fresh = mtime >= since_ms || day.as_deref().is_some_and(|d| d >= since_day.as_str());
            // Newest first: by the note's day when it has one, else when it last changed.
            let key = day.unwrap_or_else(|| {
                chrono::DateTime::from_timestamp_millis(mtime).map(|t| t.format("%Y-%m-%d").to_string()).unwrap_or_default()
            });
            fresh.then_some((key, p))
        })
        .collect();
    recent.sort_by(|a, b| b.cmp(a));
    let paths: Vec<String> = recent.into_iter().take(MAX_NOTES).map(|(_, p)| p).collect();
    let all = ix.all_tasks().map_err(|e| e.to_string())?;
    let projects = ix.projects().map_err(|e| e.to_string())?;
    let inputs = Inputs {
        today: today.format("%Y-%m-%d").to_string(),
        notes: Vec::new(),
        projects: projects.iter().map(|p| p.name.clone()).collect(),
        active: projects.iter().filter(|p| p.status == "active").map(|p| p.name.clone()).collect(),
        known: all.iter().map(|t| task_words(&t.text)).filter(|t| !t.is_empty()).collect(),
        open: all.iter().filter(|t| !t.done).map(|t| t.text.trim().to_string()).take(MAX_TASKS).collect(),
    };
    Ok((inputs, paths))
}

/// The notes at `paths` (from `gather`), in order, leaving out any gone or empty.
pub fn read_notes(root: &Path, paths: Vec<String>) -> Vec<Note> {
    paths
        .into_iter()
        .filter_map(|p| Some(Note { text: std::fs::read_to_string(root.join(&p)).ok()?, path: p }))
        .filter(|n| !n.text.trim().is_empty())
        .collect()
}

/// The notes in batches small enough for one call each.
pub fn batches(i: &Inputs) -> Vec<Vec<&Note>> {
    let mut out: Vec<Vec<&Note>> = Vec::new();
    let mut size = 0;
    for n in &i.notes {
        let len = n.text.chars().count().min(NOTE_CHARS);
        if out.is_empty() || size + len > BATCH_CHARS {
            out.push(Vec::new());
            size = 0;
        }
        out.last_mut().unwrap().push(n);
        size += len;
    }
    out
}

/// The whole message for one batch; `today_label` as "Friday 2 October 2026".
pub fn prompt(batch: &[&Note], i: &Inputs, today_label: &str) -> String {
    let mut s = format!("{}\n\nToday is {today_label} ({}).\n\n# Inputs\n\n## Projects\n\n", WORKFLOW.trim(), i.today);
    s.push_str(if i.projects.is_empty() { "None.\n" } else { "" });
    for p in &i.projects {
        let active = if i.active.contains(p) { "" } else { " (not active)" };
        s.push_str(&format!("- {p}{active}\n"));
    }
    s.push_str("\n## Open tasks\n\n");
    s.push_str(if i.open.is_empty() { "None.\n" } else { "" });
    for t in &i.open {
        s.push_str(&format!("- {t}\n"));
    }
    s.push_str("\n## Notes\n\n");
    for n in batch {
        let text: String = n.text.chars().take(NOTE_CHARS).collect();
        let cut = if text.len() < n.text.len() { "\n\n(cut short)" } else { "" };
        s.push_str(&format!("### {}\n\n{}{cut}\n\n", n.path, text.trim()));
    }
    s.push_str("Answer with the JSON array only.");
    s
}

/// One suggestion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// Stable across scans, so one skipped or accepted isn't suggested again.
    pub id: String,
    /// task or project.
    pub kind: String,
    /// The task, or the project's name.
    pub text: String,
    /// A task's project, by name; None for the To Do list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    /// A task that's waiting on someone (`#waiting-for`).
    #[serde(default)]
    pub waiting: bool,
    /// A project's outcome.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    /// A project's first next actions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tasks: Vec<String>,
    pub sources: Vec<Source>,
}

#[derive(Deserialize)]
struct RawSource {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    quote: Option<String>,
}

#[derive(Deserialize)]
struct Raw {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    due: Option<String>,
    #[serde(default)]
    waiting: Option<bool>,
    #[serde(default)]
    outcome: Option<String>,
    #[serde(default)]
    source: Option<RawSource>,
    #[serde(default)]
    sources: Vec<RawSource>,
    #[serde(default)]
    tasks: Vec<String>,
}

fn one_line(s: Option<String>, max: usize) -> Option<String> {
    s.map(|x| x.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect::<String>())
        .filter(|x| !x.is_empty() && x != "null")
}

/// A project name that makes a good file name, as the Projects screen allows.
pub fn good_name(n: &str) -> bool {
    !n.is_empty() && !n.starts_with('.') && !n.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '[', ']', '#', '^'])
}

/// The suggestions in a model's answer for one batch, each checked; `read` gives a note's text by
/// its path. `seen` holds the ids already decided (skipped or accepted) or suggested in an earlier
/// batch, which aren't given again. What fails a check is dropped, with why in the second list.
pub fn parse(
    answer: &str,
    i: &Inputs,
    read: impl Fn(&str) -> Option<String>,
    seen: &[String],
) -> Result<(Vec<Suggestion>, Vec<String>), String> {
    let (raw, stopped) = array_items(answer)?;
    let mut out: Vec<Suggestion> = Vec::new();
    let mut dropped: Vec<String> = Vec::new();
    if stopped {
        dropped.push("the rest of the answer: it stopped part way, or couldn't be read".into());
    }
    for v in raw {
        let Ok(r) = serde_json::from_value::<Raw>(v) else {
            dropped.push("not a suggestion".into());
            continue;
        };
        match check(r, i, &read) {
            Ok(sg) if seen.contains(&sg.id) || out.iter().any(|x| x.id == sg.id) => dropped.push(format!("{}: suggested before", sg.text)),
            Ok(sg) => {
                let (cap, n) = match sg.kind.as_str() {
                    "task" => (MAX_TASK_SUGGESTIONS, out.iter().filter(|x| x.kind == "task").count()),
                    _ => (MAX_PROJECT_SUGGESTIONS, out.iter().filter(|x| x.kind == "project").count()),
                };
                if n >= cap {
                    dropped.push(format!("{}: too many", sg.text));
                } else {
                    out.push(sg);
                }
            }
            Err(e) => dropped.push(e),
        }
    }
    Ok((out, dropped))
}

fn source(s: RawSource, what: &str, read: &impl Fn(&str) -> Option<String>) -> Result<Source, String> {
    let (Some(path), Some(quote)) = (one_line(s.path, 400), one_line(s.quote, 400)) else {
        return Err(format!("{what}: a source needs a note and a quote"));
    };
    let path = path.trim_start_matches("[[").trim_end_matches("]]").to_string();
    let path = if path.ends_with(".md") { path } else { format!("{path}.md") };
    let quote = quote.trim_matches(['"', '“', '”']).to_string();
    if crate::trash::safe_rel(&path).is_err() || !read(&path).is_some_and(|t| quote_in(&quote, &t)) {
        return Err(format!("{what}: the quote isn't in {path}"));
    }
    Ok(Source { path, quote })
}

fn check(r: Raw, i: &Inputs, read: &impl Fn(&str) -> Option<String>) -> Result<Suggestion, String> {
    let date = |d: Option<String>| one_line(d, 10).filter(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok());
    match r.kind.trim().to_lowercase().as_str() {
        "task" => {
            let text = one_line(r.text, 200).ok_or("a task with no words")?;
            if already_a_task(&text, &i.known) {
                return Err(format!("{text}: already a task"));
            }
            let src = r.source.or_else(|| r.sources.into_iter().next()).ok_or_else(|| format!("{text}: no source"))?;
            let project = one_line(r.project, 200).and_then(|p| {
                let p = p.trim_start_matches("[[").trim_end_matches("]]").trim_start_matches("Project. ").to_string();
                i.active.iter().find(|x| x.eq_ignore_ascii_case(&p)).cloned()
            });
            Ok(Suggestion {
                id: suggestion_id("find", "task", &text),
                kind: "task".into(),
                sources: vec![source(src, &text, read)?],
                text,
                project,
                due: date(r.due),
                waiting: r.waiting.unwrap_or(false),
                outcome: None,
                tasks: vec![],
            })
        }
        "project" => {
            let name = one_line(r.name.or(r.text), 80).ok_or("a project with no name")?;
            let name = name.trim_start_matches("Project. ").to_string();
            if !good_name(&name) {
                return Err(format!("{name}: not a name a project can have"));
            }
            if i.projects.iter().any(|p| p.eq_ignore_ascii_case(&name)) {
                return Err(format!("{name}: already a project"));
            }
            let sources: Vec<Source> = r.sources.into_iter().chain(r.source).map(|s| source(s, &name, read)).collect::<Result<_, _>>()?;
            if sources.is_empty() {
                return Err(format!("{name}: no source"));
            }
            let mut tasks: Vec<String> = Vec::new();
            for t in r.tasks.into_iter().filter_map(|t| one_line(Some(t), 200)) {
                if !already_a_task(&t, &i.known) && !tasks.contains(&t) && tasks.len() < MAX_FIRST_TASKS {
                    tasks.push(t);
                }
            }
            Ok(Suggestion {
                id: suggestion_id("find", "project", &name),
                kind: "project".into(),
                text: name,
                project: None,
                due: None,
                waiting: false,
                outcome: one_line(r.outcome, 300),
                tasks,
                sources,
            })
        }
        k => Err(format!("not a task or a project: {k:?}")),
    }
}

/// Whether a suggestion still holds when looking again: not a task or a project by now (the user
/// may have added it by hand), and its quotes still in their notes.
pub fn still_holds(s: &Suggestion, i: &Inputs, read: impl Fn(&str) -> Option<String>) -> bool {
    let made = match s.kind.as_str() {
        "project" => i.projects.iter().any(|p| p.eq_ignore_ascii_case(&s.text)),
        _ => already_a_task(&s.text, &i.known),
    };
    !made && s.sources.iter().all(|x| read(&x.path).is_some_and(|t| quote_in(&x.quote, &t)))
}

/// A project's note, as the Projects screen makes it, with its first next actions under Next actions.
pub fn project_text(outcome: Option<&str>, tasks: &[String]) -> String {
    let note = crate::projects::project_note("active", None, outcome);
    let (mut lines, eol, trailing) = crate::write::split_lines(&note);
    for t in tasks {
        crate::write::append_under(&mut lines, crate::projects::NEXT_ACTIONS, &format!("- [ ] {t}"));
    }
    crate::write::join_lines(&lines, &eol, trailing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs() -> Inputs {
        Inputs {
            today: "2026-10-05".into(),
            notes: vec![],
            projects: vec!["Orbit App launch".into(), "Old thing".into()],
            active: vec!["Orbit App launch".into()],
            known: vec![task_words("- [ ] Call the bank about the card")],
            open: vec!["Call the bank about the card".into()],
        }
    }

    const NOTE: &str = "# Launch plan\n\nI'll book a venue for the party once we have a date. Theo will send the Q2 budget figures next Friday. The office move keeps slipping.";

    fn read(p: &str) -> Option<String> {
        (p == "Meeting. Launch plan - 2026-10-01.md").then(|| NOTE.to_string())
    }

    #[test]
    fn checked_tasks_and_projects() {
        let answer = r#"[
          {"kind": "task", "text": "Book the venue for the launch party", "project": "orbit app launch", "due": null, "waiting": false, "source": {"path": "Meeting. Launch plan - 2026-10-01", "quote": "I'll book a venue for the party"}},
          {"kind": "task", "text": "Theo: Q2 budget figures", "project": "Nowhere", "due": "2026-10-09", "waiting": true, "source": {"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "Theo will send the Q2 budget figures"}},
          {"kind": "task", "text": "Invent something", "source": {"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "words that are not there at all"}},
          {"kind": "task", "text": "Call the bank about the card", "source": {"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "The office move keeps slipping"}},
          {"kind": "project", "name": "Office move", "outcome": "We work from the new office by June.", "sources": [{"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "The office move keeps slipping"}], "tasks": ["Ask facilities for the dates", "Call the bank about the card"]},
          {"kind": "project", "name": "Old thing", "sources": [{"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "The office move keeps slipping"}]},
          {"kind": "project", "name": "A/B", "sources": [{"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "The office move keeps slipping"}]}
        ]"#;
        let (s, dropped) = parse(answer, &inputs(), read, &[]).unwrap();
        assert_eq!(
            s.iter().map(|x| x.text.as_str()).collect::<Vec<_>>(),
            ["Book the venue for the launch party", "Theo: Q2 budget figures", "Office move"]
        );
        assert_eq!(s[0].project.as_deref(), Some("Orbit App launch"));
        assert_eq!(s[0].sources[0].path, "Meeting. Launch plan - 2026-10-01.md");
        assert_eq!((s[1].project.as_deref(), s[1].due.as_deref(), s[1].waiting), (None, Some("2026-10-09"), true));
        assert_eq!(s[2].tasks, ["Ask facilities for the dates"], "an existing task isn't a first next action");
        assert_eq!(dropped.len(), 4, "{dropped:?}");
        // Asked again, what's decided isn't suggested again.
        let (again, _) = parse(answer, &inputs(), read, &[s[0].id.clone()]).unwrap();
        assert!(!again.iter().any(|x| x.id == s[0].id));
    }

    #[test]
    fn a_suggestion_lapses_once_made_or_its_note_changes() {
        let (s, _) = parse(
            r#"[{"kind": "task", "text": "Book the venue for the launch party", "source": {"path": "Meeting. Launch plan - 2026-10-01.md", "quote": "I'll book a venue for the party"}}]"#,
            &inputs(),
            read,
            &[],
        )
        .unwrap();
        assert!(still_holds(&s[0], &inputs(), read));
        // Added by hand since.
        let mut i = inputs();
        i.known.push(task_words("- [ ] Book the venue for the launch party"));
        assert!(!still_holds(&s[0], &i, read));
        // Its note no longer says it.
        assert!(!still_holds(&s[0], &inputs(), |_| Some("Something else.".into())));
    }

    #[test]
    fn a_project_note_with_its_first_actions() {
        let t = project_text(Some("Done by June."), &["Ask facilities".into()]);
        assert!(t.starts_with("---\nstatus: active\noutcome: Done by June.\n---"));
        assert!(t.contains("## Next actions\n\n- [ ] Ask facilities\n"), "{t}");
    }

    #[test]
    fn only_an_iso_date_is_a_day() {
        assert_eq!(note_day(Some("2026-10-02")).as_deref(), Some("2026-10-02"));
        assert_eq!(note_day(Some("2026-10-02T09:30")).as_deref(), Some("2026-10-02"));
        // Not a date, or a multi-byte character where a byte slice would split it: no day, no panic.
        assert_eq!(note_day(Some("2026-10-0é")), None);
        assert_eq!(note_day(Some("二〇二六年十月二日")), None);
        assert_eq!(note_day(Some("2026-13-40")), None);
        assert_eq!(note_day(Some("2026")), None);
        assert_eq!(note_day(None), None);
    }

    #[test]
    fn notes_in_batches_and_the_prompt() {
        let mut i = inputs();
        // Each note counts as at most what the model is given of it.
        i.notes = (0..10).map(|n| Note { path: format!("n{n}.md"), text: "x".repeat(25_000) }).collect();
        assert_eq!(batches(&i).iter().map(Vec::len).collect::<Vec<_>>(), [10]);
        i.notes.push(Note { path: "more.md".into(), text: "y".repeat(100) });
        assert_eq!(batches(&i).iter().map(Vec::len).collect::<Vec<_>>(), [10, 1]);
        let p = prompt(&batches(&i)[0], &i, "Monday 5 October 2026");
        assert!(p.contains("- Old thing (not active)") && p.contains("- Call the bank about the card") && p.contains("### n0.md"));
        assert!(
            readable("Idea. X.md") && !readable("Templates/Meeting.md") && !readable("Project. Orbit App launch.md") && !readable("log.md")
        );
    }
}
