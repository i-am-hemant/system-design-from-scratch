# Design exercise: sharding a session store

The code in this lesson gives you a mechanism. This exercise is about deciding whether to use
it — the part with no unit test.

There is no single correct answer. There is a set of things a good answer *names*, and a set of
traps a weak answer falls into. Write your answer before reading the rubric.

## The brief

You own the session store for a web application.

- 40M active sessions, ~2 KB each
- 95k reads/s at peak, 8k writes/s
- p99 read latency budget: 10ms
- Sessions expire after 30 days of inactivity
- Currently: one Redis instance, vertically scaled, at 78% memory
- The business is expanding to a second region next quarter

You have been asked to "shard it with consistent hashing." Decide whether that is the right
call, and specify what you would actually build.

## Deliverable

Write up to one page covering:

1. **Estimate first.** Total memory footprint. Does it justify sharding at all?
2. **Node count and replicas.** Justify both with numbers, not defaults.
3. **What happens when a node dies?** Be specific about what users experience.
4. **How do clients agree on the node set?** This is the part most answers skip.
5. **The trade-off you are accepting.** Name what your design is deliberately bad at.
6. **What you would do differently if sessions could not be lost.**

## Rubric

Score yourself. Each point is 1 mark; 9+ is a strong answer.

**Estimation (3 marks)**
- [ ] Computed the footprint: 40M x 2 KB = 80 GB, so this exceeds comfortable single-instance
      memory and sharding is justified
- [ ] Derived node count from a real per-node memory target rather than picking a round number
- [ ] Noted that 95k reads/s spread over N nodes is undemanding per node — this is a *memory*
      problem, not a throughput problem

**Mechanism (3 marks)**
- [ ] Chose a replica count and justified it by measurement or by the plateau, not "150 because
      that is what everyone uses"
- [ ] Addressed expiry: 30-day TTL means the store self-trims, so growth is bounded
- [ ] Recognised that sessions are already keyed by an opaque random ID, which is close to
      ideal hash input — no hot-key skew from natural key distribution

**Failure handling (2 marks)**
- [ ] Stated the user-visible consequence: losing a node logs out ~1/N of users, because a
      session miss is indistinguishable from a session that never existed
- [ ] Proposed something about it — replication per shard, or accepting it explicitly as a
      business decision, or a signed-cookie fallback

**Coordination (2 marks)**
- [ ] Identified that every client needs the same view of the node set, or two clients will
      write the same session to different shards
- [ ] Named a mechanism: config service, DNS with a short TTL, a proxy such as Envoy or
      twemproxy that owns the ring, or a Redis Cluster–style slot map

**Trade-off honesty (2 marks)**
- [ ] Named at least one thing the design is bad at
- [ ] Addressed the second region rather than ignoring it: a single global ring across regions
      means cross-region reads at 100ms+, which blows the 10ms budget. Sessions are almost
      always region-local, so the honest answer is a separate ring per region, not one big ring

## Traps

Weak answers usually contain at least one of these:

| Trap | Why it is wrong |
| --- | --- |
| Reaching for consistent hashing before estimating | 80 GB justifies it. If it had been 8 GB, the right answer is "buy more RAM" — sharding adds operational cost you did not need |
| A single ring spanning both regions | Cross-region latency is ~100ms. The budget is 10ms. Geography is a constraint, not a detail |
| "Consistent hashing gives even distribution" | It bounds churn. Evenness comes from virtual nodes, and you should say which count and why |
| Ignoring the coordination problem | The ring is only correct if all clients share one view of membership. This is the most commonly skipped requirement |
| Treating node loss as invisible | 1/N of your users get logged out. That is a product decision and needs stating, not hiding |
| Adding replication without costing it | Replicating every shard doubles the memory bill for 80 GB of data. Say whether the business should pay |

## Reference direction

A strong answer looks something like this. It is not the only good answer.

**Estimate.** 40M x 2 KB = 80 GB of session data. At a 25 GB per-node working target (leaving
headroom for fragmentation and overhead), that is 4 nodes minimum; 6 gives room for growth and
keeps per-node loss at ~17%. Read load is 95k/s ÷ 6 ≈ 16k/s per node, which Redis handles
comfortably — confirming this is a memory-driven shard, not a throughput-driven one.

**Mechanism.** Consistent hashing with ~50–150 virtual nodes per physical node, chosen by
measuring spread at 6 nodes rather than inherited from a blog post. Session IDs are random, so
key distribution is favourable and there is no natural hot key. The 30-day TTL means the working
set is self-limiting.

**Failure.** Losing one of six nodes logs out ~17% of active users. For a content site that is
an annoyance; for a banking app it is unacceptable. If it is unacceptable, each shard needs a
replica, which roughly doubles the memory bill — and that is a business conversation, not a
technical one. A cheaper middle path is a signed cookie carrying enough state to re-establish a
session on miss, trading a little security surface for resilience.

**Coordination.** The ring must be owned in one place. Either a proxy layer (Envoy `ring_hash`)
so clients hold no ring at all, or a config service that pushes membership with a version number
that clients reject if stale. Client-side rings with independent membership views are how you get
the same session written to two shards.

**Trade-off accepted.** This design optimises for memory scaling and cheap rebalancing. It is
deliberately bad at: surviving node loss without user impact (no replication), and cross-region
operation (rings are per-region, so a user moving regions gets a new session). Both are
defensible for a session store and both should be written down, not discovered later.

**If sessions could not be lost**, this stops being a consistent-hashing problem. You would want
a replicated store with a real durability story — Redis Cluster with AOF and replicas, or
DynamoDB with its own partitioning — and you would accept the higher write latency that
durability costs.
