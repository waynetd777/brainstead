#!/usr/bin/env python3
# Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
# See LICENSE for the full text.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Runs the previous app's normalize.py over the cases in cases.json and freezes what it makes.

    python3 tests/fixtures/names/freeze.py <path to the previous app's scripts/>

Each file is normalised twice: with every ambiguous occurrence confirmed (--yes), and with none
(as when no answer comes). The output is expected.json, which src-tauri/core/src/names.rs compares
against; run Prettier on it afterwards. Invented names only.
"""

import builtins
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    sys.path.insert(0, str(Path(sys.argv[1]).expanduser()))
    import normalize

    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    subs = cases["substitutions"]
    out = {}
    for f in cases["files"]:
        res = {}
        for mode, yes in (("yes", True), ("no", False)):
            builtins.input = lambda _prompt="": "n"
            counts = []
            # Change lines read "  'wrong' → 'right'  (N occurrence(s)…)"; count per substitution instead.
            text = f["text"]
            for s in subs:
                new, changes = normalize.apply_substitutions(text, [s], yes=yes, filename=f["name"])
                if changes:
                    n = int(changes[0].split("(")[1].split(" ")[0])
                    counts.append([s["wrong"], s["right"], n])
                text = new
            res[mode] = {"text": text, "changes": counts}
        out[f["name"]] = res
    (HERE / "expected.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
