// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The Graph screen's data (§4: neighbourhood view): the files around one, its links and backlinks
//! to a depth of 1 to 3, or the whole wiki with the links between its pages. Links that resolve to
//! nothing are ghost nodes. Templates are left out.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

use crate::index::{Index, Result};

fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}

fn is_attachment(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    name.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty()
            && (2..=5).contains(&ext.len())
            && ext.chars().all(|c| c.is_ascii_alphanumeric())
            && !ext.eq_ignore_ascii_case("md")
    })
}

/// The most nodes one graph has: a neighbourhood stops growing there.
pub const MAX_NODES: usize = 400;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// The vault path, or `ghost:<name>` for a link to nothing.
    pub id: String,
    pub title: String,
    /// note, wiki, source, or ghost.
    pub layer: String,
    /// The `type:` property (a wiki page's concept, entity…).
    #[serde(rename = "type")]
    pub kind: Option<String>,
    /// Links in and out, across the whole vault (for its size).
    pub degree: usize,
    /// Steps from the centre (0 for the centre; 0 for all in the whole-wiki view).
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    /// Pairs of node ids, each once, either way round.
    pub edges: Vec<(String, String)>,
    /// The neighbourhood was cut at [`MAX_NODES`].
    pub truncated: bool,
}

struct All {
    nodes: HashMap<String, Node>,
    adj: HashMap<String, HashSet<String>>,
}

fn load(ix: &Index) -> Result<All> {
    let c = ix.conn();
    let mut nodes = HashMap::new();
    let mut by_id = HashMap::new();
    let mut st = c.prepare("SELECT id, path, coalesce(title, path), layer, type FROM files WHERE layer != 'template'").map_err(e)?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(e)?;
    for row in rows {
        let (id, path, title, layer, kind) = row.map_err(e)?;
        by_id.insert(id, path.clone());
        nodes.insert(path.clone(), Node { id: path, title, layer, kind, degree: 0, depth: 0 });
    }
    let mut adj: HashMap<String, HashSet<String>> = HashMap::new();
    let mut st = c.prepare("SELECT src, target_id, target, target_key FROM links").map_err(e)?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
        .map_err(e)?;
    for row in rows {
        let (src, to, target, key) = row.map_err(e)?;
        let Some(a) = by_id.get(&src).cloned() else { continue };
        let b = match to {
            Some(t) => match by_id.get(&t) {
                Some(p) => p.clone(),
                None => continue, // a template
            },
            // An image or other attachment isn't in the index, and isn't a page waiting to be written.
            None if !key.is_empty() && !is_attachment(&target) => {
                let id = format!("ghost:{key}");
                nodes.entry(id.clone()).or_insert(Node {
                    id: id.clone(),
                    title: target,
                    layer: "ghost".into(),
                    kind: None,
                    degree: 0,
                    depth: 0,
                });
                id
            }
            None => continue,
        };
        if a == b {
            continue;
        }
        adj.entry(a.clone()).or_default().insert(b.clone());
        adj.entry(b).or_default().insert(a);
    }
    for (id, n) in nodes.iter_mut() {
        n.degree = adj.get(id).map_or(0, HashSet::len);
    }
    Ok(All { nodes, adj })
}

fn build(all: &All, keep: &HashMap<String, usize>, truncated: bool) -> Graph {
    let mut nodes: Vec<Node> = keep.iter().filter_map(|(id, d)| all.nodes.get(id).map(|n| Node { depth: *d, ..n.clone() })).collect();
    nodes.sort_by(|a, b| a.depth.cmp(&b.depth).then(b.degree.cmp(&a.degree)).then(a.id.cmp(&b.id)));
    let mut edges = vec![];
    for a in keep.keys() {
        for b in all.adj.get(a).into_iter().flatten() {
            if a < b && keep.contains_key(b) {
                edges.push((a.clone(), b.clone()));
            }
        }
    }
    edges.sort();
    Graph { nodes, edges, truncated }
}

