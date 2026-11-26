// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! What a turned-down sign-in means, the same for Teams, Outlook and Slack (D-20261126-02). When a
//! service refuses a token (Microsoft's 401, Slack's `invalid_auth`) the sync stops using it and
//! remembers it by fingerprint, with when. A hand-over that brings only that token, or one issued
//! before the refusal (ending a session ends every token issued before it), leaves the service
//! refused, and the extension is told to reload the tab (`renew` in its answer) so the page fetches
//! a fresh one; a token issued after it clears the refusal. Each sign-in keeps two maps, by service
//! (or Slack workspace): the refused token's fingerprint, and when it was refused.

use std::collections::BTreeMap;

/// A short fingerprint of a secret (its last characters), to recognise it again. Nothing secret is
/// kept: a token's end is part of its signature.
pub fn fingerprint(secret: &str) -> String {
    secret.chars().rev().take(16).collect()
}

/// What was refused for one service: the refused token's fingerprint and when.
#[derive(Clone, Copy, Default)]
pub struct Refused<'a> {
    pub fingerprint: Option<&'a str>,
    pub at: Option<i64>,
}

impl<'a> Refused<'a> {
    pub fn of(rejected: &'a BTreeMap<String, String>, at: &BTreeMap<String, i64>, key: &str) -> Self {
        Refused { fingerprint: rejected.get(key).map(String::as_str), at: at.get(key).copied() }
    }

    /// Whether `secret` is the refused one, or was issued (`issued`, when it says) before the
    /// refusal, and so is as dead.
    pub fn covers(&self, secret: &str, issued: Option<i64>) -> bool {
        self.fingerprint.is_some_and(|fp| fingerprint(secret) == fp) || matches!((self.at, issued), (Some(at), Some(iat)) if iat < at)
    }
}

/// Records that `key`'s token `secret` was turned down at `now`.
pub fn record(rejected: &mut BTreeMap<String, String>, at: &mut BTreeMap<String, i64>, key: &str, secret: &str, now: i64) {
    rejected.insert(key.to_string(), fingerprint(secret));
    at.insert(key.to_string(), now);
}

/// The refusals that still stand after a hand-over: those whose service was handed nothing newer.
/// `new(key)` is the service's handed-over token and when it was issued, or None.
pub fn still<'n>(
    rejected: &BTreeMap<String, String>,
    at: &BTreeMap<String, i64>,
    new: impl Fn(&str) -> Option<(&'n str, Option<i64>)>,
) -> (BTreeMap<String, String>, BTreeMap<String, i64>) {
    let mut keep = (BTreeMap::new(), BTreeMap::new());
    for (k, fp) in rejected {
        let refused = Refused { fingerprint: Some(fp), at: at.get(k).copied() };
        if new(k).is_some_and(|(secret, issued)| !refused.covers(secret, issued)) {
            continue;
        }
        keep.0.insert(k.clone(), fp.clone());
        if let Some(t) = at.get(k) {
            keep.1.insert(k.clone(), *t);
        }
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_covers_its_token_and_those_issued_before_it_until_a_newer_one_comes() {
        let (mut rejected, mut at) = (BTreeMap::new(), BTreeMap::new());
        record(&mut rejected, &mut at, "mail", "token-a-0123456789abcdef", 1000);
        let r = Refused::of(&rejected, &at, "mail");
        assert!(r.covers("token-a-0123456789abcdef", None), "the refused one");
        assert!(r.covers("token-b-0123456789abcdeX", Some(900)), "issued before the refusal");
        assert!(!r.covers("token-c-0123456789abcdeY", Some(1100)), "issued after");
        assert!(!r.covers("token-d-0123456789abcdeZ", None), "a token that doesn't say when is judged by itself");
        assert!(!Refused::of(&rejected, &at, "chats").covers("anything", Some(0)));

        // A hand-over: the same dead token keeps it refused; a newer one clears it.
        let same = still(&rejected, &at, |_| Some(("token-a-0123456789abcdef", None)));
        assert_eq!(same.0.len(), 1);
        assert_eq!(same.1.get("mail"), Some(&1000));
        let none = still(&rejected, &at, |_| None);
        assert_eq!(none.0.len(), 1);
        let newer = still(&rejected, &at, |_| Some(("token-c-0123456789abcdeY", Some(1100))));
        assert!(newer.0.is_empty() && newer.1.is_empty());
    }
}
