#!/usr/bin/env python3
"""Audit lesson structure and verify the curriculum's own claims.

    python3 scripts/audit_lessons.py
    python3 scripts/audit_lessons.py --phase 1
    python3 scripts/audit_lessons.py --run-tests   # also execute each lesson's Go tests

Checks, in rough order of how much they matter:

  1. Directory naming follows NN-slug
  2. docs/en.md exists and carries the required sections for its lesson type
  3. Build lessons have code/ with at least one _test.go
  4. Every Go identifier the doc quotes in backticks actually exists in the code
  5. Every `go test`/`go run` command quoted in the doc is runnable
  6. quiz.json parses, and every question's `correct` index is in range
  7. Design exercises carry a rubric and a traps section
  8. Relative links inside docs resolve to real files

Check 4 is the one that matters most: it is how a lesson stops claiming an API it does not have.
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
REQUIRED_SECTIONS = {
    "build": [
        "## Learning objectives",
        "## The problem",
        "## The concept",
        "## Build it",
        "## Run it",
        "## Exercises",
        "## Key terms",
        "## Further reading",
    ],
    "simulate": [
        "## Learning objectives",
        "## The problem",
        "## The concept",
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

    for section in REQUIRED_SECTIONS[ltype]:
        audit.checks_run += 1
        if section.lower() not in text.lower():
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
    go_files = list(code.rglob("*.go"))
    if not go_files:
        audit.error(lesson, "code/ contains no .go files")
        return
    if not any(f.name.endswith("_test.go") for f in go_files):
        audit.error(lesson, "code/ has no _test.go — every build lesson must be verifiable")


def check_doc_claims_match_code(audit: Audit, lesson: Path, text: str) -> None:
    """Every exported Go identifier the doc quotes must exist in the lesson's code.

    This is the check that keeps a lesson from describing an API it never wrote.
    """
    audit.checks_run += 1
    code = lesson / "code"
    if not code.is_dir():
        return
    source = "\n".join(
        f.read_text(encoding="utf-8") for f in code.rglob("*.go")
    )
    if not source:
        return

    # Backticked CamelCase identifiers, optionally with a call suffix.
    claimed = set(re.findall(r"`([A-Z][A-Za-z0-9]{2,})(?:\(\))?`", text))
    # Words that are prose, not identifiers.
    ignore = {
        "CRC", "TTL", "RAM", "API", "HTTP", "JSON", "YAML", "SPREAD", "MODULO",
        "CHANGE", "IDEAL", "REPLICAS", "VERDICT", "Inf", "MIT", "DNS", "AOF",
    }
    for name in sorted(claimed - ignore):
        if not re.search(rf"\b{re.escape(name)}\b", source):
            audit.error(lesson, f"doc references `{name}` which is absent from code/")


def check_doc_commands_run(audit: Audit, lesson: Path, text: str, run: bool) -> None:
    if not run:
        return
    code = lesson / "code"
    if not code.is_dir():
        return
    cmds = re.findall(r"^(go (?:test|run|vet)[^\n#]*)", text, re.M)
    for cmd in sorted({c.strip() for c in cmds}):
        audit.checks_run += 1
        proc = subprocess.run(
            cmd, shell=True, cwd=code, capture_output=True, text=True, timeout=600
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
