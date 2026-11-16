"""Tester för automatisk koppling: AI-datorn kopplar om sig själv när kopplingskoden
inte längre godtas, och sparar den nya koden i .env utan att röra annat i filen.

Kör: .venv/bin/python -m unittest discover -s tests
"""

import os
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import engine_pairing  # noqa: E402


class SaveCodeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.env = os.path.join(self.dir, ".env")

    def test_replaces_old_code_and_keeps_other_settings(self):
        with open(self.env, "w") as f:
            f.write(
                "CAMERA_URL=rtsp://kamera\n"
                "SUPABASE_SERVICE_KEY=gammal\n"
                "RESTAURANT_ID=123\n"
                "\n# Kopplingskoden (Inställningar → AI-datorn). Hemlig: dela den inte.\n"
                "ENGINE_CODE=BV1.gammal\n"
                "STREAM_PORT=8080\n"
            )
        engine_pairing.save_code("BV1.ny", self.env)
        text = open(self.env).read()
        self.assertIn("CAMERA_URL=rtsp://kamera\n", text)
        self.assertIn("STREAM_PORT=8080\n", text)
        self.assertIn("ENGINE_CODE=BV1.ny\n", text)
        self.assertNotIn("BV1.gammal", text)
        self.assertNotIn("SUPABASE_SERVICE_KEY", text)
        self.assertNotIn("RESTAURANT_ID", text)
        self.assertEqual(text.count("Kopplingskoden (Inställningar"), 1)

    def test_creates_file_readable_only_by_owner(self):
        engine_pairing.save_code("BV1.ny", self.env)
        self.assertEqual(open(self.env).read().strip().splitlines()[-1], "ENGINE_CODE=BV1.ny")
        self.assertEqual(stat.S_IMODE(os.stat(self.env).st_mode), 0o600)


class WebUrlTest(unittest.TestCase):
    def test_prefers_address_from_old_code(self):
        url = engine_pairing.web_url({"w": "https://app.exempel.se/, https://annan.se"})
        self.assertEqual(url, "https://app.exempel.se")

    def test_env_variable_is_used_without_old_code(self):
        with mock.patch.dict(os.environ, {"BORDVAKT_WEB_URL": "https://test.bordvakt.se/"}):
            self.assertEqual(engine_pairing.web_url(None), "https://test.bordvakt.se")


class PairTest(unittest.TestCase):
    """pair() ber om en kod, väntar på godkännande och returnerar den nya kopplingskoden."""

    def test_returns_code_when_owner_approves(self):
        valid = "BV1.giltig"
        replies = iter([
            {"code": "ABC-DEFG", "device": "hemlig", "interval": 0, "expires_in": 600},
            {"status": "pending"},
            {"status": "approved", "code": valid, "restaurant": "Testkrogen"},
        ])
        with mock.patch.object(engine_pairing, "_post", side_effect=lambda *a, **k: next(replies)), \
             mock.patch.object(engine_pairing, "_show_code", return_value=None), \
             mock.patch.object(engine_pairing.sec, "parse_code", side_effect=lambda c: {"ok": 1} if c == valid else None), \
             mock.patch.object(engine_pairing.time, "sleep"), \
             mock.patch.object(engine_pairing, "web_url", return_value="http://test"):
            self.assertEqual(engine_pairing.pair(), valid)

    def test_retries_when_web_app_is_unreachable(self):
        valid = "BV1.giltig"
        calls = {"n": 0}

        def post(url, body, timeout=15):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("nätet är nere")
            if url.endswith("/start"):
                return {"code": "ABC-DEFG", "device": "hemlig", "interval": 0, "expires_in": 600}
            return {"status": "approved", "code": valid}

        with mock.patch.object(engine_pairing, "_post", side_effect=post), \
             mock.patch.object(engine_pairing, "_show_code", return_value=None), \
             mock.patch.object(engine_pairing.sec, "parse_code", side_effect=lambda c: {"ok": 1} if c == valid else None), \
             mock.patch.object(engine_pairing.time, "sleep"), \
             mock.patch.object(engine_pairing, "web_url", return_value="http://test"):
            self.assertEqual(engine_pairing.pair(), valid)


if __name__ == "__main__":
    unittest.main()
