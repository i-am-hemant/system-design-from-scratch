# System Design from Scratch

> Most system design material teaches you to recite answers. This teaches you to derive them.
> You build the mechanisms, measure the trade-offs, and defend the designs.

**Status: early. One lesson complete as the reference implementation. The curriculum outline is
being built in the open.**

## Why this exists

Every system design resource has the same shape: a list of concepts, a diagram of a URL
shortener, and a promise that you'll pass the interview. You read it, nod, and two weeks later
can't explain why your own service fell over.

The problem is that design knowledge doesn't transfer by reading. "Consistent hashing reduces
key movement" is a sentence you can memorise without understanding. But if you *implement* the
naive version, measure that adding one server to a 4-node cache moves **81% of your keys**, then
implement the ring and watch it drop to **20%** — now you know something. You can't un-know it,
and you can rederive it under pressure.

So this curriculum has three kinds of lesson, matched to what the material actually is:

| Kind | What you produce | Why |
| --- | --- | --- |
| **Build** | Working Go code with tests | Some things are real algorithms: hash rings, rate limiters, bloom filters, WALs, leader election, circuit breakers. Implement them |
| **Simulate** | A measurable experiment | You can't build DynamoDB in a lesson. You *can* simulate load and watch p99 move when you add a cache — trade-offs become numbers you generated |
| **Design** | A written design, self-scored | Some judgement has no unit test. These ship a rubric, a set of traps, and a reference direction — not a hidden right answer |

The rule for every lesson: **no claim without a number you produced.**

## The reference lesson

[`phases/01-foundations/03-consistent-hashing`](phases/01-foundations/03-consistent-hashing) is
complete and shows the intended shape:

```
03-consistent-hashing/
├── docs/en.md          the lesson
├── code/
│   ├── hashring.go     Modulo + Ring behind one interface, ~250 lines, zero deps
│   ├── hashring_test.go tests that assert the TRADE-OFF, not just correctness
│   └── cmd/churn/      runnable demo that prints the comparison table
├── quiz.json           6 questions, pre and post
└── design/             design exercise with rubric and traps
```

Try it:

```bash
cd phases/01-foundations/03-consistent-hashing/code
go test ./...          # correctness plus trade-off assertions
go run ./cmd/churn     # see 81% vs 20% for yourself
```

Real output:

```
CHANGE           MODULO   RING    IDEAL   RING vs MODULO
2 -> 3 nodes     66.9%    34.3%   33.3%   2.0x better
4 -> 5 nodes     81.0%    25.1%   20.0%   3.2x better
8 -> 9 nodes     89.2%     7.8%   11.1%   11.4x better
64 -> 65 nodes   98.5%     1.1%    1.5%   86.4x better
```

Note what that table does: it makes the *shape* of the improvement visible. Modulo gets worse as
you scale; the ring gets better. No prose conveys that as well as the numbers do.

## What makes the tests unusual

Ordinary tests check correctness. These also assert the property the lesson teaches:

```go
func TestRingBeatsModuloByAtLeast2x(t *testing.T) { ... }  // fails if the gap closes
func TestSpreadPlateaus(t *testing.T)             { ... }  // records where returns stop
```

If a future refactor breaks the ring's churn guarantee, the test says which *idea* died, not just
which assertion failed.

This also keeps the curriculum honest about itself. While writing the reference lesson, a test
asserting "more virtual nodes always balance better" **failed** — because it isn't true. Spread
plateaus around 50 replicas and 500 can score worse than 150. The lesson now teaches the plateau
because the measurement contradicted the plausible belief. That's the whole method.

## Who this is for

- **Beginners** — start at phase 1 and go in order. Every lesson runs on your laptop with Go and
  nothing else.
- **Working engineers** — skip to the lesson for the thing you're about to build. Each one is
  self-contained, with a "what this does *not* solve" section you'll want before you commit.
- **Interview prep** — the design exercises are the closest thing here to an interview, and the
  rubrics tell you what a strong answer names.

No prior distributed-systems knowledge assumed. Basic Go is enough; the code avoids clever
constructs deliberately.

## Language

**Go**, for the whole curriculum. Not because it's fashionable, but because this domain's real
infrastructure is written in it — etcd, Kubernetes, Consul, CockroachDB, Envoy's control plane —
and because goroutines and channels let a lesson show concurrency without a framework in the way.

One language keeps the focus on the ideas. You will not be asked to install anything beyond the
Go toolchain.

## Contributing

Early days, so the most useful contributions right now are:

- **Curriculum feedback.** Is the phase ordering right? What's missing?
- **Finding wrong claims.** If a lesson asserts something the code doesn't demonstrate, that's
  the highest-value bug report here.
- **Design exercise rubrics.** These are the hardest part to write well.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`LESSON_TEMPLATE.md`](LESSON_TEMPLATE.md).

## Prior art and credit

The lesson structure — Problem → Concept → Build It → Use It → Ship It, plus per-lesson quizzes
and shippable artifacts — is adapted from
[ai-engineering-from-scratch](https://github.com/rohitg00/ai-engineering-from-scratch) by Rohit
Ghumare, which demonstrates the format at 503-lesson scale. The adaptation for this domain is the
simulate-and-grade tiers, since system design has fewer things you can implement outright and
more things you can only measure or argue.

## Licence

MIT. Use it, fork it, teach from it.
