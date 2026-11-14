"""Tester för sittningsloggen som statistiken bygger på.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import Observation, TableMemory  # noqa: E402


def seen(guests=2):
    return Observation(guests, 2, 0, False, standing=0, seen_persons=guests)


class SessionLogTest(unittest.TestCase):
    def setUp(self):
        self._sos = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        self.memory = TableMemory()
        self.now = 1_000_000.0

    def tearDown(self):
        local_ai.SOS_DETECTION = self._sos

    def feed(self, seconds: int, observation: Observation):
        for _ in range(seconds):
            self.now += 1
            self.memory.update(observation, self.now)

    def test_finished_sitting_is_logged_with_most_guests(self):
        self.feed(60, seen(2))
        start = self.memory.session_start
        self.feed(20 * 60, seen(4))
        self.feed(int(local_ai.EMPTY_GRACE_SEC) + 30, seen(0))
        self.assertEqual(len(self.memory.finished), 1)
        began, ended, guests = self.memory.finished[0]
        self.assertEqual(began, start)
        self.assertEqual(guests, 4)
        self.assertGreater(ended - began, 20 * 60)

    def test_short_visit_is_not_a_sitting(self):
        self.feed(60, seen(1))
        self.feed(int(local_ai.EMPTY_GRACE_SEC) + 30, seen(0))
        self.assertEqual(self.memory.finished, [])

    def test_drain_empties_the_log(self):
        ai = local_ai.LocalTableAI.__new__(local_ai.LocalTableAI)
        ai.memory = {"t1": self.memory}
        self.memory.finished.append((1.0, 2000.0, 3))
        self.assertEqual(ai.drain_sessions(), [("t1", 1.0, 2000.0, 3)])
        self.assertEqual(ai.drain_sessions(), [])


if __name__ == "__main__":
    unittest.main()
