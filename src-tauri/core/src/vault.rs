// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Which files in the vault Brainstead reads, and which layer each belongs to. The rules follow
//! the previous app's `listNotes` and `isPathSkipped` (bff/src/vault/notes.ts, services/settings.ts),
//! so both apps see the same notes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Note,
    Wiki,
    Source,
    Template,
}

impl Layer {
    pub fn as_str(self) -> &'static str {
        match self {
            Layer::Note => "note",
            Layer::Wiki => "wiki",
            Layer::Source => "source",
            Layer::Template => "template",
        }
    }
}

/// Files at the vault root that describe the vault rather than being notes in it.
pub const SCHEMA_FILES: [&str; 3] = ["CLAUDE.md", "index.md", "log.md"];

/// Top-level folders that hold no notes. Any folder whose name starts with a dot (`.obsidian`,
/// `.trash`, `.git`, `.claude`) is skipped too, at any depth.
const SKIPPED_TOP: [&str; 4] = ["images", "scripts", "node_modules", "attachments"];

/// A vault file the index keeps.
#[derive(Debug, Clone)]
pub struct VaultFile {
    /// Vault-relative, `/`-separated, as the file system spells it.
    pub rel: String,
    pub abs: PathBuf,
    pub layer: Layer,
    pub size: u64,
    /// Modification time in milliseconds since the epoch.
    pub mtime: i64,
}

/// The vault folder and the user's excluded folder names (skipped at any depth).
#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub excluded: Vec<String>,
}

pub fn is_note_ext(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.ends_with(".md") || l.ends_with(".txt")
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>, excluded: Vec<String>) -> Self {
        Vault { root: root.into(), excluded }
    }

    /// The layer a vault-relative path belongs to, or None when Brainstead doesn't index it.
    /// Conflict copies need the folder's listing, so `walk` and `file` check those separately.
    pub fn classify(&self, rel: &str) -> Option<Layer> {
        let segs: Vec<&str> = rel.split('/').collect();
        let name = *segs.last()?;
        if segs.iter().any(|s| s.starts_with('.') || s.is_empty()) {
            return None;
        }
        // Every file in sources/ is a source (PDFs, Word files, images); elsewhere only notes.
        if !is_note_ext(name) && !(segs.len() > 1 && segs[0] == "sources") {
            return None;
        }
        if segs.len() == 1 && SCHEMA_FILES.contains(&name) {
            return None;
        }
        if segs[..segs.len() - 1].iter().any(|s| self.excluded.iter().any(|x| x == s)) {
            return None;
        }
        if segs.len() == 1 {
            return Some(Layer::Note);
        }
        match segs[0] {
            "wiki" => Some(Layer::Wiki),
            "sources" => Some(Layer::Source),
            "Templates" | "templates" => Some(Layer::Template),
            top if SKIPPED_TOP.contains(&top) => None,
            _ => Some(Layer::Note),
        }
    }

    fn skip_dir(&self, rel: &str) -> bool {
        let name = rel.rsplit('/').next().unwrap_or(rel);
        name.starts_with('.') || self.excluded.iter().any(|x| x == name) || (!rel.contains('/') && SKIPPED_TOP.contains(&name))
    }

    /// Every indexed file in the vault.
    pub fn walk(&self) -> Vec<VaultFile> {
        let mut out = Vec::new();
        let it = walkdir::WalkDir::new(&self.root).follow_links(false).into_iter().filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            rel_of(&self.root, e.path()).is_some_and(|r| !self.skip_dir(&r))
        });
        let mut by_dir: std::collections::HashMap<PathBuf, Vec<walkdir::DirEntry>> = Default::default();
        for e in it.flatten() {
            if e.file_type().is_file() {
                by_dir.entry(e.path().parent().map(Path::to_path_buf).unwrap_or_default()).or_default().push(e);
            }
        }
        for files in by_dir.values() {
            let names: HashSet<String> = files.iter().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            for e in files {
                let name = e.file_name().to_string_lossy();
                if is_conflict_copy(&name, &names) {
                    continue;
                }
                let Some(rel) = rel_of(&self.root, e.path()) else { continue };
                let Some(layer) = self.classify(&rel) else { continue };
                let Ok(md) = e.metadata() else { continue };
                out.push(VaultFile { rel, abs: e.path().to_path_buf(), layer, size: md.len(), mtime: mtime_ms(&md) });
            }
        }
        out.sort_by(|a, b| a.rel.cmp(&b.rel));
        out
    }

    /// Every indexed file under `dir` (a folder in the vault), as `walk` would report them, without
    /// walking the rest of the vault.
    pub fn walk_under(&self, dir: &Path) -> Vec<VaultFile> {
        let it = walkdir::WalkDir::new(dir).follow_links(false).into_iter().filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            rel_of(&self.root, e.path()).is_some_and(|r| !self.skip_dir(&r))
        });
        let mut out: Vec<VaultFile> = it.flatten().filter(|e| e.file_type().is_file()).filter_map(|e| self.file(e.path())).collect();
        out.sort_by(|a, b| a.rel.cmp(&b.rel));
        out
    }

    /// One file, as `walk` would report it, or None when it's gone or not indexed.
    pub fn file(&self, abs: &Path) -> Option<VaultFile> {
        let rel = rel_of(&self.root, abs)?;
        let layer = self.classify(&rel)?;
        // Inside a skipped folder at any level (an excluded name is handled by classify).
        let segs: Vec<&str> = rel.split('/').collect();
        let mut acc = String::new();
        for seg in &segs[..segs.len() - 1] {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(seg);
            if self.skip_dir(&acc) {
                return None;
            }
        }
        let md = std::fs::metadata(abs).ok().filter(|m| m.is_file())?;
        let name = abs.file_name()?.to_string_lossy().into_owned();
        if let Some(parent) = abs.parent() {
            if conflict_base(&name).is_some() {
                let names: HashSet<String> = std::fs::read_dir(parent)
                    .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
                    .unwrap_or_default();
                if is_conflict_copy(&name, &names) {
                    return None;
                }
            }
        }
        Some(VaultFile { rel, abs: abs.to_path_buf(), layer, size: md.len(), mtime: mtime_ms(&md) })
    }
}

