// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Brainstead's MCP server, over stdio: newline-delimited JSON-RPC, as every CLI that Ask runs
//! speaks it. Each CLI starts it (the app's own binary with `--mcp`, or `brainstead-mcp` from a
//! terminal), so it works whether Brainstead is open or not.
//!
//! It reads: the vault's files, and the app's index opened read-only. It never changes the vault
//! itself: a change (edit_page, create_note, a task, a rename…) is checked here, then sent to the
//! app, which makes it or holds it for the user and records it in Changes (decided 2026-10-05).

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use brainstead_core::changes::{self, Instruction};
use brainstead_core::proposals::{self, Kind, Origin, Patch, Quote, SourceText};
use brainstead_core::search::SearchRequest;
use brainstead_core::{bridge, filename, lint, projects, write, Index};
use serde::Deserialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

/// Protocol versions it speaks, newest first; it answers with the client's when it's one of them.
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
/// The most text one tool result carries.
const MAX_CHARS: usize = 30_000;
const TODO_LIST: &str = "Me. To Do List.md";

const INSTRUCTIONS: &str = "Brainstead's tools over the user's vault (notes, a wiki in wiki/, sources in sources/), covering what the app's screens do. \
Read with search, read_section, backlinks, resolve_entity, list_tasks, list_inbox, list_projects, summary (the daily and weekly summaries: what the user did) and weekly_review; help answers questions about the app itself. \
Changes to the vault's notes happen straight away, each recorded in Brainstead's Changes screen where the user can revert it: tasks (edit_task, move_task, create_task, delete_task), Inbox clarifying, projects (create_project, update_project), and prose, renames and deletes (edit_page, create_note, rename_note, trash_note). \
A change to Templates/ (a rename or trash of a template too, or a rename whose link rewrites touch one), one that adds code that runs (a script, a Tasks function, a Templater tag), or one that changes a system note's header is always held for the user. \
Other tools (bookmarks, saved searches, the weekly review's suggestions, Knowledge health fixes, fix_name) change things at once, undoable with ⌘Z in the app; runs record their own changes in Changes. \
Change only what the user asked for. In a session nobody is watching (a loop, a scheduled agent), pass unattended: true on every call (every tool takes it): a change that fails a check is then held for the user instead, and for the rest of the session nothing held can be accepted and weekly_start_over and moving_over's retire are refused. \
changes lists what was changed and what's held, and reverts one; it accepts a held change only when the user is there and only one held because a check failed: the user accepts the rest in the app. \
Quote sources word for word in edit_page's quotes; a quote that isn't in its source is flagged. Tools marked as needing the app open Brainstead when it isn't running.";

/// Where the server works.
#[derive(Debug)]
pub struct Ctx {
    /// The app data folder: `settings.json`, `index.db`, `text/` (what was read from sources) and
    /// `bridge/` (requests to the running app).
    pub data: PathBuf,
    pub vault: PathBuf,
    /// The Ask chat that started it, and its model, for Changes.
    pub chat: Option<String>,
    pub model: Option<String>,
    /// Today, for `updated:` (tests fix it).
    pub today: chrono::NaiveDate,
    /// The app's own program, to open it for an action when it isn't running; None from the
    /// separate `brainstead-mcp` binary and in tests.
    pub app: Option<PathBuf>,
    /// When the last calls came, for the rate limit.
    pub calls: std::sync::Mutex<Vec<std::time::Instant>>,
    /// This server's session, grouping a terminal's changes in Changes when no chat started it.
    pub session: String,
    /// A call in this session said nobody is watching: from then on it can't accept held changes.
    pub unattended: std::sync::atomic::AtomicBool,
}

impl Ctx {
    /// From the command line (`--data <dir>`, `--chat <id>`, `--model <id>`), the vault being the one
    /// in the data folder's `settings.json`. `default_data` is the app data folder when no `--data`.
    pub fn from_args(args: &[String], default_data: PathBuf) -> Result<Ctx, String> {
        let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
        let data = opt("--data").map(PathBuf::from).unwrap_or(default_data);
        let settings: Value = std::fs::read(data.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or_else(|| format!("No Brainstead settings in {}: open Brainstead and choose the vault first.", data.display()))?;
        let vault = settings
            .get("vaultPath")
            .and_then(Value::as_str)
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
            .ok_or("Brainstead has no vault chosen yet.")?;
        // Started as the app (`Brainstead --mcp`): the same program opens the app.
        let app = std::env::current_exe().ok().filter(|p| {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            !stem.starts_with("brainstead-") && !stem.starts_with("brainstead_")
        });
        Ok(Ctx {
            data,
            vault,
            chat: opt("--chat"),
            model: opt("--model"),
            today: chrono::Local::now().date_naive(),
            app,
            calls: Default::default(),
            session: format!("session-{}", proposals::new_id()),
            unattended: Default::default(),
        })
    }

    fn index(&self) -> Result<Index, String> {
        Index::open_read_only(&self.data.join("index.db"))
    }
}

/// Answers requests from `input`, one JSON message per line, until it closes.
pub fn serve(ctx: &Ctx, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let out: Vec<Value> = batch.into_iter().filter_map(|m| handle(ctx, m)).collect();
                (!out.is_empty()).then_some(Value::Array(out))
            }
            Ok(m) => handle(ctx, m),
            Err(e) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("Parse error: {e}")}})),
        };
        if let Some(r) = reply {
            writeln!(output, "{r}")?;
            output.flush()?;
        }
    }
    Ok(())
}

/// One message; None for notifications, which get no answer.
pub fn handle(ctx: &Ctx, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(VERSIONS[0]);
            let version = VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(VERSIONS[0]);
            Ok(json!({
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": "brainstead", "version": env!("CARGO_PKG_VERSION")},
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call(ctx, name, args) {
                Ok(text) => Ok(json!({"content": [{"type": "text", "text": cap(text)}], "isError": false})),
                Err(CallError::Tool(e)) => Ok(json!({"content": [{"type": "text", "text": e}], "isError": true})),
                Err(CallError::Args(e)) => Err((-32602, e)),
            }
        }
        "prompts/list" => Ok(json!({"prompts": []})),
        "resources/list" => Ok(json!({"resources": []})),
        "resources/templates/list" => Ok(json!({"resourceTemplates": []})),
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
    })
}

fn cap(text: String) -> String {
    if text.chars().count() <= MAX_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_CHARS).collect();
    format!("{cut}\n\n[Cut at {MAX_CHARS} characters. Ask for less: one section, or fewer results.]")
}

fn schema(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}

/// What a tool does to the vault, for its annotations (MCP's tool hints).
#[derive(Clone, Copy)]
enum Effect {
    /// Reads only.
    Read,
    /// Changes the vault straight away, undoably (⌘Z in the app, Revert in Changes).
    Change,
    /// Can write over or take out what's in the vault: deletes, accepting and reverting changes.
    Destroy,
    /// Starts work by a model on the user's account.
    Run,
}

/// Every tool takes `unattended`, so a client that passes it on every call, as the instructions
/// ask, isn't turned away by a schema that allows no other properties. Said once, it holds for the
/// whole session (D-20261005-14).
fn unattended() -> Value {
    json!({"type": "boolean", "description": "true when nobody is watching this session (a loop, a scheduled agent): a change that fails a check is held for the user instead of made, and from then on nothing held can be accepted and weekly_start_over and moving_over's retire are refused."})
}

fn tool(name: &str, title: &str, effect: Effect, description: &str, mut input: Value) -> Value {
    if let Some(props) = input.get_mut("properties").and_then(Value::as_object_mut) {
        props.entry("unattended").or_insert_with(unattended);
    }
    let (read_only, destructive, idempotent, open_world) = match effect {
        Effect::Read => (true, false, true, false),
        Effect::Change => (false, false, false, false),
        Effect::Destroy => (false, true, false, false),
        Effect::Run => (false, false, false, true),
    };
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input,
        "annotations": {
            "title": title,
            "readOnlyHint": read_only,
            "destructiveHint": destructive,
            "idempotentHint": idempotent,
            "openWorldHint": open_world,
        },
    })
}

const EDIT_PAGE: &str = "Changes one page (a note, a wiki page, a project: any page in the vault), or makes a new wiki page (needs the app); a new note is create_note. The change is made at once and recorded in Brainstead's Changes, where the user can revert it. Give exactly one of: section + content (that section's new text, without its heading; a section that isn't there is added at the end), edits (exact find and replace pairs, each find text appearing once in the page), or content alone (the whole page; required for a new page, whose path must be wiki/entities/<Name>.md, wiki/concepts/<Name>.md or wiki/summaries/<Name>.md). Keep what's in the text you replace that you aren't changing: links, tags, and block ids such as ^q3 at a line's end. Cite what the change rests on in quotes, copied word for word from the source; cite in the text as [[Source#Heading]] or [[Source.pdf#page=6]]; a PDF quote with anchor page=N must be on that page. A quote that isn't in its source is flagged to the user.";

