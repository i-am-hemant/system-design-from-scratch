package hashring

import (
	"fmt"
	"math"
	"testing"
)

// --- Correctness ---------------------------------------------------------

func TestEmptyMapperReturnsNoNode(t *testing.T) {
	for name, m := range map[string]Mapper{
		"modulo": NewModulo(),
		"ring":   NewRing(64),
	} {
		if got := m.Get("anything"); got != "" {
			t.Errorf("%s: empty mapper returned %q, want \"\"", name, got)
		}
	}
}

func TestMappingIsDeterministic(t *testing.T) {
	nodes := []string{"node-a", "node-b", "node-c"}
	for name, m := range map[string]Mapper{
		"modulo": NewModulo(nodes...),
		"ring":   NewRing(64, nodes...),
	} {
		for _, key := range Keys(200) {
			first := m.Get(key)
			for i := 0; i < 5; i++ {
				if got := m.Get(key); got != first {
					t.Fatalf("%s: Get(%q) not stable: %q then %q", name, key, first, got)
				}
			}
		}
	}
}

func TestEveryKeyLandsOnARealNode(t *testing.T) {
	nodes := []string{"a", "b", "c", "d"}
	r := NewRing(50, nodes...)
	valid := map[string]bool{}
	for _, n := range nodes {
		valid[n] = true
	}
	for _, key := range Keys(1000) {
		if got := r.Get(key); !valid[got] {
			t.Fatalf("Get(%q) = %q, which is not a member node", key, got)
		}
	}
}

func TestAddAndRemoveAreIdempotent(t *testing.T) {
	r := NewRing(16, "a", "b")
	r.Add("b")
	if got := r.Nodes(); len(got) != 2 {
		t.Errorf("adding an existing node changed the set: %v", got)
	}
	r.Remove("zzz")
	if got := r.Nodes(); len(got) != 2 {
		t.Errorf("removing an absent node changed the set: %v", got)
	}
	r.Remove("a")
	r.Remove("a")
	if got := r.Nodes(); len(got) != 1 || got[0] != "b" {
		t.Errorf("after removals want [b], got %v", got)
	}
}

func TestRemovedNodeNeverServesKeys(t *testing.T) {
	r := NewRing(64, "a", "b", "c")
	r.Remove("b")
	for _, key := range Keys(500) {
		if r.Get(key) == "b" {
			t.Fatalf("removed node b still owns %q", key)
		}
	}
}

// --- The trade-off this lesson exists to demonstrate ---------------------

// TestModuloRemapsNearlyEverything is the motivating failure. Growing a modulo
// cluster from 4 to 5 nodes changes the divisor, so the great majority of keys
// move — in a cache that is a near-total cold start.
func TestModuloRemapsNearlyEverything(t *testing.T) {
	keys := Keys(10000)
	m := NewModulo("n1", "n2", "n3", "n4")

	churn := Churn(m, keys, func(m Mapper) { m.Add("n5") })

	if churn < 0.70 {
		t.Errorf("expected modulo churn >= 0.70 (near-total remap), got %.3f", churn)
	}
	t.Logf("modulo 4->5 nodes: %.1f%% of keys moved", churn*100)
}

// TestRingMovesOnlyItsShare is the payoff. Adding the Nth node to a ring should
// move roughly 1/N of the keys, because only the arcs the new node claims are
// disturbed.
func TestRingMovesOnlyItsShare(t *testing.T) {
	keys := Keys(10000)
	r := NewRing(150, "n1", "n2", "n3", "n4")

	churn := Churn(r, keys, func(m Mapper) { m.Add("n5") })

	// Ideal is 1/5 = 0.20. Allow generous slack for hash irregularity, but it
	// must be dramatically better than modulo's ~0.75.
	if churn > 0.35 {
		t.Errorf("expected ring churn <= 0.35 (about 1/5), got %.3f", churn)
	}
	t.Logf("ring 4->5 nodes: %.1f%% of keys moved (ideal 20%%)", churn*100)
}

// TestRingBeatsModuloByAtLeast2x states the comparison as a single assertion so
// a regression in either implementation fails loudly.
func TestRingBeatsModuloByAtLeast2x(t *testing.T) {
	keys := Keys(10000)
	nodes := []string{"n1", "n2", "n3", "n4", "n5", "n6"}

	moduloChurn := Churn(NewModulo(nodes...), keys, func(m Mapper) { m.Add("n7") })
	ringChurn := Churn(NewRing(150, nodes...), keys, func(m Mapper) { m.Add("n7") })

	if ringChurn == 0 {
		t.Fatal("ring churn of 0 is suspicious — the mutation did nothing")
	}
	ratio := moduloChurn / ringChurn
	if ratio < 2.0 {
		t.Errorf("ring should beat modulo by >=2x, got %.1fx (modulo %.3f, ring %.3f)",
			ratio, moduloChurn, ringChurn)
	}
	t.Logf("6->7 nodes: modulo %.1f%%, ring %.1f%% — ring is %.1fx better",
		moduloChurn*100, ringChurn*100, ratio)
}

