// Command churn measures what a topology change costs.
//
//	go run ./cmd/churn
//	go run ./cmd/churn -keys 100000 -replicas 300
//
// It prints the fraction of keys that change owner when a node is added or
// removed, for modulo mapping versus a consistent-hash ring. The point of the
// lesson is visible in one table: modulo remaps nearly everything, the ring
// remaps roughly its fair share.
package main

import (
	"flag"
	"fmt"
	"math"
	"os"
	"text/tabwriter"

	hashring "github.com/i-am-hemant/system-design-from-scratch/phases/01-foundations/03-consistent-hashing/code"
)

func main() {
	keyCount := flag.Int("keys", 10000, "number of keys to map")
	replicas := flag.Int("replicas", 150, "virtual nodes per physical node")
	flag.Parse()

	keys := hashring.Keys(*keyCount)

	fmt.Printf("Mapping %d keys. Ring uses %d virtual nodes per physical node.\n\n",
		*keyCount, *replicas)

	nodeCounts := []int{2, 4, 8, 16, 32, 64}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "CHANGE\tMODULO\tRING\tIDEAL\tRING vs MODULO")
	fmt.Fprintln(w, "------\t------\t----\t-----\t--------------")

	for _, n := range nodeCounts {
		nodes := nodeNames(n)
		added := fmt.Sprintf("node-%02d", n)

		modulo := hashring.Churn(hashring.NewModulo(nodes...), keys,
			func(m hashring.Mapper) { m.Add(added) })
		ring := hashring.Churn(hashring.NewRing(*replicas, nodes...), keys,
			func(m hashring.Mapper) { m.Add(added) })
		ideal := 1.0 / float64(n+1)

		improvement := "n/a"
		if ring > 0 {
			improvement = fmt.Sprintf("%.1fx better", modulo/ring)
		}

		fmt.Fprintf(w, "%d -> %d nodes\t%.1f%%\t%.1f%%\t%.1f%%\t%s\n",
			n, n+1, modulo*100, ring*100, ideal*100, improvement)
	}
	w.Flush()

	fmt.Println("\nRemoving a node (what a crash looks like):")
	w = tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "CHANGE\tMODULO\tRING\tIDEAL")
	fmt.Fprintln(w, "------\t------\t----\t-----")
	for _, n := range []int{4, 8, 16} {
		nodes := nodeNames(n)
		victim := nodes[n/2]

		modulo := hashring.Churn(hashring.NewModulo(nodes...), keys,
			func(m hashring.Mapper) { m.Remove(victim) })
		ring := hashring.Churn(hashring.NewRing(*replicas, nodes...), keys,
			func(m hashring.Mapper) { m.Remove(victim) })

		fmt.Fprintf(w, "%d -> %d nodes\t%.1f%%\t%.1f%%\t%.1f%%\n",
			n, n-1, modulo*100, ring*100, 100.0/float64(n))
	}
	w.Flush()

	fmt.Println("\nWhy virtual nodes exist (5 nodes, busiest/quietest ratio):")
	w = tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "REPLICAS\tSPREAD\tVERDICT")
	fmt.Fprintln(w, "--------\t------\t-------")
	for _, r := range []int{1, 5, 10, 50, 150, 500} {
		spread := hashring.Spread(hashring.NewRing(r, nodeNames(5)...), keys)
		fmt.Fprintf(w, "%d\t%s\t%s\n", r, formatSpread(spread), verdict(spread))
	}
	w.Flush()

	fmt.Println("\nNote the spread column stops improving past ~50 replicas.")
	fmt.Println("More virtual nodes cost memory and lookup time; they do not")
	fmt.Println("keep buying fairness. Measure, do not assume.")
}

func nodeNames(n int) []string {
	nodes := make([]string, n)
	for i := range nodes {
		nodes[i] = fmt.Sprintf("node-%02d", i)
	}
	return nodes
}

func formatSpread(s float64) string {
	if math.IsInf(s, 1) {
		return "infinite"
	}
	return fmt.Sprintf("%.2f", s)
}

func verdict(s float64) string {
	switch {
	case math.IsInf(s, 1):
		return "a node received zero keys"
	case s > 10:
		return "unusable"
	case s > 2:
		return "noticeably lopsided"
	default:
		return "usable"
	}
}
