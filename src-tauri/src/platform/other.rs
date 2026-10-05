// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Windows and Linux: enough to build and run.

use std::path::{Path, PathBuf};

pub fn native_host_dirs() -> Vec<(&'static str, PathBuf)> {
    if cfg!(windows) {
        return vec![];
    }
    let Some(base) = dirs::config_dir() else { return vec![] };
    [("Chrome", "google-chrome"), ("Chromium", "chromium"), ("Edge", "microsoft-edge"), ("Brave", "BraveSoftware/Brave-Browser")]
        .into_iter()
        .filter(|(_, d)| base.join(d).is_dir())
        .map(|(n, d)| (n, base.join(d).join("NativeMessagingHosts")))
        .collect()
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("Brainstead")
}

pub fn quick_look(path: &Path) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

pub fn open_at_login() -> Option<bool> {
    None
}

pub fn set_open_at_login(_on: bool) -> Result<(), String> {
    Err("Opening at login isn't built for this system yet.".into())
}

pub fn reveal(path: &Path) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

pub fn full_disk_access() -> Option<bool> {
    Some(true)
}

pub fn open_full_disk_access_settings() -> Result<(), String> {
    Ok(())
}

/// Plain text only here; the HTML half needs each system's clipboard API.
pub fn copy_html(_html: &str, _text: &str) -> Result<(), String> {
    Err("Rich copy isn't available on this system yet.".into())
}
