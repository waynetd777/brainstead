// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Sync runs started by hand: Settings › Sync's Sync now and Fetch again, the Sources bar's Sync
//! now, and their MCP tools (`teams_sync` now and fetch_again, `pull_teams_outlook`). Each starts
//! in the background and answers at once with its run id; how it's going and what it did are read
//! back from here (`sync_jobs`, the `sync-job` event), so a long back-fill never outlasts the wait
//! of whoever started it (D-20261127-19). Kept in memory, the last few, for this run of the app.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Emitter;

use super::{pull, run};
use crate::platform;

/// How many finished runs are kept. Ids count up from `sync-1`, so `run_status` tells one dropped
/// from the list (finished earlier) from one never started (`syncRunGone` in src/mcpActions.ts).
const KEEP: usize = 10;

/// What a run is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// One pass (Sync now).
    Now,
    /// A back-fill from a day (Fetch again).
    FetchAgain,
    /// An assistant's pull of a topic (`pull_teams_outlook`).
    Pull,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: Kind,
    /// running, done or failed (it couldn't start, or its thread died).
    pub status: &'static str,
    /// Local `YYYY-MM-DDTHH:MM:SS`.
    pub started: String,
    pub finished: Option<String>,
    /// Fetch again's first day.
    pub from: Option<String>,
    /// A pull's topic, days and kinds.
    pub query: Option<String>,
    pub days: Option<u32>,
    pub kinds: Vec<String>,
    /// A pass's report, once it's done.
    pub report: Option<run::Report>,
    /// A pull's outcome, once it's done.
    pub pulled: Option<pull::Outcome>,
    pub error: Option<String>,
}

static JOBS: Mutex<Vec<Job>> = Mutex::new(Vec::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

fn now() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn jobs() -> std::sync::MutexGuard<'static, Vec<Job>> {
    JOBS.lock().unwrap_or_else(|e| e.into_inner())
}

/// A new running job, newest first, keeping the running ones and the last [`KEEP`] finished.
fn begin(list: &mut Vec<Job>, mut job: Job) -> Job {
    job.id = format!("sync-{}", NEXT.fetch_add(1, Ordering::SeqCst));
    list.insert(0, job.clone());
    let mut finished = 0;
    list.retain(|j| {
        if j.status == "running" {
            return true;
        }
        finished += 1;
        finished <= KEEP
    });
    job
}

/// Marks `id` finished with what `f` sets on it, and gives it back.
fn end(list: &mut [Job], id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
    let j = list.iter_mut().find(|j| j.id == id)?;
    f(j);
    if j.status == "running" {
        j.status = "done";
    }
    j.finished = Some(now());
    Some(j.clone())
}

/// The pass already running, as a job, when one was started by hand.
fn pass_running(list: &[Job]) -> Option<&Job> {
    list.iter().find(|j| j.status == "running" && j.kind != Kind::Pull)
}

fn blank(kind: Kind) -> Job {
    Job {
        id: String::new(),
        kind,
        status: "running",
        started: now(),
        finished: None,
        from: None,
        query: None,
        days: None,
        kinds: vec![],
        report: None,
        pulled: None,
        error: None,
    }
}

