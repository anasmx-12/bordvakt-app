"""Tester för dåligt ljus: mörka bordsbilder ljusas upp innan AI:n tittar, ljusa lämnas orörda.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_ai  # noqa: E402
from local_ai import brighten  # noqa: E402


def scene(level: float) -> np.ndarray:
    """En bild med lite mönster (som ett bord med saker på), så ljus som level (0–1)."""
    rng = np.random.default_rng(0)
    base = rng.integers(60, 255, (120, 160, 3)).astype(np.float32)
    return np.clip(base * level, 0, 255).astype(np.uint8)


class BrightenTest(unittest.TestCase):
    def test_normal_light_is_untouched(self):
        img = scene(0.9)
        self.assertIs(brighten(img), img)

    def test_dark_table_is_brightened(self):
        img = scene(0.15)
        out = brighten(img)
        self.assertEqual(out.shape, img.shape)
        self.assertGreater(out.mean(), img.mean() * 2)
        self.assertLess(abs(out.mean() / 255 - local_ai.LOW_LIGHT_TARGET), 0.15)

    def test_keeps_dark_and_light_apart(self):
        # Det mörka ska fortfarande vara mörkare än det ljusa (ingen platt grå bild)
        img = np.zeros((40, 40, 3), np.uint8)
        img[:, 20:] = 40
        out = brighten(img)
        self.assertLess(out[:, :15].mean() + 30, out[:, 25:].mean())

    def test_black_image_and_empty_crop(self):
        black = np.zeros((30, 30, 3), np.uint8)
        self.assertEqual(brighten(black).max(), 0)
        empty = np.zeros((0, 0, 3), np.uint8)
        self.assertIs(brighten(empty), empty)


if __name__ == "__main__":
    unittest.main()
