// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The wiki page shape's dry run (D-20261006-06): reshapes every entity and concept page of a
//! vault in memory and writes what it would do, nothing else. Run it on a copy of a vault,
//! never the vault itself:
//!
//!     cargo run -q -p brainstead-evals --bin reshape -- --vault <copy> --report <dir>
//!
//! Writes `<dir>/report.md` (counts, every page that needs the user with why, 20 pages it
//! would reshape by itself as diffs to check) and `<dir>/report.json` (every page). With
//! `--pages <dir>`, also writes each page it would change, reshaped, under that folder.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::Instant;

use brainstead_core::pageshape;

fn arg(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

/// A fixed sample: the pages whose paths hash lowest.
fn sample<'a>(pages: impl Iterator<Item = &'a str>, n: usize) -> Vec<&'a str> {
    let mut v: Vec<(u64, &str)> = pages
        .map(|p| {
            let mut h = std::collections::hash_map::DefaultHasher::new();
            p.hash(&mut h);
            (h.finish(), p)
        })
        .collect();
    v.sort();
    let mut out: Vec<&str> = v.into_iter().take(n).map(|x| x.1).collect();
    out.sort();
    out
}

/// A reason with its page-specific part (after the colon) cut, to count reasons by kind.
fn reason_kind(r: &str) -> &str {
    r.split(": ").next().unwrap_or(r)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(vault), Some(out)) = (arg(&args, "--vault"), arg(&args, "--report")) else {
        eprintln!("usage: reshape --vault <copy of a vault> --report <dir>");
        std::process::exit(2);
    };
    let pages_out = arg(&args, "--pages");
    if pages_out.as_deref().is_some_and(|p| p.starts_with(&vault)) {
        eprintln!("--pages must be outside the vault");
        std::process::exit(2);
    }
    let started = Instant::now();
    let mut results = Vec::new();
    let mut diffs: BTreeMap<String, (String, String)> = BTreeMap::new();
    for (r, new) in pageshape::survey(&vault) {
        if let Some(new) = new {
            if let Some(dir) = &pages_out {
                let to = dir.join(&r.path);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::write(to, &new).unwrap();
            }
            let old = std::fs::read_to_string(vault.join(&r.path)).unwrap_or_default();
            diffs.insert(r.path.clone(), (old, new));
        }
        results.push(r);
    }
    let took = started.elapsed();

    let count = |f: &dyn Fn(&pageshape::PageResult) -> bool| results.iter().filter(|r| f(r)).count();
    let (shaped, auto, review, broken) = (
        count(&|r| r.in_shape),
        count(&|r| !r.in_shape && r.auto),
        count(&|r| !r.auto && r.report.broken.is_empty()),
        count(&|r| !r.report.broken.is_empty()),
    );
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    for r in &results {
        let mut seen: Vec<&str> = r.report.reasons.iter().map(|x| reason_kind(x)).collect();
        seen.dedup();
        for k in seen {
            *kinds.entry(k).or_default() += 1;
        }
    }
    let mut md = format!(
        "# Page shape: dry run\n\n{} pages in {:.2?}, nothing written.\n\n- Already in the shape: {shaped}\n- Would be reshaped by itself (auto): {auto}\n- Need the user (review): {review}\n- Failed the checks (left as they are): {broken}\n- Timeline entries: {}\n- Headings rewritten: {}\n- Source lines added: {}\n\n",
        results.len(),
        took,
        results.iter().map(|r| r.report.entries).sum::<usize>(),
        results.iter().map(|r| r.report.headings.len()).sum::<usize>(),
        results.iter().map(|r| r.report.added.iter().filter(|a| a.starts_with("Source:")).count()).sum::<usize>(),
    );
    md.push_str("## Review reasons (pages)\n\n");
    let mut kinds: Vec<_> = kinds.into_iter().collect();
    kinds.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    for (k, n) in &kinds {
        md.push_str(&format!("- {n} — {k}\n"));
    }
    if broken > 0 {
        md.push_str("\n## Failed the checks\n\n");
        for r in results.iter().filter(|r| !r.report.broken.is_empty()) {
            md.push_str(&format!("- `{}`: {}\n", r.path, r.report.broken.join("; ")));
        }
    }
    md.push_str("\n## Review pages\n\n");
    for r in results.iter().filter(|r| !r.auto && r.report.broken.is_empty()) {
        md.push_str(&format!("- `{}`\n", r.path));
        for x in &r.report.reasons {
            md.push_str(&format!("  - {x}\n"));
        }
    }
    let notes: Vec<_> = results.iter().flat_map(|r| r.report.notes.iter().map(move |n| (r.path.as_str(), n))).collect();
    if !notes.is_empty() {
        md.push_str("\n## Notes\n\n");
        for (p, n) in notes {
            md.push_str(&format!("- `{p}`: {n}\n"));
        }
    }
    md.push_str("\n## 20 auto pages, as diffs\n\n");
    for p in sample(results.iter().filter(|r| !r.in_shape && r.auto).map(|r| r.path.as_str()), 20) {
        let (old, new) = &diffs[p];
        let diff = similar::TextDiff::from_lines(old, new).unified_diff().context_radius(2).header(p, p).to_string();
        md.push_str(&format!("### {p}\n\n````diff\n{diff}````\n\n"));
    }
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(out.join("report.md"), md).unwrap();
    std::fs::write(out.join("report.json"), serde_json::to_string_pretty(&results).unwrap()).unwrap();
    println!("{} pages in {took:.2?}: {shaped} in shape, {auto} auto, {review} review, {broken} failed the checks", results.len());
    println!("{}", out.join("report.md").display());
}
