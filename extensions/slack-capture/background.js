// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Brainstead's Slack sync (D-20261118-01): hands the open Slack tab's sign-in (each workspace's
// client token, and the session cookie) to Brainstead's local helper every few minutes, so the app
// can read the user's own conversations with Slack's API. It reads nothing else and sends nothing
// anywhere but that helper on this machine. Works alongside the Slack desktop app: the tab only has
// to stay open. Keeping the sign-in alive (reloads, timeouts, the record) is handover.js, the same in
// all three of Brainstead's extensions.

importScripts("handover.js", "slack-reader.js");

const HOST = "com.wayned.brainstead";

const handOver = globalThis.brainsteadHandover.start({
  name: "slack",
  every: 10,
  lastKey: "slack-last-handover",
  tabs: () => chrome.tabs.query({ url: ["https://app.slack.com/*"] }),
  read: globalThis.brainsteadReadSlack,
  usable: (page) => !!page?.workspaces?.length,
  // Every tab's workspaces, with the session cookie they work with.
  all: true,
  send: async (pages) => {
    const workspaces = globalThis.brainsteadSlackWorkspaces(pages);
    if (!workspaces.length) return { outcome: "no sign-in found" };
    const cookie = await chrome.cookies.get({ url: "https://app.slack.com/", name: "d" });
    if (!cookie?.value) return { outcome: "the Slack session cookie isn't there: sign in to Slack in this browser" };
    const reply = await chrome.runtime.sendNativeMessage(HOST, {
      type: "sign-in",
      workspaces,
      cookie: cookie.value,
      version: chrome.runtime.getManifest().version,
    });
    return { ...reply, extra: { workspaces: workspaces.map((w) => w.name || w.id) } };
  },
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "slack:hand-over") return false;
  handOver().then(() => chrome.storage.local.get("slack-last-handover").then((s) => reply(s["slack-last-handover"] ?? null)));
  return true;
});
