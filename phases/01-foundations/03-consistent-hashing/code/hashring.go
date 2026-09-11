// Package hashring implements request-to-node mapping strategies.
//
// Two implementations sit side by side so their behaviour under a topology
// change can be measured rather than asserted:
//
//	Modulo    — the obvious approach: hash(key) % len(nodes)
//	Ring      — consistent hashing with virtual nodes
//
// Both satisfy Mapper, so the lesson's benchmark can swap one for the other.
package hashring

import (
	"fmt"
	"hash/crc32"
	"math"
	"sort"
	"strconv"
	"sync"
)

// Mapper assigns a key to exactly one node.
type Mapper interface {
	// Get returns the node responsible for key, or "" if there are no nodes.
	Get(key string) string
	// Add introduces a node into the topology.
	Add(node string)
	// Remove takes a node out of the topology.
	Remove(node string)
	// Nodes returns the current node set, sorted.
	Nodes() []string
}

// hashKey maps an arbitrary string into the 32-bit keyspace.
//
// CRC32 is chosen for speed and, more importantly, for reproducibility: the
// same key yields the same slot on every machine and every run, which is what
// makes the distribution numbers in this lesson verifiable rather than
// approximate. It is NOT a cryptographic hash and must not be used where an
// adversary picks the keys — see the exercises.
func hashKey(s string) uint32 {
	return crc32.ChecksumIEEE([]byte(s))
}

// Modulo maps keys with hash(key) % len(nodes).
//
// This is the approach almost everyone writes first. It distributes keys evenly
// and is trivially correct — until the node count changes, at which point the
// divisor changes and nearly every key moves. The lesson quantifies that.
type Modulo struct {
	mu    sync.RWMutex
	nodes []string
}

// NewModulo builds a Modulo mapper over the given nodes.
func NewModulo(nodes ...string) *Modulo {
	m := &Modulo{}
	for _, n := range nodes {
		m.Add(n)
	}
	return m
}

func (m *Modulo) Get(key string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.nodes) == 0 {
		return ""
	}
	return m.nodes[hashKey(key)%uint32(len(m.nodes))]
}

func (m *Modulo) Add(node string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, n := range m.nodes {
		if n == node {
			return
		}
	}
	m.nodes = append(m.nodes, node)
	sort.Strings(m.nodes)
}

func (m *Modulo) Remove(node string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, n := range m.nodes {
		if n == node {
			m.nodes = append(m.nodes[:i], m.nodes[i+1:]...)
			return
		}
	}
}

func (m *Modulo) Nodes() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, len(m.nodes))
	copy(out, m.nodes)
	return out
}

// Ring implements consistent hashing.
//
// Nodes are placed on a conceptual circle of hash values. A key is owned by the
// first node encountered walking clockwise from the key's own position. Adding
// or removing a node therefore only disturbs the arc between that node and its
// predecessor, rather than remapping the whole keyspace.
//
// Each physical node is placed at `replicas` positions ("virtual nodes"). With
// one position per node the arcs are wildly uneven — the ring is only as fair as
// the hash function is lucky. More positions average that out; see
// TestVirtualNodesImproveBalance for the measured effect.
type Ring struct {
	mu       sync.RWMutex
	replicas int
	slots    []uint32          // sorted positions on the circle
	owner    map[uint32]string // slot -> physical node
	present  map[string]bool
}

// NewRing builds a ring with the given number of virtual nodes per physical
// node. replicas <= 0 is treated as 1.
func NewRing(replicas int, nodes ...string) *Ring {
	if replicas <= 0 {
		replicas = 1
	}
	r := &Ring{
		replicas: replicas,
		owner:    make(map[uint32]string),
		present:  make(map[string]bool),
	}
	for _, n := range nodes {
		r.Add(n)
	}
	return r
}

// virtualKey names the i-th virtual node of a physical node. The format is part
// of the ring's contract: changing it reshuffles every key's placement.
func virtualKey(node string, i int) string {
	return node + "#" + strconv.Itoa(i)
}

func (r *Ring) Add(node string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.present[node] {
		return
	}
	r.present[node] = true
	for i := 0; i < r.replicas; i++ {
		slot := hashKey(virtualKey(node, i))
		// A collision would silently steal an arc from another node. With CRC32
		// and realistic node counts this is rare, but skipping is the honest
		// response: the alternative is corrupting an existing mapping.
		if _, taken := r.owner[slot]; taken {
			continue
		}
		r.owner[slot] = node
		r.slots = append(r.slots, slot)
	}
	sort.Slice(r.slots, func(a, b int) bool { return r.slots[a] < r.slots[b] })
}

func (r *Ring) Remove(node string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.present[node] {
		return
	}
	delete(r.present, node)
	kept := r.slots[:0]
	for _, slot := range r.slots {
		if r.owner[slot] == node {
			delete(r.owner, slot)
			continue
		}
		kept = append(kept, slot)
	}
	r.slots = kept
}

func (r *Ring) Get(key string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.slots) == 0 {
		return ""
	}
	h := hashKey(key)
	// First slot >= h, wrapping to the start of the ring.
	i := sort.Search(len(r.slots), func(i int) bool { return r.slots[i] >= h })
	if i == len(r.slots) {
		i = 0
	}
	return r.owner[r.slots[i]]
}

func (r *Ring) Nodes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.present))
	for n := range r.present {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Churn reports the fraction of keys whose owning node changes when mutate is
// applied to m. This is the number that makes the lesson's point: it is ~1.0 for
// Modulo and ~1/N for a ring.
//
// The returned value is in [0, 1]. Keys that map to "" before and after are not
// counted as moved.
func Churn(m Mapper, keys []string, mutate func(Mapper)) float64 {
	if len(keys) == 0 {
		return 0
	}
	before := make(map[string]string, len(keys))
	for _, k := range keys {
		before[k] = m.Get(k)
	}
	mutate(m)
	moved := 0
	for _, k := range keys {
		if m.Get(k) != before[k] {
			moved++
		}
	}
	return float64(moved) / float64(len(keys))
}

// Distribution counts how many keys land on each node.
func Distribution(m Mapper, keys []string) map[string]int {
	counts := make(map[string]int)
	for _, n := range m.Nodes() {
		counts[n] = 0
	}
	for _, k := range keys {
		counts[m.Get(k)]++
	}
	return counts
}

// Spread returns the ratio of the busiest node's share to the quietest node's
// share. A perfectly even mapping scores 1.0. Higher is worse.
//
// This is the metric that exposes why virtual nodes exist: a ring with one
// virtual node per physical node distributes keys unevenly even though its churn
// is already good.
func Spread(m Mapper, keys []string) float64 {
	counts := Distribution(m, keys)
	if len(counts) == 0 {
		return 0
	}
	minCount, maxCount := -1, 0
	for _, c := range counts {
		if c > maxCount {
			maxCount = c
		}
		if minCount == -1 || c < minCount {
			minCount = c
		}
	}
	if minCount == 0 {
		// At least one node received nothing. Report +Inf rather than dividing by
		// zero, since "a node is idle" is itself the finding.
		return math.Inf(1)
	}
	return float64(maxCount) / float64(minCount)
}

// Keys generates n synthetic keys with a stable, reproducible naming scheme.
func Keys(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("key:%d", i)
	}
	return out
}
