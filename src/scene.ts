// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Screenshot mode (tools/screenshots.py, tools/screenshots/scenes.json): BRAINSTEAD_SCENE holds a
// scene as JSON, and the window sets it up and saves nothing.

import { toast } from "./Toast";
import { fixNameOpen } from "./FixName";
import { shortcutsOpen } from "./Shortcuts";
import { helpOpen, HelpView } from "./help/HelpDrawer";
import { readingScene } from "./speech/player";
import type { Theme } from "./api";
import { ask, blankChat } from "./askState";
import { nav, Screen, SettingsPane } from "./nav";
import { noteDialog } from "./notes/dialogs";
import { applyTheme, settings } from "./store";

export interface Scene {
  name?: string;
  screen?: Screen;
  pane?: SettingsPane;
  theme?: Exclude<Theme, "system">;
  palette?: boolean;
  /** For "doc": the vault path to open; for "search" and "doc": the query. */
  path?: string;
  q?: string;
  /** Keep the splash up. */
  splash?: boolean;
  /** A note dialog to open: New note (optionally from `template`), or Rename `path` to `title`. */
  dialog?: "new-note" | "rename" | "fix-name" | "shortcuts";
  template?: string;
  title?: string;
  /** For "doc": live, source or read (the default, as the earlier screenshots were taken). */
  docMode?: "live" | "source" | "read";
  /** For "doc": the find bar open with these words. */
  find?: string;
  /** For "doc" in live or source: the caret put where `|` is in this text (as a click puts it),
   *  or with `hover` the mouse resting there instead. */
  caret?: string;
  hover?: boolean;
  /** For "doc": the Linked from pane collapsed. */
  sideFolded?: boolean;
  /** For "doc": the note shown being read aloud at a block and spoken character, saying nothing. */
  reading?: { block: number; char: number };
  /** The menu-bar window alone (src/Tray.tsx), shown by Rust. */
  tray?: boolean;
  /** The help drawer open: on the screen's topic, or `topic`, a guide at a step, or a search. */
  help?: HelpView;
  /** Screens' remembered choices (`useViewState` keys), e.g. the selected task. */
  view?: Record<string, unknown>;
  /** For "ask": show a sample chat. */
  chat?: boolean;
  /** A toast to show, with an Undo button. */
  toast?: string;
}

/** The Ask scene's chat: a question about the fixture vault and an answer with links. */
function sampleChat() {
  const c = blankChat("claude:sonnet");
  return {
    ...c,
    id: "scene",
    title: "Orbit App launch date",
    filename: "Chat. Orbit App launch date.md",
    contextTokens: 31000,
    contextWindow: 200000,
    transcript: [
      { id: "1", role: "user" as const, text: "What changed on the Orbit App since the 18 Sep roadmap update? Anything I need to act on?" },
      { id: "2", role: "tool" as const, text: "Searching the vault" },
      { id: "3", role: "tool" as const, text: "Reading Orbit App" },
      { id: "4", role: "tool" as const, text: "Reading Meeting. Orbit App Steerco - 2026-09-30" },
      {
        id: "5",
        role: "assistant" as const,
        text: "Three things moved since the roadmap update:\n\n- **The launch date is contested.** [[Orbit App]] still says 14 November, but the [[Meeting. Orbit App Steerco - 2026-09-30|30 Sep steerco]] moved it to 28 November.\n- **A new gating item:** the penetration test has to close by 30 October.\n- **Origination is in build**, with the servicing APIs to follow.\n\nYou have one open task on it: confirming the comms plan, which depends on the date.",
        meta: "claude:sonnet",
      },
      { id: "6", role: "user" as const, text: "And who owns the pen test?" },
    ],
    busy: true,
    streaming: "",
    status: "Reading wiki/entities/Orbit App",
    looked: ["Searching the vault"],
    queue: ["Draft three talking points for the steerco"],
  };
}

export function parseScene(json: string | null): Scene | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Scene;
  } catch {
    return null;
  }
}

export function applyScene(sc: Scene) {
  document.documentElement.dataset.scene = sc.name ?? "1";
  if (sc.splash) document.documentElement.dataset.keepSplash = "1";
  document.documentElement.dataset.docMode = sc.docMode ?? "read";
  if (sc.find) document.documentElement.dataset.find = sc.find;
  if (sc.caret) document.documentElement.dataset.caret = sc.caret;
  if (sc.hover) document.documentElement.dataset.hover = "1";
  settings.frozen = true;
  if (sc.theme) {
    settings.update({ theme: sc.theme });
    applyTheme(sc.theme);
  }
  if (sc.sideFolded) settings.update({ docSideFolded: true });
  if (sc.view) settings.update({ viewMemory: { ...settings.get().viewMemory, ...sc.view } });
  if (sc.screen) nav.replace({ screen: sc.screen, pane: sc.pane, path: sc.path, q: sc.q, view: sc.view });
  if (sc.dialog === "new-note") noteDialog.set({ kind: "new", template: sc.template });
  if (sc.dialog === "rename" && sc.path) noteDialog.set({ kind: "rename", path: sc.path, title: sc.title });
  // Fix name: `q` the name as written, `title` the right one.
  if (sc.dialog === "shortcuts") shortcutsOpen.set(true);
  if (sc.dialog === "fix-name") fixNameOpen.set({ wrong: sc.q, right: sc.title });
  if (sc.chat) ask.set({ chats: [sampleChat()], active: "scene" });
  if (sc.help) helpOpen.set(sc.help);
  if (sc.reading) readingScene.set(sc.reading);
  if (sc.toast) toast(sc.toast, { label: "Undo", run: () => {} });
}
