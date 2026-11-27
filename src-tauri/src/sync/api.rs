// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

//! Calls to Microsoft's web APIs with the user's own sign-in (`auth`). These are the same
//! endpoints the Teams and Outlook web apps call. The sync only ever reads; the one write is
//! [`write_json`], with which Draft reply saves a reply as an Outlook draft (`reply`), never sending it. Chats and the Teams
//! calendar go through chatsvc / the middle tier (a Skype token plus the Spaces bearer); mail and the
//! Outlook calendar through Outlook REST (the Outlook bearer); transcripts through Substrate.

use reqwest::blocking::Client;
use serde_json::Value;

use super::auth::{self, Service};

/// The browser-like headers Microsoft's web APIs expect on a request from the Teams/Outlook origin.
fn web_headers(req: reqwest::blocking::RequestBuilder) -> reqwest::blocking::RequestBuilder {
    req.header("Origin", "https://teams.microsoft.com")
        .header("Referer", "https://teams.microsoft.com/")
        .header("Accept", "application/json")
}

/// A GET returning JSON, with the bearer token for `svc`. A non-2xx is an error carrying the status.
pub fn get_json(client: &Client, svc: Service, url: &str) -> Result<Value, String> {
    let token = auth::token(svc)?;
    let resp = checked(svc, &token, || web_headers(client.get(url).bearer_auth(&token)).send().map_err(|e| e.to_string()))?;
    read(resp, url)
}

/// A POST or PATCH with a JSON body and the bearer token for `svc`, returning the JSON answer. Only
/// Draft reply's Put in Outlook uses it (D-20261120-05): it makes and fills a draft, never sends.
pub fn write_json(client: &Client, svc: Service, method: reqwest::Method, url: &str, body: &Value) -> Result<Value, String> {
    let token = auth::token(svc)?;
    let resp = checked(svc, &token, || {
        let req = client.request(method.clone(), url).bearer_auth(&token).header("Content-Type", "application/json").body(body.to_string());
        web_headers(req).send().map_err(|e| e.to_string())
    })?;
    read(resp, url)
}

/// How long to wait before asking again after a 401, to tell a moment's refusal from a real one.
const RECHECK: std::time::Duration = std::time::Duration::from_secs(2);

/// Sends a request made with `used`, `svc`'s token, and says what Microsoft made of the token: a
/// 401 is asked again once, after a moment, and only a second one counts as a refusal (`auth::reject`,
/// shown to the user and the token not used until it's tried again); an answer that went through
/// clears a refusal the token had (`auth::worked`). The response is returned either way, to be read.
pub fn checked(
    svc: Service,
    used: &str,
    send: impl Fn() -> Result<reqwest::blocking::Response, String>,
) -> Result<reqwest::blocking::Response, String> {
    let mut resp = send()?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        std::thread::sleep(RECHECK);
        resp = send()?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            auth::reject(svc, used);
        }
    }
    if resp.status().is_success() {
        auth::worked(svc);
    }
    Ok(resp)
}

/// A GET on chatsvc / the middle tier, which need the Skype token alongside the Spaces bearer.
pub fn get_chatsvc(client: &Client, url: &str) -> Result<Value, String> {
    with_skype(client, Service::Spaces, url, |spaces, skype| {
        web_headers(client.get(url).bearer_auth(spaces).header("Authentication", format!("skypetoken={skype}")))
            .send()
            .map_err(|e| e.to_string())
    })
}

/// A GET on the chat-service aggregator (teams and channels), which needs the Skype token alongside
/// the CSA bearer.
pub fn get_csa(client: &Client, url: &str) -> Result<Value, String> {
    let csa = auth::token(Service::Csa)?;
    with_skype(client, Service::Csa, url, |_, skype| {
        web_headers(client.get(url).bearer_auth(&csa).header("Authentication", format!("skypetoken={skype}")))
            .send()
            .map_err(|e| e.to_string())
    })
}

/// A call that needs the Skype token: made with the kept one, and when that's turned down, once
/// more with a fresh one (it may simply have run out) before `svc`'s token counts as refused.
fn with_skype(
    client: &Client,
    svc: Service,
    url: &str,
    call: impl Fn(&str, &str) -> Result<reqwest::blocking::Response, String>,
) -> Result<Value, String> {
    let spaces = auth::token(Service::Spaces)?;
    let skype = skype_token(client, &spaces)?;
    let mut resp = call(&spaces, &skype)?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        forget_skype();
        let skype = skype_token(client, &spaces)?;
        let used = if svc == Service::Spaces { spaces.clone() } else { auth::token(svc)? };
        resp = checked(svc, &used, || call(&spaces, &skype))?;
    } else if resp.status().is_success() {
        auth::worked(svc);
    }
    read(resp, url)
}

