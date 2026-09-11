# Contributing

The most valuable contribution to this project is **finding a claim the code doesn't support.**

Everything here is built on one rule: no assertion without a number the lesson itself produces.
If you find a lesson stating something its code doesn't demonstrate, that's a real bug — open an
issue even if you don't have a fix.

## Before you write a lesson

Decide which type it is, because forcing the wrong shape produces bad material:

- **Build** — the topic is a genuine algorithm you can implement in a few hundred lines. Hash
  rings, rate limiters, bloom filters, LRU caches, write-ahead logs, leader election, circuit
  breakers, gossip, merkle trees.
- **Simulate** — the real system is too big to build, but you can model its behaviour and
  measure. Cache hit ratios under skewed load, replication lag versus write latency, queue depth
  under backpressure.
- **Design** — the answer is judgement. Ships a brief, a rubric with checkboxes, a traps table,
  and a reference direction that is explicitly *a* good answer rather than *the* answer.

If you're about to write Go that only exists so the lesson has code in it, it should be a
Simulate or Design lesson instead.

## Workflow

```bash
scripts/scaffold_lesson.sh 01-foundations 04-rate-limiting "Rate Limiting" build
# write code first, get the measurement, then write the doc around it
python3 scripts/audit_lessons.py --run-tests
```

Write the code before the prose. The lesson's hook should be a number you were mildly surprised
by; you can't know what that is until you've run it.

## What CI enforces

- `gofmt` clean
- `go vet` and `go test` pass in every lesson's module
- Lesson structure: required sections for the declared type
- **Every backticked Go identifier in a doc exists in that lesson's code**
- **Every `go test`/`go run` command quoted in a doc actually runs**
- `quiz.json` parses and every `correct` index is in range
- Relative links resolve
- Design exercises have a rubric with checkboxes

That fourth and fifth item are the interesting ones. They're why a doc can't drift from its code.

## Standards for code

- **No dependencies** beyond the Go standard library. A reader should clone and run.
- **No narrating comments.** Don't write `// loop over nodes`. Do write why this hash function,
  why skip on collision, what's part of the contract.
- **Tests assert the teaching.** Alongside correctness tests, include at least one named for the
  property the lesson exists to demonstrate — `TestRingBeatsModuloByAtLeast2x`, not `TestRing2`.
- **Thresholds come from measurement.** Run the thing, see the real number, then assert against
  it with sensible headroom. Don't assert an idealised value and tune until it passes.

## Standards for prose

- Lead with the failure. Show the naive approach breaking, with output, before the fix.
- State what the mechanism does *not* solve. Every technique gets oversold; the boundary is often
  the most useful paragraph in the lesson.
- "Key terms" contrasts the common misconception against the accurate version. If a term has no
  common misconception, it probably doesn't need a row.
- No motivational filler. The reader came to learn a mechanism.

## If a measurement contradicts a lesson

Change the lesson. This has already happened: a test asserting "more virtual nodes always improve
balance" failed, because balance plateaus around 50 replicas and 500 can score worse than 150.
The lesson now teaches the plateau, and a test records the curve.

That outcome is a success, not an embarrassment. Please report more of them.

## Licence

Contributions are MIT, same as the project.
