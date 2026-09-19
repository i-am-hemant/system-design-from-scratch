# System Design from Scratch

> Most system design material teaches you to recite answers. This teaches you to derive them.
> Every trade-off here arrives as a number you can reproduce, not an assertion you have to trust.

**Status: early. Two lessons complete as reference implementations. The curriculum outline is
being built in the open.**

## Why this exists

Every system design resource has the same shape: a list of concepts, a diagram of a URL
shortener, and a promise that you'll pass the interview. You read it, nod, and two weeks later
can't explain why your own service fell over.

The problem is that design knowledge doesn't transfer by reading. "Consistent hashing reduces key
movement" is a sentence you can memorise without understanding. But *measure* it — adding one
server to a 4-node cache moves **81% of your keys**, and a hash ring moves **20%** — and now you
know something. You can't un-know a number you watched a program print, and you can rederive it
under pressure.

Notice what that does and doesn't require. It requires seeing the measurement. It does not require
you to hand-write a hash ring, and pretending otherwise turns a design curriculum into a coding
tutorial. So most lessons hand you the mechanism and make you interrogate the result.

So this curriculum has four kinds of lesson, matched to what the material actually is:

| Kind | What you get | Why |
| --- | --- | --- |
| **Concept** | The idea, a measured result, a script to run | Most of system design. Knowing *when to shard* matters; hand-writing a hash ring does not. You read the mechanism as pseudocode and run the measurement |
| **Build** | Step-by-step implementation | Reserved for the few where writing it *is* the insight: Raft, rate limiting under real concurrency, write-ahead logs. Six of fifty lessons |
| **Simulate** | A measurable experiment | You can't build DynamoDB in a lesson. You *can* simulate load and watch p99 move when you add a cache — trade-offs become numbers you generated |
| **Design** | A written design, self-scored | Some judgement has no unit test. These ship a rubric, a set of traps, and a reference direction — not a hidden right answer |

The rule for every lesson: **no claim without a number the lesson produced.** The audit script
enforces it — a doc holding figures its code no longer prints fails CI.

## The reference lessons

[`phases/01-foundations/04-scalability`](phases/01-foundations/04-scalability) and
[`phases/03-data-storage/08-consistent-hashing`](phases/03-data-storage/08-consistent-hashing) are
complete and show the intended shape:

```
08-consistent-hashing/
├── docs/en.md          the lesson
├── code/
│   ├── hashring.py     Modulo + Ring behind one interface, ~40 lines of logic
│   └── test_hashring.py tests that assert the TRADE-OFF, not just correctness
├── quiz.json           6 questions, staged pre / check / post
└── design/             design exercise with rubric and traps
```

Try it:

```bash
cd phases/03-data-storage/08-consistent-hashing
python3 code/hashring.py                        # see 81% vs 20% for yourself
python3 -m unittest discover -s code -q         # trade-off assertions

cd ../../01-foundations/04-scalability
python3 code/scaling.py                         # see what 64 machines actually buy
python3 -m unittest discover -s code -q
```

Or read them on the site, served with production routing:

```bash
node scripts/serve.js   # http://localhost:8080
```

Real output, pasted from the run:

```
CHANGE            MODULO    RING   IDEAL   RING vs MODULO
2 -> 3 nodes      66.9%   34.3%   33.3%   2.0x better
4 -> 5 nodes      81.0%   25.1%   20.0%   3.2x better
8 -> 9 nodes      89.2%    7.8%   11.1%   11.4x better
64 -> 65 nodes    98.5%    1.1%    1.5%   86.4x better
```

Note what that table does: it makes the *shape* of the improvement visible. Modulo gets worse as
you scale; the ring gets better. No prose conveys that as well as the numbers do.

## What makes the tests unusual

Ordinary tests check correctness. These also assert the property the lesson teaches:

```python
def test_ring_beats_modulo_by_at_least_2x(self)  # fails if the gap closes
def test_spread_plateaus(self)                   # records where returns stop
```

If a future refactor breaks the ring's churn guarantee, the test says which *idea* died, not just
which assertion failed.

This also keeps the curriculum honest about itself. While writing the reference lesson, a test
asserting "more virtual nodes always balance better" **failed** — because it isn't true. Spread
plateaus around 50 replicas and 500 can score worse than 150. The lesson now teaches the plateau
because the measurement contradicted the plausible belief. That's the whole method.

## Who this is for

- **Beginners** — start at phase 1 and go in order. Every lesson runs on your laptop with Python
  and nothing else — no installs, no dependencies.
- **Working engineers** — skip to the lesson for the thing you're about to build. Each one is
  self-contained, with a "what this does *not* solve" section you'll want before you commit.
- **Interview prep** — the design exercises are the closest thing here to an interview, and the
  rubrics tell you what a strong answer names.

No prior distributed-systems knowledge assumed, and no language expertise either — the code is
deliberately plain.

## Language

**Pseudocode in the lessons. Python behind them.**

The subject here is system design, not a programming language. So the mechanism in each lesson is
written as pseudocode — readable whatever you work in, and impossible to skip because it's in a
language you don't use:

```text
function Get(key):
    i ← index of first slot ≥ hash(key)
    return owner[slots[i]]
```

Behind every lesson sits one Python script whose only job is producing the numbers. It uses the
standard library only — the audit fails on a third-party import — so `python3 code/thing.py` works
on a fresh machine. You mostly *read and run* it rather than write it.

Why keep code at all, if you're not writing it? Because it's what keeps this curriculum honest.
Every "it depends" has to terminate in a figure something reproducible generated, and you can
check it. That's the difference between this and a confident blog post.

Go appears in a handful of concurrency lessons, and only where Python's GIL makes the point
unobservable — real data races, true parallelism. Those lessons say why.

## Contributing

Early days, so the most useful contributions right now are:

- **Curriculum feedback.** Is the phase ordering right? What's missing?
- **Finding wrong claims.** If a lesson asserts something the code doesn't demonstrate, that's
  the highest-value bug report here.
- **Design exercise rubrics.** These are the hardest part to write well.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`LESSON_TEMPLATE.md`](LESSON_TEMPLATE.md).

## Prior art and credit

The per-lesson shape here — objectives, a quiz staged before and after, and a self-contained
directory holding the doc, its code and its exercise — follows the pattern set by the
"from scratch" curriculum repos. This project diverges in two ways that matter: lessons teach with
pseudocode and keep code as verification rather than as the exercise, and design judgement is
graded against rubrics because most of system design has no unit test.

## Licence

MIT. Use it, fork it, teach from it.
