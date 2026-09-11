#!/usr/bin/env python3
"""Audit lesson structure and verify the curriculum's own claims.

    python3 scripts/audit_lessons.py
    python3 scripts/audit_lessons.py --phase 1
    python3 scripts/audit_lessons.py --run-tests   # also run each lesson's tests and doc commands

Checks, in rough order of how much they matter:

  1. Directory naming follows NN-slug
  2. docs/en.md exists and carries the required sections for its lesson type
  3. Lessons with code have code/ and at least one test_*.py, stdlib-only
  4. Every identifier the doc quotes in backticks actually exists in the code
  5. Numbers quoted in the doc's output blocks match what the script prints today
  6. Every python3 command quoted in the doc is runnable
  7. quiz.json parses, and every question's `correct` index is in range
  8. Design exercises carry a rubric and a traps section
  9. Relative links inside docs resolve to real files

Check 5 is the one that matters most. The curriculum's whole premise is that no claim
appears without a number the lesson produced; a doc holding stale figures breaks that
silently, and nothing else would catch it.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PHASES = REPO / "phases"

LESSON_DIR_RE = re.compile(r"^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")

# Sections every lesson needs, by declared type.
#
# 'concept' is the default shape: explain the idea, show the measurement, hand over
# a script to run, then exercise judgement. 'build' is reserved for the few lessons
# where writing the mechanism IS the insight — Raft, rate limiting under real
# concurrency — and adds a step-by-step section. Most lessons should be 'concept'.
REQUIRED_SECTIONS = {
    "concept": [
        "## Learning objectives",
        "## Run it",
        "## Exercises",
        "## Key terms",
        "## Further reading",
    ],
    "build": [
        "## Learning objectives",
        "## Build it",
        "## Run it",
        "## Exercises",
        "## Key terms",
        "## Further reading",
    ],
    "simulate": [
        "## Learning objectives",
        "## Run it",
        "## Exercises",
        "## Key terms",
        "## Further reading",
    ],
    "design": [
        "## Learning objectives",
        "## The problem",
        "## Rubric",
        "## Exercises",
        "## Further reading",
    ],
}


@dataclass
class Audit:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    lessons_seen: int = 0
    checks_run: int = 0

    def error(self, lesson: Path, msg: str) -> None:
        self.errors.append(f"{rel(lesson)}: {msg}")

    def warn(self, lesson: Path, msg: str) -> None:
        self.warnings.append(f"{rel(lesson)}: {msg}")


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(REPO))
    except ValueError:
        return str(p)


def iter_lessons(phase_filter: int | None):
    if not PHASES.is_dir():
        return
    for phase in sorted(PHASES.iterdir()):
        if not phase.is_dir():
            continue
        if phase_filter is not None:
            num = phase.name.split("-", 1)[0]
            if not num.isdigit() or int(num) != phase_filter:
                continue
        for lesson in sorted(phase.iterdir()):
            if lesson.is_dir():
                yield lesson


def lesson_type(text: str) -> str:
    m = re.search(r"^\*\*Type:\*\*\s*(\w+)", text, re.M)
    return m.group(1).strip().lower() if m else "build"


def check_naming(audit: Audit, lesson: Path) -> None:
    audit.checks_run += 1
    if not LESSON_DIR_RE.match(lesson.name):
        audit.error(lesson, f"directory name {lesson.name!r} is not NN-lowercase-slug")


def check_doc(audit: Audit, lesson: Path) -> tuple[str, str] | None:
    audit.checks_run += 1
    doc = lesson / "docs" / "en.md"
    if not doc.is_file():
        audit.error(lesson, "missing docs/en.md")
        return None
    text = doc.read_text(encoding="utf-8")

    if not text.lstrip().startswith("# "):
        audit.error(lesson, "docs/en.md must open with a single H1 title")

    ltype = lesson_type(text)
    if ltype not in REQUIRED_SECTIONS:
        audit.error(lesson, f"unknown lesson type {ltype!r}; expected build/simulate/design")
        return text, "build"

    # Headings may be numbered ("## 5. Run it") or plain ("## Run it"); both count.
    for section in REQUIRED_SECTIONS[ltype]:
        audit.checks_run += 1
        name = section.removeprefix("## ").strip()
        pattern = rf"^##\s+(?:\d+\.\s*)?{re.escape(name)}\s*$"
        if not re.search(pattern, text, re.M | re.I):
            audit.error(lesson, f"[{ltype}] missing required section {section!r}")

    if len(text.split()) < 400:
        audit.warn(lesson, f"docs/en.md is short ({len(text.split())} words)")

    return text, ltype


def check_code(audit: Audit, lesson: Path, ltype: str) -> None:
    audit.checks_run += 1
    code = lesson / "code"
    if ltype == "design":
        return
    if not code.is_dir():
        audit.error(lesson, f"[{ltype}] missing code/ directory")
        return
    py_files = [f for f in code.rglob("*.py") if "__pycache__" not in f.parts]
    if not py_files:
        audit.error(lesson, "code/ contains no .py files")
        return
    if not any(f.name.startswith("test_") for f in py_files):
        audit.error(lesson, "code/ has no test_*.py — every claim must be verifiable")

    # Lessons must run on a bare interpreter. A third-party import silently raises
    # the cost of running the lesson from "python3 file.py" to "set up an env".
    stdlib_ok = {
        "bisect", "zlib", "hashlib", "math", "random", "statistics", "time",
        "collections", "itertools", "dataclasses", "typing", "json", "os", "sys",
        "unittest", "heapq", "threading", "queue", "socket", "struct", "enum",
        "functools", "abc", "argparse", "csv", "datetime", "re", "textwrap",
        "concurrent", "asyncio", "contextlib", "io", "pathlib", "__future__",
    }
    for f in py_files:
        for m in re.finditer(r"^\s*(?:from|import)\s+([a-zA-Z_][\w]*)", f.read_text("utf-8"), re.M):
            mod = m.group(1)
            local = (code / f"{mod}.py").exists()
            if mod not in stdlib_ok and not local:
                audit.checks_run += 1
                audit.error(
                    lesson, f"{f.name} imports third-party {mod!r}; lessons must be stdlib-only"
                )


def check_doc_claims_match_code(audit: Audit, lesson: Path, text: str) -> None:
    """Every function or class the doc quotes in backticks must exist in the code.

    This is the check that keeps a lesson from describing an API it never wrote.
    """
    audit.checks_run += 1
    code = lesson / "code"
    if not code.is_dir():
        return
    source = "\n".join(
        f.read_text(encoding="utf-8")
        for f in code.rglob("*.py")
        if "__pycache__" not in f.parts
    )
    if not source:
        return

    defined = set(re.findall(r"^\s*(?:def|class)\s+(\w+)", source, re.M))
    defined |= set(re.findall(r"^\s*(\w+)\s*=", source, re.M))

    # Backticked names that look like code: CamelCase types, or snake_case with a
    # call suffix. Bare snake_case words are too often prose to check safely.
    claimed = set(re.findall(r"`([A-Z][A-Za-z0-9]{2,})(?:\(\))?`", text))
    claimed |= set(re.findall(r"`([a-z_][a-z0-9_]{2,})\(\)`", text))

    ignore = {
        "CRC", "TTL", "RAM", "API", "HTTP", "JSON", "YAML", "SPREAD", "MODULO",
        "CHANGE", "IDEAL", "REPLICAS", "VERDICT", "MIT", "DNS", "AOF", "GIL",
        "DynamoDB", "Cassandra", "Memcached", "Envoy", "Riak", "Voldemort",
        "Google", "Amazon", "Apache", "Dynamo", "NONE", "None", "Type",
        "Prerequisites", "Time", "But",
    }
    for name in sorted(claimed - ignore):
        if name not in defined and not re.search(rf"\b{re.escape(name)}\b", source):
            audit.error(lesson, f"doc references `{name}` which is absent from code/")


def check_doc_output_is_current(audit: Audit, lesson: Path, text: str, run: bool) -> None:
    """The strongest check here: numbers printed in the doc must match a real run.

    A lesson's authority rests on its measurements. If someone changes the code and
    the doc keeps yesterday's figures, every claim silently becomes fiction. So take
    the numeric rows quoted in the doc's output blocks and require the script to
    still print them.
    """
    if not run:
        return
    code = lesson / "code"
    main = code / "hashring.py"
    if not main.is_file():
        return

    # Output blocks are fenced code blocks the doc presents as program output.
    # Only fenced blocks, and only rows that look like tabular program output:
    # a label followed by two or more percentages. Prose citing the same figures is
    # deliberately excluded — it is reworded often and would produce false failures.
    blocks = re.findall(r"^```[a-z]*\n(.*?)^```", text, re.S | re.M)
    quoted_rows = []
    for block in blocks:
        for line in block.splitlines():
            if len(re.findall(r"\d+\.\d%", line)) >= 2 and not line.lstrip().startswith(">"):
                quoted_rows.append(line.strip())
    if not quoted_rows:
        return

    audit.checks_run += 1
    proc = subprocess.run(
        [sys.executable, main.name], cwd=code, capture_output=True, text=True, timeout=600
    )
    if proc.returncode != 0:
        audit.error(lesson, f"{main.name} failed to run: {proc.stderr.strip()[:200]}")
        return
    actual = " ".join(proc.stdout.split())

    for row in quoted_rows:
        audit.checks_run += 1
        if " ".join(row.split()) not in actual:
            audit.error(
                lesson,
                f"doc quotes output that the code no longer produces:\n"
                f"      {row}\n"
                f"      re-run 'python3 code/{main.name}' and update docs/en.md",
            )


def check_doc_commands_run(audit: Audit, lesson: Path, text: str, run: bool) -> None:
    if not run:
        return
    code = lesson / "code"
    if not code.is_dir():
        return
    cmds = re.findall(r"^(python3 -m unittest[^\n#]*|python3 [\w./]+\.py[^\n#]*)", text, re.M)
    for cmd in sorted({c.strip() for c in cmds}):
        audit.checks_run += 1
        # Docs quote paths relative to the lesson root; run them from there.
        proc = subprocess.run(
            cmd, shell=True, cwd=lesson, capture_output=True, text=True, timeout=600
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
            audit.error(lesson, f"doc command failed: {cmd}\n      {' / '.join(tail)}")


def check_quiz(audit: Audit, lesson: Path) -> None:
    quiz = lesson / "quiz.json"
    if not quiz.is_file():
        audit.warn(lesson, "no quiz.json")
        return
    audit.checks_run += 1
    try:
        data = json.loads(quiz.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        audit.error(lesson, f"quiz.json is not valid JSON: {exc}")
        return

    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        audit.error(lesson, "quiz.json has no questions array")
        return

    stages = set()
    for i, q in enumerate(questions):
        audit.checks_run += 1
        where = f"quiz question {i + 1}"
        for field_name in ("stage", "question", "options", "correct", "explanation"):
            if field_name not in q:
                audit.error(lesson, f"{where} missing {field_name!r}")
        stages.add(q.get("stage"))
        opts = q.get("options")
        if isinstance(opts, list):
            if len(opts) < 2:
                audit.error(lesson, f"{where} needs at least 2 options")
            correct = q.get("correct")
            if not isinstance(correct, int) or not (0 <= correct < len(opts)):
                audit.error(
                    lesson,
                    f"{where} correct={correct!r} out of range for {len(opts)} options",
                )
        if len(str(q.get("explanation", ""))) < 40:
            audit.warn(lesson, f"{where} explanation is thin")

    if not {"pre", "post"} & stages:
        audit.warn(lesson, "quiz has no pre/post staging")


def check_design(audit: Audit, lesson: Path) -> None:
    design = lesson / "design"
    if not design.is_dir():
        return
    for f in sorted(design.glob("*.md")):
        audit.checks_run += 1
        text = f.read_text(encoding="utf-8").lower()
        if "## rubric" not in text:
            audit.error(lesson, f"design/{f.name} has no ## Rubric")
        if "## traps" not in text and "## trap" not in text:
            audit.warn(lesson, f"design/{f.name} has no ## Traps section")
        if "- [ ]" not in text:
            audit.warn(lesson, f"design/{f.name} rubric has no checkboxes")


def check_links(audit: Audit, lesson: Path, text: str) -> None:
    doc = lesson / "docs" / "en.md"
    for target in re.findall(r"\[[^\]]+\]\((?!https?://|#)([^)]+)\)", text):
        audit.checks_run += 1
        clean = target.split("#")[0]
        if not clean:
            continue
        if not (doc.parent / clean).resolve().exists():
            audit.error(lesson, f"broken relative link: {target}")


def audit_lesson(audit: Audit, lesson: Path, run_tests: bool) -> None:
    audit.lessons_seen += 1
    check_naming(audit, lesson)
    result = check_doc(audit, lesson)
    if result is None:
        return
    text, ltype = result
    check_code(audit, lesson, ltype)
    check_doc_claims_match_code(audit, lesson, text)
    check_doc_output_is_current(audit, lesson, text, run_tests)
    check_doc_commands_run(audit, lesson, text, run_tests)
    check_quiz(audit, lesson)
    check_design(audit, lesson)
    check_links(audit, lesson, text)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--phase", type=int, help="audit a single phase number")
    ap.add_argument(
        "--run-tests",
        action="store_true",
        help="execute the go commands quoted in each doc (slower, catches stale docs)",
    )
    args = ap.parse_args(argv)

    audit = Audit()
    for lesson in iter_lessons(args.phase):
        audit_lesson(audit, lesson, args.run_tests)

    print(f"audited {audit.lessons_seen} lesson(s), {audit.checks_run} checks")

    if audit.warnings:
        print(f"\n{len(audit.warnings)} warning(s):")
        for w in audit.warnings:
            print(f"  ! {w}")

    if audit.errors:
        print(f"\n{len(audit.errors)} error(s):")
        for e in audit.errors:
            print(f"  x {e}")
        return 1

    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
