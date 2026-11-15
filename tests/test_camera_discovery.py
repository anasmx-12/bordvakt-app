"""Tester för kameraguiden (camera_discovery.py). Kör: .venv/bin/python -m unittest discover -s tests"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import camera_discovery as cd  # noqa: E402


class BrandFromTextTest(unittest.TestCase):
    def test_hikvision_model(self):
        self.assertEqual(cd.brand_from_text("Model: DS-2CD2143G2-I\nS/N 123"), ("hikvision", "DS-2CD2143G2-I"))

    def test_ocr_dash_and_case(self):
        self.assertEqual(cd.brand_from_text("ds–2cd2043g0-i")[0], "hikvision")

    def test_dahua(self):
        self.assertEqual(cd.brand_from_text("IPC-HFW2431S-S-S2"), ("dahua", "IPC-HFW2431S-S-S2"))

    def test_reolink(self):
        self.assertEqual(cd.brand_from_text("Reolink RLC-510A"), ("reolink", "RLC-510A"))

    def test_unknown(self):
        self.assertEqual(cd.brand_from_text("Made in China"), (None, None))

    def test_other_brands(self):
        cases = {
            "AXIS M3106-L Mk II": "axis",
            "UVC-G4-Bullet": "unifi",
            "Tapo C310": "tplink",
            "VIGI C340": "tplink",
            "XNV-6080": "hanwha",
            "QNV-8080R": "hanwha",
            "PNM-9000VQ": "hanwha",
            "IPC322LB-SF28-A": "uniview",
            "IP8M-2496EB": "amcrest",
            "FI9900P": "foscam",
        }
        for text, brand in cases.items():
            with self.subTest(text=text):
                self.assertEqual(cd.brand_from_text(text)[0], brand)


class PrivateIpTest(unittest.TestCase):
    def test_private(self):
        for ip in ["192.168.1.64", "10.0.0.5", "172.16.3.4", "127.0.0.1"]:
            with self.subTest(ip=ip):
                self.assertTrue(cd.is_private_ip(ip))

    def test_public_and_names(self):
        for ip in ["8.8.8.8", "172.32.0.1", "camera.local", "", "192.168.1.64:554", "::1x", "100.64.0.1", "169.254.1.1"]:
            with self.subTest(ip=ip):
                self.assertFalse(cd.is_private_ip(ip))


class RtspUrlTest(unittest.TestCase):
    def test_hikvision_channel_2(self):
        self.assertEqual(cd.rtsp_url("192.168.1.64", "hikvision", "admin", "pw", 2),
                         "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/201")

    def test_password_is_encoded(self):
        self.assertEqual(cd.rtsp_url("10.0.0.2", "tplink", "admin", "a@b:c/d#", 1),
                         "rtsp://admin:a%40b%3Ac%2Fd%23@10.0.0.2:554/stream1")

    def test_foscam_port(self):
        self.assertIn(":88/videoMain", cd.rtsp_url("10.0.0.3", "foscam", "admin", "x"))

    def test_unknown_brand(self):
        self.assertIsNone(cd.rtsp_url("10.0.0.3", "other", "admin", "x"))


PROBE_MATCH = """<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Body><d:ProbeMatches><d:ProbeMatch>
 <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/hardware/DS-2CD2143G2-I
 onvif://www.onvif.org/name/HIKVISION</d:Scopes>
 <d:XAddrs>http://[fe80::1]/onvif/device_service http://192.168.1.64/onvif/device_service</d:XAddrs>
 </d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>"""


class ProbeMatchTest(unittest.TestCase):
    def test_parses_ip_url_brand_model(self):
        self.assertEqual(cd.parse_probe_match(PROBE_MATCH), {
            "ip": "192.168.1.64", "onvif_url": "http://192.168.1.64/onvif/device_service",
            "brand": "hikvision", "model": "DS-2CD2143G2-I"})

    def test_garbage(self):
        self.assertIsNone(cd.parse_probe_match("<not xml"))

    def test_probe_is_for_video_devices(self):
        self.assertIn("NetworkVideoTransmitter", cd.PROBE)


class DiscoverTest(unittest.TestCase):
    def test_merges_onvif_and_port_scan(self):
        found = cd.discover(
            probe=lambda t: [{"ip": "192.168.1.64", "onvif_url": "http://192.168.1.64/onvif/device_service", "brand": "hikvision", "model": "X"}],
            scan=lambda: {"192.168.1.64": [554, 80], "192.168.1.80": [554]})
        self.assertEqual([d["ip"] for d in found], ["192.168.1.64", "192.168.1.80"])
        self.assertEqual(found[0]["ports"], [80, 554])
        self.assertIsNone(found[1]["onvif_url"])

    def test_hosts_with_only_port_80_are_dropped(self):
        # en skrivare eller router är ingen kamera: utan ONVIF krävs port 554
        self.assertEqual(cd.discover(probe=lambda t: [], scan=lambda: {"192.168.1.1": [80]}), [])

    def test_sorted_numerically(self):
        found = cd.discover(probe=lambda t: [], scan=lambda: {"192.168.1.100": [554], "192.168.1.9": [554]})
        self.assertEqual([d["ip"] for d in found], ["192.168.1.9", "192.168.1.100"])


if __name__ == "__main__":
    unittest.main()
