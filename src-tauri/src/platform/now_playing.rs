// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The keyboard's media keys (F7, F8, F9), headphone buttons and Control Centre's Now Playing, for
//! reading aloud. macOS sends these keys to the app it thinks is playing, so the window says what
//! is being read and whether it's playing; the keys come back as `media` events to the main window
//! ("toggle", "play", "pause", "next", "previous"). Now Playing is cleared when reading stops, or
//! the app would keep the media keys from Music.

use std::ptr::NonNull;
use std::sync::Once;

use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSDictionary, NSString};
use objc2_media_player::{
    MPMediaItemPropertyTitle, MPNowPlayingInfoCenter, MPNowPlayingPlaybackState, MPRemoteCommand, MPRemoteCommandCenter,
    MPRemoteCommandEvent, MPRemoteCommandHandlerStatus,
};
use tauri::{AppHandle, Emitter};

static WIRED: Once = Once::new();

fn wire(app: &AppHandle) {
    WIRED.call_once(|| unsafe {
        let c = MPRemoteCommandCenter::sharedCommandCenter();
        let on = |cmd: &MPRemoteCommand, name: &'static str| {
            let a = app.clone();
            let h = RcBlock::new(move |_: NonNull<MPRemoteCommandEvent>| {
                let _ = a.emit_to("main", "media", name);
                MPRemoteCommandHandlerStatus::Success
            });
            cmd.setEnabled(true);
            // The command centre keeps the handler for the life of the app.
            cmd.addTargetWithHandler(&h);
        };
        on(&c.togglePlayPauseCommand(), "toggle");
        on(&c.playCommand(), "play");
        on(&c.pauseCommand(), "pause");
        on(&c.nextTrackCommand(), "next");
        on(&c.previousTrackCommand(), "previous");
    });
}

/// What's being read (`title`; none when nothing is) and whether it's playing or paused.
pub fn state(app: &AppHandle, title: Option<String>, playing: bool) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || unsafe {
        wire(&a);
        let np = MPNowPlayingInfoCenter::defaultCenter();
        match title {
            Some(t) => {
                let t = NSString::from_str(&t);
                let info = NSDictionary::<NSString, AnyObject>::from_slices(&[MPMediaItemPropertyTitle], &[&*t as &AnyObject]);
                np.setNowPlayingInfo(Some(&info));
                np.setPlaybackState(if playing { MPNowPlayingPlaybackState::Playing } else { MPNowPlayingPlaybackState::Paused });
            }
            None => {
                np.setNowPlayingInfo(None);
                np.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
            }
        }
    });
}
