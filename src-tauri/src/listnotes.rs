// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Writes to the vault's own list notes: bookmarking a note (`Me. Bookmarks.md`) and saving a
//! search (`Me. Smart Lists.md`). Refused while read-only, one line each, undoable with ⌘Z.

use brainstead_core::lists::{self, BOOKMARKS, SMART_LISTS};
use brainstead_core::write::{self, FileChange};
use tauri::{AppHandle, Manager};

use crate::edits::{writable, written, EditError, FileUndo, Res, UndoEntry, UndoStack};
use crate::vault::VaultService;
use crate::AppState;

fn save(app: &AppHandle, name: &str, f: impl FnOnce(&str) -> Result<String, String>, label: String) -> Res<()> {
    writable(&app.state::<AppState>())?;
    let root = app.state::<VaultService>().root().ok_or("No vault is open.".to_string())?;
    let abs = root.join(name);
    let before = std::fs::read_to_string(&abs).ok();
    let after = f(before.as_deref().unwrap_or("")).map_err(|e| EditError::from(write::WriteError::Invalid(e)))?;
    let version = match &before {
        Some(b) => write::save_file(&abs, &after, &write::version(b.as_bytes()))?,
        None => write::create_file(&abs, &after)?,
    };
    let ch = FileChange { path: abs.clone(), before, version };
    app.state::<UndoStack>()
        .push(UndoEntry::files(label, vec![FileUndo { path: name.into(), before: ch.before.clone(), version: ch.version.clone() }]));
    written(app, &[abs]);
    Ok(())
}

/// Bookmarks the note, or takes its bookmark away. Returns whether it's bookmarked now.
#[tauri::command]
pub async fn bookmark_toggle(app: AppHandle, path: String) -> Res<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        brainstead_core::trash::safe_rel(&path).map_err(EditError::from)?;
        // By name, as bookmarks are written; by path when the name is ambiguous.
        let stem = brainstead_core::filename::stem(&path).to_string();
        let target = {
            let svc = app.state::<VaultService>();
            let same = svc.with_index(|ix, _| ix.resolve(std::slice::from_ref(&stem)))?.into_iter().next().flatten();
            if same.as_deref() == Some(path.as_str()) {
                stem.clone()
            } else {
                path.trim_end_matches(".md").to_string()
            }
        };
        let mut on = false;
        save(
            &app,
            BOOKMARKS,
            |t| {
                let (out, now) = lists::toggle_bookmark(t, &target);
                on = now;
                Ok(out)
            },
            format!("Bookmark for {stem}"),
        )?;
        Ok(on)
    })
    .await
    .map_err(|e| EditError::from(e.to_string()))?
}

/// Takes a bookmark out of the list by its target as written (Triage bookmarks: a missing one, or
/// one archived, promoted or made a task).
#[tauri::command]
pub async fn bookmark_remove(app: AppHandle, target: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        save(
            &app,
            BOOKMARKS,
            |t| {
                let (out, now) = lists::toggle_bookmark(t, &target);
                if now {
                    Err(format!("“{target}” isn't bookmarked."))
                } else {
                    Ok(out)
                }
            },
            format!("Bookmark for {target}"),
        )
    })
    .await
    .map_err(|e| EditError::from(e.to_string()))?
}

/// Deletes a saved search from the smart lists note.
#[tauri::command]
pub async fn smart_list_delete(app: AppHandle, name: String) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let label = format!("Deleted the saved search “{}”", name.trim());
        save(&app, SMART_LISTS, |t| lists::remove_smart_list(t, &name), label)
    })
    .await
    .map_err(|e| EditError::from(e.to_string()))?
}

/// Saves a search as a smart list.
#[tauri::command]
pub async fn smart_list_save(app: AppHandle, name: String, query: String, layers: Vec<String>) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let label = format!("Saved the search “{}”", name.trim());
        save(&app, SMART_LISTS, |t| lists::add_smart_list(t, &name, &query, &layers), label)
    })
    .await
    .map_err(|e| EditError::from(e.to_string()))?
}
