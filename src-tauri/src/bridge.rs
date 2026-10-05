// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The MCP server's way into the running app (§10 stage 9). The server (a separate process, in Ask
//! or a session outside the app) writes a request into the app data folder's `bridge/requests/`;
//! this takes it up, hands it to the window as an `mcp-request` event, and the window runs it with
//! the same functions its screens call (src/mcpActions.ts) and answers with `mcp_reply`, which is
//! written to `bridge/replies/` for the server to read. `bridge/alive.json` says the app is up,
//! rewritten every two seconds, so the server knows when to open it.

use std::collections::HashMap;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use brainstead_core::bridge::{self as wire, Reply, Request};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::platform;

/// Replies the window owes, by request id.
#[derive(Default)]
pub struct Waiting {
    senders: Mutex<HashMap<String, mpsc::Sender<Reply>>>,
    /// The window has its listener up.
    ready: Mutex<bool>,
}

/// How long the window may take over one request. Runs answer as soon as they've started.
const WINDOW_TIMEOUT: Duration = Duration::from_secs(120);

/// Starts the heartbeat and the request loop. Not in a screenshot demo.
pub fn start(app: AppHandle) {
    let dir = wire::dir(&platform::data_dir());
    for d in [dir.join(wire::REQUESTS), dir.join(wire::REPLIES)] {
        let _ = std::fs::create_dir_all(d);
    }
    let alive = dir.join(wire::ALIVE);
    std::thread::spawn(move || loop {
        let _ = wire::write_alive(&alive, std::process::id());
        std::thread::sleep(Duration::from_secs(2));
    });
    std::thread::spawn(move || loop {
        for (path, req) in wire::take_requests(&dir.join(wire::REQUESTS)) {
            let app = app.clone();
            let replies = dir.join(wire::REPLIES);
            // Each on its own thread, so a run that takes a moment doesn't hold up a tick.
            std::thread::spawn(move || {
                let reply = handle(&app, &req);
                let _ = wire::write_reply(&replies, &req.id, &reply);
                let _ = std::fs::remove_file(&path);
            });
        }
        std::thread::sleep(Duration::from_millis(150));
    });
}

fn handle(app: &AppHandle, req: &Request) -> Reply {
    let waiting = app.state::<Waiting>();
    // The window may still be loading when the app was opened for this request.
    let start = Instant::now();
    while !*waiting.ready.lock().unwrap() {
        if start.elapsed() > Duration::from_secs(30) {
            return Reply::err("Brainstead's window didn't start in time. Try again.");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let (tx, rx) = mpsc::channel();
    waiting.senders.lock().unwrap().insert(req.id.clone(), tx);
    if app.emit_to("main", "mcp-request", req).is_err() {
        waiting.senders.lock().unwrap().remove(&req.id);
        return Reply::err("Couldn't reach Brainstead's window.");
    }
    let r = rx.recv_timeout(WINDOW_TIMEOUT).unwrap_or_else(|_| {
        Reply::err("Brainstead took too long to answer. The action may still have happened: check before trying again.")
    });
    waiting.senders.lock().unwrap().remove(&req.id);
    r
}

/// The window's answer to a request.
#[tauri::command]
pub fn mcp_reply(app: AppHandle, id: String, ok: bool, result: Value) {
    let reply = if ok { Reply { ok: true, result, error: None } } else { Reply::err(result.as_str().unwrap_or("It didn't work.")) };
    if let Some(tx) = app.state::<Waiting>().senders.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

/// The window has its listener up.
#[tauri::command]
pub fn mcp_ready(app: AppHandle) {
    *app.state::<Waiting>().ready.lock().unwrap() = true;
}