/// The tools, as `tools/list` gives them. Those marked "needs the app" run in Brainstead itself
/// (the server opens it when it isn't running), so they behave as the screens do.
pub fn tools() -> Vec<Value> {
    use Effect::*;
    let page = json!({"type": "string", "description": "A page's name (Orbit App), its [[link]], or its path in the vault (wiki/entities/Orbit App.md)."});
    let task = json!({"type": "string", "description": "The task's id from list_tasks: path:line, as in `Me. To Do List.md:12`."});
    let task_text = json!({"type": "string", "description": "The task's text as list_tasks showed it (or enough of it), to make sure it's the same task if lines moved."});
    let date = json!({"type": ["string", "null"], "description": "YYYY-MM-DD, or null to clear it."});
    let edit_schema = schema(
        json!({
            "page": page,
            "title": {"type": "string", "description": "One line for Changes: what the change does."},
            "reason": {"type": "string", "description": "Why, briefly."},
            "section": {"type": "string"},
            "content": {"type": "string"},
            "edits": {"type": "array", "items": schema(json!({"find": {"type": "string"}, "replace": {"type": "string"}}), &["find", "replace"])},
            "quotes": {"type": "array", "items": schema(json!({
                "source": {"type": "string", "description": "The source's name or path."},
                "anchor": {"type": "string", "description": "A heading in it, or page=N for a PDF."},
                "text": {"type": "string", "description": "Word for word from the source."}
            }), &["source", "text"])}
        }),
        &["page", "title"],
    );
    vec![
        tool("search", "Search the vault", Read,
            "Full-text search over the vault, as Brainstead's Search does: words, \"exact phrases\", +required, -excluded, #tag. Returns the best passages, each with its page, heading and a snippet.",
            schema(json!({
                "query": {"type": "string"},
                "layers": {"type": "array", "items": {"type": "string", "enum": ["notes", "wiki", "sources", "templates"]}, "description": "Only these parts of the vault; all when left out."},
                "since": {"type": "string", "description": "YYYY-MM-DD: only files changed on or after this day."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Default 10."}
            }), &["query"])),
        tool("read_section", "Read a page", Read,
            "Reads a page, or one section of it by heading (to the next heading of the same level). A long page without a heading lists its headings. For a PDF or Office source, heading picks a page (page=6), slide (Slide 2) or sheet by name.",
            schema(json!({"page": page, "heading": {"type": "string"}}), &["page"])),
        tool("backlinks", "Pages linking here", Read, "The notes and pages that link to a page, with the line each link is on.", schema(json!({"page": page}), &["page"])),
        tool("resolve_entity", "Which page a name means", Read,
            "Which page a name means: by file name, then alias, then a close spelling. Use it before creating a page, so you don't make a second page for something that has one.",
            schema(json!({"name": {"type": "string"}}), &["name"])),
        tool("facts", "Facts from the wiki", Read,
            "The facts ingest checked against their sources and kept with each wiki page: per subject and attribute, the latest value with its as of date, quote, source and Timeline entry, then the values it superseded. Answers \"what's the latest go_live_date for Orbit App\" without reading pages. Give a page, a subject, an attribute (go_live_date, owner, status, role…; synonyms count), or any mix. Facts are kept from the first ingest that checks them, so a page may have none yet.",
            schema(json!({"page": page, "subject": {"type": "string"}, "attribute": {"type": "string"}}), &[])),
        tool("pending_sources", "Sources not yet in the wiki", Read, "Files in sources/ that no wiki page cites yet in its sources: property: notes, PDFs, Office files and images (whose text is read from the picture), each ready for start_run's ingest.", schema(json!({}), &[])),
        tool("lint", "Knowledge health report", Read,
            "Knowledge health's checks on the wiki. Wiki checks: missing pages, broken sources, orphan pages, missing cross-links, stale updated: dates, unlogged writes, sources not yet ingested and images nothing uses. More checks: possible duplicates, stale pages others rely on, and sources changed since they were cited (claims with no citation show only in the app, after a contradictions check). For one page when given. Items with a safe fix can be fixed with fix_health.",
            schema(json!({"page": page}), &[])),
        tool("help", "Brainstead's help", Read,
            "Brainstead's own help: how the app works and how to use it (screens, settings, shortcuts, getting-started guides). For questions about the app itself, not the vault. No arguments lists the topics; `topic` reads one (and `section` one part of it); `query` finds the best matching sections.",
            schema(json!({
                "topic": {"type": "string", "description": "A topic's id or title, from the list."},
                "section": {"type": "string", "description": "One section of the topic, by its title."},
                "query": {"type": "string", "description": "Words to search the help for: change capture shortcut."}
            }), &[])),
        // Tasks.
        tool("list_tasks", "List tasks", Read,
            "Tasks as Brainstead's lists show them (needs the app). Each line gives the task, its dates and chips, and its id (path:line) to act on it with edit_task or move_task.",
            schema(json!({
                "view": {"type": "string", "enum": ["today", "next", "followups", "waiting", "deferred", "someday", "done-this-week", "done-last-week", "all"], "description": "today: overdue, due and deferred until today, leaving out tasks deferred to a later day. next: open tasks that aren't follow-ups, waiting, someday, deferred or still in the Inbox (the default). deferred: the Deferred list, tasks deferred to a later day. all: every open task."},
                "project": {"type": "string", "description": "Only this project's tasks, by its name."},
                "context": {"type": "string", "description": "Only tasks with this context: calls, office…"},
                "query": {"type": "string", "description": "Only tasks whose text has these words."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 300, "description": "Default 50."},
                "detail": {"type": "boolean", "description": "Also the heading, effort, created and done dates."}
            }), &[])),
        tool("edit_task", "Change a task", Change,
            "Changes a task, as the task screens do (needs the app): made straight away and recorded in Changes, where the user can revert it (⌘Z undoes it too). Give only the fields to change; several at once is fine, made as one change. Ticking a recurring task adds its next occurrence, as in the app.",
            schema(json!({
                "task": task, "text": task_text,
                "done": {"type": "boolean", "description": "true ticks it (with today's ✅ date), false unticks it."},
                "due": date, "defer": date, "start": date, "created": date,
                "priority": {"type": "string", "enum": ["highest", "high", "medium", "low", "lowest", "none"]},
                "contexts": {"type": "array", "items": {"type": "string"}, "description": "The task's contexts, replacing what it has: [\"calls\"]. [] clears them."},
                "effort": {"type": ["string", "null"], "description": "15m, 1h, 1h30m, 2d; null clears it."},
                "project": {"type": ["string", "null"], "description": "A project's name; null takes it out of its project."},
                "waiting": {"type": "boolean", "description": "true marks it waiting for someone (#waiting-for), false no longer."},
                "status": {"type": "string", "enum": ["cancelled", "open", "in_progress"]}
            }), &["task", "text"])),
        tool("move_task", "Reorder a task", Change,
            "Moves a task in the manual order of Next actions, Follow-ups, Waiting for and Someday (needs the app), next to another task. Recorded in Changes, where the user can revert it.",
            schema(json!({
                "task": task, "text": task_text,
                "after": {"type": "string", "description": "The id of the task it should come after."},
                "before": {"type": "string", "description": "The id of the task it should come before."}
            }), &["task", "text"])),
        tool("create_task", "Add a task", Change,
            "Adds a task (needs the app): to a project's Next actions when a project is given, else to the To Do list. Recorded in Changes, where the user can revert it.",
            schema(json!({
                "text": {"type": "string", "description": "The task, one line, starting with a verb."},
                "project": {"type": "string", "description": "A project's name (Orbit App launch) or its note."},
                "context": {"type": "string", "description": "Where or with what: calls, computer, errands, office."},
                "effort": {"type": "string", "description": "15m, 1h, 1h30m, 2d."},
                "due": {"type": "string", "description": "YYYY-MM-DD."},
                "reason": {"type": "string"}
            }), &["text"])),
        tool("delete_task", "Delete a task", Destroy,
            "Takes a task's line out of its note (needs the app); revertable in Changes. Only when the user asks: to finish a task, tick it with edit_task instead; to drop it, set status cancelled.",
            schema(json!({"task": task, "text": task_text, "reason": {"type": "string"}}), &["task", "text"])),
        // Inbox and projects.
        tool("list_inbox", "List the Inbox", Read,
            "What's waiting in the Inbox to clarify (needs the app): captures from Outlook and Teams, Scratchpad thoughts and tasks under Other on the To Do list, each with its id.",
            schema(json!({}), &[])),
        tool("clarify_inbox", "Clarify an Inbox item", Change,
            "Decides what an Inbox item is, as the Inbox screen does (needs the app); its edits to notes are recorded in Changes, where the user can revert them, and held together when one is held. next and waiting write a task (to a project's Next actions when project is given); someday writes a #someday-maybe task; project makes a new project from it; done ticks or clears it; reference files it in a note (note or new_note), or keeps a capture in Sources; ingest ingests a capture into the wiki; delete takes it out (a capture goes to the Trash).",
            schema(json!({
                "item": {"type": "string", "description": "The item's id from list_inbox, as in task:14."},
                "becomes": {"type": "string", "enum": ["next", "waiting", "someday", "project", "done", "reference", "ingest", "delete"]},
                "text": {"type": "string", "description": "The task's text, if it should read differently: start with a verb."},
                "project": {"type": "string", "description": "For next, waiting or someday: the project it belongs to, by name."},
                "context": {"type": "string"},
                "effort": {"type": "string", "description": "15m, 1h…"},
                "due": {"type": "string", "description": "YYYY-MM-DD."},
                "project_name": {"type": "string", "description": "For project: the new project's name (the item's text when left out)."},
                "area": {"type": "string"}, "outcome": {"type": "string"},
                "note": {"type": "string", "description": "For reference: the path of the note to add it to as a bullet."},
                "new_note": {"type": "string", "description": "For reference: a new note's title to hold it."}
            }), &["item", "becomes"])),
        tool("list_projects", "List projects", Read, "Every project with its status, area, outcome and task counts (needs the app).", schema(json!({}), &[])),
        tool("create_project", "Create a project", Change,
            "Makes a project note, as the Projects screen does (needs the app); recorded in Changes, where the user can revert it.",
            schema(json!({
                "name": {"type": "string"},
                "status": {"type": "string", "enum": ["active", "on-hold", "someday", "done"]},
                "area": {"type": "string"},
                "outcome": {"type": "string", "description": "What done looks like, one sentence."}
            }), &["name"])),
        tool("update_project", "Change a project", Change,
            "Sets a project's status, area or outcome (needs the app); recorded in Changes, where the user can revert it. null clears area or outcome.",
            schema(json!({
                "project": {"type": "string", "description": "The project's name."},
                "status": {"type": "string", "enum": ["active", "on-hold", "someday", "done"]},
                "area": {"type": ["string", "null"]},
                "outcome": {"type": ["string", "null"]}
            }), &["project"])),
        // Notes and pages.
        tool("edit_page", "Change a page", Change, EDIT_PAGE, edit_schema),
        tool("create_note", "Make a new note", Change,
            "Makes a new note (not a wiki page: edit_page makes those), needs the app; recorded in Changes, where the user can revert it. Brainstead names it the vault's way, `Type. Title - YYYY-MM-DD.md`, from type, title and date. Either give content (write it as the vault's other notes of that type are written: read the type's template in Templates/ with read_section and follow its properties and headings), or give template to have Brainstead run that template as New note does, answering its questions from answers in order. To change a note that exists, use edit_page.",
            schema(json!({
                "type": {"type": "string", "description": "The note's type, as the vault's names use it: Meeting, 1-1, Idea, Project, Ask… Leave out for a plain title."},
                "title": {"type": "string"},
                "date": {"type": "string", "description": "YYYY-MM-DD (or YYYY-MM), for notes about a day: meetings, 1-1s, journals."},
                "folder": {"type": "string", "description": "A folder in the vault to put it in; the top level when left out. Not sources/, wiki/ or Templates/."},
                "content": {"type": "string", "description": "The whole note: properties (frontmatter) if any, then the body. Not with template."},
                "template": {"type": "string", "description": "A template's name in Templates/ (Meeting, 1-1…) to make the note from, instead of content."},
                "answers": {"type": "array", "items": {"type": "string"}, "description": "With template: answers to its questions, in the order it asks them (a choice by its label)."},
                "reason": {"type": "string", "description": "Why, briefly."}
            }), &["title"])),
        tool("rename_note", "Rename a note", Change,
            "Renames a note in its folder, with the links to it rewritten (needs the app); revertable in Changes. Give the new name's parts; Brainstead builds `Type. Title - date.md`.",
            schema(json!({
                "page": page,
                "type": {"type": "string"}, "title": {"type": "string"}, "date": {"type": "string"},
                "reason": {"type": "string"}
            }), &["page", "title"])),
        tool("trash_note", "Move a note to the Trash", Destroy,
            "Moves a note or page to Brainstead's Trash (needs the app), only when the user asks; it can be restored from the Trash or reverted in Changes.",
            schema(json!({"page": page, "reason": {"type": "string"}}), &["page"])),
        tool("trash", "The Trash", Change,
            "Lists what's in Brainstead's Trash, or restores an entry to where it was (needs the app). Moving something to the Trash is trash_note.",
            schema(json!({"action": {"type": "string", "enum": ["list", "restore"]}, "id": {"type": "string", "description": "For restore: the entry's id from the list."}}), &[])),
        tool("bookmarks", "Bookmarks", Change,
            "Lists the bookmarks, or with page, bookmarks it or takes its bookmark off, or with keep, keeps a bookmark as triage's Keep does (needs the app).",
            schema(json!({"page": {"type": "string", "description": "A note's path to bookmark or unbookmark."}, "keep": {"type": "string", "description": "A bookmark's target to keep: it won't need triage for two weeks."}}), &[])),
        tool("saved_searches", "Saved searches", Change,
            "Lists the saved searches, or with name and query, saves one (needs the app).",
            schema(json!({"name": {"type": "string"}, "query": {"type": "string"}, "layers": {"type": "array", "items": {"type": "string", "enum": ["note", "wiki", "source", "template"]}}}), &[])),
        // What agents changed.
        tool("changes", "Changes", Destroy,
            "What assistants and Brainstead's runs changed, and the changes held for the user (needs the app). list shows the held changes and the latest made, by run; show gives one change's diff, quotes and flags; accept makes a held change (on the page as it is now) and reject turns it down; accept_run and reject_run do every held change in a run (group from list); revert undoes a change that was made, also after later edits, and says when its lines have been edited since; revert_run reverts every change a run made (Changes' Revert all). accept and accept_run work only while the user is there (never with unattended) and only for a change held because a check failed: one held because it changes a template, adds code that runs, changes a system note's header, renames or trashes a template (or rewrites links in one), or comes from a job set to hold its changes is the user's to accept, in the app. history reads how long Changes keeps its history (Settings › AI assistants › Keep the history of agent changes), and with days or mb sets it. Accept, reject, revert or change the history only as the user asked.",
            schema(json!({
                "action": {"type": "string", "enum": ["list", "show", "accept", "reject", "accept_run", "reject_run", "revert", "revert_run", "history"]},
                "id": {"type": "string", "description": "The change's id from list."},
                "group": {"type": "string", "description": "For accept_run, reject_run and revert_run: the run's group from list."},
                "page": {"type": "string", "description": "For list: only this page's changes, by its path."},
                "days": {"type": "integer", "enum": [30, 90, 180, 365], "description": "For history: keep this many days."},
                "mb": {"type": "integer", "enum": [100, 250, 500, 1000, 2000], "description": "For history: keep at most this many MB."}
            }), &[])),
        // Runs and the wiki.
        tool("start_run", "Start a run", Run,
            "Starts work Brainstead does with a model on the user's account, as its screens do (needs the app): ingest sources into the wiki (notes, PDFs, Office files or images; their changes are made and recorded in Changes), the nightly check, the daily or weekly summary (daily_summary, weekly_summary; date picks the day or week; summary reads them), the weekly review's preparation (weekly_prep: suggestions for each step of the week's review, nothing changed until one is accepted; weekly_review lists them), a look through the last 90 days of notes for tasks and projects (find_tasks; suggestions lists what it found), a contradictions check, or a meeting note from a Teams transcript (list_transcripts; once made, the note is ingested and the transcript moved to the Trash, as the user's settings say). It returns once started; run_status shows progress and stop_run stops it.",
            schema(json!({
                "run": {"type": "string", "enum": ["ingest", "nightly", "daily_summary", "weekly_summary", "weekly_prep", "find_tasks", "contradictions", "meeting_note"]},
                "sources": {"type": "array", "items": {"type": "string"}, "description": "For ingest: vault paths to ingest, in sources/ or notes (pending_sources lists those not yet ingested). All are checked before any is queued. Every ingest waits in one queue with the app's own, one at a time, oldest source first (by the date in its name, else the file's), so the order given and how many calls make no difference."},
                "transcript": {"type": "string", "description": "For meeting_note: the transcript's path."},
                "type": {"type": "string", "description": "For meeting_note: Meeting or 1-1, if Brainstead guessed wrong."},
                "name": {"type": "string", "description": "For meeting_note: the meeting's name, or who the 1-1 was with."},
                "date": {"type": "string", "description": "For meeting_note: the meeting's day, YYYY-MM-DD; needed when list_transcripts says the date is only the capture day (ask the user). For daily_summary: the day to summarise (default yesterday); for weekly_summary: a day in the week to summarise."}
            }), &["run"])),
        tool("run_status", "How runs are going", Read, "Ingests running and lately done, the nightly check, the daily and weekly summaries and the weekly review's preparation (needs the app).", schema(json!({}), &[])),
        tool("stop_run", "Stop a run", Change,
            "Stops a run that's going (needs the app).",
            schema(json!({"run": {"type": "string", "enum": ["ingest", "nightly", "daily_summary", "weekly_summary", "weekly_prep", "contradictions"]}, "id": {"type": "string", "description": "For ingest: the run's id, else the one running."}}), &["run"])),
        // Summaries and the weekly review.
        tool("summary", "A daily or weekly summary", Read,
            "The daily or weekly summary Brainstead wrote (what the user did that day or week, from their notes, tasks and log): the latest on file, or the one for day. For \"what did I do yesterday\", give kind daily and yesterday's date.",
            schema(json!({
                "kind": {"type": "string", "enum": ["daily", "weekly"], "description": "Default daily."},
                "day": {"type": "string", "description": "YYYY-MM-DD: that day's summary, or for weekly the summary of the week it's in (2026-W40 works too). The latest when left out."}
            }), &[])),
        tool("weekly_review", "The weekly review", Read,
            "The guided weekly review (needs the app): when it's scheduled and its suggestions are next prepared, the week it's for (on a Monday or Tuesday the week just ended, otherwise this one; a paused review keeps its week), its progress (steps done, the step it's on, notes and decisions so far), the path of the week's own review note once it's finished (Me. Weekly Review - YYYY-Www.md, what the user did and wrote; read it with read_section), and the prepared suggestions not yet accepted or skipped, grouped by step, each with its id, text, source and what accepting does. weekly_suggestion accepts or skips one; start_run weekly_prep prepares them again.",
            schema(json!({}), &[])),
        tool("weekly_suggestion", "Accept or skip a weekly review suggestion", Change,
            "Accepts a prepared weekly review suggestion, doing what the Weekly review's button does (a task added, ticked, deferred or reworded, or an Inbox item clarified, undoable with ⌘Z in the app; a link added to a note, made as a change recorded in Changes, where the user can revert it); or skips it. Either way it's hidden from the review and an accepted one goes in the review's log (needs the app). Accept only what the user asked for.",
            schema(json!({
                "id": {"type": "string", "description": "The suggestion's id from weekly_review."},
                "action": {"type": "string", "enum": ["accept", "skip"]}
            }), &["id", "action"])),
        tool("weekly_start_over", "Start the weekly review over", Destroy,
            "Starts the weekly review over, as its Start over button does (needs the app): the paused review's progress, notes, decisions and handled suggestions are dropped, and it starts again from step 1 for this week. What it already changed in the vault stays, and there's no undo. Only when the user asks: refused once any call in the session passed unattended: true.",
            schema(json!({}), &[])),
        tool("save_chat", "Save an Ask chat", Change,
            "Saves a chat open in Brainstead's Ask to the vault as a note, as Ask's Save does (needs the app); it then stays up to date there as the chat goes on. Unsaved chats stay in Brainstead's app data, and closed ones beyond the latest 20 are deleted. Save only when the user asks.",
            schema(json!({
                "title": {"type": "string", "description": "The chat's title, as its tab shows it. The chat open in Ask when left out."}
            }), &[])),
        tool("list_transcripts", "Transcripts to write up", Read, "Teams meeting transcripts in Sources still without a meeting note, with what Brainstead guesses about each (needs the app).", schema(json!({}), &[])),
        tool("fix_health", "Fix Knowledge health issues", Change,
            "Applies Knowledge health's safe fixes (needs the app): all of them, or the items named (their text as lint gives it). Undoable. Issues that need judgement aren't safe fixes: make those with edit_page.",
            schema(json!({"items": {"type": "array", "items": {"type": "string"}}}), &[])),
        tool("page_shape", "Page shape", Read,
            "Knowledge health's Page shape check: which wiki entity and concept pages aren't in the page shape (opening text, Current state, topical sections, a Timeline of `### YYYY-MM-DD — title` entries newest first, each with a Source: [[…]] line, then See also), which of them Reshape pages can do by itself and why the rest need the user. With page, that page's report: the headings it would rewrite and the lines it would add.",
            schema(json!({"page": page}), &[])),
        tool("reshape_pages", "Reshape pages", Change,
            "Reshape pages, as Knowledge health's Page shape check does it (needs the app): every page that can be reshaped by itself, or the pages named (as proposed, even those that need the user; only when the user asked). Sections move whole and dated headings are rewritten; no text is lost. Each page is one change in Changes, in one run the user can revert alone or all together (changes revert_run).",
            schema(json!({"pages": {"type": "array", "items": page, "description": "Only these pages, by name or path."}}), &[])),
        tool("write_current_state", "Write Current state", Run,
            "Knowledge health's Write Current state (needs the app): for wiki pages with a Timeline but no Current state (lint lists them under Pages with no Current state), the cheap model writes one from each page's opening and newest Timeline entries only, checked (no links the page doesn't have) and made as a change in one Changes run. Runs in the background: limit does only that many first (a sample to look at), pages only those named; status says how the run is going; stop stops it after the page it's on.",
            schema(json!({
                "pages": {"type": "array", "items": page},
                "limit": {"type": "integer", "minimum": 1},
                "status": {"type": "boolean"},
                "stop": {"type": "boolean"}
            }), &[])),
        tool("fix_name", "Fix a name everywhere", Change,
            "Corrects a misspelt name across the notes and wiki, as Fix name does (needs the app); sources are left alone. Without apply it only says what would change; with apply true it changes the files (undoable).",
            schema(json!({
                "wrong": {"type": "string"}, "right": {"type": "string"},
                "apply": {"type": "boolean"},
                "remember": {"type": "boolean", "description": "Also correct it in future captures, transcripts and ingests."}
            }), &["wrong", "right"])),
        // The skill screens.
        tool("triage_bookmarks", "Triage bookmarks", Run,
            "Without items, lists the bookmarks with how long since each changed (needs the app). With items, asks the model for a keep, update or drop suggestion on each, as the Triage screen does.",
            schema(json!({"items": {"type": "array", "items": schema(json!({"target": {"type": "string"}, "path": {"type": "string"}}), &["target", "path"])}}), &[])),
        tool("draft_reply", "Draft a reply", Run,
            "Drafts a reply to an email thread in sources/ (thread) or to pasted text, as the Draft reply screen does (needs the app). Nothing is sent.",
            schema(json!({"thread": {"type": "string"}, "text": {"type": "string"}, "tone": {"type": "string", "description": "neutral, warm, brief, formal…"}}), &[])),
        tool("doc_check", "Check a document", Run,
            "Checks a document against the version in force in the canonical docs register, as Doc check does (needs the app). Without candidate it gives the register.",
            schema(json!({"candidate": {"type": "string", "description": "The document to check, by path."}, "doc": {"type": "string", "description": "The register's document name."}, "mode": {"type": "string", "enum": ["standard", "callouts"]}}), &[])),
        // Around the vault.
        tool("activity", "Recent activity", Read,
            "log.md, newest first: what Brainstead and the assistants changed (needs the app). With date, the files changed that day.",
            schema(json!({"date": {"type": "string", "description": "YYYY-MM-DD."}, "limit": {"type": "integer", "minimum": 1, "maximum": 200}}), &[])),
        tool("graph", "Links around a page", Read,
            "The pages linked to and from a page, to a depth of 1 to 3 (needs the app); the whole wiki without page.",
            schema(json!({"page": page, "depth": {"type": "integer", "minimum": 1, "maximum": 3}}), &[])),
        tool("suggestions", "Suggested tasks and projects", Change,
            "Find tasks and projects' suggestions (needs the app): tasks and projects a read of the user's notes from the last 90 days found, each with the note and quote it rests on; start_run find_tasks looks again. list gives them with their ids; accept makes one (a task added to its project's Next actions or the To Do list, a project note with its first next actions) as a change recorded in Changes, where the user can revert it (⌘Z doesn't undo it), with text to reword it (or a project's name) and outcome for a project's; skip leaves one out. Neither comes back. Accept or skip only what the user asked for.",
            schema(json!({
                "action": {"type": "string", "enum": ["list", "accept", "skip"]},
                "id": {"type": "string", "description": "The suggestion's id from list."},
                "text": {"type": "string", "description": "For accept: the task's wording, or the project's name, if it should differ."},
                "outcome": {"type": "string", "description": "For accept on a project: what done looks like, if it should differ."}
            }), &[])),
        tool("moving_over", "Moving over from the previous app", Destroy,
            "Settings › General › Moving over (needs the app). status says whether the previous app's skills (.claude/skills/) and scripts (scripts/) are still in the vault; retire does what its Retire them button does: both folders go to Brainstead's Trash (restorable from there), the name corrections are kept, and CLAUDE.md tells agents to use these tools. It says what it removed. Only when the user asks: retire is refused once any call in the session passed unattended: true.",
            schema(json!({"action": {"type": "string", "enum": ["status", "retire"]}}), &[])),
        tool("automated_tools", "Tools that start sessions", Change,
            "The user's own tools that start Claude Code sessions (Settings › Jobs & schedule): the daily summary counts their sessions as automated instead of as the user's work (needs the app). list gives them, and as suggestions the folders whose recent sessions were nearly all one prompt and done; add lists one (a name, and folder and/or opening: the folder its sessions run in, or the words their first message starts with); remove takes one off by name. Only when the user asks.",
            schema(json!({
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "name": {"type": "string", "description": "For add and remove: the tool's name."},
                "folder": {"type": "string", "description": "For add: its sessions run in a folder whose path contains this."},
                "opening": {"type": "string", "description": "For add: its sessions' first message starts with these words."}
            }), &[])),
        tool("app_status", "Brainstead's state", Read,
            "The vault, whether it's read-only (then nothing can be changed until the user switches it off in Settings › Vault), the index, whether Brainstead runs the daily and weekly summaries, and what ⌘Z would undo (needs the app).",
            schema(json!({}), &[])),
    ]
}

/// Why a call failed: arguments the tool can't take (a JSON-RPC error, as MCP asks), or the tool
/// ran and couldn't do it (a result marked as an error, which the model reads and can act on).
enum CallError {
    Args(String),
    Tool(String),
}

impl From<String> for CallError {
    fn from(e: String) -> Self {
        CallError::Tool(e)
    }
}

/// Calls in the last minute, to keep a runaway loop from hammering the vault (MCP asks servers to
/// rate-limit tool calls).
const PER_MINUTE: usize = 120;

fn call(ctx: &Ctx, name: &str, args: Value) -> Result<String, CallError> {
    fn parse<T: for<'de> Deserialize<'de>>(v: Value) -> Result<T, CallError> {
        serde_json::from_value(v).map_err(|e| CallError::Args(format!("Those arguments don't fit: {e}")))
    }
    if !tools().iter().any(|t| t["name"] == name) {
        return Err(CallError::Args(format!("Unknown tool: {name}")));
    }
    {
        let mut calls = ctx.calls.lock().unwrap();
        let now = std::time::Instant::now();
        calls.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(60));
        if calls.len() >= PER_MINUTE {
            return Err(CallError::Tool(format!(
                "Over {PER_MINUTE} calls in a minute: wait a moment, and do more in each call where you can."
            )));
        }
        calls.push(now);
    }
    let mut obj = if args.is_null() { json!({}) } else { args };
    let unattended = obj.get("unattended").and_then(Value::as_bool) == Some(true);
    if unattended {
        ctx.unattended.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    // Once a call has said nobody's watching, the whole session is (D-20261005-09).
    let unwatched = ctx.unattended.load(std::sync::atomic::Ordering::Relaxed);
    let act = |action: &str, a: Value| -> Result<String, CallError> { Ok(act(ctx, action, a)?) };
    // The app records these in Changes as this session's (D-20261005-10).
    if ["edit_task", "move_task", "clarify_inbox", "create_project", "update_project"].contains(&name) {
        obj["origin"] = serde_json::to_value(origin(ctx, unattended)).unwrap_or_default();
    }
    match name {
        "search" => Ok(search(ctx, parse(obj)?)?),
        "read_section" => Ok(read_section(ctx, parse(obj)?)?),
        "backlinks" => Ok(backlinks(ctx, parse(obj)?)?),
        "resolve_entity" => Ok(resolve_entity(ctx, parse(obj)?)?),
        "facts" => Ok(facts(ctx, parse(obj)?)?),
        "pending_sources" => Ok(pending_sources(ctx)),
        "lint" => Ok(lint_tool(ctx, parse(obj)?)?),
        "help" => Ok(help(parse(obj)?)?),
        "edit_page" => Ok(edit_page(ctx, parse(obj)?)?),
        "create_task" => Ok(create_task(ctx, parse(obj)?)?),
        "delete_task" => Ok(delete_task(ctx, parse(obj)?)?),
        "create_note" => {
            let a: NoteArgs = parse(obj.clone())?;
            if a.template.as_deref().is_some_and(|t| !t.trim().is_empty()) {
                let mut obj = obj;
                obj["origin"] = serde_json::to_value(origin(ctx, a.unattended)).unwrap_or_default();
                act("note.from_template", obj)
            } else {
                Ok(create_note(ctx, a)?)
            }
        }
        "rename_note" => Ok(rename_note(ctx, parse(obj)?)?),
        "trash_note" => Ok(trash_note(ctx, parse(obj)?)?),
        "list_tasks" => act("tasks.list", obj),
        "edit_task" => act("task.edit", obj),
        "move_task" => act("task.move", obj),
        "list_inbox" => act("inbox.list", obj),
        "clarify_inbox" => act("inbox.clarify", obj),
        "list_projects" => act("projects.list", obj),
        "create_project" => act("project.create", obj),
        "update_project" => act("project.update", obj),
        "trash" => act("trash", obj),
        "bookmarks" => act("bookmarks", obj),
        "saved_searches" => act("saved_searches", obj),
        "changes" => {
            let action = obj.get("action").and_then(Value::as_str).unwrap_or("list");
            if (action == "accept" || action == "accept_run") && unwatched {
                return Err(CallError::Tool(
                    "Nothing held can be accepted in a session nobody is watching: the user accepts held changes on Brainstead's Changes screen.".into(),
                ));
            }
            act("changes", obj)
        }
        "weekly_start_over" | "moving_over"
            if unwatched && (name == "weekly_start_over" || obj.get("action").and_then(Value::as_str) == Some("retire")) =>
        {
            Err(CallError::Tool("That's only for when the user is there and asks for it, not in an unattended session.".into()))
        }
        "weekly_start_over" => act("weekly.start_over", obj),
        "moving_over" => act("moving_over", obj),
        "start_run" => act("run.start", obj),
        "run_status" => act("run.status", obj),
        "stop_run" => act("run.stop", obj),
        "list_transcripts" => act("meeting.transcripts", obj),
        "summary" => Ok(summary(ctx, parse(obj)?)?),
        "weekly_review" => act("weekly.status", obj),
        "weekly_suggestion" => act("weekly.suggestion", obj),
        "save_chat" => act("chat.save", obj),
        "fix_health" => act("health.fix", obj),
        "page_shape" => Ok(page_shape_tool(ctx, obj.get("page").and_then(Value::as_str))?),
        "reshape_pages" => act("health.reshape", obj),
        "write_current_state" => act("health.current_state", obj),
        "fix_name" => act("fix_name", obj),
        "triage_bookmarks" => {
            let has_items = obj.get("items").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
            act(if has_items { "triage.suggest" } else { "triage.list" }, obj)
        }
        "draft_reply" => act("reply.draft", obj),
        "doc_check" => {
            let run = obj.get("candidate").and_then(Value::as_str).is_some_and(|c| !c.trim().is_empty());
            act(if run { "doccheck.run" } else { "doccheck.register" }, obj)
        }
        "activity" => act("activity", obj),
        "graph" => act("graph", obj),
        "app_status" => act("status", obj),
        "automated_tools" => act("automated", obj),
        "suggestions" => act("suggestions", obj),
        _ => Err(CallError::Args(format!("Unknown tool: {name}"))),
    }
}

/// How long the server waits for the app to answer one action.
const ACT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(150);

/// Runs an action in the app (src/mcpActions.ts, through core/src/bridge.rs), opening the app
/// first when it isn't running. A text result is given back as it is; anything else as JSON.
fn act(ctx: &Ctx, action: &str, args: Value) -> Result<String, String> {
    open_app(ctx)?;
    let req = bridge::Request { id: bridge::new_id(), action: action.into(), args, chat: ctx.chat.clone(), model: ctx.model.clone() };
    let r = bridge::ask(&ctx.data, &req, ACT_TIMEOUT);
    if !r.ok {
        return Err(r.error.unwrap_or_else(|| "It didn't work.".into()));
    }
    Ok(match r.result {
        Value::String(s) => s,
        Value::Null => "Done.".into(),
        v => serde_json::to_string_pretty(&v).unwrap_or_default(),
    })
}

/// Opens Brainstead when it isn't running (the app's own binary, with the same app data folder)
/// and waits for it to say it's up.
fn open_app(ctx: &Ctx) -> Result<(), String> {
    if bridge::app_alive(&ctx.data) {
        return Ok(());
    }
    let exe = ctx.app.as_ref().ok_or("Brainstead isn't open. Open it, then try again.")?;
    let mut cmd = std::process::Command::new(exe);
    cmd.env("BRAINSTEAD_DATA", &ctx.data)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group: the app keeps running when the assistant's session ends.
        cmd.process_group(0);
    }
    cmd.spawn().map_err(|e| format!("Brainstead isn't open, and opening it failed: {e}. Open it, then try again."))?;
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(45) {
        if bridge::app_alive(&ctx.data) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Err("Brainstead was opened but didn't start in time. Try again in a moment.".into())
}

#[derive(Deserialize)]
struct TaskRefArgs {
    task: String,
    text: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    unattended: bool,
}

/// A task's words, without its tags, dates, fields and ids, to compare what a model gives with
/// the line (src/mcpActions.ts has the same rule).
fn task_words(s: &str) -> String {
    static NOISE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"#[^\s#]+|[📅⏳🛫➕✅❌]\u{fe0f}?\s*\d{4}-\d{2}-\d{2}|[🔺⏫🔼🔽⏬🔁🏁⛔🆔]\u{fe0f}?|[\[(]\w+::[^\])]*[\])]|\^[\w-]+|\[\[([^\]|]*\|)?|\]\]|^\s*[-*+]\s+\[.\]\s*")
            .unwrap()
    });
    NOISE.replace_all(s, " ").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// `path:line` (1-based) and the task's text to the line in the file, as the app's own lookup.
