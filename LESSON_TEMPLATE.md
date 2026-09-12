# Lesson template

Copy this shape. Do not copy it slavishly — the headings a lesson needs depend on what it
teaches. `scripts/audit_lessons.py` enforces the required ones per type.

## The rule this curriculum runs on

**No claim without a number the lesson produced.**

Not a number from a blog post. Not a number you remember. A number that appears because a script
in the lesson directory printed it, and that a reader can reproduce by running one command.

This is the only rule that matters. Everything below serves it.

## Lesson types

| Type | When to use it | What it must contain |
| --- | --- | --- |
| `concept` | **The default.** The idea matters; writing the mechanism does not | Concept, measured output, a script to run, judgement |
| `build` | Writing the mechanism *is* the insight — Raft, rate limiting under real concurrency | Everything in `concept`, plus a step-by-step `## Build it` |
| `simulate` | The behaviour cannot be built in a lesson: cache hit ratios, replication lag | A model, its assumptions stated plainly, measured output |
| `design` | Judgement under ambiguity. No code | The problem, a rubric, traps, a reference direction |

**Most lessons are `concept`.** Reach for `build` rarely; roughly six of the planned forty-nine
justify it. Writing 200 lines of a hash ring teaches you the ring, not when to shard.

## Language

**Pseudocode in the doc. Python in `code/`.**

Pseudocode carries the idea without the reader learning a language first — and without them
skipping the section because it is in a language they do not use. Keep it close to your own
notation:

```text
function Get(key):
    if slots is empty:
        return NONE
    i ← index of first slot ≥ hash(key)
    return owner[slots[i]]
```

Python exists to produce the numbers, and must be **stdlib-only** — the audit fails on a
third-party import. If a reader needs `pip install` before seeing a measurement, most will not
see it.

Go, or any second language, appears only where Python physically cannot make the point: the GIL
means true data races and real parallelism are unobservable. Say in the doc why that lesson has
two languages.

## Shape

````markdown
# Lesson Title

> A hook with a surprising number. This is the one line a reader will repeat to someone else.

**Type:** concept
**Prerequisites:** Lesson NN (topic)
**Time:** ~45 minutes

## Learning objectives

By the end you will be able to:

- Predict <specific behaviour> and explain why
- Distinguish <X> from <Y>, and say which mechanism fixes which
- Name the failure modes this does *not* fix

## 1. The problem

The naive approach, stated without condescension — it is what a competent engineer writes first,
and usually for good reasons.

Then break it, with output:

```
$ python3 code/thing.py
<real output showing the failure>
```

Name the number in prose. "81% of keys move." That sentence is the lesson.

## 2. The idea

The mechanism, in words first. A Mermaid diagram if the shape is spatial. Then pseudocode.

Call out the parts that look incidental and are not — the format string that becomes a wire
contract, the collision branch that silently loses data.

## 3. Why the number is what it is

Derive it. If churn is 1/N, show why geometrically, then point at the measured column and let the
reader check the claim against the table.

## 4. <The trade-off this lesson exists to teach>

Every lesson has one. Two properties that look like the same thing and are not; a knob with a
plateau; a fix that creates a new failure.

This is where a curriculum earns its keep. "It depends" is where most explanations stop; this is
where you say *on what*, with a table.

## 5. Run it

```bash
python3 code/thing.py
python3 -m unittest discover -s code -q
```

Say what the tests assert. If they assert the *teaching* and not just correctness, say so —
that is unusual and worth pointing out.

## 6. Use it

| System | Where it appears |
| --- | --- |
| Real product | The specific knob, named as its docs name it |

Map the lesson's parameter to the real configuration key. `replicas` is Cassandra's `num_tokens`.
That mapping is what makes the lesson usable at work.

## 7. What this does *not* solve

Be blunt. Every technique is oversold somewhere, and knowing the boundary is most of knowing the
technique.

## Exercises

1. **Easy** — vary one parameter, predict the direction, then measure
2. **Medium** — extend the model, and state what the extension cost
3. **Hard** — an alternative from a paper. Why has it not won?

## Key terms

| Term | What people say | What it actually means |
| --- | --- | --- |
| Term | The loose version | The precise version, with the number if there is one |

## Further reading

- [Paper](url) — what specifically to read in it, and why
````

## Diagrams

Two mechanisms, and the choice matters:

**Mermaid** — the default. Fenced ```` ```mermaid ````. It is diffable text, reviewable in a pull
request, and re-renders on theme change so dark mode is free. Use it for flowcharts, sequence
diagrams, state machines, anything Mermaid's auto-layout handles well.

**Committed SVG** — for diagrams where Mermaid's auto-layout fights you: spatial arrangements,
hand-drawn shapes, a ring with keys walking clockwise, rack and topology sketches. Excalidraw is
a good source for these.

A static SVG cannot re-theme itself, so export **both variants** and name them as a pair:

```
figures/
├── ring-walk.excalidraw     the editable source — commit it
├── ring-walk-light.svg      exported for light theme
└── ring-walk-dark.svg       exported for dark theme
```

Reference only the light one; the renderer pairs them automatically:

```markdown
![A key between node-A and node-B walks clockwise to node-B](../figures/ring-walk-light.svg)
```

Rules:

- **Keep the `.excalidraw` source in the repo.** An SVG you cannot edit is a diagram you will
  never fix.
- **Match the design system.** Set Excalidraw's font to "Normal" or Code rather than the default
  hand-drawn Virgil, which clashes with the site's typography. Palette: ink `#17181c`, paper
  `#f7f6f2`, one accent `#b25a00` (dark: `#e9e7df`, `#101116`, `#e08a2e`).
- **Alt text is a sentence, not a label.** "A key between node-A and node-B walks clockwise to
  node-B" — not "ring diagram". It is what a screen reader and a search index get.
- **A figure is never the only carrier of a fact.** Say the number in prose too; the diagram
  illustrates, it does not testify.

Do not add a live Excalidraw renderer. `@excalidraw/excalidraw` is 47 MB and needs React, against
a site that currently ships zero dependencies.

## Writing rules

- **Show the failure before the fix.** A reader who has not felt the problem cannot value the
  solution.
- **Every number traceable.** If the doc says 81%, `python3 code/thing.py` prints 81%. The audit
  checks this and fails on stale figures.
- **Record what surprised you.** The consistent-hashing lesson teaches that virtual-node returns
  plateau *because a test asserting otherwise failed*. Being wrong in public is the most credible
  thing in a curriculum.
- **Familiar vocabulary.** No invented jargon. If a term has a standard name, use it; if it does
  not, describe it plainly rather than coining one.
- **No hedging as a substitute for measuring.** "It depends" must be followed by "on what,"
  answered with data.
- **Cite where a claim is not yours.** Link the paper, name the version.

## Before you commit

```bash
python3 -m unittest discover -s code -q
python3 scripts/audit_lessons.py --run-tests
node site/build.js && node site/test_site.js
node scripts/serve.js          # read it as a reader would
```
