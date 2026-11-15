"""Tester för kameraguiden (camera_discovery.py). Kör: .venv/bin/python -m unittest discover -s tests"""

import base64
import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import camera_discovery as cd  # noqa: E402
import local_ai  # noqa: E402


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


ENV = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body>{}</s:Body></s:Envelope>'
DEVICE_INFO_XML = ENV.format("<tds:GetDeviceInformationResponse><tds:Manufacturer>HIKVISION</tds:Manufacturer>"
                             "<tds:Model>DS-2CD2143G2-I</tds:Model></tds:GetDeviceInformationResponse>")
CAPABILITIES_XML = ENV.format("<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>"
                              "http://192.168.1.64/onvif/Media</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>")
def profile(token, source, width):
    return (f'<trt:Profiles token="{token}"><tt:VideoSourceConfiguration><tt:SourceToken>{source}</tt:SourceToken>'
            f'</tt:VideoSourceConfiguration><tt:VideoEncoderConfiguration><tt:Resolution><tt:Width>{width}</tt:Width>'
            f'<tt:Height>{width * 9 // 16}</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>')


# En kamera: huvudström och delström från samma videokälla
PROFILES_XML_TWO = ENV.format("<trt:GetProfilesResponse>" + profile("Profile_2", "VideoSource_1", 640)
                              + profile("Profile_1", "VideoSource_1", 2560) + "</trt:GetProfilesResponse>")
# En inspelare: två kameror (två videokällor)
PROFILES_XML_NVR = ENV.format("<trt:GetProfilesResponse>" + profile("A", "VideoSource_1", 1920)
                              + profile("B", "VideoSource_2", 1920) + "</trt:GetProfilesResponse>")
STREAM_URI_XML = ENV.format("<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://192.168.1.64:554/Streaming/Channels/101"
                            "</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>")


class WsseTest(unittest.TestCase):
    def test_digest_matches_onvif_spec(self):
        h = cd.wsse_header("admin", "12345", b"\x00" * 16, "2026-11-15T10:00:00Z")
        expected = base64.b64encode(hashlib.sha1(b"\x00" * 16 + b"2026-11-15T10:00:00Z12345").digest()).decode()
        self.assertIn(expected, h)
        self.assertIn("<wsse:Username>admin</wsse:Username>", h)

    def test_xml_special_chars_in_user_are_escaped(self):
        self.assertNotIn("<&", cd.wsse_header("<&", "pw", b"\x01" * 16, "2026-11-15T10:00:00Z"))


class OnvifParseTest(unittest.TestCase):
    def test_device_info(self):
        self.assertEqual(cd.parse_device_info(DEVICE_INFO_XML), ("HIKVISION", "DS-2CD2143G2-I"))

    def test_profiles_best_per_source(self):
        self.assertEqual(cd.parse_profiles(PROFILES_XML_TWO), ["Profile_1"])

    def test_profiles_nvr(self):
        self.assertEqual(cd.parse_profiles(PROFILES_XML_NVR), ["A", "B"])

    def test_stream_uri(self):
        self.assertEqual(cd.parse_stream_uri(STREAM_URI_XML), "rtsp://192.168.1.64:554/Streaming/Channels/101")

    def test_with_credentials_replaces_existing(self):
        self.assertEqual(cd.with_credentials("rtsp://old:x@10.0.0.2:554/a?b=1", "admin", "p@ss"),
                         "rtsp://admin:p%40ss@10.0.0.2:554/a?b=1")


