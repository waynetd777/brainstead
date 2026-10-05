// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! The app's own chat workflows (§7.1), listed in Ask's `/` picker beside the vault's skills. A
//! message starting `/<name>` is sent as the workflow's instructions with the rest of the message
//! as the question, so every CLI can run it (a vault skill only runs in Claude Code).

/// Name (as typed after `/`), one line for the picker, and the instructions.
pub const WORKFLOWS: &[(&str, &str, &str)] =
    &[("wiki", "Answer from the vault with citations, using Brainstead's search and sections", include_str!("../workflows/wiki-query.md"))];

/// The message to send for `prompt`: a workflow's instructions and the question, when it starts
/// with one's `/name`; None otherwise.
pub fn expand(prompt: &str) -> Option<String> {
    let rest = prompt.trim_start().strip_prefix('/')?;
    let (name, question) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let (_, _, text) = WORKFLOWS.iter().find(|(n, _, _)| *n == name)?;
    let q = question.trim();
    let q = if q.is_empty() { "(No question given: ask what the user wants to know.)" } else { q };
    Some(format!("{}\n\n# The question\n\n{q}", text.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_only_its_own() {
        let e = expand("/wiki when is the soft launch?").unwrap();
        assert!(e.starts_with("# Answer from the vault") && e.ends_with("# The question\n\nwhen is the soft launch?"));
        assert!(expand("/ingest sources/x.md").is_none());
        assert!(expand("what about /wiki").is_none());
        assert!(expand("/wiki").unwrap().contains("No question given"));
    }
}
