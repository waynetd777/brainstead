// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Dataview's pages for the window (src/md/dataview/pages.ts): every markdown file parsed by
//! brainstead_core::dataview, links resolved through the index. Parsed pages are kept by path,
//! size and modification time, each with the generation it last changed in, so the window asks
//! only for what changed since its last look and a 5,000-note vault isn't sent on every save.
//! When files come or go, every page's links are resolved again (a ghost link may now resolve).

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use brainstead_core::dataview::{parse_page, DvLink, DvPage};
use brainstead_core::index::Index;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::vault::VaultService;

struct Entry {
    size: i64,
    mtime: i64,
    title: String,
    gen: u64,
    page: DvPage,
}

#[derive(Default)]
struct Cache {
    gen: u64,
    /// The vault the entries are from.
    root: Option<std::path::PathBuf>,
    entries: HashMap<String, Entry>,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Default::default);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagesDelta {
    /// Pass this back as `since` next time.
    pub gen: u64,
    /// Every page's path now (pages not in it are gone).
    pub all: Vec<String>,
    /// Pages new or changed since `since` (all of them when `since` is 0 or stale).
    pub changed: Vec<DvPage>,
}

fn ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Fills in where each of the page's links goes.
fn resolve(ix: &Index, p: &mut DvPage) -> Result<(), String> {
    let mut uniq: Vec<String> = p.links.iter().filter(|l| !l.target.is_empty()).map(|l| l.target.clone()).collect();
    uniq.sort();
    uniq.dedup();
    let resolved = ix.resolve(&uniq)?;
    let by: HashMap<&String, &Option<String>> = uniq.iter().zip(resolved.iter()).collect();
    let own = p.path.clone();
    let fix = |l: &mut DvLink| {
        l.path = if l.target.is_empty() { Some(own.clone()) } else { by.get(&l.target).and_then(|p| (*p).clone()) };
    };
    p.links.iter_mut().for_each(fix);
    p.lists.iter_mut().flat_map(|it| it.links.iter_mut()).for_each(fix);
    Ok(())
}

#[tauri::command]
pub async fn dataview_pages(app: AppHandle, since: u64) -> Result<PagesDelta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let svc = app.state::<VaultService>();
        let root = svc.root().ok_or("No vault is open.")?;
        svc.with_index(|ix, _| {
            let files = ix.list(None)?;
            let mut c = CACHE.lock().unwrap();
            if c.root.as_ref() != Some(&root) {
                *c = Cache { gen: c.gen + 1, root: Some(root.clone()), entries: HashMap::new() };
            }
            let gen = c.gen + 1;
            let mut all = Vec::new();
            let mut seen = HashSet::new();
            let mut any = false;
            let mut added = false;
            for f in files.into_iter().filter(|f| f.path.to_ascii_lowercase().ends_with(".md")) {
                seen.insert(f.path.clone());
                all.push(f.path.clone());
                if c.entries.get(&f.path).is_some_and(|e| e.size == f.size && e.mtime == f.mtime && e.title == f.title) {
                    continue;
                }
                let abs = root.join(&f.path);
                let Ok(src) = std::fs::read_to_string(&abs) else { continue };
                let ctime = std::fs::metadata(&abs).map(|m| ms(m.created())).unwrap_or(f.mtime);
                added |= !c.entries.contains_key(&f.path);
                let mut page = parse_page(&f.path, &f.title, &src, f.size, ctime, f.mtime);
                resolve(ix, &mut page)?;
                c.entries.insert(f.path.clone(), Entry { size: f.size, mtime: f.mtime, title: f.title, gen, page });
                any = true;
            }
            let before = c.entries.len();
            c.entries.retain(|k, _| seen.contains(k));
            let added_or_gone = c.entries.len() != before || (added && since > 0);
            if added_or_gone {
                // A file came or went: links elsewhere may now go somewhere else.
                for e in c.entries.values_mut() {
                    let old: Vec<Option<String>> = e.page.links.iter().map(|l| l.path.clone()).collect();
                    resolve(ix, &mut e.page)?;
                    if e.page.links.iter().map(|l| &l.path).ne(old.iter()) {
                        e.gen = gen;
                    }
                }
            }
            if any || added_or_gone {
                c.gen = gen;
            }
            let fresh = since == 0 || since > c.gen;
            let changed = c.entries.values().filter(|e| fresh || e.gen > since).map(|e| e.page.clone()).collect();
            Ok(PagesDelta { gen: c.gen, all, changed })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A text file in the vault, read-only (DataviewJS's dv.io.load and dv.view); None when missing.
#[tauri::command]
pub fn dataview_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let svc = app.state::<VaultService>();
    let abs = svc.resolve_path(path.trim_start_matches('/'))?;
    match std::fs::read(&abs) {
        Ok(b) => Ok(Some(String::from_utf8_lossy(&b).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Couldn't read {path}: {e}")),
    }
}
