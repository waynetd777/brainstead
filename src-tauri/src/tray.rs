// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The menu-bar icon and its menu window (§10 stage 10), as a sibling app has them: clicking the
//! icon opens a small window of its own under it (src/Tray.tsx, the page with `?view=tray`),
//! which closes when it loses focus. The icon is plain, busy while a run is going, or has a dot
//! when something waits; the menu window works that out and says so (`tray_set_state`). With
//! "Only in the menu bar when the window is closed" on, closing the window takes Brainstead out of
//! the Dock until the window opens again.

use std::sync::Mutex;

use serde_json::Value;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::{lock, platform, AppState};

const ID: &str = "main";
/// The menu window's width, in points.
const WIDTH: f64 = 360.0;

/// What the icon shows now, so it's only swapped when it changes.
#[derive(Default)]
pub struct TrayState(Mutex<(bool, bool)>);

fn icon_for(busy: bool, attention: bool) -> &'static [u8] {
    if busy {
        include_bytes!("../icons/tray-busy@2x.png")
    } else if attention {
        include_bytes!("../icons/tray-alert@2x.png")
    } else {
        include_bytes!("../icons/tray@2x.png")
    }
}

/// A setting the window keeps (`ui`), as a switch; `default` when it was never set.
fn setting(app: &AppHandle, key: &str, default: bool) -> bool {
    lock(&app.state::<AppState>().settings).ui.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Shows the icon or takes it away, as Settings › General › Show in the menu bar says.
pub fn apply(app: &AppHandle) {
    let want = setting(app, "menuBar", true);
    match (app.tray_by_id(ID), want) {
        (Some(_), false) => {
            let _ = app.remove_tray_by_id(ID);
            if let Some(t) = app.get_webview_window("tray") {
                let _ = t.hide();
            }
        }
        (None, true) => {
            if let Err(e) = build(app) {
                crate::applog!("tray: {e}");
            }
        }
        _ => {}
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let (busy, attention) = *app.state::<TrayState>().0.lock().unwrap();
    let icon = tauri::image::Image::from_bytes(icon_for(busy, attention))?;
    TrayIconBuilder::with_id(ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Brainstead")
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = ev {
                toggle(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

/// When the menu window last closed itself on losing focus.
static BLURRED_AT: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

/// A click on the icon this soon after the menu closed on losing focus is the click that took the
/// focus: it closes the menu rather than opening it again.
const CLICK_AFTER_BLUR: std::time::Duration = std::time::Duration::from_millis(400);

/// The menu window's own handling: it closes when it loses focus.
pub fn setup_window(app: &AppHandle) {
    if let Some(t) = app.get_webview_window("tray") {
        let t2 = t.clone();
        t.on_window_event(move |ev| {
            if let tauri::WindowEvent::Focused(false) = ev {
                if t2.is_visible().unwrap_or(false) {
                    *BLURRED_AT.lock().unwrap() = Some(std::time::Instant::now());
                }
                let _ = t2.hide();
            }
        });
    }
}

/// Opens the menu window under the icon, or closes it.
fn toggle(app: &AppHandle, rect: tauri::Rect) {
    let Some(w) = app.get_webview_window("tray") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    // With the main window closed, clicking the icon takes the focus from the menu first, so it has
    // just hidden itself: this click was meant to close it.
    if BLURRED_AT.lock().unwrap().take().is_some_and(|t| t.elapsed() < CLICK_AFTER_BLUR) {
        return;
    }
    // The icon's place is in physical pixels across all screens: find the screen it's on and use
    // that screen's scale, as the window's own is the screen it was last on.
    let guess = w.scale_factor().unwrap_or(2.0);
    let (pos, size) = (rect.position.to_physical::<f64>(guess), rect.size.to_physical::<f64>(guess));
    let monitors = app.available_monitors().unwrap_or_default();
    let screen = monitors.iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        pos.x >= p.x as f64 && pos.x < (p.x + s.width as i32) as f64 && pos.y >= p.y as f64 && pos.y < (p.y + s.height as i32) as f64
    });
    let scale = screen.map_or(guess, |m| m.scale_factor());
    let (pos, size) = if (scale - guess).abs() > f64::EPSILON {
        (rect.position.to_physical::<f64>(scale), rect.size.to_physical::<f64>(scale))
    } else {
        (pos, size)
    };
    let width = WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    if let Some(m) = screen {
        let right = (m.position().x + m.size().width as i32) as f64;
        x = x.min(right - width - 8.0 * scale).max(m.position().x as f64 + 8.0 * scale);
    }
    let y = pos.y + size.height + 6.0 * scale;
    let place = tauri::PhysicalPosition::new(x, y);
    let _ = w.set_position(place);
    let _ = w.show();
    // Once on that screen, place it again: macOS converts the first move with the old screen's scale.
    let _ = w.set_position(place);
    let _ = w.set_focus();
    let _ = w.emit("tray-opened", ());
}

/// The menu window says what the icon should show.
#[tauri::command]
pub fn tray_set_state(app: AppHandle, busy: bool, attention: bool) {
    let st = app.state::<TrayState>();
    let mut now = st.0.lock().unwrap();
    if *now == (busy, attention) {
        return;
    }
    *now = (busy, attention);
    if let Some(t) = app.tray_by_id(ID) {
        if let Ok(img) = tauri::image::Image::from_bytes(icon_for(busy, attention)) {
            let _ = t.set_icon(Some(img));
            let _ = t.set_icon_as_template(true);
        }
    }
}

/// Brings the main window up (back in the Dock first), on `screen` when one is given.
#[tauri::command]
pub fn main_show(app: AppHandle, screen: Option<String>) {
    show_main(&app);
    if let Some(s) = screen {
        let _ = app.emit_to("main", "navigate", s);
    }
    if let Some(t) = app.get_webview_window("tray") {
        let _ = t.hide();
    }
}

/// Quit from the menu window: the main window comes up to ask about unsaved edits, as ⌘Q does.
#[tauri::command]
pub fn tray_quit(app: AppHandle) {
    if let Some(t) = app.get_webview_window("tray") {
        let _ = t.hide();
    }
    show_main(&app);
    let _ = app.emit_to("main", "quit-requested", ());
}

pub fn show_main(app: &AppHandle) {
    // Back in the Dock before the window shows, or it can come up behind what had focus.
    platform::set_in_dock(app, true);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        platform::activate();
        let _ = w.set_focus();
    }
}

/// The main window was closed (hidden): out of the Dock when the menu bar is all that's wanted.
pub fn main_closed(app: &AppHandle) {
    if setting(app, "menuBar", true) && setting(app, "menuBarOnly", false) {
        platform::set_in_dock(app, false);
    }
}
