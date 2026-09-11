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
TYPE="${4:-build}"

case "$TYPE" in
  build|simulate|design) ;;
  *) echo "error: type must be build, simulate, or design (got '$TYPE')" >&2; exit 2 ;;
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
[[ "$TYPE" == "design" ]] || mkdir -p "$LESSON/code/cmd/demo"
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
**Language:** Go
**Prerequisites:** TODO
**Time:** ~60 minutes

## Learning objectives

- TODO verb-first and checkable

## The problem

TODO the naive approach, then break it with a measurement you actually ran.

## The concept

TODO the idea before the code.

## Build it

### Step 1: TODO

TODO explanation, then code.

## Run it

\`\`\`bash
go test ./...
go run ./cmd/demo
\`\`\`

TODO paste real output.

## Use it

| System | Where it appears |
| --- | --- |
| TODO | TODO |

## Ship it

TODO the reusable artifact and its limits.

## What this does *not* solve

- TODO

## Exercises

1. TODO easy
2. TODO medium
3. TODO hard

## Key terms

| Term | What people say | What it actually means |
| --- | --- | --- |
| TODO | TODO | TODO |

## Further reading

- [TODO](url) — why it is worth your time
EOF

# --- code skeleton ---
cat > "$LESSON/code/go.mod" <<EOF
module github.com/i-am-hemant/system-design-from-scratch/phases/$PHASE/$SLUG/code

go 1.25
EOF

cat > "$LESSON/code/$PKG.go" <<EOF
// Package $PKG TODO one-line purpose.
package $PKG

// TODO implement
EOF

cat > "$LESSON/code/${PKG}_test.go" <<EOF
package $PKG

import "testing"

// TODO: at least one test must assert the TRADE-OFF this lesson teaches,
// not merely that the code is correct.
func TestTODO(t *testing.T) {
	t.Skip("not implemented")
}
EOF

cat > "$LESSON/code/cmd/demo/main.go" <<EOF
// Command demo prints the measurement this lesson is built around.
package main

import "fmt"

func main() {
	fmt.Println("TODO")
}
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