fn find_task(ctx: &Ctx, id: &str, text: &str) -> Result<(String, usize, String), String> {
    let (path, n) = id.rsplit_once(':').ok_or_else(|| format!("“{id}” isn't a task id: use the path:line that list_tasks gives."))?;
    let n: usize = n.parse().map_err(|_| format!("“{id}” isn't a task id: use the path:line that list_tasks gives."))?;
    brainstead_core::trash::safe_rel(path).map_err(|e| e.to_string())?;
    let body = read_text(ctx, path).map_err(|_| format!("{path} isn't in the vault."))?;
    let want = task_words(text);
    let lines: Vec<&str> = body.lines().collect();
    let fits = |l: &str| {
        brainstead_core::tasks::parse_line(l, 0).is_some_and(|t| {
            let have = task_words(&t.text);
            want.is_empty() || have.contains(&want) || (!have.is_empty() && want.contains(&have))
        })
    };
    if let Some(l) = n.checked_sub(1).and_then(|i| lines.get(i)).filter(|l| fits(l)) {
        return Ok((path.to_string(), n - 1, l.to_string()));
    }
    let hits: Vec<usize> = (0..lines.len()).filter(|&i| fits(lines[i])).collect();
    match hits.as_slice() {
        [i] => Ok((path.to_string(), *i, lines[*i].to_string())),
        _ => Err(format!("There's no task at {id} reading “{text}” any more. List the tasks again for its current place.")),
    }
}

