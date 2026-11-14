"""Tester för Akut läge (SOS): kameran ska larma när en gäst tappar ett glas,
en tallrik eller bestick, eller välter ett glas, men inte när personalen
plockar undan eller en gäst skymmer.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import EMERGENCY, Observation, TableMemory  # noqa: E402

GLASS = ("drink", (100, 100, 120, 130))     # upprätt glas: högre än brett
PLATE = ("food", (150, 100, 200, 130))
FORK = ("cutlery", (210, 100, 216, 130))
TIPPED = ("drink", (95, 116, 130, 130))     # samma glas liggande: bredare än högt
GUEST = (40, 60, 90, 200)        # sittande gäst till vänster (skymmer inte)
OVER_GLASS = (80, 40, 140, 220)  # en person som står framför glaset
STAFF = (130, 20, 180, 220)
FLOOR_GLASS = ("drink", (100, 220, 120, 250))

SET = (GLASS, PLATE, FORK)  # dukat bord med mat


def obs(items=SET, persons=1, standing=0, bending=False, people=(GUEST,), floor=()):
    drinks = sum(1 for kind, _ in items if kind == "drink")
    dishes = sum(1 for kind, _ in items if kind == "food")
    return Observation(persons, drinks, dishes, False, standing=standing,
                       people=people, seen_persons=persons, items=tuple(items),
                       bending=bending, floor_items=tuple(floor))


def without(*gone):
    return tuple(i for i in SET if i not in gone)


class SosTest(unittest.TestCase):
    def run_table(self, steps, strict=()):
        """steps = observationer, en per sekund. Returnerar minnet, statusarna och tiden."""
        memory = TableMemory()
        memory.watch.strict = set(strict)
        t = 1000.0
        # En gäst har suttit vid bordet med glas, tallrik och gaffel en stund
        for _ in range(30):
            memory.update(obs(), t)
            t += 1
        statuses = []
        for o in steps:
            statuses.append(memory.update(o, t))
            t += 1
        return memory, statuses, t

    # --- Tappat glas eller tallrik

    def test_glass_falls_and_guest_bends_down(self):
        memory, statuses, _ = self.run_table(
            [obs(without(GLASS)), obs(without(GLASS), bending=True), obs(without(GLASS))])
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual((memory.sos.kind, memory.sos.trigger), ("drink", "bend"))

    def test_glass_falls_and_guest_stands_up(self):
        memory, statuses, _ = self.run_table([obs(without(GLASS), standing=1)] * 2)
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual(memory.sos.trigger, "stand")

    def test_glass_seen_on_floor(self):
        memory, statuses, _ = self.run_table([obs(without(GLASS), floor=(FLOOR_GLASS,)), obs(without(GLASS))])
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual(memory.sos.trigger, "floor")

    def test_plate_with_food_is_food(self):
        memory, statuses, _ = self.run_table([obs(without(PLATE)), obs(without(PLATE), bending=True)])
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual(memory.sos.kind, "food")

    def test_glass_gone_without_reaction_is_no_alarm(self):
        # Gästen sitter kvar lugnt: t.ex. modellen tappade bort glaset en stund
        _, statuses, _ = self.run_table([obs(without(GLASS))] * 6)
        self.assertNotIn(EMERGENCY, statuses)

    def test_staff_clears_glass_is_no_alarm(self):
        # En servitör kommer fram (en person till, står) och tar glaset
        staff = (GUEST, STAFF)
        _, statuses, _ = self.run_table(
            [obs(persons=2, standing=1, people=staff)]
            + [obs(without(GLASS), persons=2, standing=1, people=staff)] * 3
            + [obs(without(GLASS))] * 3
        )
        self.assertNotIn(EMERGENCY, statuses)

    def test_guest_standing_in_front_of_glass_is_no_alarm(self):
        # Gästen reser sig och skymmer glaset: det är inte borta
        _, statuses, _ = self.run_table([obs(without(GLASS), standing=1, people=(OVER_GLASS,))] * 4)
        self.assertNotIn(EMERGENCY, statuses)

    # --- Vält glas

    def test_tipped_glass(self):
        memory, statuses, _ = self.run_table([obs(without(GLASS) + (TIPPED,))] * 3)
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual((memory.sos.kind, memory.sos.trigger), ("spill", "tipped"))

    def test_tipped_glass_needs_two_images(self):
        _, statuses, _ = self.run_table([obs(without(GLASS) + (TIPPED,)), obs()])
        self.assertNotIn(EMERGENCY, statuses)

    def test_staff_holding_glass_sideways_is_no_alarm(self):
        staff = (GUEST, STAFF)
        _, statuses, _ = self.run_table([obs(without(GLASS) + (TIPPED,), persons=2, standing=1, people=staff)] * 3)
        self.assertNotIn(EMERGENCY, statuses)

    def test_glass_seen_from_above_is_not_checked(self):
        # Rakt uppifrån är glaset runt (lika brett som högt): vält eller inte går inte att se
        round_glass, flat = ("drink", (100, 100, 125, 125)), ("drink", (95, 110, 130, 125))
        memory = TableMemory()
        t = 1000.0
        for _ in range(30):
            memory.update(obs((round_glass, PLATE)), t)
            t += 1
        statuses = [memory.update(obs((flat, PLATE)), t + i) for i in range(3)]
        self.assertNotIn(EMERGENCY, statuses)

    # --- Bestick

    def test_fork_falls_and_guest_bends_down(self):
        memory, statuses, _ = self.run_table([obs(without(FORK)), obs(without(FORK), bending=True)])
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual(memory.sos.kind, "cutlery")

    def test_fork_gone_when_guest_stands_is_no_alarm(self):
        # Bestick flyttas hela tiden: att gästen bara reser sig räcker inte
        _, statuses, _ = self.run_table([obs(without(FORK), standing=1)] * 4)
        self.assertNotIn(EMERGENCY, statuses)

    # --- Falsklarm gör AI:n försiktigare

    def test_strict_trigger_needs_one_more_sign(self):
        _, statuses, _ = self.run_table([obs(without(GLASS)), obs(without(GLASS), bending=True)], strict={"bend"})
        self.assertNotIn(EMERGENCY, statuses)

    def test_strict_trigger_with_extra_sign(self):
        memory, statuses, _ = self.run_table(
            [obs(without(GLASS)), obs(without(GLASS), bending=True, floor=(FLOOR_GLASS,))], strict={"bend"})
        self.assertIn(EMERGENCY, statuses)
        self.assertEqual(memory.sos.trigger, "floor")

    def test_other_triggers_still_work_when_one_is_strict(self):
        _, statuses, _ = self.run_table([obs(without(GLASS), standing=1)] * 2, strict={"bend"})
        self.assertIn(EMERGENCY, statuses)

    # --- Klar

    def test_sos_stays_until_staff_marks_done(self):
        memory, statuses, t = self.run_table(
            [obs(without(GLASS)), obs(without(GLASS), bending=True), obs(without(GLASS))]
            + [obs(without(GLASS))] * 30   # allt lugnt igen
            + [obs(items=(), persons=0, people=())] * 120  # gästerna har gått
        )
        self.assertEqual(statuses[-1], EMERGENCY)
        memory.clear_emergency(t)
        self.assertNotEqual(memory.update(obs(items=(), persons=0, people=()), t + 1), EMERGENCY)

    def test_no_new_alarm_right_after_done(self):
        memory, _, t = self.run_table([obs(without(GLASS)), obs(without(GLASS), bending=True)])
        memory.clear_emergency(t)
        # Personalen har torkat upp; strax efter försvinner tallriken när gästen böjer sig
        for i in range(10):
            status = memory.update(obs(without(GLASS, PLATE) if i > 3 else without(GLASS), bending=i > 4), t + 1 + i)
        self.assertNotEqual(status, EMERGENCY)

    def test_turned_off(self):
        old = local_ai.SOS_DETECTION
        local_ai.SOS_DETECTION = False
        try:
            _, statuses, _ = self.run_table([obs(without(GLASS)), obs(without(GLASS), bending=True)])
        finally:
            local_ai.SOS_DETECTION = old
        self.assertNotIn(EMERGENCY, statuses)


class StrictnessTest(unittest.TestCase):
    def test_two_false_alarms_without_real_one(self):
        rows = [{"table_id": "a", "sos_trigger": "bend", "false_alarm": True}] * 2
        self.assertEqual(local_ai.strict_triggers(rows), {"a": {"bend"}})

    def test_one_real_accident_keeps_trigger(self):
        rows = [{"table_id": "a", "sos_trigger": "bend", "false_alarm": True}] * 2 \
            + [{"table_id": "a", "sos_trigger": "bend", "false_alarm": False}]
        self.assertEqual(local_ai.strict_triggers(rows), {})

    def test_one_false_alarm_is_not_enough(self):
        rows = [{"table_id": "a", "sos_trigger": "stand", "false_alarm": True}]
        self.assertEqual(local_ai.strict_triggers(rows), {})


class BendingTest(unittest.TestCase):
    def kp(self, nose_y):
        import numpy as np
        kp = np.zeros((17, 3))
        kp[:, 2] = 1.0
        kp[local_ai.NOSE] = (50, nose_y, 1)
        kp[local_ai.L_SHOULDER] = (40, 100, 1)
        kp[local_ai.R_SHOULDER] = (60, 100, 1)
        return kp

    def test_head_below_shoulders(self):
        self.assertTrue(local_ai.bending_down(self.kp(nose_y=115)))

    def test_upright(self):
        self.assertFalse(local_ai.bending_down(self.kp(nose_y=80)))


if __name__ == "__main__":
    unittest.main()
