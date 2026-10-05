// Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
// See LICENSE for the full text.
// SPDX-License-Identifier: GPL-3.0-or-later

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Snippet } from "../FileList";

describe("search snippets", () => {
  it("draw Tasks-format emoji as icons", () => {
    const hit = {
      snippet: [
        { text: "Ship it 📅 2026-10-03 ", hit: false },
        { text: "launch", hit: true },
        { text: " ✅", hit: false },
      ],
    };
    const { container } = render(<Snippet hit={hit as never} />);
    expect(container.textContent).not.toMatch(/[📅✅]/u);
    expect(container.querySelectorAll(".femoji").length).toBe(2);
  });
});
