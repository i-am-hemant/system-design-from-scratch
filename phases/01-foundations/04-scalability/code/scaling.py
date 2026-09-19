"""Three numbers behind the vertical-versus-horizontal decision.

Read this top to bottom; it is meant to be read, not just run.

    python3 scaling.py

The lesson is about judgement, not code, so this script stays deliberately small.
It produces only the figures the doc could not honestly assert without them:

  1. How long you now wait for a CPU twice as fast (why "buy a bigger box" ran out)
  2. What the top of the machine ladder costs per unit of compute (the price cliff)
  3. What a serial fraction does to a cluster you already paid for (Amdahl)
"""

from __future__ import annotations

import math

# Annual single-thread (scalar) performance growth, measured on SPECint relative
# to a VAX 11/780. Source: Hennessy & Patterson, Computer Architecture 6ed,
# figure 1.17. The eras are theirs, not smoothed by us.
MOORE_ERAS = [
    ("1986-2003  superscalar era", 0.52),
    ("2003-2011  end of Dennard", 0.23),
    ("2011-2015  multicore only", 0.12),
    ("2015-      present", 0.035),
]

# AWS EC2 on-demand, us-east-1, Linux, published Sep 2026.
#
# Two general purpose rows to establish the baseline rate, then the rungs above
# the general purpose ceiling. m7i stops at 192 vCPUs; every machine bigger than
# that is a specialised high-memory family, and the per-unit price is where the
# "vertical scaling gets expensive" claim is true. Kept short on purpose — the
# lesson needs the cliff, not a price list.
EC2_LADDER = [
    ("m7i.large", 2, 8, 0.1008),
    ("m7i.48xlarge", 192, 768, 9.6768),
    ("u7i-12tb.224xlarge", 896, 12288, 125.5818),
    ("u7in-16tb.224xlarge", 896, 16384, 180.4756),
    ("u7in-24tb.224xlarge", 896, 24576, 270.7313),
]


def doubling_years(annual_growth: float) -> float:
    """Years for compounding growth at this rate to double performance."""
    return math.log(2) / math.log(1 + annual_growth)


def amdahl(serial_fraction: float, machines: int) -> float:
    """Speedup with `machines` workers when `serial_fraction` cannot be parallelised."""
    return 1 / (serial_fraction + (1 - serial_fraction) / machines)


def main() -> None:
    print("How long you wait for a CPU twice as fast (Hennessy & Patterson, fig 1.17):")
    print(f"{'ERA':30} {'GROWTH/YEAR':>12} {'DOUBLES IN':>12}")
    for label, rate in MOORE_ERAS:
        print(f"{label:30} {rate * 100:11.1f}% {doubling_years(rate):9.1f} yr")

    base = EC2_LADDER[0][3] / EC2_LADDER[0][1]
    print("\nWhat the top of the ladder costs (EC2 on-demand, us-east-1, Sep 2026):")
    print(f"{'INSTANCE':22} {'vCPU':>5} {'GiB':>7} {'$/HOUR':>9} {'$/vCPU-HR':>10} {'vs SMALL':>9}")
    for name, vcpu, gib, price in EC2_LADDER:
        per = price / vcpu
        print(f"{name:22} {vcpu:5} {gib:7} {price:9.2f} {per:10.4f} {per / base:8.2f}x")

    print("\nAmdahl: what a serial fraction does to machines you already paid for:")
    counts = (4, 16, 64, 1024)
    print(f"{'SERIAL':>7} " + " ".join(f"{'N=' + str(n):>7}" for n in counts) + f" {'CEILING':>9}")
    for serial in (0.01, 0.05, 0.20):
        row = " ".join(f"{amdahl(serial, n):7.1f}" for n in counts)
        print(f"{serial * 100:6.0f}% {row} {1 / serial:8.1f}x")


if __name__ == "__main__":
    main()