fn delete_task(ctx: &Ctx, a: TaskRefArgs) -> Result<String, String> {
    let (path, at, line) = find_task(ctx, &a.task, &a.text)?;
    let text = brainstead_core::tasks::parse_line(&line, 0).map(|t| t.text).unwrap_or_default();
    let c = change(
        ctx,
        &path,
        Kind::Task,
        &format!("Delete “{text}”"),
        &a.reason,
        a.unattended,
        Instruction::DeleteLine { line, at: Some(at) },
    );
    send(ctx, c, vec![])
}

/// A change for the app (src/changes.rs's `Submit`), from this session.
fn change(ctx: &Ctx, page: &str, kind: Kind, title: &str, reason: &str, unattended: bool, instruction: Instruction) -> Value {
    json!({
        "page": page,
        "kind": kind,
        "title": title,
        "reason": reason,
        "instruction": instruction,
        "origin": origin(ctx, unattended),
        "model": ctx.model,
    })
}

/// Sends a change to the app, which makes it or holds it; its reply, and `notes` after it.
fn send(ctx: &Ctx, change: Value, notes: Vec<String>) -> Result<String, String> {
    let mut out = act(ctx, "change.submit", json!({ "change": change }))?;
    for n in notes {
        out.push_str(&format!("\n{n}"));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct RenameArgs {
    page: String,
    #[serde(rename = "type", default)]
    kind: Option<String>,
    title: String,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    unattended: bool,
}

fn rename_note(ctx: &Ctx, a: RenameArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let rel = existing(ctx, &ix, &a.page)?;
    let name = filename::compose(a.kind.as_deref(), &a.title, a.date.as_deref()).ok_or("The new name needs a title.")?;
    let to = match rel.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/{name}"),
        None => name,
    };
    if to == rel {
        return Err("That's its name already.".into());
    }
    if ctx.vault.join(&to).exists() && !to.eq_ignore_ascii_case(&rel) {
        return Err(format!("{to} exists already."));
    }
    let c =
        change(ctx, &rel, Kind::Rename, &format!("Rename to {}", filename::stem(&to)), &a.reason, a.unattended, Instruction::Rename { to });
    send(ctx, c, vec![])
}

#[derive(Deserialize)]
struct TrashArgs {
    page: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    unattended: bool,
}

fn trash_note(ctx: &Ctx, a: TrashArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let rel = existing(ctx, &ix, &a.page)?;
    let c =
        change(ctx, &rel, Kind::Trash, &format!("Move {} to the Trash", filename::stem(&rel)), &a.reason, a.unattended, Instruction::Trash);
    send(ctx, c, vec![])
}

#[derive(Deserialize)]
struct NoteArgs {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    title: String,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    folder: Option<String>,
    #[serde(default)]
    content: Option<String>,
    /// With these, the app runs the template (`note.from_template`) instead.
    #[serde(default)]
    template: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    answers: Vec<String>,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    unattended: bool,
}

fn create_note(ctx: &Ctx, a: NoteArgs) -> Result<String, String> {
    if let Some(d) = a.date.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        let ok = chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
            || chrono::NaiveDate::parse_from_str(&format!("{d}-01"), "%Y-%m-%d").is_ok();
        if !ok {
            return Err(format!("The date {d} isn't YYYY-MM-DD or YYYY-MM."));
        }
    }
    let name = filename::compose(a.kind.as_deref(), &a.title, a.date.as_deref()).ok_or("The note needs a title.")?;
    let folder = a.folder.as_deref().unwrap_or("").trim().trim_matches('/').to_string();
    if !folder.is_empty() {
        brainstead_core::trash::safe_rel(&folder).map_err(|e| e.to_string())?;
        let first = folder.split('/').next().unwrap_or("");
        if folder.split('/').any(|s| s.starts_with('.')) || proposals::NOT_FOR_NOTES.iter().any(|n| n.eq_ignore_ascii_case(first)) {
            return Err(format!("A note can't go in {folder}/: not in sources/, wiki/ (edit_page makes wiki pages) or Templates/."));
        }
        if !ctx.vault.join(&folder).is_dir() {
            return Err(format!("There's no folder {folder}/ in the vault."));
        }
    }
    let rel = if folder.is_empty() { name } else { format!("{folder}/{name}") };
    proposals::valid_new_note(&rel)?;
    if ctx.vault.join(&rel).exists() {
        return Err(format!("{rel} exists already. To change it, use edit_page."));
    }
    let content = a
        .content
        .filter(|c| !c.trim().is_empty())
        .ok_or("Give content (the whole note), or template to make it from one of the vault's templates.")?;
    let mut after = content.replace("\r\n", "\n");
    if !after.ends_with('\n') {
        after.push('\n');
    }
    let title = format!("New note {}", filename::stem(&rel));
    let c = change(ctx, &rel, Kind::New, &title, &a.reason, a.unattended, Instruction::Page { content: after });
    send(ctx, c, vec![])
}