/// Reads a response as JSON, turning a non-2xx into an error naming the endpoint and status, so a
/// changed or withdrawn Microsoft endpoint shows up plainly in Settings rather than breaking the sync.
fn read(resp: reqwest::blocking::Response, url: &str) -> Result<Value, String> {
    let status = resp.status();
    let host = url.split('/').nth(2).unwrap_or(url);
    if !status.is_success() {
        let detail = resp.text().unwrap_or_default();
        let code = serde_json::from_str::<Value>(&detail).ok().and_then(|v| v["error"]["code"].as_str().map(str::to_string));
        return Err(match code {
            Some(c) => format!("{host} answered {} ({c})", status.as_u16()),
            None => format!("{host} answered {}", status.as_u16()),
        });
    }
    resp.json().map_err(|e| format!("{host} gave an unreadable answer: {e}"))
}

/// A picture from Teams' picture store (a chat's pasted picture), with its content type, read with the
/// Skype token as Teams web reads it. Refuses any other host, so the sign-in only goes to Teams, and a
/// picture over `max` bytes.
pub fn get_picture(client: &Client, url: &str, max: u64) -> Result<(Vec<u8>, Option<String>), String> {
    let host = url.strip_prefix("https://").and_then(|r| r.split('/').next()).unwrap_or("");
    if !super::fetch::picture_host(host) {
        return Err("That picture isn't in Teams' picture store.".into());
    }
    let spaces = auth::token(Service::Spaces)?;
    let skype = skype_token(client, &spaces)?;
    let resp = client
        .get(url)
        .header("Authorization", format!("skype_token {skype}"))
        .header("Origin", "https://teams.microsoft.com")
        .header("Referer", "https://teams.microsoft.com/")
        .send()
        .map_err(|e| e.to_string())?;
    // A refused picture isn't taken as the chat sign-in having expired: chats still read.
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("{host} answered {}", status.as_u16()));
    }
    if resp.content_length().is_some_and(|n| n > max) {
        return Err(format!("it's over {} MB", max / (1024 * 1024)));
    }
    let kind = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).map(str::to_string);
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err(format!("it's over {} MB", max / (1024 * 1024)));
    }
    Ok((bytes.to_vec(), kind))
}

/// The Skype token, kept for the Spaces token it was made from until shortly before it runs out.
struct Skype {
    from: String,
    token: String,
    until: i64,
}

static SKYPE: std::sync::Mutex<Option<Skype>> = std::sync::Mutex::new(None);

fn forget_skype() {
    *SKYPE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// The Skype token chatsvc and the middle tier require, exchanged for the Spaces bearer at authsvc
/// once and kept while it lasts (about a day), not fetched again for every call: a pass makes
/// hundreds of calls, and one refused exchange among so many shut chats out (D-20261127-03).
fn skype_token(client: &Client, spaces: &str) -> Result<String, String> {
    let fp = super::refusal::fingerprint(spaces);
    let now = auth::now_secs();
    if let Some(k) = SKYPE.lock().unwrap_or_else(|e| e.into_inner()).as_ref().filter(|k| k.from == fp && k.until > now) {
        return Ok(k.token.clone());
    }
    const AUTHZ: &str = "https://authsvc.teams.microsoft.com/v1.0/authz";
    let resp = checked(Service::Spaces, spaces, || {
        client.post(AUTHZ).bearer_auth(spaces).header("Content-Type", "application/json").body("{}").send().map_err(|e| e.to_string())
    })?;
    let body = read(resp, AUTHZ)?;
    let token = body["tokens"]["skypeToken"].as_str().map(str::to_string).ok_or("The Teams auth service returned no Skype token.")?;
    // It says how long it lasts; renewed five minutes early, and at least every hour.
    let lasts = body["tokens"]["expiresIn"].as_i64().unwrap_or(3600).clamp(600, 24 * 3600);
    *SKYPE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Skype { from: fp, token: token.clone(), until: now + lasts - 300 });
    Ok(token)
}
