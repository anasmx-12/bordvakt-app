"""Tester för det AI:n lär sig av restaurangen: hur länge gästerna sitter efter maten (notan),
var och när gästerna beställer dessert, och rusning (larma tidigare om maten dröjer).

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import (  # noqa: E402
    WANTS_BILL,
    LocalTableAI,
    Observation,
    OrderInfo,
    TableMemory,
    learn_bill_delay,
    learn_dessert,
)

BASE = datetime(2026, 11, 2, 18, 0).astimezone()  # lokal tid, kl. 18


def at(minutes: float) -> str:
    return (BASE + timedelta(minutes=minutes)).isoformat()


# ------------------------------------------------------------ Notan

def sitting(delay_min: float) -> dict:
    return {"cleared_at": at(0), "bill_at": at(delay_min)}


class LearnBillDelayTest(unittest.TestCase):
    def test_median_minus_a_minute(self):
        rows = [sitting(m) for m in (10, 11, 12, 12, 13, 13, 14, 15, 30, 40)]
        self.assertEqual(learn_bill_delay(rows), 12)  # median 13 − 1 minut

    def test_needs_ten_sittings(self):
        self.assertIsNone(learn_bill_delay([sitting(12)] * 9))

    def test_stays_within_limits(self):
        self.assertEqual(learn_bill_delay([sitting(1.5)] * 10), 3)
        self.assertEqual(learn_bill_delay([sitting(45)] * 10), 20)

    def test_skips_broken_rows(self):
        rows = [sitting(12)] * 10 + [{"cleared_at": at(0), "bill_at": at(-5)}, {"cleared_at": None, "bill_at": at(3)},
                                     {"cleared_at": at(0), "bill_at": at(300)}]
        self.assertEqual(learn_bill_delay(rows), 11)


def seen(dishes=0):
    return Observation(2, 2, dishes, False, seen_persons=2)


class TableTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        self.memory = TableMemory()
        self.now = 1_000_000.0

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: float, obs: Observation, orders: OrderInfo | None = None) -> str:
        status = ""
        end = self.now + seconds
        while self.now < end:
            self.now += 2
            status = self.memory.update(obs, self.now, orders)
        return status

    def eat_and_clear(self):
        self.feed(30, seen())
        self.feed(120, seen(dishes=2))
        self.feed(10, seen())  # tallrikarna är bortplockade


class BillDelayTest(TableTest):
    def test_learned_delay_replaces_the_fixed_seven_minutes(self):
        self.memory.bill_delay_min = 12
        self.memory.dessert_done = True  # bara notan testas
        self.eat_and_clear()
        self.assertNotEqual(self.feed(9 * 60, seen()), WANTS_BILL)
        self.assertEqual(self.feed(4 * 60, seen()), WANTS_BILL)

    def test_sitting_remembers_clearing_and_bill(self):
        self.eat_and_clear()
        cleared = self.memory.cleared_at
        self.assertIsNotNone(cleared)
        self.feed(60, seen())
        self.memory.bill_brought()
        bill = self.memory.bill_at
        self.assertIsNotNone(bill)
        self.feed(5 * 60, Observation(0, 2, 0, False))  # gästerna går
        start, end, guests, c, b = self.memory.finished[-1]
        self.assertEqual((c, b), (cleared, bill))

    def test_paying_in_the_app_counts_as_the_bill(self):
        self.eat_and_clear()
        orders = OrderInfo(orders=((self.now - 120, "COMPLETED"),), served_at=self.now - 60)
        self.feed(30, seen(), orders)
        self.assertIsNotNone(self.memory.bill_at)


# ------------------------------------------------------------ Dessert

def order(table: str, minutes: float, served_after: float | None = 15) -> dict:
    served = at(minutes + served_after) if served_after is not None else None
    return {"table_id": table, "created_at": at(minutes), "served_at": served, "status": "SERVED"}


def sessions(table: str, count: int, with_dessert: int, day_offset_min: float = 0) -> list[dict]:
    rows = []
    for i in range(count):
        start = day_offset_min + i * 24 * 60  # en sittning per dag
        rows.append(order(table, start))
        if i < with_dessert:
            rows.append(order(table, start + 50))  # något mer efter huvudrätten
    return rows


class LearnDessertTest(unittest.TestCase):
    def test_table_where_nobody_orders_dessert(self):
        rows = sessions("A", 12, 0) + sessions("B", 12, 6)
        low_tables, _ = learn_dessert(rows)
        self.assertEqual(low_tables, {"A"})

    def test_needs_enough_sittings(self):
        low_tables, low_hours = learn_dessert(sessions("A", 11, 0))
        self.assertEqual((low_tables, low_hours), (set(), set()))

    def test_hours_when_nobody_orders_dessert(self):
        # Lunch kl. 12 (ingen dessert) på flera bord, middag kl. 18 med dessert
        rows = []
        for table in "ABC":
            rows += sessions(table, 6, 0, day_offset_min=-6 * 60)  # kl. 12
            rows += sessions(table, 6, 4)                          # kl. 18
        _, low_hours = learn_dessert(rows)
        self.assertIn(12 // 2, low_hours)
        self.assertNotIn(18 // 2, low_hours)

    def test_one_long_order_is_one_sitting(self):
        rows = [order("A", 0), order("A", 5)]  # två beställningar innan maten kom: ingen dessert
        rows = rows * 1 + sessions("A", 11, 0, day_offset_min=24 * 60)
        low_tables, _ = learn_dessert(rows)
        self.assertEqual(low_tables, {"A"})


class NoDessertTest(TableTest):
    def test_no_dessert_table_is_not_offered_dessert(self):
        self.memory.no_dessert = True
        self.eat_and_clear()
        self.assertNotEqual(self.feed(3 * 60, seen()), "DESSERT_OPPORTUNITY")

    def test_normal_table_is_offered_dessert(self):
        self.eat_and_clear()
        self.assertEqual(self.feed(local_ai.DESSERT_DELAY_SEC + 10, seen()), "DESSERT_OPPORTUNITY")


# ------------------------------------------------------------ Rusning

class RushTest(TableTest):
    def test_food_alarm_comes_earlier_in_a_rush(self):
        self.feed(30, seen())
        ordered = self.now
        orders = OrderInfo(waiting_since=ordered, food_deadline=ordered + 20 * 60)
        self.memory.rush = True
        self.assertEqual(self.feed(16 * 60, orders=orders, obs=seen()), "OCCUPIED")
        self.assertEqual(self.feed(2 * 60, orders=orders, obs=seen()), "AWAITING_FOOD")

    def test_fixed_wait_is_shorter_in_a_rush(self):
        self.memory.rush = True
        self.assertEqual(self.feed((local_ai.FOOD_WAIT_MIN - local_ai.RUSH_EARLIER_MIN) * 60 + 40, seen()), "AWAITING_FOOD")

    def test_rush_when_most_tables_have_guests(self):
        ai = LocalTableAI.__new__(LocalTableAI)
        ai.memory = {str(i): TableMemory() for i in range(5)}
        for i in range(3):
            ai.memory[str(i)].session_start = 1.0
        ai.update_rush()
        self.assertFalse(ai.memory["0"].rush)  # 3 av 5 = 60 %
        ai.memory["3"].session_start = 1.0
        ai.update_rush()
        self.assertTrue(all(m.rush for m in ai.memory.values()))  # 4 av 5 = 80 %

    def test_two_small_tables_are_not_a_rush(self):
        ai = LocalTableAI.__new__(LocalTableAI)
        ai.memory = {"a": TableMemory(), "b": TableMemory()}
        for m in ai.memory.values():
            m.session_start = 1.0
        ai.update_rush()
        self.assertFalse(ai.memory["a"].rush)


# ------------------------------------------------------------ Det AI:n har lärt sig (för ägaren)

class SummaryTest(unittest.TestCase):
    def test_summary_for_the_owner(self):
        out = local_ai.learned_summary(
            prep={"pizza": 12.04, "lasagne": 21.5}, bill_delay=11.0, low_dessert=({"t2", "t1"}, {6, 9}),
            careful={"t3"}, strict={"t4": {"bend", "floor"}, "t5": set()}, rush=True)
        self.assertEqual(out["prep"], [{"dish": "lasagne", "minutes": 21.5}, {"dish": "pizza", "minutes": 12.0}])
        self.assertEqual(out["bill_delay_min"], 11.0)
        self.assertEqual(out["dessert_off_tables"], ["t1", "t2"])
        self.assertEqual(out["dessert_off_hours"], [12, 18])
        self.assertEqual(out["careful_tables"], ["t3"])
        self.assertEqual(out["strict_tables"], {"t4": ["bend", "floor"]})
        self.assertTrue(out["rush"])

    def test_nothing_learned_yet(self):
        out = local_ai.learned_summary({}, None, (set(), set()), set(), {}, False)
        self.assertEqual((out["prep"], out["bill_delay_min"], out["careful_tables"]), ([], None, []))
        self.assertEqual(out["bill_default_min"], local_ai.BILL_DELAY_MIN)


if __name__ == "__main__":
    unittest.main()