#[derive(Deserialize)]
struct HelpArgs {
    #[serde(default)]
    topic: Option<String>,
    #[serde(default)]
    section: Option<String>,
    #[serde(default)]
    query: Option<String>,
}

/// The app's help (core/src/help.rs); it needs no vault.
fn help(a: HelpArgs) -> Result<String, String> {
    let some = |s: Option<String>| s.filter(|x| !x.trim().is_empty());
    match (some(a.topic), some(a.query)) {
        (Some(t), _) => brainstead_core::help::read(&t, a.section.as_deref()),
        (None, Some(q)) => Ok(brainstead_core::help::search(&q, 5)),
        (None, None) => Ok(brainstead_core::help::list()),
    }
}

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    #[serde(default)]
    layers: Vec<String>,
    since: Option<String>,
    limit: Option<usize>,
}

fn search(ctx: &Ctx, a: SearchArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let layers = a
        .layers
        .iter()
        .map(|l| match l.trim_end_matches('s') {
            "note" => Ok("note".to_string()),
            "wiki" => Ok("wiki".to_string()),
            "source" => Ok("source".to_string()),
            "template" => Ok("template".to_string()),
            _ => Err(format!("Not a part of the vault: {l}. Use notes, wiki, sources or templates.")),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let since = match a.since.as_deref() {
        Some(d) => Some(chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| format!("Not a date: {d}. Use YYYY-MM-DD."))?),
        None => None,
    };
    let limit = a.limit.unwrap_or(10).clamp(1, 30);
    let res = ix.search(&SearchRequest { q: a.query.clone(), layers, limit: 200 })?;
    let day = |ms: i64| chrono::DateTime::from_timestamp_millis(ms).map(|d| d.with_timezone(&chrono::Local).date_naive());
    let hits: Vec<_> = res.hits.iter().filter(|h| since.is_none_or(|s| day(h.file.mtime).is_some_and(|d| d >= s))).collect();
    if hits.is_empty() {
        return Ok(format!("Nothing in the vault matches {}.", a.query));
    }
    let mut out = format!("{} of {} matching files for {}:\n", hits.len().min(limit), hits.len(), a.query);
    for (i, h) in hits.iter().take(limit).enumerate() {
        let when = h.file.date.clone().or_else(|| day(h.file.mtime).map(|d| d.to_string())).unwrap_or_default();
        out.push_str(&format!("\n{}. {} — {} ({}, {when})\n", i + 1, h.file.path, h.file.title, h.file.layer));
        if !h.heading.is_empty() {
            out.push_str(&format!("   § {}\n", h.heading));
        }
        let snip: String = h.snippet.iter().map(|s| s.text.as_str()).collect();
        let snip = snip.split_whitespace().collect::<Vec<_>>().join(" ");
        if !snip.is_empty() {
            out.push_str(&format!("   {snip}\n"));
        }
    }
    Ok(out)
}

/// What a page argument names.
enum PageRef {
    /// A file in the vault, and its text when it's text.
    Found(String),
    /// A path that isn't there.
    NotThere(String),
}

/// `[[Orbit App#Current state|the app]]` → `Orbit App`.
fn bare(page: &str) -> String {
    let t = page.trim().trim_start_matches("![[").trim_start_matches("[[").trim_end_matches("]]");
    let t = t.split('|').next().unwrap_or(t);
    let t = t.split('#').next().unwrap_or(t);
    t.trim().trim_start_matches('/').nfc().collect()
}

fn find_page(ctx: &Ctx, ix: &Index, page: &str) -> Result<PageRef, String> {
    let p = bare(page);
    if p.is_empty() {
        return Err("Which page? None was given.".into());
    }
    if p.contains('/') || p.ends_with(".md") {
        brainstead_core::trash::safe_rel(&p).map_err(|e| e.to_string())?;
        let with_ext = if Path::new(&p).extension().is_some() { p.clone() } else { format!("{p}.md") };
        for cand in [&p, &with_ext] {
            if ctx.vault.join(cand).is_file() {
                return Ok(PageRef::Found(cand.clone()));
            }
        }
        return Ok(PageRef::NotThere(with_ext));
    }
    match ix.resolve(std::slice::from_ref(&p))?.into_iter().next().flatten() {
        Some(rel) => Ok(PageRef::Found(rel)),
        None => Err(format!(
            "There's no page called {p}. resolve_entity finds close names; a new page is proposed by its path, as wiki/entities/{p}.md."
        )),
    }
}

fn existing(ctx: &Ctx, ix: &Index, page: &str) -> Result<String, String> {
    match find_page(ctx, ix, page)? {
        PageRef::Found(rel) => Ok(rel),
        PageRef::NotThere(rel) => Err(format!("There's no file at {rel}.")),
    }
}

fn is_text(rel: &str) -> bool {
    brainstead_core::vault::is_note_ext(rel) || rel.ends_with(".txt")
}

fn read_text(ctx: &Ctx, rel: &str) -> Result<String, String> {
    if !is_text(rel) {
        return Err(format!("{rel} isn't a text file: read it with read_section."));
    }
    std::fs::read(ctx.vault.join(rel)).map(|b| String::from_utf8_lossy(&b).into_owned()).map_err(|e| format!("Couldn't read {rel}: {e}"))
}

#[derive(Deserialize)]
struct ReadArgs {
    page: String,
    heading: Option<String>,
}

fn headings(text: &str) -> Vec<(usize, usize, String)> {
    let lines: Vec<&str> = text.split('\n').collect();
    let md = brainstead_core::markdown::lines(text, 0);
    lines
        .iter()
        .enumerate()
        .filter(|(i, _)| !md.get(*i).is_some_and(|l| l.code))
        .filter_map(|(i, l)| brainstead_core::markdown::heading(l.trim_end_matches('\r')).map(|(n, t)| (i, n, t.to_string())))
        .collect()
}

/// A page or section within the result's limit. One with headings is shown as an outline with its
/// opening, summing-up and newest sections in full (`pageview::view`); one without keeps its start
/// and most of its end (`pageview::excerpt`), as what's new is mostly at the end. Either says how
/// to read the rest.
fn fit(text: &str, len: usize, has_headings: bool) -> String {
    let budget = MAX_CHARS - 2_000;
    if len <= budget {
        return text.to_string();
    }
    let (shown, how) = if has_headings {
        (brainstead_core::pageview::view(text, budget).text, "Sections shown only by their heading: ask for one by its heading.")
    } else {
        (brainstead_core::pageview::excerpt(text, budget), "The middle isn't shown: search for words in it to find what you need.")
    };
    format!("[{len} characters in all, so shown in part. {how}]\n\n{shown}")
}

fn read_section(ctx: &Ctx, a: ReadArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let rel = existing(ctx, &ix, &a.page)?;
    if !is_text(&rel) {
        return read_parts(ctx, &ix, &rel, a.heading.as_deref());
    }
    let text = read_text(ctx, &rel)?;
    let hs = headings(&text);
    let list = || hs.iter().map(|(_, n, t)| format!("{}{t}", "  ".repeat(n.saturating_sub(1)))).collect::<Vec<_>>().join("\n");
    match a.heading.as_deref().map(|h| h.trim().trim_start_matches('#').trim()).filter(|h| !h.is_empty()) {
        None => Ok(format!("{rel}\n\n{}", fit(&text, text.chars().count(), !hs.is_empty()))),
        Some(h) => {
            let Some(at) = hs.iter().position(|(_, _, t)| t.eq_ignore_ascii_case(h)) else {
                return Err(format!("{rel} has no heading “{h}”. Its headings:\n{}", list()));
            };
            let (start, level, _) = hs[at];
            let end = hs[at + 1..].iter().find(|(_, n, _)| *n <= level).map(|(i, _, _)| *i);
            let lines: Vec<&str> = text.split('\n').collect();
            let part = lines[start..end.unwrap_or(lines.len())].join("\n");
            let subs = hs[at + 1..].iter().take_while(|(_, n, _)| *n > level).count() > 0;
            Ok(format!("{rel}\n\n{}", fit(part.trim_end(), part.chars().count(), subs).trim_end()))
        }
    }
}

/// A PDF or Office file: one page, slide or sheet by its name ("page=6", "Page 6", "Slide 2",
/// a sheet's name), or all of it with each part headed.
fn read_parts(ctx: &Ctx, ix: &Index, rel: &str, which: Option<&str>) -> Result<String, String> {
    let x = extracted(ctx, ix, rel).ok_or_else(|| format!("Brainstead has no text for {rel} (it may be a scan, or not indexed yet)."))?;
    let names = || x.parts.iter().map(|p| p.label.clone()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(", ");
    match which.map(str::trim).filter(|w| !w.is_empty()) {
        Some(w) => {
            let page = proposals::page_anchor(w).map(|n| format!("Page {n}"));
            let want = page.as_deref().unwrap_or(w);
            let p = x
                .parts
                .iter()
                .find(|p| p.label.eq_ignore_ascii_case(want))
                .ok_or_else(|| format!("{rel} has no “{w}”. It has: {}", names()))?;
            Ok(format!("{rel} · {}\n\n{}", p.label, p.text))
        }
        None => {
            let all: Vec<String> =
                x.parts.iter().map(|p| if p.label.is_empty() { p.text.clone() } else { format!("## {}\n\n{}", p.label, p.text) }).collect();
            let all = all.join("\n\n");
            if all.chars().count() > MAX_CHARS {
                return Ok(format!("{rel} is long ({} characters). Ask for one part: {}", all.chars().count(), names()));
            }
            Ok(format!("{rel}\n\n{all}"))
        }
    }
}

#[derive(Deserialize)]
struct PageArgs {
    page: String,
}

fn backlinks(ctx: &Ctx, a: PageArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let rel = existing(ctx, &ix, &a.page)?;
    let Some(mut meta) = ix.doc_meta(&rel)? else { return Err(format!("{rel} isn't in Brainstead's index yet.")) };
    brainstead_core::read::fill_context(&ctx.vault, &mut meta.backlinks);
    if meta.backlinks.is_empty() {
        return Ok(format!("Nothing links to {rel}."));
    }
    let mut out = format!("{} link(s) to {rel}:\n", meta.backlinks.len());
    for b in &meta.backlinks {
        let line = b.line.map(|n| format!(" (line {})", n + 1)).unwrap_or_default();
        out.push_str(&format!("- {}{line}: {}\n", b.path, b.context));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct NameArgs {
    name: String,
}

fn resolve_entity(ctx: &Ctx, a: NameArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let name = bare(&a.name);
    if name.is_empty() {
        return Err("Which name? None was given.".into());
    }
    let r = brainstead_core::names::resolve(&ix, &name)?;
    if let Some((rel, how)) = r.exact {
        let how = if how == "alias" { "an alias" } else { "its file name" };
        return Ok(format!("{name} is {rel} (by {how})."));
    }
    if r.close.is_empty() {
        return Ok(format!("No page is called {name}, or anything close."));
    }
    let mut out = format!("No page is called exactly {name}. Close:\n");
    for (p, s) in &r.close {
        out.push_str(&format!("- {p} ({:.0}% alike)\n", s * 100.0));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct FactsArgs {
    page: Option<String>,
    subject: Option<String>,
    attribute: Option<String>,
}

/// One kept claim as a line: value, when, quote, source, entry.
fn fact_line(c: &brainstead_core::claims::Kept) -> String {
    let when = c.as_of.as_deref().map(|d| format!(" (as of {d})")).unwrap_or_default();
    let entry = c.entry.as_deref().map(|e| format!(", entry “{e}”")).unwrap_or_default();
    let name = brainstead_core::lint::stem(brainstead_core::lint::name_of(&c.source));
    format!("{}{when}: “{}” from [[{name}]]{entry}, recorded {}", c.value, c.quote, c.recorded)
}

fn facts(ctx: &Ctx, a: FactsArgs) -> Result<String, String> {
    let page = match a.page.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => Some(existing(ctx, &ctx.index()?, p)?),
        None => None,
    };
    let files: Vec<_> =
        brainstead_core::claims::all(&ctx.vault).into_iter().filter(|f| page.as_ref().is_none_or(|p| *p == f.page)).collect();
    let mut out = String::new();
    for f in &files {
        let found = brainstead_core::claims::facts(f, a.subject.as_deref(), a.attribute.as_deref());
        if found.is_empty() {
            continue;
        }
        out.push_str(&format!("{}:\n", f.page));
        for x in found {
            out.push_str(&format!("- {} — {}: {}\n", x.subject, x.attribute, fact_line(&x.latest)));
            for e in &x.earlier {
                out.push_str(&format!("  - superseded: {}\n", fact_line(e)));
            }
        }
    }
    if out.is_empty() {
        let on = page.map(|p| format!(" on {p}")).unwrap_or_default();
        return Ok(format!(
            "No kept facts match{on}. Facts are kept from the first ingest that checks them, so older pages may have none: read the page (read_section) instead."
        ));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct SummaryArgs {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    day: Option<String>,
}

/// A daily or weekly summary block, read from the monthly files (either name, before or after the
/// rename): that day's or week's, or the latest within the look-back.
fn summary(ctx: &Ctx, a: SummaryArgs) -> Result<String, CallError> {
    use brainstead_core::reviews::{self, target, ReviewKind, Target};
    let kind = match a.kind.as_deref().map(str::trim).unwrap_or("daily") {
        "" | "daily" => ReviewKind::Daily,
        "weekly" => ReviewKind::Weekly,
        k => return Err(CallError::Args(format!("kind is daily or weekly, not {k}."))),
    };
    let read = |p: &str| std::fs::read_to_string(ctx.vault.join(p)).ok();
    let name = if kind == ReviewKind::Daily { "daily" } else { "weekly" };
    let found = match a.day.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        None => {
            reviews::latest(kind, ctx.today, read).ok_or_else(|| format!("There's no {name} summary from the last few weeks on file."))?
        }
        Some(d) => {
            let t = Target::parse(d).map_err(|_| CallError::Args(format!("day is YYYY-MM-DD (or a week, 2026-W40), not {d}.")))?;
            let t = match (kind, t) {
                (ReviewKind::Weekly, Target::Day(day)) => Target::week_of(day),
                (ReviewKind::Daily, Target::Week { .. }) => {
                    return Err(CallError::Args("A daily summary is for a day: give YYYY-MM-DD.".into()))
                }
                (_, t) => t,
            };
            let w = target::window(t);
            let (file, heading) = w.locate(read);
            let text = read(&file).and_then(|f| reviews::latest::block_of(&f, &heading)).ok_or_else(|| {
                format!("There's no {name} summary for {} on file. start_run {name}_summary with date writes one.", w.label())
            })?;
            reviews::Latest { file, heading, label: w.label().to_string(), text }
        }
    };
    Ok(format!("The {name} summary for {}, from {}:\n\n{}", found.label, found.file, found.text))
}

fn pending_sources(ctx: &Ctx) -> String {
    let p = lint::pending_sources(&ctx.vault);
    if p.is_empty() {
        return "Every source is cited by a wiki page.".into();
    }
    format!("{} source(s) no wiki page cites yet:\n{}", p.len(), p.iter().map(|s| format!("- {s}")).collect::<Vec<_>>().join("\n"))
}

#[derive(Deserialize)]
struct LintArgs {
    page: Option<String>,
}

/// The page shape dry run, for the vault or one page.
fn page_shape_tool(ctx: &Ctx, page: Option<&str>) -> Result<String, String> {
    use brainstead_core::pageshape;
    if let Some(p) = page.filter(|p| !p.trim().is_empty()) {
        let rel = existing(ctx, &ctx.index()?, p)?;
        if !pageshape::shaped(&rel) {
            return Ok(format!("{rel} isn't a wiki entity or concept page: only those have the page shape."));
        }
        let text = read_text(ctx, &rel)?;
        let files = pageshape::vault_files(&ctx.vault);
        let (r, _) = pageshape::one(&rel, &text, &pageshape::Sources::from_paths(files.iter().map(String::as_str)));
        if r.in_shape {
            return Ok(format!("{rel} is in the page shape ({} Timeline entries).", r.report.entries));
        }
        let rp = &r.report;
        let mut out = vec![if !rp.broken.is_empty() {
            format!("{rel} can't be reshaped by script: {}.", rp.broken.join("; "))
        } else if r.auto {
            format!("{rel} isn't in the page shape; reshape_pages can reshape it by itself ({} Timeline entries).", rp.entries)
        } else {
            format!("{rel} isn't in the page shape and needs the user first: {}.", rp.reasons.join("; "))
        }];
        if !rp.headings.is_empty() {
            out.push("Headings it would rewrite:".into());
            out.extend(rp.headings.iter().take(40).map(|(o, n)| format!("- {o}  →  {n}")));
        }
        if !rp.added.is_empty() {
            out.push("Lines it would add:".into());
            out.extend(rp.added.iter().take(40).map(|l| format!("- {l}")));
        }
        if !rp.removed.is_empty() {
            out.push("Lines it would drop (repeated in a merged See also):".into());
            out.extend(rp.removed.iter().map(|l| format!("- {l}")));
        }
        out.extend(rp.notes.iter().map(|n| format!("Note: {n}")));
        return Ok(out.join("\n"));
    }
    let all = pageshape::survey(&ctx.vault);
    let out_of: Vec<_> = all.iter().map(|x| &x.0).filter(|r| !r.in_shape).collect();
    if out_of.is_empty() {
        return Ok(format!("All {} wiki entity and concept pages are in the page shape.", all.len()));
    }
    let auto: Vec<&str> = out_of.iter().filter(|r| r.auto).map(|r| r.path.as_str()).collect();
    let mut out = vec![format!(
        "{} of {} pages aren't in the page shape: {} can be reshaped by itself (reshape_pages), {} need the user first.",
        out_of.len(),
        all.len(),
        auto.len(),
        out_of.len() - auto.len()
    )];
    for r in out_of.iter().filter(|r| !r.auto) {
        let why = if r.report.broken.is_empty() {
            r.report.reasons.join("; ")
        } else {
            format!("can't be reshaped: {}", r.report.broken.join("; "))
        };
        out.push(format!("- {}: {why}", r.path));
    }
    if !auto.is_empty() {
        out.push(format!(
            "By itself: {}{}",
            auto.iter().take(30).copied().collect::<Vec<_>>().join(", "),
            if auto.len() > 30 { ", …" } else { "" }
        ));
    }
    Ok(out.join("\n"))
}

fn lint_tool(ctx: &Ctx, a: LintArgs) -> Result<String, String> {
    let only = match a.page.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => Some(existing(ctx, &ctx.index()?, p)?),
        None => None,
    };
    let r = lint::run(&ctx.vault, ctx.today, &Default::default());
    let mut out = String::new();
    for c in &r.checks {
        let items: Vec<&lint::Item> =
            c.items.iter().filter(|i| only.as_ref().is_none_or(|p| i.page.as_ref() == Some(p) || i.pages.contains(p))).collect();
        if items.is_empty() {
            continue;
        }
        out.push_str(&format!("\n{} ({}):\n", c.title, items.len()));
        for i in items.iter().take(40) {
            out.push_str(&format!("- {}\n", i.text));
        }
    }
    Ok(if out.is_empty() {
        "No issues.".into()
    } else {
        format!("Knowledge health{}:\n{out}", only.map(|p| format!(" for {p}")).unwrap_or_default())
    })
}

#[derive(Deserialize)]
struct ProposeArgs {
    page: String,
    title: String,
    #[serde(default)]
    reason: String,
    section: Option<String>,
    content: Option<String>,
    edits: Option<Vec<proposals::Edit>>,
    #[serde(default)]
    quotes: Vec<QuoteArg>,
    #[serde(default)]
    unattended: bool,
}

#[derive(Deserialize)]
struct QuoteArg {
    source: String,
    anchor: Option<String>,
    text: String,
}

/// Where this session's changes come from: the Ask chat that started it, or this terminal session;
/// scheduled when the call says nobody is watching.
fn origin(ctx: &Ctx, unattended: bool) -> Origin {
    Origin {
        kind: "chat".into(),
        chat: ctx.chat.clone(),
        label: ctx.chat.is_none().then(|| "Terminal session".into()),
        run: Some(ctx.chat.clone().unwrap_or_else(|| ctx.session.clone())),
        trigger: unattended.then(|| "scheduled".into()),
    }
}

fn edit_page(ctx: &Ctx, a: ProposeArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let patch = match (a.section, a.content, a.edits) {
        (Some(section), Some(content), None) => Patch::Section { section, content },
        (None, None, Some(edits)) => Patch::Replace { edits },
        (None, Some(content), None) => Patch::Content { content },
        _ => return Err("Give exactly one of: section and content, edits, or content alone.".into()),
    };
    let (rel, before) = match find_page(ctx, &ix, &a.page)? {
        PageRef::Found(rel) => {
            let text = read_text(ctx, &rel)?;
            (rel, Some(text))
        }
        PageRef::NotThere(rel) => {
            proposals::valid_new_page(&rel)?;
            if !matches!(patch, Patch::Content { .. }) {
                return Err(format!("{rel} doesn't exist yet: give its whole text in content."));
            }
            (rel, None)
        }
    };
    // Checked here, so the model hears at once what's wrong; the app runs it again on the page as
    // it is when it's made.
    let mut after = proposals::patched(before.as_deref().unwrap_or(""), &patch)?;
    if let Some(b) = &before {
        after = proposals::bump_updated(b, &after, &ctx.today.to_string());
        if after.replace("\r\n", "\n") == b.replace("\r\n", "\n") {
            return Err("That changes nothing in the page.".into());
        }
        if brainstead_core::frontmatter::split(&after).error.is_some() && brainstead_core::frontmatter::split(b).error.is_none() {
            return Err("The page's properties wouldn't read any more: check the frontmatter you wrote.".into());
        }
    }
    let mut quotes: Vec<Quote> =
        a.quotes.into_iter().map(|q| Quote { source: q.source, anchor: q.anchor, text: q.text, checked: None, path: None }).collect();
    let problems = proposals::mark_quotes(&mut quotes, |s| source_text(ctx, &ix, s))?;
    let resolves =
        |t: &str| ix.resolve(&[t.to_string()]).ok().and_then(|v| v.into_iter().next().flatten()).is_some() || ctx.vault.join(t).exists();
    let ghosts = proposals::new_ghost_links(before.as_deref().unwrap_or(""), &after, resolves);
    let warnings: Vec<String> = ghosts.iter().map(|g| format!("[[{g}]] goes to no page")).collect();
    let (kind, instruction) = match &before {
        Some(b) => (
            Kind::Edit,
            match patch {
                Patch::Section { section, content } => Instruction::Section { section, content },
                Patch::Replace { edits } => Instruction::Replace { edits },
                // The whole page given: kept as the changes it makes, so it doesn't write over what
                // changed meanwhile.
                Patch::Content { .. } => changes::from_texts(Some(b), &after),
            },
        ),
        None => (Kind::New, Instruction::Page { content: after.clone() }),
    };
    // `updated:` moved too: the section or edits alone wouldn't, so the change is the texts'.
    let instruction = match (&before, &instruction) {
        (Some(b), Instruction::Section { .. } | Instruction::Replace { .. })
            if instruction.text(&rel, Some(b)).ok().as_deref() != Some(after.as_str()) =>
        {
            changes::from_texts(Some(b), &after)
        }
        _ => instruction,
    };
    let mut c = change(ctx, &rel, kind, &a.title, &a.reason, a.unattended, instruction);
    c["quotes"] = serde_json::to_value(&quotes).unwrap_or_default();
    c["warnings"] = json!(warnings);
    // A quote that isn't in its source is marked on the quote; the app's checks flag it, once.
    let mut notes: Vec<String> = problems.iter().map(|p| format!("Note: {p}")).collect();
    let unchecked = quotes.iter().filter(|q| q.checked.is_none()).count();
    if unchecked > 0 {
        notes.push(format!("{unchecked} quote(s) couldn't be checked: Brainstead has no text for their source."));
    }
    notes.extend(warnings.iter().map(|w| format!("Note: {w}.")));
    send(ctx, c, notes)
}

/// A quote's source: its path, and its text when Brainstead reads it.
fn source_text(ctx: &Ctx, ix: &Index, source: &str) -> (Option<String>, SourceText) {
    match find_page(ctx, ix, source) {
        Ok(PageRef::Found(rel)) => {
            let t = if is_text(&rel) {
                read_text(ctx, &rel).map(SourceText::Text).unwrap_or(SourceText::Missing)
            } else {
                match extracted(ctx, ix, &rel) {
                    Some(x) => SourceText::Parts(x),
                    None => SourceText::Unchecked,
                }
            };
            (Some(rel), t)
        }
        _ => (None, SourceText::Missing),
    }
}

/// A PDF or Office file's text, as the app indexed it; None when it hasn't (or can't).
fn extracted(ctx: &Ctx, ix: &Index, rel: &str) -> Option<brainstead_core::extract::Extracted> {
    ix.extracted(rel, &ctx.data.join("text")).ok().flatten().filter(|x| !x.parts.is_empty())
}

#[derive(Deserialize)]
struct TaskArgs {
    text: String,
    project: Option<String>,
    context: Option<String>,
    effort: Option<String>,
    due: Option<String>,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    unattended: bool,
}

fn create_task(ctx: &Ctx, a: TaskArgs) -> Result<String, String> {
    let ix = ctx.index()?;
    let text = a.text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.trim_start_matches("- [ ]").trim().to_string();
    if text.is_empty() {
        return Err("The task has no text.".into());
    }
    let mut line = format!("- [ ] {text}");
    if let Some(c) = a.context.as_deref().filter(|c| !c.trim().is_empty()) {
        line = write::with_contexts(&line, &[c.to_string()]).map_err(|e| e.to_string())?;
    }
    if let Some(e) = a.effort.as_deref().filter(|e| !e.trim().is_empty()) {
        line = write::with_effort(&line, Some(e)).map_err(|e| e.to_string())?;
    }
    if let Some(d) = a.due.as_deref().filter(|d| !d.trim().is_empty()) {
        line = write::with_date(&line, write::DateKind::Due, Some(d.trim())).map_err(|e| e.to_string())?;
    }
    let dest = match a.project.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let name = bare(p);
            let cands = [name.clone(), format!("{}{name}", projects::PREFIX)];
            let found = ix.resolve(&cands)?.into_iter().flatten().find(|r| projects::is_project_path(r));
            found.ok_or_else(|| format!("There's no project called {name}."))?
        }
        None => TODO_LIST.to_string(),
    };
    read_text(ctx, &dest).map_err(|_| format!("{dest} isn't in the vault."))?;
    let c = change(ctx, &dest, Kind::Task, &format!("Add “{text}”"), &a.reason, a.unattended, Instruction::AddTask { line });
    send(ctx, c, vec![])
}

/// Runs the server on stdin and stdout; the process's exit code.
pub fn main_with(args: &[String], default_data: PathBuf) -> i32 {
    let ctx = match Ctx::from_args(args, default_data) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("brainstead mcp: {e}");
            return 1;
        }
    };
    let stdin = std::io::stdin();
    match serve(&ctx, stdin.lock(), std::io::stdout().lock()) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("brainstead mcp: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests;
