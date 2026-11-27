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
//!
//! A refusal lapses after `RETRY_SECS`: the token is tried again at the next hand-over. A 401 isn't
//! always the end of a session (a brief network change can make Microsoft turn a token down that the
//! browser goes on using), and a page doesn't renew a token it still thinks good, so a refusal that
//! stood until the token ran out kept the sync off for up to a day while the tab worked. A token
//! that really is dead is turned down again on its first call and refused afresh.

use std::collections::BTreeMap;

/// How long a refusal stands before the same token is tried again: two hand-overs.
pub const RETRY_SECS: i64 = 30 * 60;

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
    /// `key`'s refusal as it stands at `now`: none once it has lapsed (`RETRY_SECS`).
    pub fn of(rejected: &'a BTreeMap<String, String>, at: &BTreeMap<String, i64>, key: &str, now: i64) -> Self {
        let when = at.get(key).copied();
        if lapsed(when, now) {
            return Refused::default();
        }
        Refused { fingerprint: rejected.get(key).map(String::as_str), at: when }
    }

    /// Whether `secret` is the refused one, or was issued (`issued`, when it says) before the
    /// refusal, and so is as dead.
    pub fn covers(&self, secret: &str, issued: Option<i64>) -> bool {
        self.fingerprint.is_some_and(|fp| fingerprint(secret) == fp) || matches!((self.at, issued), (Some(at), Some(iat)) if iat < at)
    }
}

/// Whether a refusal made `at` has lapsed by `now`. One with no time (kept before refusals had
/// one) lapses too.
fn lapsed(at: Option<i64>, now: i64) -> bool {
    at.is_none_or(|t| now - t >= RETRY_SECS)
}

/// Forgets the refusals that have lapsed by `now`, so a sign-in read back from the store tries those
/// tokens again at once: on the pass 20 seconds after the app starts, without waiting for a hand-over.
pub fn prune(rejected: &mut BTreeMap<String, String>, at: &mut BTreeMap<String, i64>, now: i64) {
    rejected.retain(|k, _| !lapsed(at.get(k).copied(), now));
    at.retain(|k, _| rejected.contains_key(k));
}

/// Records that `key`'s token `secret` was turned down at `now`.
pub fn record(rejected: &mut BTreeMap<String, String>, at: &mut BTreeMap<String, i64>, key: &str, secret: &str, now: i64) {
    rejected.insert(key.to_string(), fingerprint(secret));
    at.insert(key.to_string(), now);
}

/// The refusals that still stand after a hand-over at `now`: those not lapsed whose service was
/// handed nothing newer. `new(key)` is the service's handed-over token and when it was issued, or None.
pub fn still<'n>(
    rejected: &BTreeMap<String, String>,
    at: &BTreeMap<String, i64>,
    now: i64,
    new: impl Fn(&str) -> Option<(&'n str, Option<i64>)>,
) -> (BTreeMap<String, String>, BTreeMap<String, i64>) {
    let mut keep = (BTreeMap::new(), BTreeMap::new());
    for (k, fp) in rejected {
        let refused = Refused { fingerprint: Some(fp), at: at.get(k).copied() };
        if lapsed(refused.at, now) || new(k).is_some_and(|(secret, issued)| !refused.covers(secret, issued)) {
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
        let r = Refused::of(&rejected, &at, "mail", 1100);
        assert!(r.covers("token-a-0123456789abcdef", None), "the refused one");
        assert!(r.covers("token-b-0123456789abcdeX", Some(900)), "issued before the refusal");
        assert!(!r.covers("token-c-0123456789abcdeY", Some(1100)), "issued after");
        assert!(!r.covers("token-d-0123456789abcdeZ", None), "a token that doesn't say when is judged by itself");
        assert!(!Refused::of(&rejected, &at, "chats", 1100).covers("anything", Some(0)));

        // A hand-over: the same dead token keeps it refused; a newer one clears it.
        let same = still(&rejected, &at, 1100, |_| Some(("token-a-0123456789abcdef", None)));
        assert_eq!(same.0.len(), 1);
        assert_eq!(same.1.get("mail"), Some(&1000));
        let none = still(&rejected, &at, 1100, |_| None);
        assert_eq!(none.0.len(), 1);
        let newer = still(&rejected, &at, 1100, |_| Some(("token-c-0123456789abcdeY", Some(1100))));
        assert!(newer.0.is_empty() && newer.1.is_empty());
    }

    #[test]
    fn a_refusal_lapses_after_half_an_hour_so_a_token_turned_down_by_a_blip_is_tried_again() {
        let (mut rejected, mut at) = (BTreeMap::new(), BTreeMap::new());
        record(&mut rejected, &mut at, "chats", "token-a-0123456789abcdef", 1000);
        let later = 1000 + RETRY_SECS;
        assert!(Refused::of(&rejected, &at, "chats", later - 1).covers("token-a-0123456789abcdef", None));
        assert!(!Refused::of(&rejected, &at, "chats", later).covers("token-a-0123456789abcdef", None));
        assert!(!Refused::of(&rejected, &at, "chats", later).covers("token-b-0123456789abcdeX", Some(900)));
        // The same token handed over again: still refused within the half hour, tried again after.
        let same = |_: &str| Some(("token-a-0123456789abcdef", None));
        assert_eq!(still(&rejected, &at, later - 1, same).0.len(), 1);
        assert!(still(&rejected, &at, later, same).0.is_empty());
        // Nothing handed over: the refusal lapses all the same (the service has no token till then).
        assert!(still(&rejected, &at, later, |_| None).0.is_empty());
        // Read back from the store: kept within the half hour, gone after.
        let (mut r, mut a) = (rejected.clone(), at.clone());
        prune(&mut r, &mut a, later - 1);
        assert_eq!((r.len(), a.len()), (1, 1));
        prune(&mut r, &mut a, later);
        assert!(r.is_empty() && a.is_empty());
    }
}
