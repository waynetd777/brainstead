// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { DOC_ACCENTS, DOC_STYLES } from "./docLook";

/** Themes and colours to choose from (here and in Settings › Notes). */
export function LookPicker({
  style,
  accent,
  onStyle,
  onAccent,
}: {
  style: string;
  accent: string;
  onStyle: (id: string) => void;
  onAccent: (id: string) => void;
}) {
  return (
    <div className="lookpick">
      <div className="lookstyles" role="radiogroup" aria-label="Theme">
        {DOC_STYLES.map(([id, name, blurb, font]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === style}
            className={id === style ? "on" : undefined}
            title={blurb}
            onClick={() => onStyle(id)}
          >
            <span className="aa" style={{ fontFamily: font }}>
              Aa
            </span>
            {name}
          </button>
        ))}
      </div>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {DOC_ACCENTS.map(([id, name, c]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === accent}
            className={id === accent ? "on" : undefined}
            title={name}
            aria-label={name}
            style={{ background: c }}
            onClick={() => onAccent(id)}
          />
        ))}
      </div>
    </div>
  );
}
