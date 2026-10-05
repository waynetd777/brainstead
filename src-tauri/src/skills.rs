// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The three skill screens §4 lists (stage 8 item 15), each from the vault skill it replaces:
//! Triage bookmarks (`triage-bookmarks`), Draft reply (`draft-reply`) and Doc check (`doc-check`).
//! The model only reads and answers in JSON; whatever changes in the vault, the screen does through
//! the usual safe writes, agent changes (in Changes) or the user's own clicks.

use std::path::{Path, PathBuf};

use brainstead_core::canonical::{self, Entry, Register};
use brainstead_core::lists::BOOKMARKS;
use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::ask;

use crate::vault::VaultService;

fn model(app: &AppHandle) -> String {
    crate::ask::job_model(app, "skills")
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.state::<VaultService>().root().ok_or_else(|| "No vault is open.".to_string())
}

/// Runs the default model, read-only in the vault, and returns its answer.
fn answer(app: &AppHandle, tag: &str, prompt: &str) -> Result<String, String> {
    let system = brainstead_core::ask::system_prompt(&ask::today(), false);
    let id = format!("{tag}-{}", Local::now().format("%H%M%S%3f"));
    let out = ask::run(app, &id, prompt, &model(app), None, &system, None, &mut |_| {});
    match out.error {
        Some(e) => Err(e),
        None => Ok(out.text),
    }
}

/// The JSON value in a model's answer: the outermost `open`…`close`, fences and prose around it
/// left out.
fn json_in<T: for<'a> Deserialize<'a>>(answer: &str, open: char, close: char) -> Result<T, String> {
    let (Some(a), Some(b)) = (answer.find(open), answer.rfind(close)) else {
        return Err("The answer had no result in it.".into());
    };
    if b < a {
        return Err("The answer had no result in it.".into());
    }
    serde_json::from_str(&answer[a..=b]).map_err(|e| format!("The answer couldn't be read: {e}"))
}

// ── Triage bookmarks ─────────────────────────────────────────────────────────────────────────

/// A bookmark with what can be known without reading it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkRow {
    pub target: String,
    pub path: Option<String>,
    pub title: String,
    /// When its file last changed (ms): an upper bound on its age, as the pin date isn't kept.
    pub mtime: Option<i64>,
    pub days: Option<i64>,
    /// Untouched for two weeks or more, counting a Keep in triage as a touch.
    pub stale: bool,
    pub missing: bool,
}

/// When each bookmark was last kept in triage (ms), by its target: keeping one says it's still
/// wanted, so it isn't stale again for another two weeks (app data, not the vault).
fn kept_file() -> PathBuf {
    crate::platform::data_dir().join("bookmarks-kept.json")
}

