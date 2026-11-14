"""Tester för Väntar på mat som lär sig av köket: larmet kommer när maten är sen jämfört med
hur lång tid just de rätterna brukar ta, inte efter en fast tid för allt.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import Observation, OrderInfo, TableMemory, food_deadline, learn_prep_times  # noqa: E402

T0 = 1_000_000.0
ISO = "2026-11-01T12:00:00+00:00"


def iso(minutes_after: float) -> str:
    from datetime import datetime, timedelta

    return (datetime.fromisoformat(ISO) + timedelta(minutes=minutes_after)).isoformat()


def done(name: str, minutes: float, qty: int = 1) -> dict:
    """En beställning som köket gjorde klar efter så många minuter."""
    return {"items": [{"name": name, "qty": qty}], "created_at": ISO, "ready_at": iso(minutes)}


class LearnPrepTimesTest(unittest.TestCase):
    def test_median_per_dish(self):
        rows = [done("Pasta", 10), done("Pasta", 12), done("Pasta", 30), done("Gryta", 35), done("Gryta", 40), done("Gryta", 38)]
        prep = learn_prep_times(rows)
        self.assertEqual(prep["pasta"], 12)
        self.assertEqual(prep["gryta"], 38)

    def test_needs_three_orders(self):
        self.assertNotIn("sallad", learn_prep_times([done("Sallad", 5), done("Sallad", 6)]))

    def test_name_ignores_case_and_spaces(self):
        rows = [done(" Pizza ", 14), done("pizza", 16), done("PIZZA", 15)]
        self.assertEqual(learn_prep_times(rows)["pizza"], 15)

    def test_skips_broken_rows(self):
        rows = [
            {"items": [{"name": "Pasta"}], "created_at": ISO, "ready_at": None},  # aldrig klar
            {"items": [{"name": "Pasta"}], "created_at": ISO, "ready_at": iso(-3)},  # klar före beställningen
            {"items": [{"name": "Pasta"}], "created_at": ISO, "ready_at": iso(600)},  # glömd i tio timmar
            {"items": "trasig", "created_at": ISO, "ready_at": iso(10)},
            {"items": [{"qty": 1}], "created_at": ISO, "ready_at": iso(10)},
        ]
        self.assertEqual(learn_prep_times(rows), {})


class FoodDeadlineTest(unittest.TestCase):
    def test_unknown_dish_uses_default(self):
        self.assertEqual(food_deadline([(T0, ["Okänd"])], {}), T0 + local_ai.FOOD_WAIT_MIN * 60)

    def test_known_dish_gets_its_time_plus_margin(self):
        # 40 min i köket + en fjärdedel (10 min) i marginal
        self.assertEqual(food_deadline([(T0, ["Gryta"])], {"gryta": 40}), T0 + 50 * 60)

    def test_quick_dish_gets_at_least_five_minutes_margin(self):
        self.assertEqual(food_deadline([(T0, ["Sallad"])], {"sallad": 6}), T0 + 11 * 60)

    def test_slowest_dish_in_the_order_counts(self):
        self.assertEqual(food_deadline([(T0, ["Sallad", "Gryta"])], {"sallad": 6, "gryta": 40}), T0 + 50 * 60)

    def test_earliest_late_order_counts(self):
        orders = [(T0, ["Gryta"]), (T0 + 60, ["Sallad"])]
        self.assertEqual(food_deadline(orders, {"sallad": 6, "gryta": 40}), T0 + 60 + 11 * 60)

    def test_no_waiting_orders(self):
        self.assertIsNone(food_deadline([], {"pasta": 12}))


def guests(dishes=0):
    return Observation(2, 2, dishes, False, seen_persons=2)


class AwaitingFoodTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        self.memory = TableMemory()
        self.now = T0
        self.status = self.feed(60)  # gästerna har satt sig

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: float, orders: OrderInfo | None = None) -> str:
        status = ""
        end = self.now + seconds
        while self.now < end:
            self.now += 2
            status = self.memory.update(guests(), self.now, orders)
        return status

    def test_slow_dish_is_not_late_after_fifteen_minutes(self):
        ordered = self.now
        orders = OrderInfo(waiting_since=ordered, food_deadline=ordered + 50 * 60)
        self.assertEqual(self.feed(20 * 60, orders), "OCCUPIED")
        self.assertEqual(self.feed(31 * 60, orders), "AWAITING_FOOD")

    def test_quick_dish_is_late_sooner(self):
        ordered = self.now
        orders = OrderInfo(waiting_since=ordered, food_deadline=ordered + 11 * 60)
        self.assertEqual(self.feed(10 * 60, orders), "OCCUPIED")
        self.assertEqual(self.feed(2 * 60, orders), "AWAITING_FOOD")

    def test_without_learned_times_the_fixed_wait_applies(self):
        ordered = self.now
        orders = OrderInfo(waiting_since=ordered)
        self.assertEqual(self.feed(14 * 60, orders), "OCCUPIED")
        self.assertEqual(self.feed(2 * 60, orders), "AWAITING_FOOD")

    def test_without_orders_the_wait_counts_from_seating(self):
        self.assertEqual(self.feed(local_ai.FOOD_WAIT_MIN * 60 + 10), "AWAITING_FOOD")


if __name__ == "__main__":
    unittest.main()
