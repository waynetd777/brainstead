// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Times a full index of a vault (read-only; the index goes to a temp folder):
//! `cargo run --release -p brainstead-core --example index_bench -- <vault>`

use std::time::Instant;

fn main() {
    let root = std::env::args().nth(1).expect("usage: index_bench <vault>");
    let dir = std::env::temp_dir().join(format!("brainstead-bench-{}", std::process::id()));
    let v = brainstead_core::vault::Vault::new(root, vec![]);
    let mut ix = brainstead_core::Index::open(&dir.join("index.db")).unwrap();
    let t = Instant::now();
    let ch = ix.sync(&v).unwrap();
    let first = t.elapsed();
    let t = Instant::now();
    ix.sync(&v).unwrap();
    println!("{} files in {first:?}; unchanged re-sync {:?}", ch.changed.len(), t.elapsed());
    println!("{:?}", ix.stats().unwrap());
    // Search latency over a spread of query shapes.
    let queries = [
        "budget",
        "hiring plan",
        "\"operating model\"",
        "+hub -archived",
        "tag:followup",
        "meeting notes 2026",
        "launch date",
        "architecture",
        "risk AND roadmap",
        "steerco",
        "a",
        "data platform migration",
        "tag:hiring offer",
        "q4",
        "review",
        "team leads",
    ];
    let mut ms: Vec<f64> = Vec::new();
    for _ in 0..5 {
        for q in queries {
            let t = Instant::now();
            let r = ix.search(&brainstead_core::search::SearchRequest { q: q.into(), layers: vec![], limit: 200 }).unwrap();
            ms.push(t.elapsed().as_secs_f64() * 1000.0);
            let _ = r.total;
        }
    }
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "search: p50 {:.1} ms, p95 {:.1} ms, max {:.1} ms over {} queries",
        ms[ms.len() / 2],
        ms[ms.len() * 95 / 100],
        ms[ms.len() - 1],
        ms.len()
    );
    let _ = std::fs::remove_dir_all(dir);
}
