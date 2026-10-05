// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Files embedded by name (`![[diagram.png]]`) can be anywhere in the vault. As in the previous app
//! (bff/src/services/image-index.ts): case-insensitive, the shortest path wins, dot-folders,
//! `node_modules` and excluded folders skipped.

use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Default)]
pub struct Assets {
    by_name: HashMap<String, Vec<String>>,
}

impl Assets {
    pub fn scan(root: &Path, excluded: &[String]) -> Assets {
        let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
        let it = walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            e.depth() == 0 || !(n.starts_with('.') || (e.file_type().is_dir() && (n == "node_modules" || excluded.iter().any(|x| *x == n))))
        });
        for e in it.flatten().filter(|e| e.file_type().is_file()) {
            if let Some(rel) = crate::vault::rel_of(root, e.path()) {
                by_name.entry(crate::links::nfc(&e.file_name().to_string_lossy()).to_lowercase()).or_default().push(rel);
            }
        }
        for v in by_name.values_mut() {
            v.sort_by(|a, b| a.len().cmp(&b.len()).then(a.cmp(b)));
        }
        Assets { by_name }
    }

    /// The vault-relative path for a name as embedded (a path in it is used as written when it
    /// exists; otherwise the base name is looked up).
    pub fn find(&self, name: &str) -> Option<&str> {
        let base = name.rsplit('/').next().unwrap_or(name);
        let hits = self.by_name.get(&crate::links::nfc(base).to_lowercase())?;
        hits.iter().find(|p| p.eq_ignore_ascii_case(name)).or_else(|| hits.first()).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_by_name() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault");
        let a = Assets::scan(&root, &[]);
        assert_eq!(a.find("diagram.png"), Some("images/diagram.png"));
        assert_eq!(a.find("DIAGRAM.PNG"), Some("images/diagram.png"));
        assert_eq!(a.find("images/diagram.png"), Some("images/diagram.png"));
        assert_eq!(a.find("app.json"), None);
        assert_eq!(a.find("nothing.png"), None);
    }
}
