#!/usr/bin/env python3
# Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
# See LICENSE for the full text.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Runs the previous app's contradictions.py rules over cases.json and freezes what they say.

    python3 tests/fixtures/contradictions/freeze.py <path to the previous app's scripts/>

Normalised attributes and values, quote matches, and the clashes found from the cases' claims
with a name index built from the cases' pages (aliases two pages claim are dropped). The output is
expected.json, which src-tauri/core/src/contradictions.rs compares against; run Prettier on it
afterwards. Invented names only.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    sys.path.insert(0, str(Path(sys.argv[1]).expanduser()))
    import contradictions as c

    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    index: dict[str, str] = {}
    contested: set[str] = set()
    for p in cases["pages"]:
        stem = Path(p["path"]).stem
        index[c.key(stem)] = stem
    for p in cases["pages"]:
        stem = Path(p["path"]).stem
        for a in p["aliases"]:
            k = c.key(a)
            if k in index and index[k] != stem:
                if k != c.key(index[k]):
                    contested.add(k)
                continue
            index[k] = stem
    for k in contested:
        index.pop(k, None)
    claims = []
    for cl in cases["claims"]:
        d = dict(cl, attribute=c.normalise_attribute(cl["attribute"]))
        d["date"] = c.parse_as_of(cl.get("as_of", "")) or c.parse_as_of(cl.get("updated", ""))
        claims.append(d)
    clashes = [{k: v for k, v in x.items() if k != "id"} for x in c.find_clashes(claims, index, c.DEFAULT_WINDOW_DAYS)]
    out = {
        "attributes": [c.normalise_attribute(a) for a in cases["attributes"]],
        "values": [c.normalise_value(v) for v in cases["values"]],
        "quotes": [c.quote_found(q, t) for q, t in cases["quotes"]],
        "clashes": clashes,
    }
    (HERE / "expected.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
