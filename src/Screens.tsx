// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Screens that aren't built yet: each says what it will do and which roadmap stage brings it
// (the archived build plan, §8). Each moves to its own file when it's built.

import { Icon } from "./icons";
import { Screen } from "./nav";
import { ALL_ITEMS } from "./Sidebar";
import { TopBar } from "./TopBar";

const PLANNED: Partial<Record<Screen, [stage: number, what: string]>> = {};

export function Placeholder({ screen }: { screen: Screen }) {
  const item = ALL_ITEMS.find((i) => i.screen === screen);
  const [stage, what] = PLANNED[screen] ?? [0, ""];
  return (
    <main className="main">
      <TopBar title={item?.label ?? screen} />
      <div className="body center">
        <div className="soon">
          <Icon name={item?.icon ?? "note"} size={28} />
          <h1 className="h2">{item?.label}</h1>
          <p className="muted">{what}</p>
          {stage > 0 && <span className="chip">Coming in stage {stage}</span>}
        </div>
      </div>
    </main>
  );
}
