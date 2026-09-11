#!/usr/bin/env bash
# Scaffold a new lesson directory from the template.
#
#   scripts/scaffold_lesson.sh <phase-dir> <lesson-slug> <title> [type]
#
# Example:
#   scripts/scaffold_lesson.sh 01-foundations 04-rate-limiting "Rate Limiting" build
#
# type is build (default), simulate, or design.
set -euo pipefail

if [[ $# -lt 3 ]]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi

PHASE="$1"
SLUG="$2"
TITLE="$3"
TYPE="${4:-concept}"

case "$TYPE" in
  concept|build|simulate|design) ;;
  *) echo "error: type must be concept, build, simulate, or design (got '$TYPE')" >&2; exit 2 ;;
esac

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
LESSON="$REPO/phases/$PHASE/$SLUG"

if [[ ! -d "$REPO/phases/$PHASE" ]]; then
  echo "error: phase not found: phases/$PHASE" >&2
  echo "       available:" >&2
  ls "$REPO/phases" 2>/dev/null | sed 's/^/         /' >&2
  exit 1
fi

if [[ -e "$LESSON" ]]; then
  echo "error: lesson already exists: phases/$PHASE/$SLUG" >&2
  exit 1
fi

if [[ ! "$SLUG" =~ ^[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "error: slug must be NN-lowercase-hyphenated (got '$SLUG')" >&2
  exit 1
fi

PKG="${SLUG#*-}"
PKG="${PKG//-/}"

mkdir -p "$LESSON/docs"
[[ "$TYPE" == "design" ]] || mkdir -p "$LESSON/code"
mkdir -p "$LESSON/design"

# --- docs/en.md ---
if [[ "$TYPE" == "design" ]]; then
cat > "$LESSON/docs/en.md" <<EOF
# $TITLE

> TODO: one-sentence hook, ideally a number that surprises the reader.

**Type:** design
**Prerequisites:** TODO
**Time:** ~45 minutes

## Learning objectives

- TODO verb-first and checkable

## The problem

TODO the brief: constraints, scale, budget, and what you are being asked to decide.

## Deliverable

TODO what the reader should write.

## Rubric

TODO groups of \`- [ ]\` checkboxes with marks.

## Traps

| Trap | Why it is wrong |
| --- | --- |
| TODO | TODO |

## Reference direction

TODO *a* strong answer, explicitly not the only one.

## Exercises

1. TODO

## Further reading

- [TODO](url) — why it is worth your time
EOF
else
cat > "$LESSON/docs/en.md" <<EOF
# $TITLE

> TODO: one-sentence hook, ideally a number that surprises the reader.

**Type:** $TYPE
**Prerequisites:** TODO
**Time:** ~45 minutes

## Learning objectives

By the end you will be able to:

- TODO verb-first and checkable

## 1. The problem

TODO the naive approach, stated fairly, then broken with output you actually ran.

\`\`\`
\$ python3 code/$PKG.py
TODO paste real output
\`\`\`

## 2. The idea

TODO the mechanism in words, then as pseudocode. Not in a real language — the reader
should not need to know one.

\`\`\`text
function TODO(x):
    TODO
\`\`\`

## 3. The trade-off this lesson teaches

TODO two properties that look identical and are not, or a knob with a plateau.
This is the section that justifies the lesson existing.

## 5. Run it

\`\`\`bash
python3 code/$PKG.py
python3 -m unittest discover -s code -q
\`\`\`

TODO say what the tests assert.

## 6. Use it

| System | Where it appears |
| --- | --- |
| TODO | TODO the real config key, named as its docs name it |

## 7. What this does *not* solve

- TODO

## Exercises

1. TODO easy — vary one parameter, predict, then measure
2. TODO medium
3. TODO hard

## Key terms

| Term | What people say | What it actually means |
| --- | --- | --- |
| TODO | TODO | TODO |

## Further reading

- [TODO](url) — why it is worth your time
EOF

# --- code skeleton: stdlib only, readable, prints the measurement ---
cat > "$LESSON/code/$PKG.py" <<EOF
"""TODO one-line purpose.

Read this top to bottom; it is meant to be read, not just run.

    python3 $PKG.py
"""

from __future__ import annotations


def measure() -> dict[str, float]:
    """TODO produce the number this lesson is built around."""
    raise NotImplementedError("TODO")


def main() -> None:
    raise NotImplementedError("TODO print the measurement table")


if __name__ == "__main__":
    main()
EOF

cat > "$LESSON/code/test_$PKG.py" <<EOF
"""Tests for $PKG.py.

    python3 -m unittest test_$PKG -v
"""

from __future__ import annotations

import unittest

import $PKG


class Test$(printf '%s' "$PKG" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')(unittest.TestCase):
    def test_todo_correctness(self):
        self.skipTest("not implemented")

    def test_todo_asserts_the_tradeoff(self):
        """TODO name this for the IDEA it protects, not the function it calls."""
        self.skipTest("not implemented")
EOF
fi

# --- quiz ---
cat > "$LESSON/quiz.json" <<'EOF'
{
  "questions": [
    {
      "stage": "pre",
      "question": "TODO",
      "options": ["TODO a", "TODO b", "TODO c", "TODO d"],
      "correct": 0,
      "explanation": "TODO at least forty characters explaining why, not just restating."
    },
    {
      "stage": "post",
      "question": "TODO",
      "options": ["TODO a", "TODO b", "TODO c", "TODO d"],
      "correct": 0,
      "explanation": "TODO at least forty characters explaining why, not just restating."
    }
  ]
}
EOF

echo "created phases/$PHASE/$SLUG ($TYPE)"
echo
echo "next:"
echo "  \$EDITOR phases/$PHASE/$SLUG/docs/en.md"
echo "  python3 scripts/audit_lessons.py --phase ${PHASE%%-*}"
