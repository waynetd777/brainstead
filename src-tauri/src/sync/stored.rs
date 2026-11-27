// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Reading and keeping a sign-in in the secret store (the Keychain on macOS, Credential Manager on
//! Windows) so that a moment's trouble reading it never reads as "not signed in". The store is
//! written by the extensions' helper (another process) as well as the app: a read can land while a
//! write is replacing the item (macOS deletes and adds it again when an update in place is refused;
//! Windows rewrites its slots one by one), or while the store is briefly unavailable (around sleep
//! and wake). So a read that finds nothing, can't be made, or doesn't parse is tried again; one that
//! still fails falls back to the last sign-in this process read or kept, and only the store saying,
//! twice, that there is none means there is none (D-20261127-03).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::platform;

/// The last sign-in read or kept, by account, as kept.
static LAST: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn remember(account: &str, json: Option<&str>) {
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let map = last.get_or_insert_with(HashMap::new);
    match json {
        Some(j) => map.insert(account.to_string(), j.to_string()),
        None => map.remove(account),
    };
}

fn last(account: &str) -> Option<String> {
    LAST.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(account).cloned())
}

/// The sign-in kept as `account`, read steadily (see the module).
pub fn load<T: DeserializeOwned>(account: &str) -> Option<T> {
    match read_steady(account, platform::secret_read, Duration::from_millis(250)) {
        Read::Found(j) => serde_json::from_str(&j).ok(),
        Read::Nothing => None,
        // The store couldn't say: the last sign-in read or kept stands.
        Read::Unsure => last(account).and_then(|j| serde_json::from_str(&j).ok()),
    }
}

/// [`load`], for changing it and storing it back: an error, rather than the last one read, when the
/// store couldn't say, so a change never writes an older copy over a newer one (or, in the
/// extensions' helper, which starts afresh each time, a sign-in missing the mail token and the
/// refusals over the real one). Tried again at the next hand-over or pass.
pub fn load_for_change<T: DeserializeOwned>(account: &str) -> Result<Option<T>, String> {
    match read_steady(account, platform::secret_read, Duration::from_millis(250)) {
        Read::Found(j) => serde_json::from_str(&j).map(Some).map_err(|e| e.to_string()),
        Read::Nothing => Ok(None),
        Read::Unsure => Err("Couldn't read the sign-in from the secret store just now; it's tried again shortly.".into()),
    }
}

/// The sign-in this process last read or kept, without asking the store: for a check made on every
/// call that only matters when it shows something.
pub fn peek<T: DeserializeOwned>(account: &str) -> Option<T> {
    last(account).and_then(|j| serde_json::from_str(&j).ok())
}

/// What a steady read found.
enum Read {
    Found(String),
    /// The store said, twice, there's none.
    Nothing,
    /// It couldn't say: failing, or the item mid-write each time.
    Unsure,
}

fn read_steady(account: &str, read: impl Fn(&str) -> Result<Option<String>, String>, pause: Duration) -> Read {
    let mut nothing = 0;
    for _ in 0..3 {
        match read(account) {
            Ok(Some(j)) if serde_json::from_str::<serde_json::Value>(&j).is_ok() => {
                remember(account, Some(&j));
                return Read::Found(j);
            }
            Ok(Some(_)) | Err(_) => {}
            Ok(None) => {
                nothing += 1;
                if nothing == 2 {
                    remember(account, None);
                    return Read::Nothing;
                }
            }
        }
        std::thread::sleep(pause);
    }
    Read::Unsure
}

/// Keeps `value` as `account`.
pub fn store<T: Serialize>(account: &str, value: &T) -> Result<(), String> {
    let j = serde_json::to_string(value).map_err(|e| e.to_string())?;
    platform::secret_set(account, &j)?;
    remember(account, Some(&j));
    Ok(())
}

/// Forgets `account`.
pub fn forget(account: &str) -> Result<(), String> {
    platform::secret_delete(account)?;
    remember(account, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn a_read_caught_mid_write_or_failing_is_tried_again_and_never_written_back_from_memory() {
        let acct = "test-stored-steady";
        let quick = Duration::from_millis(0);
        let found = |r: Read| match r {
            Read::Found(j) => serde_json::from_str::<serde_json::Value>(&j).unwrap()["n"].as_i64(),
            _ => None,
        };
        // Gone for a moment (an item being replaced), then back.
        let answers = RefCell::new(vec![Ok(None), Ok(Some("{\"n\":2}".to_string()))]);
        assert_eq!(found(read_steady(acct, |_| answers.borrow_mut().remove(0), quick)), Some(2));
        assert_eq!(peek::<serde_json::Value>(acct).unwrap()["n"], 2);
        // Half-written (doesn't parse), or the store refusing: unsure, so a reader falls back to the
        // last read and a change isn't made.
        assert!(matches!(read_steady(acct, |_| Ok(Some("{\"n\":".to_string())), quick), Read::Unsure));
        assert!(matches!(read_steady(acct, |_| Err("busy".to_string()), quick), Read::Unsure));
        assert_eq!(peek::<serde_json::Value>(acct).unwrap()["n"], 2);
        // The store saying twice there's none: signed out, and forgotten.
        assert!(matches!(read_steady(acct, |_| Ok(None), quick), Read::Nothing));
        assert!(peek::<serde_json::Value>(acct).is_none());
    }
}