/// Starts Sync now, or with `from` (`YYYY-MM-DD`) Fetch again, in the background and answers with
/// its job. Refused at once, not run later, when a pass is already going.
#[tauri::command]
pub fn sync_start(app: tauri::AppHandle, from: Option<String>) -> Result<Job, String> {
    let from = super::parse_from(from)?;
    let job = {
        let mut list = jobs();
        if let Some(j) = pass_running(&list) {
            return Err(format!("A sync is already running ({}).", j.id));
        }
        if run::running() {
            // Not a run run_status lists: say so, rather than send the caller there.
            return Err("A scheduled sync pass (the one every 15 minutes) is running; try again shortly.".into());
        }
        let mut j = blank(if from.is_some() { Kind::FetchAgain } else { Kind::Now });
        j.from = from.map(|d| d.format("%Y-%m-%d").to_string());
        begin(&mut list, j)
    };
    let _ = app.emit("sync-job", &job);
    let id = job.id.clone();
    tauri::async_runtime::spawn(async move {
        let r = tauri::async_runtime::spawn_blocking(move || run::run_from(&platform::data_dir(), from)).await;
        let done = end(&mut jobs(), &id, |j| match r {
            Ok(report) => {
                run::tell_replied(&app, &report);
                if report.blocked.is_some() {
                    j.status = "failed";
                    j.error = report.blocked.clone();
                }
                j.report = Some(report);
            }
            Err(e) => {
                j.status = "failed";
                j.error = Some(format!("The sync stopped: {e}"));
            }
        });
        if let Some(d) = done {
            let _ = app.emit("sync-job", &d);
        }
    });
    Ok(job)
}

/// Starts an assistant's pull of `query` over the last `days` days in the background, answering
/// with its job; its outcome is the job's `pulled` once done.
#[tauri::command]
pub fn sync_pull_start(app: tauri::AppHandle, query: Option<String>, days: Option<u32>, kinds: Option<Vec<String>>) -> Job {
    let q = query.unwrap_or_default();
    let days = days.unwrap_or(7);
    let want = kinds.unwrap_or_default();
    let job = {
        let mut j = blank(Kind::Pull);
        j.query = Some(q.clone());
        j.days = Some(days);
        j.kinds = want.clone();
        begin(&mut jobs(), j)
    };
    let _ = app.emit("sync-job", &job);
    let id = job.id.clone();
    tauri::async_runtime::spawn(async move {
        let r = tauri::async_runtime::spawn_blocking(move || pull::pull(&platform::data_dir(), &q, days, super::kinds_of(&want))).await;
        let done = end(&mut jobs(), &id, |j| match r {
            Ok(o) => {
                if o.blocked.is_some() {
                    j.status = "failed";
                    j.error = o.blocked.clone();
                }
                j.pulled = Some(o);
            }
            Err(e) => {
                j.status = "failed";
                j.error = Some(format!("The pull stopped: {e}"));
            }
        });
        if let Some(d) = done {
            let _ = app.emit("sync-job", &d);
        }
    });
    job
}

/// The sync runs started by hand in this run of the app, newest first.
#[tauri::command]
pub fn sync_jobs() -> Vec<Job> {
    jobs().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_are_listed_newest_first_and_only_the_last_finished_are_kept() {
        let mut list = vec![];
        let first = begin(&mut list, blank(Kind::FetchAgain));
        assert!(first.id.starts_with("sync-"));
        assert_eq!(pass_running(&list).map(|j| j.id.clone()), Some(first.id.clone()), "a pass going refuses another");
        let pull = begin(&mut list, blank(Kind::Pull));
        assert_eq!(list[0].id, pull.id);
        let done = end(&mut list, &first.id, |j| j.report = Some(run::Report { chats: 2, ..Default::default() })).unwrap();
        assert_eq!(done.status, "done");
        assert!(done.finished.is_some());
        assert!(pass_running(&list).is_none(), "a pull doesn't hold a pass up");
        let failed = end(&mut list, &pull.id, |j| {
            j.status = "failed";
            j.error = Some("Sync is off".into());
        })
        .unwrap();
        assert_eq!(failed.status, "failed");
        assert!(end(&mut list, "sync-none", |_| {}).is_none());
        for _ in 0..(KEEP + 3) {
            let j = begin(&mut list, blank(Kind::Now));
            end(&mut list, &j.id, |_| {});
        }
        let going = begin(&mut list, blank(Kind::Now));
        assert_eq!(list.len(), KEEP + 1, "the running one and the last {KEEP} finished");
        assert_eq!(list[0].id, going.id);
    }
}
