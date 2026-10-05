// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The app's own log, so a problem in the installed app (which has no terminal) leaves something to
//! read: one file a day in the app data folder's `logs/`, older ones deleted after Settings › About's
//! "Keep logs for" (`logDays`, 14 by default), as the previous app's rotating logs were. `applog!`
//! writes a line there and to stderr; a panic is written there too.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DEFAULT_DAYS: u64 = 14;

struct Log {
    dir: PathBuf,
    day: String,
    file: Option<File>,
}

static LOG: Mutex<Option<Log>> = Mutex::new(None);

pub fn dir(data: &Path) -> PathBuf {
    data.join("logs")
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn open(dir: &Path, day: &str) -> Option<File> {
    std::fs::create_dir_all(dir).ok()?;
    OpenOptions::new().create(true).append(true).open(dir.join(format!("brainstead-{day}.log"))).ok()
}

/// Deletes `brainstead-YYYY-MM-DD.log` files from before the last `days` days.
pub fn prune(dir: &Path, days: u64, today: &str) -> usize {
    let Ok(t) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") else { return 0 };
    let cutoff = t - chrono::Duration::days(days.max(1) as i64 - 1);
    let mut n = 0;
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(d) = name.strip_prefix("brainstead-").and_then(|s| s.strip_suffix(".log")) else { continue };
        if chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok_and(|d| d < cutoff) && std::fs::remove_file(e.path()).is_ok() {
            n += 1;
        }
    }
    n
}

/// Starts the log: prunes old files, opens today's, and writes panics to it.
pub fn init(data: &Path, days: u64) {
    let dir = dir(data);
    let day = today();
    prune(&dir, days, &day);
    let file = open(&dir, &day);
    *LOG.lock().unwrap_or_else(|e| e.into_inner()) = Some(Log { dir, day, file });
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write(&format!("panic: {info}\n{}", std::backtrace::Backtrace::force_capture()));
        default(info);
    }));
    write(&format!("Brainstead {} started", env!("CARGO_PKG_VERSION")));
}

/// One line, stamped with the time, to the log file (a new one each day).
pub fn write(line: &str) {
    let mut g = LOG.lock().unwrap_or_else(|e| e.into_inner());
    let Some(log) = g.as_mut() else { return };
    let day = today();
    if day != log.day {
        log.file = open(&log.dir, &day);
        log.day = day;
    }
    if let Some(f) = log.file.as_mut() {
        let _ = writeln!(f, "{} {line}", chrono::Local::now().format("%H:%M:%S"));
    }
}

/// Like `eprintln!`, and into the log file.
#[macro_export]
macro_rules! applog {
    ($($t:tt)*) => {{
        let line = format!($($t)*);
        eprintln!("{line}");
        $crate::applog::write(&line);
    }};
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_days() {
        let d = std::env::temp_dir().join(format!("bs-logs-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        for f in [
            "brainstead-2026-09-01.log",
            "brainstead-2026-09-19.log",
            "brainstead-2026-09-20.log",
            "brainstead-2026-10-03.log",
            "other.log",
        ] {
            std::fs::write(d.join(f), "x").unwrap();
        }
        assert_eq!(prune(&d, 14, "2026-10-03"), 2);
        let mut left: Vec<String> = std::fs::read_dir(&d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["brainstead-2026-09-20.log", "brainstead-2026-10-03.log", "other.log"]);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
