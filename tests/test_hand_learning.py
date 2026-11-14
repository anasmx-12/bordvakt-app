"""Tester för Vill ha hjälp som lär sig av personalens Falsklarm: vid bord där en uppräckt hand
ofta larmat fel (gäster som kliar sig i håret, sträcker på sig) ska handen vara uppe längre.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import Observation, TableMemory, careful_hand_tables  # noqa: E402


def service(table: str, false_alarm: bool) -> dict:
    return {"table_id": table, "type": "SERVICE", "false_alarm": false_alarm}


class CarefulTablesTest(unittest.TestCase):
    def test_two_false_alarms_make_a_table_careful(self):
        rows = [service("A", True), service("A", True), service("B", True)]
        self.assertEqual(careful_hand_tables(rows), {"A"})

    def test_real_calls_outweigh_false_alarms(self):
        rows = [service("A", True), service("A", True), service("A", False), service("A", False), service("A", False)]
        self.assertEqual(careful_hand_tables(rows), set())

    def test_other_task_types_do_not_count(self):
        rows = [{"table_id": "A", "type": "EMERGENCY", "false_alarm": True}] * 3
        self.assertEqual(careful_hand_tables(rows), set())


def guest(hand: bool) -> Observation:
    return Observation(2, 2, 0, hand, seen_persons=2)


class HandRaiseTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        self.memory = TableMemory()
        self.now = 1_000_000.0
        self.feed(60, hand=False)  # gästerna har satt sig

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: float, hand: bool, step: float = 0.5) -> list[str]:
        statuses = []
        end = self.now + seconds
        while self.now < end:
            self.now += step
            statuses.append(self.memory.update(guest(hand), self.now))
        return statuses

    def test_normal_table_calls_after_a_short_raise(self):
        self.assertIn("NEEDS_ATTENTION", self.feed(2, hand=True))

    def test_careful_table_ignores_a_short_raise(self):
        self.memory.careful_hand = True
        self.assertNotIn("NEEDS_ATTENTION", self.feed(2, hand=True))
        self.assertNotIn("NEEDS_ATTENTION", self.feed(3, hand=False))

    def test_careful_table_still_calls_when_the_hand_stays_up(self):
        self.memory.careful_hand = True
        self.assertIn("NEEDS_ATTENTION", self.feed(5, hand=True))

    def test_set_careful_reaches_each_table(self):
        ai = local_ai.LocalTableAI.__new__(local_ai.LocalTableAI)
        ai.memory = {"A": TableMemory(), "B": TableMemory()}
        ai.set_careful_hands({"A", "C"})
        self.assertTrue(ai.memory["A"].careful_hand)
        self.assertFalse(ai.memory["B"].careful_hand)
        self.assertTrue(ai.memory["C"].careful_hand)  # bord som inte analyserats än


if __name__ == "__main__":
    unittest.main()