/// `/`-separated path of `p` inside `root`, or None outside it.
pub fn rel_of(root: &Path, p: &Path) -> Option<String> {
    let r = p.strip_prefix(root).ok()?;
    let parts: Vec<String> = r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

pub fn mtime_ms(md: &std::fs::Metadata) -> i64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `Foo 2.md` → `Foo.md`: the name OneDrive gives a conflict copy (a space and one or two digits
/// before the extension).
fn conflict_base(name: &str) -> Option<String> {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let sp = stem.rfind(' ')?;
    let digits = &stem[sp + 1..];
    if sp == 0 || digits.is_empty() || digits.len() > 2 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{}{}", &stem[..sp], ext))
}

/// A conflict copy only when its base file is in the same folder, so `Sprint 2.md` on its own is a
/// note like any other.
pub fn is_conflict_copy(name: &str, siblings: &HashSet<String>) -> bool {
    conflict_base(name).is_some_and(|b| siblings.contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v() -> Vault {
        Vault::new("/v", vec!["archived".into()])
    }

    #[test]
    fn layers() {
        let v = v();
        assert_eq!(v.classify("Me. To Do List.md"), Some(Layer::Note));
        assert_eq!(v.classify("notes.txt"), Some(Layer::Note));
        assert_eq!(v.classify("Victor/Me. Foo.md"), Some(Layer::Note));
        assert_eq!(v.classify("wiki/entities/Orbit App.md"), Some(Layer::Wiki));
        assert_eq!(v.classify("sources/emails/x.md"), Some(Layer::Source));
        assert_eq!(v.classify("Templates/Meeting.md"), Some(Layer::Template));
        assert_eq!(v.classify("images/a.md"), None);
        assert_eq!(v.classify(".obsidian/x.md"), None);
        assert_eq!(v.classify(".trash/Old.md"), None);
        assert_eq!(v.classify("a/.hidden/x.md"), None);
        assert_eq!(v.classify("CLAUDE.md"), None);
        assert_eq!(v.classify("index.md"), None);
        assert_eq!(v.classify("wiki/index.md"), Some(Layer::Wiki));
        assert_eq!(v.classify("deep/archived/x.md"), None);
        assert_eq!(v.classify("archived.md"), Some(Layer::Note));
        assert_eq!(v.classify("pic.png"), None);
        assert_eq!(v.classify("sources/Roadmap.pdf"), Some(Layer::Source));
        assert_eq!(v.classify("wiki/pic.png"), None);
    }

    #[test]
    fn conflict_copies() {
        let s: HashSet<String> = ["Foo.md", "Foo 2.md", "Sprint 2.md", "Bar 123.md"].iter().map(|s| s.to_string()).collect();
        assert!(is_conflict_copy("Foo 2.md", &s));
        assert!(!is_conflict_copy("Sprint 2.md", &s));
        assert!(!is_conflict_copy("Bar 123.md", &s));
        assert!(!is_conflict_copy("Foo.md", &s));
    }
}
