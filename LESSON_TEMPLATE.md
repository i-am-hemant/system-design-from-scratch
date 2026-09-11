# Lesson Template

Every lesson declares a **Type**, and the type determines its shape. Pick the one that matches
what the material actually is — forcing a design topic into a Build lesson produces fake code,
and forcing an algorithm into a Design lesson wastes a chance to make it concrete.

| Type | Use when | Ships |
| --- | --- | --- |
| `Build` | The topic is a real algorithm or data structure | Go code + tests + demo |
| `Simulate` | The system is too large to build, but its behaviour can be measured | A simulation + measurements |
| `Design` | The answer is a judgement, not an artifact | A brief + rubric + traps |

## Directory layout

```
phases/NN-phase-name/NN-lesson-slug/
├── docs/
│   └── en.md              the lesson
├── code/                  Build and Simulate only
│   ├── <topic>.go
│   ├── <topic>_test.go    required — a lesson you cannot verify is prose
│   ├── cmd/<demo>/        runnable demonstration
│   └── go.mod
├── quiz.json              6-ish questions, pre and post
└── design/                optional for Build, required for Design
    └── <scenario>.md
```

Directory names are `NN-lowercase-hyphenated`. The audit script enforces this.

## docs/en.md — Build and Simulate

````markdown
# Lesson Title

> One-sentence hook. Ideally a number that surprises the reader.

**Type:** Build
**Language:** Go
**Prerequisites:** Lesson NN, Lesson NN
**Time:** ~N minutes

## Learning objectives

- Verb-first and checkable. "Predict how many keys move when..." not "understand hashing"
- Four is a good number

## The problem

The naive approach, written out, then broken with a measurement. Do not describe the failure —
run it and paste the output. The reader should feel the problem before seeing the fix.

## The concept

The idea, before any code. Use a mermaid diagram if structure matters. Include the maths only
where it earns its place — a formula that explains *why* the number is what it is, not decoration.

## Build it

### Step 1: <name>

Explanation, then a code block. Steps should be small enough that each one compiles.

Call out the non-obvious decisions inline: why this hash, why skip on collision, why this is part
of the contract rather than an internal detail.

## Run it

```bash
go test ./...
go run ./cmd/<demo>
```

Show the real output. Then explain what the tests assert beyond correctness.

## Use it

Where this appears in production systems, as a table. Name specific config knobs where you can —
"Cassandra's num_tokens is this lesson's replicas" is worth more than "Cassandra uses this".

## Ship it

What reusable artifact the reader now has, and its limits. Be explicit about concurrency,
scaling, and what you would not use it for.

## What this does *not* solve

Non-negotiable section for anything that gets oversold. Every mechanism has a boundary; name it
so the reader does not reach for this tool on the wrong problem.

## Exercises

1. Easy — reinforce the core idea
2. Medium — apply it somewhere else
3. Medium — measure something the lesson only asserted
4. Hard — extend it, or break it adversarially
5. Hard — implement the competing approach and compare

## Key terms

| Term | What people say | What it actually means |
| --- | --- | --- |
| term | the common misconception | the accurate version |

## Further reading

- [Title](url) — why it is worth your time
````

## docs/en.md — Design

Same header, then: `## The problem` (the brief), `## Deliverable`, `## Rubric`,
`## Traps`, `## Reference direction`, `## Exercises`, `## Further reading`.

The rubric must use `- [ ]` checkboxes so a reader can self-score. The reference direction is
labelled as *a* strong answer, never *the* answer.

## Rules

**Numbers must be produced, not remembered.** Every figure in a lesson comes from code in that
lesson. If you cannot generate it, do not claim it.

**Tests assert the teaching, not just correctness.** A test named
`TestRingBeatsModuloByAtLeast2x` fails when the *idea* breaks. That is the point.

**When a measurement contradicts the lesson, the lesson changes.** This has already happened
once: a test asserting "more virtual nodes always improve balance" failed, because balance
plateaus. The lesson now teaches the plateau.

**Code has no explanatory comments, only decision comments.** Do not narrate what the line does.
Do explain why this hash function, why skip instead of overwrite, what is part of the contract.

**Every lesson runs with only the Go toolchain.** No Docker, no cloud account, no paid API. If a
lesson needs infrastructure, it should be a Simulate lesson instead.

## Scaffolding a lesson

```bash
scripts/scaffold_lesson.sh 01-foundations 04-rate-limiting "Rate Limiting" build
python3 scripts/audit_lessons.py --phase 1
python3 scripts/audit_lessons.py --run-tests    # before opening a PR
```
