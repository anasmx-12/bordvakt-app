"""Tester för två vanliga felkällor i matsalen:
1. Personal som står framför bordet skymmer tallrikarna en stund. Det är inte avplockning,
   och när tallrikarna syns igen är det inte dessert.
2. Gäster som beställer pekar och lyfter händerna medan servitören står vid bordet.
   Det är inte "Söker kontakt", personalen är redan där.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import Observation, TableMemory  # noqa: E402


def seen(guests=2, dishes=0, standing=0, hand=False):
    return Observation(guests + standing, 2, dishes, hand, standing=standing, seen_persons=guests + standing)


class TableTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        self.memory = TableMemory()
        self.now = 1_000_000.0

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: float, obs: Observation) -> str:
        status = ""
        end = self.now + seconds
        while self.now < end:
            self.now += 2
            status = self.memory.update(obs, self.now)
        return status


class OcclusionTest(TableTest):
    def test_plates_hidden_briefly_is_not_clearing(self):
        self.feed(30, seen())
        self.feed(120, seen(dishes=2))         # maten står på bordet
        self.feed(15, seen())                  # servitören skymmer tallrikarna i 15 s
        self.assertIsNone(self.memory.cleared_since)
        self.feed(30, seen(dishes=2))          # tallrikarna syns igen
        self.assertFalse(self.memory.dessert_done, "skymda tallrikar får inte räknas som dessert")
        self.assertIsNone(self.memory.cleared_at)

    def test_real_clearing_still_suggests_dessert(self):
        self.feed(30, seen())
        self.feed(120, seen(dishes=2))
        cleared_from = self.now
        status = self.feed(local_ai.CLEAR_CONFIRM_SEC + local_ai.DESSERT_DELAY_SEC + 10, seen())
        self.assertEqual(status, "DESSERT_OPPORTUNITY")
        # Avplockningen räknas från när tallrikarna försvann, inte från när den bekräftades
        self.assertLessEqual(self.memory.cleared_at - cleared_from, local_ai.HISTORY_SEC)

    def test_dessert_after_real_clearing_is_still_detected(self):
        self.feed(30, seen())
        self.feed(120, seen(dishes=2))
        self.feed(local_ai.CLEAR_CONFIRM_SEC + 20, seen())  # avplockat på riktigt
        self.feed(20, seen(dishes=2))                        # nya tallrikar = dessert
        self.assertTrue(self.memory.dessert_done)


class StaffAtTableTest(TableTest):
    def test_raised_hand_while_waiter_takes_order_is_not_an_alarm(self):
        self.feed(30, seen())
        status = self.feed(10, seen(standing=1, hand=True))
        self.assertNotEqual(status, "NEEDS_ATTENTION")

    def test_raised_hand_without_staff_is_an_alarm(self):
        self.feed(30, seen())
        status = self.feed(6, seen(hand=True))
        self.assertEqual(status, "NEEDS_ATTENTION")

    def test_alarm_comes_back_when_waiter_leaves(self):
        self.feed(30, seen())
        self.feed(10, seen(standing=1, hand=True))
        status = self.feed(8, seen(hand=True))  # servitören har gått, handen är kvar uppe
        self.assertEqual(status, "NEEDS_ATTENTION")


if __name__ == "__main__":
    unittest.main()