fn kept() -> std::collections::HashMap<String, i64> {
    std::fs::read_to_string(kept_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Triage's Keep: the bookmark stays, and counts as looked at today.
#[tauri::command]
pub fn bookmark_keep(target: String) -> Result<(), String> {
    let mut k = kept();
    k.insert(target, Local::now().timestamp_millis());
    let f = kept_file();
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&f, serde_json::to_string(&k).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bookmarks_status(app: AppHandle) -> Result<Vec<BookmarkRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let text = std::fs::read_to_string(root.join(BOOKMARKS)).unwrap_or_default();
        let now = Local::now().timestamp_millis();
        let kept = kept();
        app.state::<VaultService>().with_index(|ix, _| {
            let mut out = Vec::new();
            for b in ix.bookmarks(&text)? {
                let mtime = match &b.path {
                    Some(p) => ix.summary(p)?.map(|s| s.mtime),
                    None => None,
                };
                let days = mtime.map(|m| (now - m) / 86_400_000);
                let touched = mtime.max(kept.get(&b.target).copied());
                out.push(BookmarkRow {
                    missing: b.path.is_none(),
                    stale: touched.is_some_and(|t| (now - t) / 86_400_000 >= 14),
                    target: b.target,
                    path: b.path,
                    title: b.title,
                    mtime,
                    days,
                });
            }
            Ok(out)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct BookmarkAsk {
    pub target: String,
    pub path: String,
}

/// What the model suggests for one bookmark.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkSuggestion {
    pub target: String,
    /// keep, promote, task or archive.
    pub decision: String,
    #[serde(default)]
    pub why: String,
    /// Two or three sentences on what it is.
    #[serde(default)]
    pub summary: String,
    /// For promote: the wiki page it should become, and whether that's a concept or an entity.
    #[serde(default)]
    pub page: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// For task: the task, starting with a verb.
    #[serde(default)]
    pub task: Option<String>,
}

const DECISIONS: [&str; 4] = ["keep", "promote", "task", "archive"];

#[tauri::command]
pub async fn bookmarks_suggest(app: AppHandle, items: Vec<BookmarkAsk>) -> Result<Vec<BookmarkSuggestion>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if items.is_empty() {
            return Ok(vec![]);
        }
        let list: String = items.iter().map(|i| format!("- \"{}\": {}\n", i.target, i.path)).collect();
        let prompt = format!(
            "Triage these bookmarks: read-later flags kept in `{BOOKMARKS}`. Read each file (paths below are in the vault) and decide what it should become. \
Use the vault's own `triage-bookmarks` skill, if it has one, for how the user likes this done.\n\n\
Decisions: \"keep\" (still worth reading later), \"promote\" (it deserves a wiki page: name the page, an existing one if it fits, and whether it's a concept or an entity), \"task\" (there's something to do about it: write the task starting with a verb), \"archive\" (read and absorbed, or no longer relevant; the bookmark goes, the note stays).\n\
Never decide on age alone, and never invent a page to promote to: if none fits, keep it and say why.\n\
Answer with only a JSON array, one object per bookmark: {{\"target\": \"…\", \"decision\": \"keep|promote|task|archive\", \"why\": \"one short sentence\", \"summary\": \"two sentences on what it is\", \"page\": \"wiki page name or null\", \"kind\": \"concept|entity or null\", \"task\": \"the task or null\"}}.\n\n\
Bookmarks:\n{list}"
        );
        let out: Vec<serde_json::Value> = json_in(&answer(&app, "triage", &prompt)?, '[', ']')?;
        let targets: Vec<&str> = items.iter().map(|i| i.target.as_str()).collect();
        Ok(out
            .into_iter()
            .filter_map(|v| serde_json::from_value::<BookmarkSuggestion>(v).ok())
            .filter(|s| targets.contains(&s.target.as_str()) && DECISIONS.contains(&s.decision.as_str()))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Draft reply ──────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Callout {
    pub point: String,
    /// answered, partly or ignored.
    pub status: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    /// yes, partly, no, or n/a when the thread wasn't a reply to the user.
    #[serde(default)]
    pub answered: String,
    /// One or two sentences: what's being asked, and whether the thread settled it.
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub callouts: Vec<Callout>,
    /// Plain text, ready to paste.
    pub draft: String,
    /// Vault pages the draft drew on.
    #[serde(default)]
    pub grounded: Vec<String>,
    /// `[…]` gaps left in the draft, and what each needs.
    #[serde(default)]
    pub gaps: Vec<String>,
    /// A follow-up task for the user, if the reply commits them to one.
    #[serde(default)]
    pub task: Option<String>,
}

const TONES: [(&str, &str); 3] = [
    ("brief", "brief: as short as it can be while still answering"),
    ("warm", "warm: friendly and personal, still to the point"),
    ("formal", "formal: courteous and complete, for someone senior or outside the team"),
];

/// A reply to a captured thread (`thread`, a vault path) or pasted text, grounded in the vault.
#[tauri::command]
pub async fn draft_reply(app: AppHandle, thread: Option<String>, text: Option<String>, tone: String) -> Result<Reply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body = match (&thread, &text) {
            (Some(p), _) => {
                brainstead_core::trash::safe_rel(p).map_err(|e| e.to_string())?;
                std::fs::read_to_string(root(&app)?.join(p)).map_err(|e| format!("Couldn't read {p}: {e}"))?
            }
            (None, Some(t)) if !t.trim().is_empty() => t.clone(),
            _ => return Err("Choose a thread or paste one.".into()),
        };
        let tone = TONES.iter().find(|(k, _)| *k == tone).map_or(TONES[0].1, |(_, d)| d);
        let prompt = format!(
            "Draft a reply to this thread for the user (they write it in Teams or Outlook; nothing is sent from here). \
Use the vault's own `draft-reply` skill and house rules (its CLAUDE.md), if it has them, for how they write.\n\n\
First read the thread properly: what is actually being asked, and, when it replies to something the user sent, which of their points are answered, partly answered or ignored. \
Then look up the people and topics in the vault (who they are, what was already agreed, what the user already said) so the reply doesn't contradict or repeat it. \
The vault wins over the thread: if they disagree, say so in the verdict.\n\n\
The draft: plain text (no markdown), the length of the original, the user's voice, no throat-clearing and no summarising their message back. \
Tone: {tone}. Never invent a fact, date, name or commitment: leave a `[…]` gap and list it.\n\n\
Answer with only a JSON object: {{\"answered\": \"yes|partly|no|n/a\", \"verdict\": \"one or two sentences\", \"callouts\": [{{\"point\": \"…\", \"status\": \"answered|partly|ignored\"}}], \"draft\": \"the reply\", \"grounded\": [\"vault page names drawn on\"], \"gaps\": [\"each […] and what it needs\"], \"task\": \"a follow-up task for the user, or null\"}}.\n\n\
The thread:\n\n{body}"
        );
        let mut r: Reply = json_in(&answer(&app, "reply", &prompt)?, '{', '}')?;
        r.task = r.task.filter(|t| !t.trim().is_empty() && t != "null");
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Doc check ────────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterView {
    #[serde(flatten)]
    pub register: Register,
    /// The register note is there.
    pub exists: bool,
}

#[tauri::command]
pub fn canonical_register(app: AppHandle) -> Result<RegisterView, String> {
    let root = root(&app)?;
    let home = dirs::home_dir().unwrap_or_default();
    match std::fs::read_to_string(root.join(canonical::REGISTER)) {
        Ok(t) => Ok(RegisterView { register: canonical::parse(&t, &root, &home), exists: true }),
        Err(_) => Ok(RegisterView { register: Register::default(), exists: false }),
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// diverges, not-covered, superseded-term, beyond-scope or aligned.
    pub kind: String,
    pub title: String,
    /// Where in each document: "§3.2 vs §4".
    #[serde(default)]
    pub r#where: String,
    #[serde(default)]
    pub candidate: String,
    #[serde(default)]
    pub canonical: String,
    /// Changes ownership, funding, sequence or how it's been positioned.
    #[serde(default)]
    pub material: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub verdict: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub findings: Vec<Finding>,
    /// Filled here, not by the model.
    #[serde(default, skip_deserializing)]
    pub against: Option<Entry>,
    #[serde(default, skip_deserializing)]
    pub excluded: Vec<Entry>,
}

/// At most this much of each document goes to the model.
const MAX_CHARS: usize = 150_000;

fn read_any(path: &Path) -> Result<String, String> {
    let rel = path.to_string_lossy();
    let text = if brainstead_core::extract::kind_of(&rel).is_some() {
        brainstead_core::extract::extract(path, Some(crate::platform::pdf_text), Some(crate::platform::image_text))?.text()
    } else {
        std::fs::read_to_string(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?
    };
    Ok(if text.chars().count() > MAX_CHARS {
        format!("{}\n\n[… cut at {MAX_CHARS} characters]", text.chars().take(MAX_CHARS).collect::<String>())
    } else {
        text
    })
}

/// Checks `candidate` (a vault path or a full path) against the version of `doc` in force, or, in
/// `callouts` mode, whether it took in the user's earlier feedback.
#[tauri::command]
pub async fn doc_check(app: AppHandle, candidate: String, doc: String, mode: String) -> Result<CheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        let home = dirs::home_dir().unwrap_or_default();
        let cand_path = canonical::resolve_path(&root, &candidate, &home);
        let cand = read_any(&cand_path)?;
        let name = cand_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(candidate.clone());
        let reg = std::fs::read_to_string(root.join(canonical::REGISTER)).map(|t| canonical::parse(&t, &root, &home)).unwrap_or_default();
        let prompt;
        let mut against = None;
        let mut excluded = vec![];
        if mode == "callouts" {
            prompt = format!(
                "Check whether this revised document, \"{name}\", took in the feedback the user sent on the last version. \
Find what they said before in the vault (notes, sources, sent captures about this document) and list it point by point; then judge each point against this revision. \
Use the vault's own `doc-check` skill, if it has one, for how they like this done.\n\n\
Answer with only a JSON object: {{\"verdict\": \"one line\", \"summary\": \"two sentences\", \"findings\": [{{\"kind\": \"aligned|diverges|not-covered\", \"title\": \"the callout\", \"where\": \"where in the revision\", \"candidate\": \"what the revision says, quoted\", \"canonical\": \"what the user asked for, quoted\", \"material\": true|false}}]}} \
(aligned: taken in; diverges: answered differently; not-covered: ignored).\n\n\
The revision:\n\n{cand}"
            );
        } else {
            let r = canonical::resolve(&reg.entries, &doc);
            if !r.ambiguous.is_empty() {
                return Err(format!(
                    "More than one version of “{doc}” is marked canonical in {} ({}). Say which is in force there, then check again.",
                    canonical::REGISTER,
                    r.ambiguous.iter().map(|e| e.version.as_str()).collect::<Vec<_>>().join(", ")
                ));
            }
            let Some(c) = r.canonical else {
                return Err(format!("Nothing in {} says which version of “{doc}” is in force. Add it there first.", canonical::REGISTER));
            };
            if !c.exists {
                return Err(format!("{} lists {} {} at {}, and that file isn't there.", canonical::REGISTER, c.title, c.version, c.path));
            }
            let canon = read_any(Path::new(&c.resolved_path))?;
            let drafts: Vec<String> = r.drafts.iter().map(|e| format!("{} {}", e.title, e.version)).collect();
            let gone: Vec<String> = r.superseded.iter().map(|e| format!("{} {}", e.title, e.version)).collect();
            prompt = format!(
                "Check the document \"{name}\" against {} {}, the version in force. Not in force, so not to be used: drafts {}; superseded {}. \
Use the vault's own `doc-check` skill, if it has one, for how the user likes this done.\n\n\
Go clause by clause through what the document claims, assigns or sequences. For each, one of: \"aligned\" (agrees, even in other words), \"diverges\" (contradicts a specific clause: quote both), \"not-covered\" (the canonical document requires something this one is silent on), \"beyond-scope\" (it asserts something the canonical document doesn't speak to), \"superseded-term\" (it uses a term a superseded version used and the version in force replaced). \
Mark each divergence material or not: material if it changes ownership, funding, sequence or how it's been positioned. Don't invent findings to look thorough, and don't soften a real divergence.\n\n\
Answer with only a JSON object: {{\"verdict\": \"one line: ready, or what must change\", \"summary\": \"two sentences\", \"findings\": [{{\"kind\": \"…\", \"title\": \"short\", \"where\": \"§ in this document vs § in the canonical one\", \"candidate\": \"quote from this document\", \"canonical\": \"quote from the canonical one\", \"material\": true|false}}]}}.\n\n\
The document to check:\n\n{cand}\n\n---\n\nThe version in force, {} {}:\n\n{canon}",
                c.title,
                c.version,
                if drafts.is_empty() { "none".into() } else { drafts.join(", ") },
                if gone.is_empty() { "none".into() } else { gone.join(", ") },
                c.title,
                c.version,
            );
            excluded = r.drafts.into_iter().chain(r.superseded).collect();
            against = Some(c);
        }
        let mut out: CheckResult = json_in(&answer(&app, "doccheck", &prompt)?, '{', '}')?;
        out.against = against;
        out.excluded = excluded;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_out_of_an_answer() {
        let a = "Here you go:\n```json\n[{\"target\": \"A\", \"decision\": \"keep\"}]\n```\nDone.";
        let v: Vec<BookmarkSuggestion> = json_in(a, '[', ']').unwrap();
        assert_eq!((v[0].target.as_str(), v[0].decision.as_str()), ("A", "keep"));
        let r: Reply = json_in("{\"draft\": \"Hi Maya, yes.\", \"answered\": \"partly\"}", '{', '}').unwrap();
        assert_eq!((r.draft.as_str(), r.answered.as_str(), r.callouts.len()), ("Hi Maya, yes.", "partly", 0));
        assert!(json_in::<Reply>("no json here", '{', '}').is_err());
    }
}
