// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Reading aloud's commands (src/speech.ts): the voices, speak, pause, stop, Now Playing and
//! keeping the screen awake, through `platform`. They are synchronous on purpose: Tauri runs those
//! on the main thread in the order the window sends them, so a stop can't land after the next
//! speak, as it could with async commands.

use tauri::AppHandle;

use crate::{platform, scene};

#[tauri::command]
pub fn tts_voices() -> Vec<platform::Voice> {
    platform::speech_voices()
}

#[tauri::command]
pub fn tts_speak(app: AppHandle, id: u64, text: String, voice: Option<String>, rate: f32) {
    // A screenshot demo says nothing.
    if scene().is_none() {
        platform::speech_speak(&app, id, text, voice, rate);
    }
}

#[tauri::command]
pub fn tts_pause(app: AppHandle, on: bool) {
    platform::speech_pause(&app, on);
}

#[tauri::command]
pub fn tts_stop(app: AppHandle) {
    platform::speech_stop(&app);
}

/// What's being read, for Now Playing and the media keys; `title` none clears it.
#[tauri::command]
pub fn media_state(app: AppHandle, title: Option<String>, playing: bool) {
    if scene().is_none() {
        platform::now_playing(&app, title, playing);
    }
}

#[tauri::command]
pub fn keep_awake(on: bool) -> Result<(), String> {
    if scene().is_some() {
        return Ok(());
    }
    platform::keep_awake(on)
}

#[cfg(test)]
mod tests {
    #[test]
    fn keeping_awake_off_is_harmless() {
        // Turning it off when it was never on does nothing and doesn't fail, on every system.
        assert!(super::platform::keep_awake(false).is_ok());
    }
}
