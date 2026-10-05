#!/usr/bin/env python3
# Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
# See LICENSE for the full text.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Runs the previous app's lint_wiki.py on the lint tests' vault and freezes what it says.

    python3 tests/fixtures/lint/freeze.py <path to the previous app's scripts/>

The vault is a temp copy of tests/fixtures/vault/ with tests/fixtures/lint/vault/ laid over it and
the modification times in mtimes.txt, as the Rust tests build it (src-tauri/core/src/lint.rs). The
output is expected.json, which the Rust tests compare against; run Prettier on it afterwards. Nothing
here touches a real vault.
"""

import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
ZONE = timezone(timedelta(hours=2))


def set_mtime(p: Path, local: str) -> None:
    t = datetime.strptime(local, "%Y-%m-%d %H:%M").replace(tzinfo=ZONE).timestamp()
    os.utime(p, (t, t))


def main() -> int:
    # The script reads modification times in local time: the tests' zone, UTC+2.
    os.environ["TZ"] = "Etc/GMT-2"
    time.tzset()
    scripts = Path(sys.argv[1]).expanduser()
    with tempfile.TemporaryDirectory() as t:
        root = Path(t) / "vault"
        shutil.copytree(FIXTURES / "vault", root)
        shutil.copytree(HERE / "vault", root, dirs_exist_ok=True)
        for p in root.rglob("*"):
            if p.is_file():
                set_mtime(p, "2026-01-01 12:00")
        for line in (HERE / "mtimes.txt").read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            path, when = line.split("\t")
            set_mtime(root / path, when)
        (root / "scripts").mkdir()
        shutil.copy(scripts / "lint_wiki.py", root / "scripts" / "lint_wiki.py")
        sys.path.insert(0, str(root / "scripts"))
        import lint_wiki

        out = {cid: issues for (cid, _), issues in zip(lint_wiki.CATEGORIES, lint_wiki.run_checks())}
    (HERE / "expected.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
