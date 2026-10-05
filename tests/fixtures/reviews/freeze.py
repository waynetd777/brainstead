#!/usr/bin/env python3
# Copyright © 2026 Wayne Davies. Free software under the GNU General Public License, version 3 or later.
# See LICENSE for the full text.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Runs the previous app's review scripts on the review tests' vault and freezes what they say.

    python3 tests/fixtures/reviews/freeze.py <path to the previous app's scripts/>

The vault is a temp copy of tests/fixtures/vault/ with tests/fixtures/reviews/vault/ laid over it
and the modification times in mtimes.txt, as the Rust tests build it (src-tauri/core/src/reviews/
mod.rs). The outputs go in expected/, which src-tauri/core/src/reviews/ compares against; run
Prettier on them afterwards (`npx prettier --write tests/fixtures/reviews`). Nothing
here touches a real vault.
"""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
OUT = HERE / "expected"
ZONE = timezone(timedelta(hours=2))
SCRIPTS = [
    "review_window.py",
    "week_inputs.py",
    "lint_wiki.py",
    "session_logs.py",
    "stuck_tasks.py",
    "upsert_review_block.py",
    "log_append.py",
]


def set_mtime(p: Path, local: str) -> None:
    t = datetime.strptime(local, "%Y-%m-%d %H:%M").replace(tzinfo=ZONE).timestamp()
    os.utime(p, (t, t))


def build_vault(tmp: Path) -> Path:
    root = tmp / "vault"
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
    return root


def stdout_of(fn, *args) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args)
    return buf.getvalue()


def write(name: str, data) -> None:
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    scripts = Path(sys.argv[1]).expanduser()
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        vault = build_vault(tmp)
        (vault / "scripts").mkdir()
        for s in SCRIPTS:
            shutil.copy(scripts / s, vault / "scripts" / s)
        sys.path.insert(0, str(vault / "scripts"))
        import lint_wiki
        import log_append
        import review_window
        import session_logs
        import stuck_tasks
        import upsert_review_block
        import week_inputs

        # review_window.py
        cases = {}
        days = ["2026-09-30", "2026-10-01", "2026-01-01", "2024-03-01", "2024-02-29"]
        weeks = [
            "2026-W40",
            "2026-w01",
            "2026-W53",
            "2020-W53",
            "2025-W01",
            "2026-W36",
            "2026-W27",
            "2025-W53",
            "2026-W54",
            "2026-W00",
            "bad",
        ]
        for d in days:
            cases[f"day:{d}"] = review_window.day_window(datetime.strptime(d, "%Y-%m-%d").date())
        for w in weeks:
            try:
                cases[f"week:{w}"] = review_window.week_window(*review_window.parse_iso_week(w))
            except ValueError as exc:
                cases[f"week:{w}"] = {"error": str(exc)}
        write("window.json", cases)

        # week_inputs.py, and the same selection for one day
        write("week-inputs.json", json.loads(stdout_of(week_inputs.main, ["2026-W40"])))
        d = "2026-09-30"
        write(
            "day-inputs.json",
            {
                "journals": week_inputs.journal_files(d, d),
                "wiki": week_inputs.wiki_pages(d, d),
                "sources": week_inputs.sources_in_window(d, d),
                "log": week_inputs.log_entries(d, d),
                "scratchpad": {"count": len(week_inputs.scratchpad_blocks(d, d)), "dates": week_inputs.scratchpad_blocks(d, d)},
            },
        )

        # lint_wiki.py: ghost links and pending sources
        wiki = lint_wiki.wiki_pages()
        index = lint_wiki.build_stem_index(lint_wiki.all_vault_files())
        write(
            "lint.json",
            {"missingPages": lint_wiki.check_missing_pages(wiki, index), "uningestedSources": lint_wiki.check_uningested_sources(wiki)},
        )

        # session_logs.py day, on the synthetic projects folder
        projects = tmp / "projects"
        shutil.copytree(HERE / "projects", projects)
        session_logs.PROJECTS = projects

        def sessions(start: str, end: str):
            a = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=session_logs.TZ)
            b = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=session_logs.TZ)
            out = [
                {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in s.items()} for s in session_logs.sessions_for_window(a, b)
            ]
            # Relative, so no temp folder's path is frozen.
            for s in out:
                s["path"] = Path(s["path"]).relative_to(projects).as_posix()
            return out

        write("sessions-day.json", sessions("2026-09-30", "2026-10-01"))
        write("sessions-week.json", sessions("2026-09-28", "2026-10-05"))

        # stuck_tasks.py, fed the index's tasks in the BFF's shape
        tasks = json.loads((HERE / "tasks.json").read_text(encoding="utf-8"))

        def bff(rows):
            return {
                "tasks": [
                    {"id": r["id"], "description": r["text"], "file": r["path"], "heading": r["heading"], "tags": r["tags"]} for r in rows
                ]
            }

        (tmp / "open.json").write_text(json.dumps(bff(tasks["open"])), encoding="utf-8")
        (tmp / "someday.json").write_text(json.dumps(bff(tasks["someday"])), encoding="utf-8")
        argv = [
            "stuck",
            "--tasks",
            str(tmp / "open.json"),
            "--reviews",
            "Me. Weekly Reviews - 2026-10.md",
            "--also",
            "Me. Weekly Reviews - 2026-09.md",
        ]
        stuck = json.loads(stdout_of(stuck_tasks.main, argv))
        only = tmp / "one-review.md"
        text = (vault / "Me. Weekly Reviews - 2026-09.md").read_text(encoding="utf-8")
        only.write_text(text[text.index("## Weekly review 2026-W38") :], encoding="utf-8")
        stuck["notEnough"] = json.loads(stdout_of(stuck_tasks.main, ["stuck", "--tasks", str(tmp / "open.json"), "--reviews", str(only)]))
        write("stuck.json", stuck)
        write(
            "someday.json", json.loads(stdout_of(stuck_tasks.main, ["someday", "--tasks", str(tmp / "someday.json"), "--week", "2026-W40"]))
        )

        # upsert_review_block.py
        out = {}
        for c in json.loads((HERE / "upsert-cases.json").read_text(encoding="utf-8")):
            text, action = upsert_review_block.upsert(c["text"], c["heading"], c["block"], c["header"])
            out[c["name"]] = {"text": text, "action": action}
        write("upsert.json", out)

        # log_append.py
        entry = log_append.format_entry("review", "daily-review 2026-10-01", None, "2026-10-02 07:15")
        inserts = {
            c["name"]: log_append.insert_at_top(c["text"], entry) for c in json.loads((HERE / "log-cases.json").read_text(encoding="utf-8"))
        }
        write(
            "log.json",
            {
                "entry": entry,
                "entryWithSummary": log_append.format_entry("ingest", "x", " Created 2 pages. ", "2026-10-02 07:15"),
                "inserts": inserts,
            },
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
