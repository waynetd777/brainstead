// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

// Tasks-format emoji drawn as line icons wherever note text is shown (no emoji in the UI).

import { Children, ReactNode } from "react";
import { Icon } from "../icons";
import { FIELD_EMOJI_RE, fieldOfEmoji } from "../taskFields";

/** A Tasks-format emoji on its own: the field's icon, what it means in the tooltip. */
export function FieldEmoji({ emoji }: { emoji: string }) {
  const f = fieldOfEmoji(emoji);
  if (!f) return <>{emoji}</>;
  return (
    <span className="femoji" title={`${f.label}: ${f.explain}`} aria-label={f.label}>
      <Icon name={f.icon} size={12} />
    </span>
  );
}

/** Text with its Tasks-format emoji as icons: inline code (remark leaves code alone) and search snippets. */
export function iconizeEmoji(children: ReactNode): ReactNode {
  return Children.map(children, (c) => {
    if (typeof c !== "string") return c;
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of c.matchAll(FIELD_EMOJI_RE)) {
      out.push(c.slice(last, m.index));
      out.push(<FieldEmoji key={m.index} emoji={m[0]} />);
      last = m.index! + m[0].length;
    }
    out.push(c.slice(last));
    return out;
  });
}
