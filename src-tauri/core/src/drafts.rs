// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The editor's unsaved text, one JSON file per document in the app data folder (`drafts/`), so it
//! survives a crash or a restart. Never in the vault, and never in the webview's localStorage (dev
//! and release are different origins, §5.3).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::write::{self, version};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Vault-relative path of the document.
    pub path: String,
    pub content: String,
    /// The version of the file the draft was started from.
    pub base: String,
    /// Last keystroke, ms since the epoch.
    pub at: i64,
}

/// The start of the key a trashed note's draft is kept under (`.trash/<entry id>`), until the note
/// is restored or the entry deleted.
pub const TRASHED: &str = ".trash/";

pub struct Drafts {
    dir: PathBuf,
}

impl Drafts {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Drafts { dir: dir.into() }
    }

    /// One file per document, named by a hash of its path (paths can hold anything).
    fn file(&self, path: &str) -> PathBuf {
        self.dir.join(format!("{}.json", &version(path.as_bytes())[..24]))
    }

    pub fn write(&self, d: &Draft) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec(d).map_err(|e| e.to_string())?;
        write::write_atomic(&self.file(&d.path), &json, false).map_err(|e| e.to_string())
    }

    pub fn read(&self, path: &str) -> Option<Draft> {
        read_one(&self.file(path)).filter(|d| d.path == path)
    }

    pub fn discard(&self, path: &str) {
        let _ = fs::remove_file(self.file(path));
    }

    /// Every draft, newest first; a trashed note's isn't one of them.
    pub fn list(&self) -> Vec<Draft> {
        let Ok(rd) = fs::read_dir(&self.dir) else { return vec![] };
        let mut out: Vec<Draft> = rd
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| read_one(&e.path()))
            .filter(|d| !d.path.starts_with(TRASHED))
            .collect();
        out.sort_by_key(|d| std::cmp::Reverse(d.at));
        out
    }

    /// Moves a draft to a document's new path (after a rename).
    pub fn rename(&self, from: &str, to: &str) {
        if let Some(mut d) = self.read(from) {
            d.path = to.to_string();
            if self.write(&d).is_ok() {
                self.discard(from);
            }
        }
    }
}

fn read_one(p: &Path) -> Option<Draft> {
    serde_json::from_slice(&fs::read(p).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let d = tempfile::tempdir().unwrap();
        let s = Drafts::new(d.path().join("drafts"));
        assert!(s.read("A.md").is_none());
        assert!(s.list().is_empty());
        let a = Draft { path: "A.md".into(), content: "hi".into(), base: "v1".into(), at: 1 };
        let b = Draft { path: "wiki/B.md".into(), content: "yo".into(), base: "v2".into(), at: 2 };
        s.write(&a).unwrap();
        s.write(&b).unwrap();
        assert_eq!(s.read("A.md"), Some(a.clone()));
        assert_eq!(s.list(), vec![b.clone(), a.clone()]);
        s.rename("A.md", "C.md");
        assert!(s.read("A.md").is_none());
        assert_eq!(s.read("C.md").unwrap().content, "hi");
        s.discard("C.md");
        assert_eq!(s.list(), vec![b]);
    }

    #[test]
    fn a_trashed_notes_draft_is_kept_out_of_the_list_until_restored() {
        let d = tempfile::tempdir().unwrap();
        let s = Drafts::new(d.path().join("drafts"));
        s.write(&Draft { path: "A.md".into(), content: "unsaved".into(), base: "v1".into(), at: 1 }).unwrap();
        s.rename("A.md", &format!("{TRASHED}abc-1"));
        assert!(s.list().is_empty());
        s.rename(&format!("{TRASHED}abc-1"), "A.md");
        assert_eq!(s.read("A.md").unwrap().content, "unsaved");
    }
}