// TestRemovalChurnIsAlsoBounded — removal matters as much as addition, because
// that is what a crash looks like.
func TestRemovalChurnIsAlsoBounded(t *testing.T) {
	keys := Keys(10000)
	r := NewRing(150, "n1", "n2", "n3", "n4", "n5")

	churn := Churn(r, keys, func(m Mapper) { m.Remove("n3") })

	// Losing 1 of 5 nodes should move that node's ~20% and nothing else.
	if churn > 0.35 {
		t.Errorf("expected removal churn <= 0.35, got %.3f", churn)
	}
	t.Logf("ring 5->4 nodes (crash): %.1f%% of keys moved", churn*100)
}

// TestVirtualNodesImproveBalance justifies the replicas parameter. With one
// position per node the arcs are whatever the hash happened to produce, which is
// catastrophically uneven. Adding virtual nodes averages that out.
//
// Note what this test does NOT claim: that more replicas monotonically improve
// balance. Measured spread for 5 nodes over 20k keys plateaus around 1.3-1.7
// from ~50 replicas upward and does not keep falling (300 replicas can score
// worse than 50). Past the plateau you are paying memory and sort time for
// noise, not fairness.
func TestVirtualNodesImproveBalance(t *testing.T) {
	keys := Keys(20000)
	nodes := []string{"n1", "n2", "n3", "n4", "n5"}

	spread1 := Spread(NewRing(1, nodes...), keys)
	spread150 := Spread(NewRing(150, nodes...), keys)

	t.Logf("spread with 1 vnode:    %.2f", spread1)
	t.Logf("spread with 150 vnodes: %.2f", spread150)

	if !math.IsInf(spread1, 1) && spread150 >= spread1 {
		t.Errorf("150 vnodes (%.2f) should balance better than 1 vnode (%.2f)",
			spread150, spread1)
	}

	// Empirically the plateau sits near 1.7 for this node count. Assert against
	// the measured reality with a little headroom, not against an idealised 1.0.
	const plateau = 2.0
	if spread150 > plateau {
		t.Errorf("spread with 150 vnodes = %.2f, want <= %.2f", spread150, plateau)
	}
}

// TestSpreadPlateaus records the shape of the replicas/balance curve so the
// lesson's claim is backed by a running test rather than a remembered number.
func TestSpreadPlateaus(t *testing.T) {
	keys := Keys(20000)
	nodes := []string{"n1", "n2", "n3", "n4", "n5"}

	t.Log("replicas   spread (busiest/quietest, 1.0 is perfect)")
	results := map[int]float64{}
	for _, r := range []int{1, 10, 50, 150, 500} {
		s := Spread(NewRing(r, nodes...), keys)
		results[r] = s
		t.Logf("%8d   %.2f", r, s)
	}

	// The real, defensible claims: 1 is unusable, and 50+ is in a usable band.
	if !math.IsInf(results[1], 1) && results[1] < 5 {
		t.Errorf("expected 1 vnode to be badly unbalanced, got %.2f", results[1])
	}
	for _, r := range []int{50, 150, 500} {
		if results[r] > 2.0 {
			t.Errorf("replicas=%d: spread %.2f exceeds usable band of 2.0", r, results[r])
		}
	}
}

func TestDistributionCoversAllNodes(t *testing.T) {
	nodes := []string{"a", "b", "c"}
	r := NewRing(150, nodes...)
	dist := Distribution(r, Keys(3000))

	if len(dist) != len(nodes) {
		t.Fatalf("distribution has %d entries, want %d: %v", len(dist), len(nodes), dist)
	}
	total := 0
	for node, count := range dist {
		if count == 0 {
			t.Errorf("node %s received no keys", node)
		}
		total += count
	}
	if total != 3000 {
		t.Errorf("distribution totals %d, want 3000", total)
	}
}

// --- Table showing the effect of scale, printed for the lesson -----------

func TestChurnScalesAsOneOverN(t *testing.T) {
	keys := Keys(10000)
	t.Log("nodes -> +1    modulo churn    ring churn    ideal (1/N+1)")
	for _, n := range []int{2, 4, 8, 16, 32} {
		nodes := make([]string, n)
		for i := range nodes {
			nodes[i] = fmt.Sprintf("n%d", i)
		}
		newNode := fmt.Sprintf("n%d", n)

		mc := Churn(NewModulo(nodes...), keys, func(m Mapper) { m.Add(newNode) })
		rc := Churn(NewRing(150, nodes...), keys, func(m Mapper) { m.Add(newNode) })
		ideal := 1.0 / float64(n+1)

		t.Logf("%2d -> %2d      %6.1f%%          %6.1f%%       %6.1f%%",
			n, n+1, mc*100, rc*100, ideal*100)

		if rc > ideal*2.5 {
			t.Errorf("at N=%d ring churn %.3f exceeds 2.5x ideal %.3f", n, rc, ideal)
		}
	}
}

// --- Benchmarks ----------------------------------------------------------

func BenchmarkRingGet(b *testing.B) {
	r := NewRing(150, "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8")
	keys := Keys(1000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.Get(keys[i%len(keys)])
	}
}

func BenchmarkModuloGet(b *testing.B) {
	m := NewModulo("n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8")
	keys := Keys(1000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Get(keys[i%len(keys)])
	}
}
