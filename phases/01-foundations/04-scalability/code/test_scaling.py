"""Tests for scaling.py.

    python3 -m unittest test_scaling -v

Two kinds of test live here. The ordinary ones check the arithmetic. The ones named
for an idea fail if the *lesson* stops being true — if the commodity price range
ever grows a premium, or if Amdahl's ceiling stops binding, the doc's claims are
wrong and these are what say so.
"""

from __future__ import annotations

import unittest

import scaling

COMMODITY_CEILING_VCPU = 192  # the largest m7i; every rung above is specialised


class TestMooreEras(unittest.TestCase):
    def test_doubling_time_matches_compounding(self):
        # 100% growth per year must double in exactly one year.
        self.assertAlmostEqual(scaling.doubling_years(1.0), 1.0, places=9)

    def test_waiting_for_hardware_stopped_being_a_strategy(self):
        """The lesson's hook: the free lunch ended, by an order of magnitude.

        If this fails, single-thread performance started compounding again and the
        case for scaling out weakens.
        """
        first = scaling.doubling_years(scaling.MOORE_ERAS[0][1])
        last = scaling.doubling_years(scaling.MOORE_ERAS[-1][1])
        self.assertLess(first, 2.0, "the superscalar era should double in under 2 years")
        self.assertGreater(last, 15.0, "the present era should need over 15 years to double")
        self.assertGreater(last / first, 10.0, "the eras should differ by more than 10x")

    def test_doubling_time_grows_as_growth_slows(self):
        times = [scaling.doubling_years(rate) for _, rate in scaling.MOORE_ERAS]
        self.assertEqual(times, sorted(times), "eras are listed slowest-growth-last")


class TestVerticalCost(unittest.TestCase):
    """The lesson splits the price ladder in two, so the tests do as well."""

    def commodity(self):
        return [r for r in scaling.EC2_LADDER if r[1] <= COMMODITY_CEILING_VCPU]

    def specialised(self):
        return [r for r in scaling.EC2_LADDER if r[1] > COMMODITY_CEILING_VCPU]

    def test_commodity_range_is_priced_proportionally(self):
        """Below the ceiling there is no size premium — scaling up costs exactly pro rata.

        This is the half of the folklore that is wrong, and stating it precisely is
        what makes the other half credible.
        """
        rates = {round(price / vcpu, 4) for _, vcpu, _, price in self.commodity()}
        self.assertEqual(len(rates), 1, f"expected one flat commodity rate, got {rates}")

    def test_price_escalates_past_the_commodity_ceiling(self):
        """And this is the half that is right: specialised hardware costs a real premium."""
        base = self.commodity()[0][3] / self.commodity()[0][1]
        rates = [price / vcpu for _, vcpu, _, price in self.specialised()]
        self.assertEqual(rates, sorted(rates), "specialised rungs should get progressively worse")
        self.assertGreater(rates[0] / base, 2.0, "the first step off the family should exceed 2x")
        self.assertGreater(rates[-1] / base, 5.0, "the top of the ladder should exceed 5x")

    def test_ladder_spans_both_ranges(self):
        # A ladder with only one range would make both tests above vacuous.
        self.assertGreaterEqual(len(self.commodity()), 2)
        self.assertGreaterEqual(len(self.specialised()), 2)

    def test_ladder_is_ordered_by_price(self):
        prices = [price for _, _, _, price in scaling.EC2_LADDER]
        self.assertEqual(prices, sorted(prices))


class TestAmdahl(unittest.TestCase):
    def test_one_machine_is_no_speedup(self):
        for serial in (0.0, 0.05, 0.5, 1.0):
            self.assertAlmostEqual(scaling.amdahl(serial, 1), 1.0, places=9)

    def test_fully_parallel_work_scales_linearly(self):
        self.assertAlmostEqual(scaling.amdahl(0.0, 64), 64.0, places=9)

    def test_serial_fraction_caps_speedup_at_its_reciprocal(self):
        """The ceiling is 1/s no matter how many servers you buy."""
        for serial in (0.01, 0.05, 0.2):
            ceiling = 1 / serial
            self.assertLess(scaling.amdahl(serial, 1_000_000), ceiling)
            self.assertGreater(scaling.amdahl(serial, 1_000_000), ceiling * 0.99)

    def test_five_percent_serial_wastes_most_of_a_large_cluster(self):
        """The doc's headline: 64 servers, 5% serial, 15.4x — under a quarter of what you paid."""
        speedup = scaling.amdahl(0.05, 64)
        self.assertLess(speedup, 16.0)
        self.assertGreater(speedup / 64, 0.20)
        self.assertLess(speedup / 64, 0.25)

    def test_past_the_ceiling_more_servers_buy_almost_nothing(self):
        """The 20% row: 16x the servers for 6% more throughput."""
        gain = scaling.amdahl(0.20, 1024) / scaling.amdahl(0.20, 64)
        self.assertLess(gain, 1.10, "past 1/s the curve should be effectively flat")


if __name__ == "__main__":
    unittest.main()
