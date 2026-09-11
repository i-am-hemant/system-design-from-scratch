"""Tests for hashring.py.

Two kinds of test here, and the second kind is the unusual one:

  correctness  — the mapping behaves sanely
  the teaching — the trade-off the lesson claims actually holds

If a later change breaks the ring's churn guarantee, the failing test names the
*idea* that died rather than just an assertion number.

    python3 -m unittest test_hashring -v      # shows the measured tables

Plain unittest, no pytest, so the lesson needs nothing installed.
"""

from __future__ import annotations

import math
import unittest

from hashring import Modulo, Ring, churn, distribution, keys, spread

# Sections: correctness first, then the trade-off the lesson exists to teach.

class TestHashRing(unittest.TestCase):
    def test_empty_mapper_returns_nothing(self):
        assert Modulo().get("anything") is None
        assert Ring(64).get("anything") is None

    def test_mapping_is_deterministic(self):
        for mapper in (Modulo("a", "b", "c"), Ring(64, "a", "b", "c")):
            for key in keys(200):
                first = mapper.get(key)
                assert all(mapper.get(key) == first for _ in range(5))

    def test_every_key_lands_on_a_real_node(self):
        nodes = ["a", "b", "c", "d"]
        ring = Ring(50, *nodes)
        assert all(ring.get(k) in nodes for k in keys(1000))

    def test_add_and_remove_are_idempotent(self):
        ring = Ring(16, "a", "b")
        ring.add("b")
        assert ring.nodes() == ["a", "b"]
        ring.remove("zzz")
        assert ring.nodes() == ["a", "b"]
        ring.remove("a")
        ring.remove("a")
        assert ring.nodes() == ["b"]

    def test_removed_node_never_serves_keys(self):
        ring = Ring(64, "a", "b", "c")
        ring.remove("b")
        assert all(ring.get(k) != "b" for k in keys(500))

    def test_distribution_covers_every_node(self):
        ring = Ring(150, "a", "b", "c")
        counts = distribution(ring, keys(3000))
        assert set(counts) == {"a", "b", "c"}
        assert sum(counts.values()) == 3000
        assert all(v > 0 for v in counts.values())

    # --- the trade-off the lesson exists to teach ----------------------------

    def test_modulo_remaps_nearly_everything(self):
        """The motivating failure. Growing 4 -> 5 changes the divisor, so most keys move."""
        sample = keys(10_000)
        moved = churn(Modulo("n1", "n2", "n3", "n4"), sample, lambda m: m.add("n5"))
        print(f"\nmodulo 4->5: {moved:.1%} of keys moved")
        assert moved >= 0.70, f"expected a near-total remap, got {moved:.1%}"

    def test_ring_moves_only_its_share(self):
        """The payoff. Adding the Nth node should move roughly 1/N of the keys."""
        sample = keys(10_000)
        moved = churn(Ring(150, "n1", "n2", "n3", "n4"), sample, lambda m: m.add("n5"))
        print(f"ring 4->5:   {moved:.1%} of keys moved (ideal 20%)")
        assert moved <= 0.35, f"expected about 1/5, got {moved:.1%}"

    def test_ring_beats_modulo_by_at_least_2x(self):
        """States the comparison as one assertion so a regression in either fails loudly."""
        sample = keys(10_000)
        nodes = [f"n{i}" for i in range(6)]
        m = churn(Modulo(*nodes), sample, lambda x: x.add("n6"))
        r = churn(Ring(150, *nodes), sample, lambda x: x.add("n6"))
        assert r > 0, "a ring churn of 0 means the mutation did nothing"
        print(f"6->7 nodes:  modulo {m:.1%}, ring {r:.1%} — ring is {m / r:.1f}x better")
        assert m / r >= 2.0, f"ring should beat modulo by >=2x, got {m / r:.1f}x"

    def test_removal_churn_is_also_bounded(self):
        """Removal matters as much as addition, because removal is what a crash looks like."""
        sample = keys(10_000)
        moved = churn(Ring(150, *[f"n{i}" for i in range(5)]), sample, lambda m: m.remove("n2"))
        print(f"ring 5->4 (crash): {moved:.1%} of keys moved")
        assert moved <= 0.35, f"expected about 1/5, got {moved:.1%}"

    def test_churn_tracks_one_over_n(self):
        """The 1/N relationship should hold across cluster sizes, not just one."""
        sample = keys(10_000)
        print("\nnodes -> +1   modulo    ring    ideal")
        for n in (2, 4, 8, 16, 32):
            nodes = [f"n{i}" for i in range(n)]
            newcomer = f"n{n}"
            m = churn(Modulo(*nodes), sample, lambda x: x.add(newcomer))
            r = churn(Ring(150, *nodes), sample, lambda x: x.add(newcomer))
            ideal = 1 / (n + 1)
            print(f"{n:5} -> {n + 1:<3}  {m:>7.1%} {r:>7.1%} {ideal:>7.1%}")
            assert r <= ideal * 2.5, f"at N={n}, ring churn {r:.1%} exceeds 2.5x ideal"

    def test_virtual_nodes_improve_balance(self):
        """One position per node is catastrophically uneven; many positions average it out.

        Note what this does NOT claim: that more replicas monotonically improve balance.
        Measured spread plateaus around 1.3-1.7 from ~50 replicas upward, and 500 can
        score worse than 50. Past the plateau you pay memory for noise.
        """
        sample = keys(20_000)
        nodes = [f"n{i}" for i in range(5)]
        one = spread(Ring(1, *nodes), sample)
        many = spread(Ring(150, *nodes), sample)
        print(f"\nspread with   1 vnode:  {one:.2f}")
        print(f"spread with 150 vnodes: {many:.2f}")

        if not math.isinf(one):
            assert many < one, f"150 vnodes ({many:.2f}) should beat 1 vnode ({one:.2f})"
        assert many <= 2.0, f"a well-configured ring should be within 2x, got {many:.2f}"

    def test_spread_plateaus(self):
        """Records the replicas/balance curve so the lesson's claim is backed by a test."""
        sample = keys(20_000)
        nodes = [f"n{i}" for i in range(5)]
        measured = {}
        print("\nreplicas   spread")
        for replicas in (1, 10, 50, 150, 500):
            measured[replicas] = spread(Ring(replicas, *nodes), sample)
            shown = "inf" if math.isinf(measured[replicas]) else f"{measured[replicas]:.2f}"
            print(f"{replicas:>8}   {shown}")

        # The defensible claims: 1 replica is unusable, and 50+ sits in a usable band.
        assert math.isinf(measured[1]) or measured[1] > 5, "1 vnode should be badly unbalanced"
        for replicas in (50, 150, 500):
            assert measured[replicas] <= 2.0, (
                f"replicas={replicas}: spread {measured[replicas]:.2f} left the usable band"
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
