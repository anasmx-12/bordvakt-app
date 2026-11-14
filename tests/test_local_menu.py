"""Tester för Fota menyn (local_menu.py). Kör: .venv/bin/python -m unittest discover -s tests"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import local_menu  # noqa: E402


def row(text, x, y, h=0.03):
    return {"text": text, "x": x, "y": y, "h": h}


class JoinRowsTest(unittest.TestCase):
    def test_name_and_price_on_same_line(self):
        rows = [row("189 kr", 0.7, 0.301), row("Pasta", 0.1, 0.3), row("Bacon, ägg", 0.1, 0.34, 0.02)]
        self.assertEqual(local_menu.join_rows(rows), "Pasta  189 kr\nBacon, ägg")

    def test_dotted_leaders_are_removed(self):
        self.assertEqual(local_menu.join_rows([row("Lax ........ 229 kr", 0.1, 0.1)]), "Lax  229 kr")


class CleanTest(unittest.TestCase):
    def test_prices_and_empty_rows(self):
        menu = local_menu.clean({"categories": [
            {"name": "Dryck", "items": [{"name": "Öl", "price": "69,50"}, {"name": "", "price": 10}, {"name": "Vin", "price": -5}]},
            {"name": "Tom", "items": []},
        ]})
        self.assertEqual(menu, {"categories": [{"name": "Dryck", "items": [
            {"name": "Öl", "description": "", "price": 69.5}, {"name": "Vin", "description": "", "price": 0.0}]}]})

    def test_garbage(self):
        self.assertEqual(local_menu.clean("hej"), {"categories": []})
        self.assertEqual(local_menu.clean({"categories": [None, {"items": [None]}]}), {"categories": []})


if __name__ == "__main__":
    unittest.main()
