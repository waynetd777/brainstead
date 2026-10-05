// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Embeds the help topics (`src/help/*.md`, the same files the window shows) as `HELP_FILES`, so
//! a topic added there needs no list kept here (core/src/help.rs), and the starter vault's notes
//! (`src-tauri/starter-vault/`) as `STARTER_FILES` (core/src/starter.rs).

use std::{env, fs, path::Path};

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/help").canonicalize().expect("src/help");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names: Vec<String> = fs::read_dir(&dir)
        .expect("src/help")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".md"))
        .collect();
    names.sort();
    let mut out = String::from("pub const HELP_FILES: &[(&str, &str)] = &[\n");
    for n in &names {
        let p = dir.join(n);
        println!("cargo:rerun-if-changed={}", p.display());
        out.push_str(&format!("    ({n:?}, include_str!({:?})),\n", p.display().to_string()));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("help_files.rs"), out).unwrap();
    starter();
}

/// Every file under `starter-vault/`, as (vault-relative path, text), sorted.
fn starter() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../starter-vault").canonicalize().expect("starter-vault");
    let mut files = Vec::new();
    walk(&dir, &dir, &mut files);
    files.sort();
    let mut out = String::from("pub const STARTER_FILES: &[(&str, &str)] = &[\n");
    for (rel, p) in &files {
        println!("cargo:rerun-if-changed={}", p.display());
        out.push_str(&format!("    ({rel:?}, include_str!({:?})),\n", p.display().to_string()));
    }
    out.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("starter_files.rs"), out).unwrap();
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, std::path::PathBuf)>) {
    println!("cargo:rerun-if-changed={}", dir.display());
    for e in fs::read_dir(dir).expect("starter-vault").filter_map(|e| e.ok()) {
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if p.is_dir() {
            walk(root, &p, out);
        } else {
            let rel = p.strip_prefix(root).unwrap().components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            out.push((rel, p));
        }
    }
}
