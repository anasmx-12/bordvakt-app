import unittest

import engine_security as sec


class SecurityTests(unittest.TestCase):
    def test_key_is_per_restaurant(self):
        a = sec.engine_key("service", "r1")
        self.assertNotEqual(a, sec.engine_key("service", "r2"))
        self.assertEqual(sec.engine_key("", "r1"), "")
        self.assertEqual(sec.engine_key("service", None), "")

    def test_ticket(self):
        key = sec.engine_key("service", "r1")
        ticket = sec.make_ticket(key, "r1", now=1000)
        self.assertTrue(sec.ticket_ok(key, "r1", ticket, now=1001))
        self.assertFalse(sec.ticket_ok(key, "r2", ticket, now=1001))  # annan restaurang
        self.assertFalse(sec.ticket_ok(sec.engine_key("service", "r2"), "r1", ticket, now=1001))
        self.assertFalse(sec.ticket_ok(key, "r1", ticket, now=1000 + 7201))  # utgången
        self.assertFalse(sec.ticket_ok(key, "r1", sec.make_ticket(key, "r1", seconds=86400, now=1000), now=1000))
        self.assertFalse(sec.ticket_ok(key, "r1", ticket[:-1] + "0", now=1001))
        self.assertFalse(sec.ticket_ok(key, "r1", "abc.def", now=1001))
        self.assertFalse(sec.ticket_ok("", "r1", ticket, now=1001))

    def test_key_check(self):
        self.assertTrue(sec.key_ok("k", "k"))
        self.assertFalse(sec.key_ok("k", ""))
        self.assertFalse(sec.key_ok("", ""))

    def test_origins(self):
        allowed = sec.parse_origins("https://app.bordvakt.se/, https://bordvakt.se")
        self.assertEqual(sec.allowed_origin("https://app.bordvakt.se", allowed), "https://app.bordvakt.se")
        self.assertIsNone(sec.allowed_origin("https://evil.example", allowed))
        self.assertIsNone(sec.allowed_origin("http://localhost:3000", allowed))
        self.assertEqual(sec.allowed_origin("http://localhost:3000", []), "http://localhost:3000")
        self.assertEqual(sec.allowed_origin("http://192.168.1.5:3000", []), "http://192.168.1.5:3000")
        self.assertIsNone(sec.allowed_origin("http://172.40.1.1", []))
        self.assertIsNone(sec.allowed_origin("https://evil.example", []))
        self.assertIsNone(sec.allowed_origin(None, []))



class CodeTests(unittest.TestCase):
    def test_parse_code(self):
        import base64
        import json

        payload = {"u": "https://x.supabase.co", "a": "anon", "r": "r1", "e": "ai@x", "p": "pw", "k": "key"}
        code = "BV1." + base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        self.assertEqual(sec.parse_code(code), payload)
        self.assertEqual(sec.parse_code("  " + code + "\n"), payload)
        self.assertIsNone(sec.parse_code(""))
        self.assertIsNone(sec.parse_code("BV1.inte-json"))
        broken = dict(payload, p="")
        self.assertIsNone(sec.parse_code("BV1." + base64.urlsafe_b64encode(json.dumps(broken).encode()).decode()))


if __name__ == "__main__":
    unittest.main()
