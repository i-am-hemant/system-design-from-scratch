# Contributing

The most valuable contribution to this project is **finding a claim the code doesn't support.**

Everything here is built on one rule: no assertion without a number the lesson itself produces.
If you find a lesson stating something its code doesn't demonstrate, that's a real bug — open an
issue even if you don't have a fix.

## Before you write a lesson

Decide which type it is, because forcing the wrong shape produces bad material:

- **Concept** — the default, and what most lessons should be. The idea matters; hand-writing the
  mechanism does not. Explain it in pseudocode, show the measurement, hand over a script the
  reader can change. Consistent hashing, indexing, quorums, percentiles, bloom filters.
- **Build** — writing the mechanism *is* the insight, so a step-by-step section earns its place.
  Raft, leader election, rate limiting under real concurrency, write-ahead logs. Six of the
  forty-nine planned lessons. If you can't say what the act of typing it teaches, use Concept.
- **Simulate** — the real system is too big to build, but you can model its behaviour and
  measure. Cache hit ratios under skewed load, replication lag versus write latency, queue depth
  under backpressure.
- **Design** — the answer is judgement. Ships a brief, a rubric with checkboxes, a traps table,
  and a reference direction that is explicitly *a* good answer rather than *the* answer.

If you're about to write code that only exists so the lesson has code in it, stop. Every script
here exists to produce a number the doc quotes — nothing else.

## Workflow

```bash
scripts/scaffold_lesson.sh 01-foundations 04-rate-limiting "Rate Limiting" concept
# write code first, get the measurement, then write the doc around it
python3 scripts/audit_lessons.py --run-tests
node scripts/serve.js        # preview at http://localhost:8080
```

Use `scripts/serve.js` rather than `python3 -m http.server` for quick iteration:
it mirrors the production routing — extensionless URLs, `/about.html` redirecting
to `/about`, a real `404.html` — so `/catalog` and `/lesson?id=...` resolve as they
do live. A plain static server 404s on those and hides routing bugs until deploy.

To test against the actual Cloudflare runtime, including `_headers` and the CSP:

```bash
npx wrangler dev          # http://localhost:8787
```

That is the only way to verify header rules; `serve.js` does not apply them.

Write the code before the prose. The lesson's hook should be a number you were mildly surprised
by; you can't know what that is until you've run it.

## What CI enforces

- Every lesson's `python3 -m unittest discover` passes
- Lesson structure: required sections for the declared type
- **Numbers quoted in a doc's output blocks match what the script prints today**
- **Every backticked identifier in a doc exists in that lesson's code**
- **Every `python3` command quoted in a doc actually runs**
- Code is stdlib-only — a third-party import fails the audit
- `quiz.json` parses and every `correct` index is in range
- Relative links resolve; design exercises have a rubric with checkboxes
- The built site is not stale

The third item is the one that matters. Edit `hashring.py` so the churn figure changes, forget to
update the doc, and CI tells you which row went stale. Without it, "no claim without a number"
would decay into "no claim without a number that was true once."

## Standards for code

- **Standard library only.** A reader should clone and run with no install step. The audit
  enforces this; if you genuinely need a dependency, the lesson design is probably wrong.
- **No narrating comments.** Don't write `// loop over nodes`. Do write why this hash function,
  why skip on collision, what's part of the contract.
- **Tests assert the teaching.** Alongside correctness tests, include at least one named for the
  property the lesson exists to demonstrate — `test_ring_beats_modulo_by_at_least_2x`, not
  `test_ring_2`. When it fails, the message should name the *idea* that died.
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
