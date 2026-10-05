// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Scheduled daily and weekly reviews: their inputs, gathered here, and the upsert of the block.
//! These replace the previous app's review scripts (`scripts/review_window.py`, `week_inputs.py`,
//! `session_logs.py`, `stuck_tasks.py`, `upsert_review_block.py`, `log_append.py`) and the task
//! queries the weekly review made through its BFF. The model only composes the block; the app
//! gathers, checks and writes.
//!
//! The scripts pinned their clock to UTC+2. Here every date is the machine's local
//! time, the same clock the user sets the schedule against, as the previous app's scheduler did.

use chrono::{DateTime, FixedOffset, Local, NaiveDateTime, TimeZone};

pub mod gather;
pub mod latest;
pub mod note;
pub mod prep;
pub mod schedule;
pub mod sessions;
pub mod target;
pub mod tasks;
pub mod write;

pub use gather::{gather, render, ReviewInputs};
pub use latest::{latest, Latest};
pub use schedule::{ReviewKind, ScheduleSettings, Weekday};
pub use target::{Target, Window};
pub use write::{extract_block, log_entry, log_insert, upsert, Upsert};

/// What the model is told to do for a daily review, after the skill of the same name.
pub const DAILY_REVIEW: &str = include_str!("../../workflows/daily-review.md");
/// What the model is told to do for a weekly review, after the skill of the same name.
pub const WEEKLY_REVIEW: &str = include_str!("../../workflows/weekly-review.md");

/// The clock dates are read in: the machine's own, or a fixed offset so tests don't depend on
/// where they run.
#[derive(Debug, Clone, Copy)]
pub enum Zone {
    Local,
    #[cfg_attr(not(test), allow(dead_code))]
    Fixed(FixedOffset),
}

impl Zone {
    pub(crate) fn to_local(self, t: NaiveDateTime) -> NaiveDateTime {
        match self {
            Zone::Local => Local.from_utc_datetime(&t).naive_local(),
            Zone::Fixed(o) => o.from_utc_datetime(&t).naive_local(),
        }
    }

    /// A modification time in ms since the epoch, as local wall-clock time.
    pub(crate) fn ms_to_local(self, ms: i64) -> NaiveDateTime {
        DateTime::from_timestamp_millis(ms).map(|d| self.to_local(d.naive_utc())).unwrap_or_default()
    }
}

/// Local times go to the window as `YYYY-MM-DDTHH:MM:SS`, with no offset.
pub(crate) fn ser_time<S: serde::Serializer>(t: &NaiveDateTime, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&t.format("%Y-%m-%dT%H:%M:%S").to_string())
}

pub(crate) fn ser_time_opt<S: serde::Serializer>(t: &Option<NaiveDateTime>, s: S) -> Result<S::Ok, S::Error> {
    match t {
        Some(t) => ser_time(t, s),
        None => s.serialize_none(),
    }
}

#[cfg(test)]
pub(crate) mod fixture {
    //! The review tests' vault: a temp copy of `tests/fixtures/vault/` with
    //! `tests/fixtures/reviews/vault/` laid over it and the modification times in
    //! `tests/fixtures/reviews/mtimes.txt`. The expected outputs in `tests/fixtures/reviews/expected/`
    //! were made by running the previous app's scripts on the same vault (`tests/fixtures/reviews/freeze.py`).

    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use chrono::{FixedOffset, NaiveDateTime};

    use super::Zone;

    /// UTC+2, which the scripts used and the frozen outputs were made in.
    pub fn zone() -> Zone {
        Zone::Fixed(FixedOffset::east_opt(2 * 3600).unwrap())
    }

    pub fn dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures")
    }

    pub fn expected(name: &str) -> serde_json::Value {
        let p = dir().join("reviews/expected").join(name);
        serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap()
    }

    /// `v` with the summary files' and headings' old names, which the scripts wrote, as they are now.
    pub fn renamed(v: serde_json::Value) -> serde_json::Value {
        use serde_json::Value;
        match v {
            Value::String(s) => Value::String(super::target::new_name(&s).unwrap_or(s)),
            Value::Array(a) => Value::Array(a.into_iter().map(renamed).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, renamed(v))).collect()),
            v => v,
        }
    }

    /// The tests' own `automated.json`, as the app would read it.
    pub fn automations() -> Vec<super::sessions::Automation> {
        super::sessions::automations(Some(&std::fs::read_to_string(dir().join("reviews/automated.json")).unwrap()))
    }

    pub fn json(name: &str) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(dir().join("reviews").join(name)).unwrap()).unwrap()
    }

    fn copy(from: &Path, to: &Path) {
        for e in walkdir::WalkDir::new(from) {
            let e = e.unwrap();
            let dest = to.join(e.path().strip_prefix(from).unwrap());
            if e.file_type().is_dir() {
                std::fs::create_dir_all(&dest).unwrap();
            } else {
                std::fs::copy(e.path(), &dest).unwrap();
            }
        }
    }

    pub fn set_mtime(p: &Path, local: &str) {
        let t = NaiveDateTime::parse_from_str(local, "%Y-%m-%d %H:%M").unwrap();
        let secs = t.and_utc().timestamp() - 2 * 3600;
        let f = std::fs::OpenOptions::new().write(true).open(p).unwrap();
        f.set_modified(UNIX_EPOCH + Duration::from_secs(secs as u64)).unwrap();
    }

    /// The vault, built in `tmp`.
    pub fn vault(tmp: &Path) -> PathBuf {
        let root = tmp.join("vault");
        copy(&dir().join("vault"), &root);
        copy(&dir().join("reviews/vault"), &root);
        for e in walkdir::WalkDir::new(&root).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            set_mtime(e.path(), "2026-01-01 12:00");
        }
        let table = std::fs::read_to_string(dir().join("reviews/mtimes.txt")).unwrap();
        for line in table.lines().filter(|l| !l.starts_with('#') && !l.trim().is_empty()) {
            let (path, when) = line.split_once('\t').unwrap();
            set_mtime(&root.join(path), when);
        }
        root
    }

    /// The synthetic Claude Code projects folder, copied so its own times don't matter.
    pub fn projects(tmp: &Path) -> PathBuf {
        let p = tmp.join("projects");
        copy(&dir().join("reviews/projects"), &p);
        // Session files are never picked by modification time: give them all a misleading one.
        for e in walkdir::WalkDir::new(&p).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let f = std::fs::OpenOptions::new().write(true).open(e.path()).unwrap();
            f.set_modified(SystemTime::now()).unwrap();
        }
        p
    }
}
