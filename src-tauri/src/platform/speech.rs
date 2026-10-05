// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Reading aloud through macOS's own synthesiser, AVSpeechSynthesizer. WebKit's speechSynthesis
//! lists only the voices that ship with the system and hides the Premium and Enhanced ones people
//! download, and its pause and resume aren't reliable, so the window speaks through here. Each
//! utterance carries the window's id; the word about to be spoken (its UTF-16 range, as JavaScript
//! indexes strings) and the utterance's end come back as `tts` events to the main window.
//!
//! The synthesiser must live on the main thread, and it holds its delegate weakly, so both are kept
//! in a main-thread `thread_local!`. The commands that call these are synchronous, so a stop and
//! the next speak run in the order the window sent them.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_avf_audio::{
    AVSpeechBoundary, AVSpeechSynthesisVoice, AVSpeechSynthesizer, AVSpeechSynthesizerDelegate, AVSpeechUtterance,
    AVSpeechUtteranceDefaultSpeechRate, AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceMinimumSpeechRate,
};
use objc2_foundation::{NSObject, NSObjectProtocol, NSRange, NSString};
use tauri::{AppHandle, Emitter};

use super::{SpeechEvent, Voice};

pub struct Ivars {
    app: AppHandle,
    /// Utterance address → the window's id. The synthesiser holds each utterance until its finish
    /// or cancel callback, so an address isn't reused while it's in here.
    ids: Mutex<HashMap<usize, u64>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = Ivars]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl AVSpeechSynthesizerDelegate for Delegate {
        #[unsafe(method(speechSynthesizer:willSpeakRangeOfSpeechString:utterance:))]
        fn will_speak(&self, _s: &AVSpeechSynthesizer, r: NSRange, u: &AVSpeechUtterance) {
            self.send(u, "word", r.location, r.length, false);
        }

        #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
        fn did_finish(&self, _s: &AVSpeechSynthesizer, u: &AVSpeechUtterance) {
            self.send(u, "end", 0, 0, true);
        }

        #[unsafe(method(speechSynthesizer:didCancelSpeechUtterance:))]
        fn did_cancel(&self, _s: &AVSpeechSynthesizer, u: &AVSpeechUtterance) {
            self.ivars().ids.lock().unwrap().remove(&(u as *const _ as usize));
        }
    }
);

impl Delegate {
    fn send(&self, u: &AVSpeechUtterance, kind: &'static str, char: usize, len: usize, last: bool) {
        let key = u as *const _ as usize;
        let mut ids = self.ivars().ids.lock().unwrap();
        let id = if last { ids.remove(&key) } else { ids.get(&key).copied() };
        drop(ids);
        if let Some(id) = id {
            let _ = self.ivars().app.emit_to("main", "tts", SpeechEvent { id, kind, char, len });
        }
    }
}

thread_local! {
    /// On the main thread. The synthesiser holds its delegate weakly, so both are kept here.
    static SYNTH: RefCell<Option<(Retained<AVSpeechSynthesizer>, Retained<Delegate>)>> = const { RefCell::new(None) };
}

fn with_synth(app: &AppHandle, f: impl FnOnce(&AVSpeechSynthesizer, &Delegate) + Send + 'static) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        SYNTH.with(|cell| {
            let mut cell = cell.borrow_mut();
            let (synth, del) = cell.get_or_insert_with(|| {
                let del = Delegate::alloc().set_ivars(Ivars { app: a, ids: Mutex::new(HashMap::new()) });
                let del: Retained<Delegate> = unsafe { msg_send![super(del), init] };
                let synth = unsafe { AVSpeechSynthesizer::new() };
                unsafe { synth.setDelegate(Some(ProtocolObject::from_ref(&*del))) };
                (synth, del)
            });
            f(synth, del);
        })
    });
}

pub fn voices() -> Vec<Voice> {
    unsafe {
        let default = AVSpeechSynthesisVoice::voiceWithLanguage(None).map(|v| v.identifier().to_string());
        AVSpeechSynthesisVoice::speechVoices()
            .iter()
            .map(|v| {
                let id = v.identifier().to_string();
                Voice {
                    default: default.as_deref() == Some(id.as_str()),
                    id,
                    name: v.name().to_string(),
                    lang: v.language().to_string(),
                    quality: v.quality().0,
                }
            })
            .collect()
    }
}

/// `rate` is the window's speed (1 is normal), scaled as WebKit scales it.
pub fn speak(app: &AppHandle, id: u64, text: String, voice: Option<String>, rate: f32) {
    with_synth(app, move |synth, del| unsafe {
        synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
        let u = AVSpeechUtterance::speechUtteranceWithString(&NSString::from_str(&text));
        if let Some(v) = voice.and_then(|v| AVSpeechSynthesisVoice::voiceWithIdentifier(&NSString::from_str(&v))) {
            u.setVoice(Some(&v));
        }
        u.setRate(
            (AVSpeechUtteranceDefaultSpeechRate * rate).clamp(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceMaximumSpeechRate),
        );
        del.ivars().ids.lock().unwrap().insert(Retained::as_ptr(&u) as usize, id);
        synth.speakUtterance(&u);
    });
}

/// Pauses mid-word (`on`), or carries on from there.
pub fn pause(app: &AppHandle, on: bool) {
    with_synth(app, move |synth, _| unsafe {
        if on {
            synth.pauseSpeakingAtBoundary(AVSpeechBoundary::Immediate);
        } else {
            synth.continueSpeaking();
        }
    });
}

pub fn stop(app: &AppHandle) {
    with_synth(app, |synth, _| unsafe {
        synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
    });
}