class OnvifStreamsTest(unittest.TestCase):
    def post(self, uris, profiles=PROFILES_XML_NVR):
        replies = {"GetDeviceInformation": DEVICE_INFO_XML, "GetCapabilities": CAPABILITIES_XML, "GetProfiles": profiles}
        calls = iter(uris)

        def post(url, body):
            if "GetStreamUri" in body:
                return 200, ENV.format(f"<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>{next(calls)}</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>")
            return 200, next(v for k, v in replies.items() if k in body)
        return post

    def test_streams_and_model(self):
        info, urls = cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "p@ss",
                                      post=self.post(["rtsp://192.168.1.64:554/Streaming/Channels/101",
                                                      "rtsp://192.168.1.64:554/Streaming/Channels/201"]))
        self.assertEqual(info, {"brand": "hikvision", "model": "DS-2CD2143G2-I"})
        self.assertEqual(urls[0], "rtsp://admin:p%40ss@192.168.1.64:554/Streaming/Channels/101")
        self.assertEqual(len(urls), 2)

    def test_duplicate_paths_counted_once(self):
        same = "rtsp://192.168.1.64:554/Streaming/Channels/101"
        _, urls = cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "pw", post=self.post([same, same]))
        self.assertEqual(len(urls), 1)

    def test_wrong_password(self):
        with self.assertRaises(cd.AuthError):
            cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "x", post=lambda u, b: (401, ""))

    def test_media_address_on_other_host_is_ignored(self):
        evil = ENV.format("<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>"
                          "http://203.0.113.9/onvif/Media</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>")
        hosts = []

        def post(url, body):
            hosts.append(url.split("/")[2])
            if "GetCapabilities" in body:
                return 200, evil
            if "GetProfiles" in body:
                return 200, PROFILES_XML_TWO
            if "GetStreamUri" in body:
                return 200, STREAM_URI_XML
            return 200, DEVICE_INFO_XML
        cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "pw", post=post)
        self.assertEqual(set(hosts), {"192.168.1.64"})

    def test_not_authorized_fault(self):
        fault = ENV.format("<s:Fault><s:Code><s:Subcode><s:Value>ter:NotAuthorized</s:Value></s:Subcode></s:Code></s:Fault>")
        with self.assertRaises(cd.AuthError):
            cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "x", post=lambda u, b: (400, fault))


class ConnectTest(unittest.TestCase):
    def test_public_ip_refused_without_trying(self):
        calls = []
        r = cd.connect("8.8.8.8", "admin", "x", grab=lambda u: calls.append(u))
        self.assertEqual((r["ok"], r["reason"], calls), (False, "unreachable", []))

    def test_brand_channels_until_silence(self):
        ok = {"rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/101", "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/201"}
        r = cd.connect("192.168.1.64", "admin", "pw", brand="hikvision", grab=lambda u: "ok" if u in ok else None)
        self.assertTrue(r["ok"])
        self.assertEqual([c["channel"] for c in r["channels"]], [1, 2])
        self.assertEqual(r["brand"], "hikvision")

    def test_stops_at_16_channels(self):
        r = cd.connect("192.168.1.64", "admin", "pw", brand="hikvision", grab=lambda u: "ok")
        self.assertEqual(len(r["channels"]), 16)

    def test_single_channel_brand_is_tried_once(self):
        calls = []
        r = cd.connect("192.168.1.64", "admin", "pw", brand="axis", grab=lambda u: calls.append(u) or "ok")
        self.assertEqual((len(r["channels"]), len(calls)), (1, 1))

    def test_wrong_password(self):
        r = cd.connect("192.168.1.64", "admin", "bad", brand="hikvision", grab=lambda u: "auth")
        self.assertEqual((r["ok"], r["reason"]), (False, "auth"))

    def test_unknown_brand_finds_dahua(self):
        r = cd.connect("192.168.1.70", "admin", "pw", grab=lambda u: "ok" if "realmonitor?channel=1&" in u else None)
        self.assertEqual(r["brand"], "dahua")

    def test_no_video(self):
        self.assertEqual(cd.connect("192.168.1.64", "admin", "pw", brand="axis", grab=lambda u: None)["reason"], "no_stream")

    def test_password_never_in_error(self):
        for grab in (lambda u: None, lambda u: "auth"):
            r = cd.connect("192.168.1.64", "admin", "hemligt", brand="axis", grab=grab)
            self.assertNotIn("hemligt", r["error"])

    def test_onvif_first(self):
        url = "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/101"
        r = cd.connect("192.168.1.64", "admin", "pw", onvif_url="http://192.168.1.64/onvif/device_service",
                       grab=lambda u: "ok" if u == url else None,
                       onvif=lambda o, user, pw: ({"brand": "hikvision", "model": "DS-2CD2143G2-I"}, [url]))
        self.assertEqual((r["model"], r["channels"][0]["stream_url"]), ("DS-2CD2143G2-I", url))

    def test_onvif_wrong_password(self):
        def onvif(o, user, pw):
            raise cd.AuthError()
        r = cd.connect("192.168.1.64", "admin", "x", onvif_url="http://192.168.1.64/onvif/device_service",
                       grab=lambda u: None, onvif=onvif)
        self.assertEqual(r["reason"], "auth")

    def test_onvif_stream_on_other_host_is_skipped(self):
        r = cd.connect("192.168.1.64", "admin", "pw", brand="axis", onvif_url="http://192.168.1.64/onvif/device_service",
                       grab=lambda u: "ok", onvif=lambda o, user, pw: ({"brand": "axis", "model": None}, ["rtsp://admin:pw@8.8.8.8/x"]))
        self.assertNotIn("8.8.8.8", r["channels"][0]["stream_url"])


