"""Tester för Väntar på notan: AI:n ska märka när gästerna ätit klart och vill betala,
men inte när de beställt mer, redan fått notan eller redan betalat.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import WANTS_BILL, Observation, OrderInfo, TableMemory  # noqa: E402


def seen(guests=2, dishes=0, standing=0, bags=0):
    return Observation(guests + standing, 2, dishes, False, standing=standing, seen_persons=guests + standing, bags=bags)


class BillTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False  # bara notan testas här
        self.memory = TableMemory()
        self.now = 1_000_000.0
        self.orders: OrderInfo | None = None
        # Gästerna sätter sig, får maten, äter och tallrikarna plockas bort
        self.feed(30, seen())
        self.feed(120, seen(dishes=2))
        self.status = self.feed(10, seen())
        self.cleared = self.now

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: int, observation: Observation) -> str:
        status = ""
        for _ in range(seconds):
            self.now += 1
            status = self.memory.update(observation, self.now, self.orders)
        return status

    def wait_until(self, minutes: float, observation: Observation | None = None) -> str:
        return self.feed(int(self.cleared + minutes * 60 - self.now), observation or seen())

    def test_bill_after_seven_minutes(self):
        self.assertNotEqual(self.wait_until(6.5), WANTS_BILL)
        self.assertEqual(self.wait_until(7.1), WANTS_BILL)

    def test_not_before_dessert_time(self):
        self.assertEqual(self.wait_until(3), "DESSERT_OPPORTUNITY")

    def test_bag_early(self):
        self.wait_until(2.1)
        self.assertEqual(self.feed(5, seen(bags=1)), WANTS_BILL)

    def test_bag_too_soon_is_ignored(self):
        self.assertNotEqual(self.feed(30, seen(bags=1)), WANTS_BILL)

    def test_half_stand_up_early(self):
        self.wait_until(2.1)
        self.assertEqual(self.feed(5, seen(guests=1, standing=1)), WANTS_BILL)

    def test_waiter_at_table_is_not_leaving(self):
        self.wait_until(2.1)
        self.assertNotEqual(self.feed(10, seen(guests=2, standing=1)), WANTS_BILL)

    def test_new_order_stops_bill(self):
        self.orders = OrderInfo(waiting_since=self.now)
        self.assertNotEqual(self.wait_until(8), WANTS_BILL)

    def test_staff_brought_bill(self):
        self.assertEqual(self.wait_until(7.1), WANTS_BILL)
        self.memory.bill_brought()
        self.assertEqual(self.feed(5, seen()), "OCCUPIED")
        self.assertEqual(self.wait_until(15), "OCCUPIED")

    def test_paid_in_app_stops_bill(self):
        self.orders = OrderInfo(orders=((self.cleared - 100, "COMPLETED"),))
        self.assertNotEqual(self.wait_until(8), WANTS_BILL)

    def test_old_paid_order_from_earlier_guests_is_ignored(self):
        self.orders = OrderInfo(orders=((self.cleared - 6 * 3600, "COMPLETED"), (self.cleared - 100, "SERVED")))
        self.assertEqual(self.wait_until(7.1), WANTS_BILL)

    def test_guests_leave_ends_bill(self):
        self.wait_until(7.1)
        self.feed(int(local_ai.EMPTY_GRACE_SEC) + 10, seen(guests=0))
        self.assertNotEqual(self.memory.last_status, WANTS_BILL)


if __name__ == "__main__":
    unittest.main()
