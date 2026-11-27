// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! What a turned-down sign-in means, the same for Teams, Outlook and Slack (D-20261126-02,
//! D-20261127-03). When a service refuses a token (Microsoft's 401, Slack's `invalid_auth`) the sync
//! remembers it by fingerprint, with when, and stops using it. The refusal stands, and is shown,
//! until either:
//!
//! - a hand-over brings a newer token: one issued after the refusal (ending a session ends every
//!   token issued before it, so those count as refused too, allowing `LEEWAY_SECS` because Microsoft
//!   back-dates a token's issue time a few minutes), or
//! - the same token works again. A 401 isn't always the end of a session (a brief network change can
//!   make Microsoft turn down a token the browser goes on using, and the page won't fetch a new one
//!   while it thinks its own good), so after `RETRY_SECS` the token is tried again; a call that
//!   succeeds clears the refusal, one turned down records it afresh.
//!
//! While it stands and the tab has nothing newer, the extension is told to reload the tab (`renew`
//! in its answer) so the page fetches a fresh one. Each sign-in keeps two maps, by service (or Slack
//! workspace): the refused token's fingerprint, and when it was refused.

use std::collections::BTreeMap;

/// How long a refusal blocks its token before it's tried again: one sync pass.
pub const RETRY_SECS: i64 = 15 * 60;
/// How far before a refusal a token may say it was issued and still count as newer: Microsoft
/// back-dates `iat` by about five minutes.
pub const LEEWAY_SECS: i64 = 10 * 60;

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

    /// Whether `secret` is the refused one, or was issued (`issued`, when it says) well before the
    /// refusal, and so is as dead.
    pub fn covers(&self, secret: &str, issued: Option<i64>) -> bool {
        self.fingerprint.is_some_and(|fp| fingerprint(secret) == fp)
            || matches!((self.at, issued), (Some(at), Some(iat)) if iat < at - LEEWAY_SECS)
    }

    /// Whether the refusal keeps its tokens from being used at `now`: until it's `RETRY_SECS` old.
    pub fn blocks(&self, now: i64) -> bool {
        self.fingerprint.is_some() && !lapsed(self.at, now)
    }

    /// The refusal as a hand-over at `now` should apply it to the page's tokens: in full while it
    /// blocks, nothing once it has lapsed (the refused token may then be tried again).
    pub fn for_choosing(self, now: i64) -> Self {
        if self.blocks(now) {
            self
        } else {
            Refused::default()
        }
    }
}

/// Whether a refusal made `at` has lapsed by `now`. One with no time (kept before refusals had one)
/// has.
pub fn lapsed(at: Option<i64>, now: i64) -> bool {
    at.is_none_or(|t| now - t >= RETRY_SECS)
}

/// Records that `key`'s token `secret` was turned down at `now`.
pub fn record(rejected: &mut BTreeMap<String, String>, at: &mut BTreeMap<String, i64>, key: &str, secret: &str, now: i64) {
    rejected.insert(key.to_string(), fingerprint(secret));
    at.insert(key.to_string(), now);
}

/// Clears `key`'s refusal after a call with its token worked: the service takes it again. Says
/// whether there was one.
pub fn clear(rejected: &mut BTreeMap<String, String>, at: &mut BTreeMap<String, i64>, key: &str) -> bool {
    at.remove(key);
    rejected.remove(key).is_some()
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
    fn a_refusal_covers_its_token_and_those_issued_well_before_it_until_a_newer_one_comes() {
        let (mut rejected, mut at) = (BTreeMap::new(), BTreeMap::new());
        record(&mut rejected, &mut at, "mail", "token-a-0123456789abcdef", 10_000);
        let r = Refused::of(&rejected, &at, "mail");
        assert!(r.covers("token-a-0123456789abcdef", None), "the refused one");
        assert!(r.covers("token-b-0123456789abcdeX", Some(10_000 - LEEWAY_SECS - 1)), "issued well before the refusal");
        assert!(!r.covers("token-e-0123456789abcdeW", Some(10_000 - 300)), "Microsoft back-dates a fresh token: not dead");
        assert!(!r.covers("token-c-0123456789abcdeY", Some(10_100)), "issued after");
        assert!(!r.covers("token-d-0123456789abcdeZ", None), "a token that doesn't say when is judged by itself");
        assert!(!Refused::of(&rejected, &at, "chats").covers("anything", Some(0)));

        // A hand-over: the same dead token keeps it refused, however long since; a newer one clears it.
        let same = still(&rejected, &at, |_| Some(("token-a-0123456789abcdef", None)));
        assert_eq!(same.0.len(), 1);
        assert_eq!(same.1.get("mail"), Some(&10_000));
        assert_eq!(still(&rejected, &at, |_| None).0.len(), 1);
        let newer = still(&rejected, &at, |_| Some(("token-c-0123456789abcdeY", Some(10_100))));
        assert!(newer.0.is_empty() && newer.1.is_empty());
    }

    #[test]
    fn a_refusal_blocks_its_token_for_a_pass_then_lets_it_be_tried_again_and_stands_till_it_works() {
        let (mut rejected, mut at) = (BTreeMap::new(), BTreeMap::new());
        record(&mut rejected, &mut at, "chats", "token-a-0123456789abcdef", 1000);
        let r = Refused::of(&rejected, &at, "chats");
        let later = 1000 + RETRY_SECS;
        assert!(r.blocks(later - 1) && !r.blocks(later));
        assert!(r.for_choosing(later - 1).covers("token-a-0123456789abcdef", None));
        assert!(!r.for_choosing(later).covers("token-a-0123456789abcdef", None), "tried again");
        // Still shown until a call with it works.
        assert!(clear(&mut rejected, &mut at, "chats"));
        assert!(rejected.is_empty() && at.is_empty());
        assert!(!clear(&mut rejected, &mut at, "chats"));
    }
}