def det(cls, x1, y1, x2, y2, score=0.9):
    return local_ai.Detection(cls, score, (x1, y1, x2, y2))


class PlacementTest(unittest.TestCase):
    shape = (1000, 1000, 3)

    def test_counts_and_few(self):
        p = cd.placement([det(60, 100, 100, 300, 300), det(60, 500, 100, 700, 300), det(56, 0, 0, 50, 50)], self.shape, None, 8)
        self.assertEqual((p["tables_seen"], p["chairs_seen"], p["plan_tables"]), (2, 1, 8))
        self.assertIn("few_tables", p["tips"])
        self.assertEqual(p["boxes"][0], [0.1, 0.1, 0.3, 0.3])

    def test_too_low(self):
        p = cd.placement([det(60, 0, 850, 100, 950), det(60, 200, 820, 300, 990)], self.shape, None, 2)
        self.assertIn("too_low", p["tips"])

    def test_dark_and_none(self):
        p = cd.placement([], self.shape, local_ai.ISSUE_DARK, 4)
        self.assertEqual(p["tips"], ["too_dark", "no_tables"])

    def test_blurry(self):
        self.assertIn("blurry", cd.placement([], self.shape, local_ai.ISSUE_BLURRY, 0)["tips"])

    def test_low_score_ignored(self):
        self.assertEqual(cd.placement([det(60, 0, 0, 10, 10, 0.2)], self.shape, None, 1)["tables_seen"], 0)

    def test_enough_tables_no_tips(self):
        p = cd.placement([det(60, 100, 100, 300, 300), det(60, 400, 100, 600, 300)], self.shape, None, 3)
        self.assertEqual(p["tips"], [])


class RtspDigestTest(unittest.TestCase):
    def test_rfc2617_example(self):
        # RFC 2617 avsnitt 3.5 (utan qop): response = MD5(HA1:nonce:HA2)
        ha1 = hashlib.md5(b"Mufasa:testrealm@host.com:Circle Of Life").hexdigest()
        ha2 = hashlib.md5(b"DESCRIBE:rtsp://10.0.0.2/x").hexdigest()
        expected = hashlib.md5(f"{ha1}:abc:{ha2}".encode()).hexdigest()
        header = cd.rtsp_digest("Mufasa", "Circle Of Life", "testrealm@host.com", "abc", "DESCRIBE", "rtsp://10.0.0.2/x")
        self.assertIn(f'response="{expected}"', header)
        self.assertTrue(header.startswith("Digest "))


if __name__ == "__main__":
    unittest.main()
