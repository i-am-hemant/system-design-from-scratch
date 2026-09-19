"""Request-to-node mapping: the naive way and the consistent way.

Read this file top to bottom — it is meant to be read, not just run. Roughly
40 lines of actual logic, because the ideas are small; what makes them matter is
the measurement at the bottom.

    python3 hashring.py

Two strategies, one interface, so the difference between them is measurable
rather than asserted:

    Modulo  hash(key) % len(nodes)      what almost everyone writes first
    Ring    consistent hashing          what production systems use
"""

from __future__ import annotations

import bisect
import zlib


def hash_key(s: str) -> int:
    """Map a string into the 32-bit keyspace.

    CRC32 is used for one reason: it is *reproducible*. The same key lands in the
    same place on every machine and every run, which is what makes the numbers in
    this lesson verifiable rather than approximate.

    It is not a cryptographic hash. If an attacker chooses your keys, they can
    deliberately collide them onto one node. Real systems facing untrusted input
    use MurmurHash3, xxHash, or SipHash.
    """
    return zlib.crc32(s.encode())


class Modulo:
    """The obvious approach. Correct, evenly distributed, and catastrophic to resize.

    Every key's answer depends on the *number* of nodes. Change the count and the
    divisor changes, so nearly every key gets a different answer.
    """

    def __init__(self, *nodes: str) -> None:
        self.nodes = sorted(nodes)

    def get(self, key: str) -> str | None:
        if not self.nodes:
            return None
        return self.nodes[hash_key(key) % len(self.nodes)]

    def add(self, node: str) -> None:
        if node not in self.nodes:
            self.nodes = sorted([*self.nodes, node])

    def remove(self, node: str) -> None:
        if node in self.nodes:
            self.nodes.remove(node)


class Ring:
    """Consistent hashing.

    Nodes are placed on a conceptual circle of hash values. A key is owned by the
    first node found walking clockwise from the key's own position. Adding or
    removing a node only disturbs the arc between it and its neighbour, so a
    change is *local* rather than global.

    Each physical node occupies `replicas` positions ("virtual nodes"). With one
    position per node the arcs are whatever the hash happened to produce, which is
    wildly uneven — see the spread table in main().
    """

    def __init__(self, replicas: int = 150, *nodes: str) -> None:
        self.replicas = max(1, replicas)
        self.slots: list[int] = []       # sorted positions on the circle
        self.owner: dict[int, str] = {}  # position -> physical node
        for node in nodes:
            self.add(node)

    def _virtual_key(self, node: str, i: int) -> str:
        """Name the i-th virtual node.

        This format is part of the ring's contract. Change it and every key's
        placement reshuffles — a full cache flush shipped as a refactor.
        """
        return f"{node}#{i}"

    def add(self, node: str) -> None:
        for i in range(self.replicas):
            slot = hash_key(self._virtual_key(node, i))
            if slot in self.owner:
                continue  # never steal an arc that already belongs to someone
            self.owner[slot] = node
            bisect.insort(self.slots, slot)

    def remove(self, node: str) -> None:
        self.slots = [s for s in self.slots if self.owner[s] != node]
        self.owner = {s: o for s, o in self.owner.items() if o != node}

    def get(self, key: str) -> str | None:
        if not self.slots:
            return None
        # First position >= the key's hash, wrapping past the top of the circle.
        i = bisect.bisect_left(self.slots, hash_key(key))
        return self.owner[self.slots[i % len(self.slots)]]

    def nodes(self) -> list[str]:
        return sorted(set(self.owner.values()))


# --- measurement -------------------------------------------------------------
# These three functions are why the lesson can make claims. Any figure in the
# doc comes from running them.


def churn(mapper, keys: list[str], mutate) -> float:
    """Fraction of keys whose owning node changes when `mutate` is applied.

    Snapshot, mutate, compare. This is the number the whole lesson turns on:
    ~1.0 for modulo, ~1/N for a ring.
    """
    before = {k: mapper.get(k) for k in keys}
    mutate(mapper)
    moved = sum(1 for k in keys if mapper.get(k) != before[k])
    return moved / len(keys)


def distribution(mapper, keys: list[str]) -> dict[str, int]:
    """How many keys land on each node."""
    counts: dict[str, int] = {}
    for k in keys:
        node = mapper.get(k)
        if node is not None:
            counts[node] = counts.get(node, 0) + 1
    return counts


def spread(mapper, keys: list[str]) -> float:
    """Busiest node / quietest node. 1.0 is perfect; higher is worse.

    Churn and spread are different properties. A ring can have excellent churn
    and terrible spread at the same time, which is exactly why virtual nodes
    exist.
    """
    counts = distribution(mapper, keys)
    if not counts:
        return 0.0
    lo, hi = min(counts.values()), max(counts.values())
    return float("inf") if lo == 0 else hi / lo


def keys(n: int) -> list[str]:
    return [f"key:{i}" for i in range(n)]


def main() -> None:
    sample = keys(10_000)

    print(f"Mapping {len(sample):,} keys.\n")
    print("Adding one node to a cluster of N:")
    print(f"{'CHANGE':<16}{'MODULO':>8}{'RING':>8}{'IDEAL':>8}   RING vs MODULO")
    for n in (2, 4, 8, 16, 32, 64):
        nodes = [f"node-{i:02d}" for i in range(n)]
        newcomer = f"node-{n:02d}"
        m = churn(Modulo(*nodes), sample, lambda x: x.add(newcomer))
        r = churn(Ring(150, *nodes), sample, lambda x: x.add(newcomer))
        better = f"{m / r:.1f}x better" if r else "n/a"
        print(f"{f'{n} -> {n + 1} nodes':<16}{m:>7.1%}{r:>8.1%}{1 / (n + 1):>8.1%}   {better}")

    print("\nRemoving a node (what a crash looks like):")
    print(f"{'CHANGE':<16}{'MODULO':>8}{'RING':>8}{'IDEAL':>8}")
    for n in (4, 8, 16):
        nodes = [f"node-{i:02d}" for i in range(n)]
        victim = nodes[n // 2]
        m = churn(Modulo(*nodes), sample, lambda x: x.remove(victim))
        r = churn(Ring(150, *nodes), sample, lambda x: x.remove(victim))
        print(f"{f'{n} -> {n - 1} nodes':<16}{m:>7.1%}{r:>8.1%}{1 / n:>8.1%}")

    print("\nWhy virtual nodes exist (5 nodes, busiest/quietest ratio):")
    print(f"{'REPLICAS':>9}{'SPREAD':>9}   VERDICT")
    five = [f"node-{i:02d}" for i in range(5)]
    for replicas in (1, 5, 10, 50, 150, 500):
        s = spread(Ring(replicas, *five), sample)
        verdict = (
            "a node got zero keys" if s == float("inf")
            else "unusable" if s > 10
            else "noticeably lopsided" if s > 2
            else "usable"
        )
        shown = "infinite" if s == float("inf") else f"{s:.2f}"
        print(f"{replicas:>9}{shown:>9}   {verdict}")

    print("\nNote the spread column stops improving past ~50 replicas.")
    print("More virtual nodes cost memory and lookup time; past the plateau")
    print("they do not buy fairness. Measure, do not assume.")


if __name__ == "__main__":
    main()
