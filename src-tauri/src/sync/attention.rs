// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! When a sign-in problem is worth the user's attention: once it has lasted. A token turned down
//! for a moment is tried again at the next pass, and one running out is renewed by the extension
//! within minutes, so most problems clear by themselves; the top bar's dot and the "Sync needs you"
//! notification speak up only for one that has been there at every look for `SETTLE_SECS`
//! (D-20261127-03). Settings › Sync still shows everything as it is.

use std::collections::BTreeMap;
use std::sync::Mutex;

/// How long a problem must last before the user is told: two passes, so the retry after a refusal
/// and the extension's reload before a token runs out have had their chance.
pub const SETTLE_SECS: i64 = 30 * 60;

/// Since when each problem has been seen at every look, by `scope:name`.
static SINCE: Mutex<BTreeMap<String, i64>> = Mutex::new(BTreeMap::new());

/// Of `names`, the problems in `scope` (`microsoft`, `slack`) seen now, those not yet lasted
/// `SETTLE_SECS`. Forgets the ones in `scope` that have cleared, so one that comes back starts again.
pub fn fresh(scope: &str, names: &[String], now: i64) -> Vec<String> {
    let mut since = SINCE.lock().unwrap_or_else(|e| e.into_inner());
    let key = |n: &str| format!("{scope}:{n}");
    let prefix = format!("{scope}:");
    since.retain(|k, _| !k.starts_with(&prefix) || names.iter().any(|n| key(n) == *k));
    names.iter().filter(|n| now - *since.entry(key(n)).or_insert(now) < SETTLE_SECS).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_problem_is_fresh_until_it_has_lasted_half_an_hour_and_starts_again_once_cleared() {
        let s = "test-scope";
        let chats = vec!["chats".to_string()];
        assert_eq!(fresh(s, &chats, 1000), chats);
        assert_eq!(fresh(s, &chats, 1000 + SETTLE_SECS - 1), chats);
        assert!(fresh(s, &chats, 1000 + SETTLE_SECS).is_empty(), "lasted: worth telling");
        // Cleared, then back: fresh again.
        assert!(fresh(s, &[], 1000 + SETTLE_SECS + 60).is_empty());
        assert_eq!(fresh(s, &chats, 1000 + SETTLE_SECS + 120), chats);
    }
}
