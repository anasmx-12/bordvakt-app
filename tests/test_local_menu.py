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


def box(text, x, y, w, h=0.03):
    return {"text": text, "x": x, "y": y, "w": w, "h": h}


class ColumnsTest(unittest.TestCase):
    """En meny i två spalter läses spalt för spalt, inte rad för rad tvärs över sidan."""

    def test_two_columns(self):
        rows = [box("Bella Napoli", 0.3, 0.02, 0.4),
                box("PIZZOR", 0.07, 0.1, 0.15), box("PASTA", 0.55, 0.1, 0.12),
                box("Margherita 115 kr", 0.07, 0.2, 0.3), box("Carbonara 159 kr", 0.55, 0.2, 0.3),
                box("Hawaii 125 kr", 0.07, 0.3, 0.25), box("Lasagne 149 kr", 0.55, 0.3, 0.25)]
        self.assertEqual(local_menu.layout(rows),
                         "Bella Napoli\nPIZZOR\nMargherita 115 kr\nHawaii 125 kr\nPASTA\nCarbonara 159 kr\nLasagne 149 kr")

    def test_name_and_price_far_apart_is_one_column(self):
        rows = [box("PIZZOR", 0.1, 0.1, 0.15),
                box("Margherita", 0.1, 0.2, 0.2), box("115 kr", 0.8, 0.2, 0.1),
                box("Hawaii", 0.1, 0.3, 0.15), box("125 kr", 0.8, 0.3, 0.1),
                box("Vesuvio", 0.1, 0.4, 0.15), box("120 kr", 0.8, 0.4, 0.1)]
        self.assertEqual(local_menu.layout(rows), "PIZZOR\nMargherita  115 kr\nHawaii  125 kr\nVesuvio  120 kr")

    def test_without_widths_nothing_is_split(self):
        rows = [row("Margherita 115 kr", 0.07, 0.2), row("Carbonara 159 kr", 0.55, 0.2)]
        self.assertEqual(local_menu.layout(rows), "Margherita 115 kr  Carbonara 159 kr")


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


MENU = """PIZZOR
Margherita  115 kr
Tomatsås, mozzarella, basilika
Capricciosa  135 kr
Skinka, champinjoner, kronärtskocka
PASTA
Carbonara  159 kr
Pancetta, ägg, pecorino
DRYCK
Coca-Cola 33 cl  35 kr
Öppet tis-sön 11-22"""


class RulesTest(unittest.TestCase):
    """Vanliga menyer läses med fasta regler (samma svar varje gång), inte av språkmodellen."""

    def test_simple_menu(self):
        menu = local_menu.parse_rules(MENU)
        self.assertEqual([c["name"] for c in menu["categories"]], ["PIZZOR", "PASTA", "DRYCK"])
        self.assertEqual(menu["categories"][0]["items"][1],
                         {"name": "Capricciosa", "description": "Skinka, champinjoner, kronärtskocka", "price": 135.0})
        self.assertEqual(menu["categories"][1]["items"], [{"name": "Carbonara", "description": "Pancetta, ägg, pecorino", "price": 159.0}])
        self.assertEqual(menu["categories"][2]["items"], [{"name": "Coca-Cola 33 cl", "description": "", "price": 35.0}])

    def test_price_formats(self):
        text = "Varmrätter\nLax 229:-\nBiff  kr 289\nSoppa  89,50 kr\nKaffe - 30\nÖl 12.5 €"
        items = local_menu.parse_rules(text)["categories"][0]["items"]
        self.assertEqual([(i["name"], i["price"]) for i in items],
                         [("Lax", 229.0), ("Biff", 289.0), ("Soppa", 89.5), ("Kaffe", 30.0), ("Öl", 12.5)])

    def test_heading_that_is_not_capitals(self):
        text = "Förrätter\nToast Skagen  145 kr\nRäkor, löjrom\nVarmrätter\nSchnitzel  199 kr"
        menu = local_menu.parse_rules(text)
        self.assertEqual([c["name"] for c in menu["categories"]], ["Förrätter", "Varmrätter"])
        self.assertEqual(menu["categories"][0]["items"][0]["description"], "Räkor, löjrom")

    def test_two_line_description(self):
        text = "BURGARE\nCheeseburgare  149 kr\nCheddar, pickles\nserveras med pommes frites\nVegoburgare  139 kr"
        items = local_menu.parse_rules(text)["categories"][0]["items"]
        self.assertEqual(items[0]["description"], "Cheddar, pickles serveras med pommes frites")
        self.assertEqual(len(items), 2)

    def test_skips_contact_lines(self):
        text = "MENY\nPasta  120 kr\nTel 040-12 34 56\nwww.exempel.se\nÖppet alla dagar 11-23\nPizza  110 kr"
        menu = local_menu.parse_rules(text)
        self.assertEqual(menu["categories"][0]["items"], [{"name": "Pasta", "description": "", "price": 120.0}, {"name": "Pizza", "description": "", "price": 110.0}])

    def test_gives_up_on_two_columns(self):
        # Två spalter blir två priser på samma rad: låt språkmodellen ta det
        self.assertIsNone(local_menu.parse_rules("PIZZOR\nMargherita 115 kr  Carbonara 159 kr\nHawaii 125 kr  Lasagne 149 kr"))

    def test_gives_up_on_price_on_its_own_line(self):
        self.assertIsNone(local_menu.parse_rules("PIZZOR\nMargherita\n115 kr\nHawaii\n125 kr"))

    def test_gives_up_when_too_few_dishes(self):
        self.assertIsNone(local_menu.parse_rules("Välkommen!\nDagens lunch  105 kr"))


class DuplicateTest(unittest.TestCase):
    def test_same_dish_twice_is_kept_once(self):
        menu = local_menu.clean({"categories": [
            {"name": "Pizza", "items": [{"name": "Cola", "price": 35}]},
            {"name": "Dryck", "items": [{"name": "cola", "price": 35}, {"name": "Fanta", "price": 35}]},
        ]})
        self.assertEqual([[i["name"] for i in c["items"]] for c in menu["categories"]], [["Cola"], ["Fanta"]])


if __name__ == "__main__":
    unittest.main()
