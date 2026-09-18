#!/usr/bin/env python3
"""A real repository with real regressions, measured against ground truth.

Clones pallets/click at a pinned commit, injects three independent regressions
(the kind a developer commits by mistake), and reports how many tests each one
breaks. That per-bug count is the ground truth Latch's clusters are compared to.

    python3 -m venv /tmp/latch-venv
    /tmp/latch-venv/bin/pip install pytest
    /tmp/latch-venv/bin/python experiments/click-real/measure.py
    npm run latch -- experiments/click-real/results.xml --store /tmp/latch-click.json
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

REPO = "https://github.com/pallets/click.git"
COMMIT = "6aabf099bfdd4c1e75fe8d0e0d4241372b988ab1"
HERE = pathlib.Path(__file__).parent

BUGS: dict[str, list[tuple[str, list[tuple[str, str]]]]] = {
    "range boundaries": [
        (
            "src/click/types.py",
            [
                ("operator.le if self.min_open else operator.lt", "operator.lt if self.min_open else operator.le"),
                ("operator.ge if self.max_open else operator.gt", "operator.gt if self.max_open else operator.ge"),
            ],
        )
    ],
    "table measure": [
        (
            "src/click/formatting.py",
            [("widths[idx] = max(widths.get(idx, 0), term_len(col))", "widths[idx] = term_len(col)")],
        )
    ],
    "flag explicit value": [
        (
            "src/click/parser.py",
            [
                (
                    '        elif explicit_value is not None:\n'
                    '            raise BadOptionUsage(\n'
                    '                opt, _("Option {name!r} does not take a value.").format(name=opt)\n'
                    "            )\n\n"
                    "        else:\n"
                    "            value = UNSET\n",
                    "        else:\n            value = UNSET\n",
                )
            ],
        )
    ],
}


def run(*args: str, cwd: pathlib.Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


def setup() -> pathlib.Path:
    work = pathlib.Path(tempfile.mkdtemp(prefix="latch-click-"))
    subprocess.run(["git", "clone", "--quiet", REPO, str(work)], check=True)
    subprocess.run(["git", "-C", str(work), "checkout", "--quiet", COMMIT], check=True)
    run(sys.executable, "-m", "pip", "install", "--quiet", "-e", ".", cwd=work)
    return work


def reset(work: pathlib.Path) -> None:
    subprocess.run(["git", "checkout", "--", "src"], cwd=work, check=True)


def apply(work: pathlib.Path, bug: list[tuple[str, list[tuple[str, str]]]]) -> None:
    for path, subs in bug:
        file = work / path
        text = file.read_text()
        for old, new in subs:
            assert old in text, f"{path}: pattern not found"
            text = text.replace(old, new)
        file.write_text(text)


def failing(work: pathlib.Path, junit: pathlib.Path | None = None) -> int:
    args = [sys.executable, "-m", "pytest", "-q"]
    if junit:
        args.append(f"--junitxml={junit}")
    result = run(*args, cwd=work)
    if junit:
        root = ET.parse(junit).getroot()
        return sum(1 for tc in root.iter("testcase") if any(c.tag in ("failure", "error") for c in tc))
    match = re.search(r"(\d+) failed", result.stdout + result.stderr)
    return int(match.group(1)) if match else 0


def main() -> None:
    work = setup()
    try:
        reset(work)
        print(f"clean                 : {failing(work)}")
        counts: dict[str, int] = {}
        for name, bug in BUGS.items():
            reset(work)
            apply(work, bug)
            counts[name] = failing(work)
            print(f"{name:21} : {counts[name]}")
        reset(work)
        for bug in BUGS.values():
            apply(work, bug)
        results = HERE / "results.xml"
        total = failing(work, results)
        effective = sum(1 for count in counts.values() if count > 0)
        print(
            f"{'all three (ground truth)':21} : "
            f"{total} failures, {effective} effective causes ({len(BUGS)} injected)"
        )
        print(f"\nwrote {results}" if results.exists() else "")
        print("next: npm run latch -- experiments/click-real/results.xml --store /tmp/latch-click.json")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
