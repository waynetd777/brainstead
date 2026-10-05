// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! What every parser here needs from markdown: lines with their byte offsets, whether each is
//! inside a fenced code block, headings, and text with inline code blanked out (so a `[[link]]`
//! or `#tag` written as code isn't read as one).

/// One line of the body. `start` is its byte offset in the whole file; `text` has no line ending.
#[derive(Debug, Clone, Copy)]
pub struct Line<'a> {
    pub no: usize,
    pub start: usize,
    pub text: &'a str,
    /// Inside a ``` or ~~~ fence (the fence lines themselves count as inside).
    pub code: bool,
}

/// Lines of `src` from byte `from` on, numbered from the file's first line (0-based). A fence inside
/// a quote or callout (`> ````) counts too, and ends with the quote if it isn't closed before.
pub fn lines(src: &str, from: usize) -> Vec<Line<'_>> {
    let mut out = Vec::new();
    // The fence character, its count, and whether it opened inside a quote.
    let mut fence: Option<(u8, usize, bool)> = None;
    let first = src[..from].matches('\n').count();
    let mut pos = from;
    for (k, raw) in src[from..].split_inclusive('\n').enumerate() {
        let text = raw.trim_end_matches('\n').trim_end_matches('\r');
        let (quote, inner) = crate::tasks::split_quote(text);
        if fence.is_some_and(|(_, _, q)| q && quote.is_empty()) {
            fence = None;
        }
        // Inside a fence opened outside any quote, `>` is just code.
        let inner = if fence.is_some_and(|(_, _, q)| !q) { text } else { inner };
        let t = inner.trim_start();
        let indent = inner.len() - t.len();
        let marker = fence_marker(t).filter(|_| indent < 4);
        let code = match (fence, marker) {
            (None, Some((c, n))) => {
                fence = Some((c, n, !quote.is_empty()));
                true
            }
            (Some((c, n, _)), Some((c2, n2))) if c == c2 && n2 >= n && t.trim_end().bytes().all(|b| b == c) => {
                fence = None;
                true
            }
            (Some(_), _) => true,
            (None, None) => false,
        };
        out.push(Line { no: first + k, start: pos, text, code });
        pos += raw.len();
    }
    out
}

/// "```" or "~~~" (three or more) at the start of a line: the fence character and its count.
fn fence_marker(t: &str) -> Option<(u8, usize)> {
    let c = *t.as_bytes().first()?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let n = t.bytes().take_while(|&b| b == c).count();
    (n >= 3).then_some((c, n))
}

/// An ATX heading: its level and text, with closing #s removed.
pub fn heading(line: &str) -> Option<(usize, &str)> {
    let t = line.trim_start();
    if line.len() - t.len() > 3 {
        return None;
    }
    let level = t.bytes().take_while(|&b| b == b'#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &t[level..];
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None;
    }
    let mut text = rest.trim();
    let closed = text.trim_end_matches('#');
    if closed.len() < text.len() && (closed.is_empty() || closed.ends_with([' ', '\t'])) {
        text = closed.trim_end();
    }
    if text.is_empty() {
        return None;
    }
    Some((level, text))
}

/// `line` with each inline code span (`` `x` ``, ``` ``x`` ```) replaced by spaces of the same byte
/// length, so offsets still line up with the original.
pub fn blank_code_spans(line: &str) -> std::borrow::Cow<'_, str> {
    if !line.contains('`') {
        return line.into();
    }
    let b = line.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'`' {
            i += 1;
            continue;
        }
        let n = b[i..].iter().take_while(|&&c| c == b'`').count();
        // Find a closing run of exactly n backticks.
        let mut j = i + n;
        let mut close = None;
        while j < b.len() {
            if b[j] == b'`' {
                let m = b[j..].iter().take_while(|&&c| c == b'`').count();
                if m == n {
                    close = Some(j);
                    break;
                }
                j += m;
            } else {
                j += 1;
            }
        }
        match close {
            Some(j) => {
                for c in &mut out[i..j + n] {
                    *c = b' ';
                }
                i = j + n;
            }
            None => i += n,
        }
    }
    // Only ASCII bytes were replaced, by ASCII, so it's still valid UTF-8.
    String::from_utf8(out).map(Into::into).unwrap_or_else(|_| line.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences() {
        let src = "a\n```js\n[[x]]\n```\nb\n~~~~\n```\n~~~~\nc";
        let l = lines(src, 0);
        let code: Vec<bool> = l.iter().map(|l| l.code).collect();
        assert_eq!(code, [false, true, true, true, false, true, true, true, false]);
        assert_eq!(l[4].text, "b");
        assert_eq!(&src[l[4].start..l[4].start + 1], "b");
    }

    #[test]
    fn fences_in_quotes() {
        let code = |src: &str| lines(src, 0).iter().map(|l| l.code).collect::<Vec<_>>();
        assert_eq!(code("> [!note]\n> ```\n> - [ ] x\n> ```\n> - [ ] y"), [false, true, true, true, false]);
        // Not closed before the quote ends: the fence ends with it.
        assert_eq!(code("> ```\n> a\n\nb"), [true, true, false, false]);
        // A fence outside a quote isn't closed by a quoted one.
        assert_eq!(code("```\n> ```\nc\n```\nd"), [true, true, true, true, false]);
    }

    #[test]
    fn headings() {
        assert_eq!(heading("## Actions"), Some((2, "Actions")));
        assert_eq!(heading("#tag"), None);
        assert_eq!(heading("# Title ##"), Some((1, "Title")));
        assert_eq!(heading("####### seven"), None);
        assert_eq!(heading("    # code"), None);
        assert_eq!(heading("# C#"), Some((1, "C#")));
    }

    #[test]
    fn code_spans() {
        assert_eq!(blank_code_spans("a `[[x]]` b"), "a         b");
        assert_eq!(blank_code_spans("``a ` b`` c"), "          c");
        assert_eq!(blank_code_spans("open ` only"), "open ` only");
    }
}