impl Index {
    /// The files within `depth` links (either way) of `center`, nearest first, at most
    /// [`MAX_NODES`].
    pub fn graph_around(&self, center: &str, depth: usize) -> Result<Graph> {
        let all = load(self)?;
        if !all.nodes.contains_key(center) {
            return Err(format!("“{center}” isn't in the index."));
        }
        let mut keep = HashMap::from([(center.to_string(), 0)]);
        let mut queue = VecDeque::from([(center.to_string(), 0)]);
        let mut truncated = false;
        'walk: while let Some((id, d)) = queue.pop_front() {
            if d >= depth.clamp(1, 3) {
                continue;
            }
            // Busier neighbours first, so a cut keeps the ones that matter most.
            let mut next: Vec<&String> = all.adj.get(&id).into_iter().flatten().filter(|n| !keep.contains_key(*n)).collect();
            next.sort_by_key(|n| (std::cmp::Reverse(all.nodes.get(*n).map_or(0, |x| x.degree)), (*n).clone()));
            for n in next {
                if keep.len() >= MAX_NODES {
                    truncated = true;
                    break 'walk;
                }
                keep.insert(n.clone(), d + 1);
                queue.push_back((n.clone(), d + 1));
            }
        }
        Ok(build(&all, &keep, truncated))
    }

    /// Every wiki page, the ghost links from them, and the links between them.
    pub fn graph_wiki(&self) -> Result<Graph> {
        let all = load(self)?;
        let wiki: HashSet<&String> = all.nodes.values().filter(|n| n.layer == "wiki").map(|n| &n.id).collect();
        let mut keep: HashMap<String, usize> = wiki.iter().map(|id| ((*id).clone(), 0)).collect();
        for id in &wiki {
            for n in all.adj.get(*id).into_iter().flatten() {
                if n.starts_with("ghost:") {
                    keep.insert(n.clone(), 0);
                }
            }
        }
        Ok(build(&all, &keep, false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;

    fn ix() -> Index {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vault");
        let mut ix = Index::open_in_memory().unwrap();
        ix.sync(&Vault::new(fixture, vec![])).unwrap();
        ix
    }

    #[test]
    fn a_neighbourhood_grows_with_depth() {
        let ix = ix();
        let one = ix.graph_around("wiki/entities/Orbit App.md", 1).unwrap();
        assert_eq!(one.nodes[0].id, "wiki/entities/Orbit App.md");
        assert_eq!(one.nodes[0].depth, 0);
        let ids: HashSet<&str> = one.nodes.iter().map(|n| n.id.as_str()).collect();
        // Its links out and in.
        assert!(ids.contains("wiki/concepts/Hub Platform.md") && ids.contains("Meeting. Orbit App Steerco - 2026-09-30.md"), "{ids:?}");
        assert!(one.nodes.iter().all(|n| n.depth <= 1));
        assert!(one.edges.iter().all(|(a, b)| a < b && ids.contains(a.as_str()) && ids.contains(b.as_str())));
        let two = ix.graph_around("wiki/entities/Orbit App.md", 2).unwrap();
        assert!(two.nodes.len() >= one.nodes.len());
        assert!(ix.graph_around("Nope.md", 1).is_err());
    }

    #[test]
    fn the_whole_wiki_with_its_ghosts() {
        let g = ix().graph_wiki().unwrap();
        assert!(g.nodes.iter().all(|n| n.layer == "wiki" || n.layer == "ghost"));
        assert!(g.nodes.iter().any(|n| n.layer == "ghost"), "{:?}", g.nodes);
        let around = ix().graph_around("Meeting. Orbit App Steerco - 2026-09-30.md", 1).unwrap();
        assert!(!around.nodes.iter().any(|n| n.title.ends_with(".png")), "an image isn't a ghost page");
        assert!(!g.edges.is_empty());
    }
}
