# Kameraguiden – byggplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ägaren hittar, kopplar och placerar kamerorna själv: AI-datorn söker i nätet, hittar videoadressen med bara lösenordet, läser kamerans etikett och kontrollerar hur många bord kameran ser.

**Architecture:** En ny Python-modul `camera_discovery.py` i AI-motorn gör allt nätverksarbete (WS-Discovery, portkoll, ONVIF, provning av märkens sökvägar) och placeringskollen, med rena funktioner som testas utan nätverk. `AI.py` får fyra nya POST-anrop. Webbappen får fyra API-rutter som skickar vidare via `enginePost`, guidetexter per märke och två nya komponenter i kamerasteget.

**Tech Stack:** Python 3 standardbibliotek + OpenCV/YOLOX som redan finns (AI-motorn, unittest), Next.js 16 / React 19 / TypeScript (webbappen, ingen testram – verifieras med tsc, eslint, build och manuellt).

**Spec:** `docs/superpowers/specs/2026-11-15-kameraguide-design.md`

## Global Constraints

- Inga nya Python-paket. Inga nya npm-paket.
- Språkmodellen används inte för adresser, märken eller guider. Allt kommer från kameran, märkestabellen eller fasta texter.
- Kamerans lösenord och `stream_url` loggas aldrig och står aldrig i felmeddelanden.
- `/connect-camera` och `/camera-placement` godtar bara privata adresser: 10/8, 172.16/12, 192.168/16 (och 127/8 för test).
- Sökningen körs bara på knapptryck och bara i Macens eget /24-nät. Hela sökningen ska ta under ≈15 s.
- Gränser: discover högst 5 per minut, connect högst 20 per minut (proxy.ts).
- Etikettfoton krymps i webbläsaren med `shrinkImage` (Vercel tar högst 4,5 MB).
- Nuvarande formulär finns kvar som "Ange adressen själv". `POST /api/setup/cameras` ändras inte.
- Python-tester körs: `cd ~/Desktop/bordvakt && .venv/bin/python -m unittest discover -s tests`
- AI-motorn startas om med `launchctl kickstart -k gui/$(id -u)/se.bordvakt.engine` (starta aldrig AI.py för hand).
- Texter på svenska, i samma ton som resten av installationen (som i `app/setup/page.tsx`, som också är på svenska utan i18n).

## Review Focus

1. Fel lösenord: kameran svarar 401 → `reason: 'auth'` och texten "Fel användarnamn eller lösenord", inte "hittades inte". Test i Task 4.
2. Lösenord med specialtecken (`@`, `:`, `/`, `#`) måste URL-kodas i `stream_url`, annars öppnas fel adress. Test i Task 1.
3. Offentlig IP eller värdnamn i `/connect-camera` → avvisas innan någon anslutning. Test i Task 1.
4. Inspelare med många kanaler: provningen slutar vid första kanal som inte svarar, högst 16. Test i Task 4.
5. Etikett där OCR läser fel tecken, t.ex. `DS–2CD` med långt streck eller små bokstäver → matchas ändå. Test i Task 1.

---

### Task 1: Märken, sökvägar och etiketter (rena funktioner)

**Files:**
- Create: `camera_discovery.py`
- Test: `tests/test_camera_discovery.py`

**Interfaces:**
- Produces:
  - `RTSP_PATHS: dict[str, Callable[[int], str]]` – samma sökvägar som `web/lib/cameras.ts`: axis `/axis-media/media.amp`, hikvision `/Streaming/Channels/{ch}01`, dahua och amcrest `/cam/realmonitor?channel={ch}&subtype=0`, hanwha `/profile2/media.smp` (ch>1: `/{ch-1}/profile2/media.smp`), reolink `/h264Preview_{ch:02d}_main`, uniview `/unicast/c{ch}/s0/live`, tplink `/stream1`, foscam `/videoMain`.
  - `RTSP_PORT: dict[str, int]` – foscam 88, övriga 554.
  - `DEFAULT_USER: dict[str, str]` – axis `root`, tplink `admin` (Tapo: kontot som skapats i appen), övriga `admin`.
  - `is_private_ip(ip: str) -> bool`
  - `rtsp_url(ip: str, brand: str, user: str, password: str, channel: int = 1) -> str | None`
  - `brand_from_text(text: str) -> tuple[str | None, str | None]` → (märke, modell)

- [ ] **Step 1: Skriv testerna**

```python
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
    # även: AXIS M3106 → axis, UVC-G4-Bullet → unifi, Tapo C310 / VIGI C340 → tplink,
    #        XNV-6080 / QNV-8080R / PNM-9000 → hanwha, IPC322LB → uniview, IP8M-2496 → amcrest, FI9900P → foscam

class PrivateIpTest(unittest.TestCase):
    def test_private(self):
        for ip in ["192.168.1.64", "10.0.0.5", "172.16.3.4", "127.0.0.1"]:
            self.assertTrue(cd.is_private_ip(ip))
    def test_public_and_names(self):
        for ip in ["8.8.8.8", "172.32.0.1", "camera.local", "", "192.168.1.64:554", "::1x"]:
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
```

- [ ] **Step 2: Kör – ska misslyckas** `.venv/bin/python -m unittest tests.test_camera_discovery -v` → `ModuleNotFoundError: camera_discovery`
- [ ] **Step 3: Skriv funktionerna i `camera_discovery.py`.** `is_private_ip` med `ipaddress.ip_address` (fångar ValueError → False) och `.is_private or .is_loopback`, men avvisa `172.32+` (Pythons is_private räknar inte dit; kontrollera att testet går igenom). Lösenord och användarnamn kodas med `urllib.parse.quote(..., safe="")`. `brand_from_text` normaliserar först: versaler, alla streck (–, —, ‐) blir `-`, sedan en lista med (regex, märke) där modellen är regexens träff.
- [ ] **Step 4: Kör – ska gå igenom** (samma kommando) → `OK`
- [ ] **Step 5: Commit** `git add camera_discovery.py tests/test_camera_discovery.py && git commit -m "Kameraguiden: märken, sökvägar och etiketter"`

---

### Task 2: Hitta kameror i nätet (WS-Discovery + portkoll)

**Files:**
- Modify: `camera_discovery.py`
- Test: `tests/test_camera_discovery.py`

**Interfaces:**
- Consumes: `brand_from_text` (Task 1)
- Produces:
  - `PROBE: str` – WS-Discovery Probe för `dn:NetworkVideoTransmitter` (SOAP 1.2, `wsa:MessageID` = `uuid:{uuid4}`).
  - `parse_probe_match(xml: str) -> dict | None` → `{"ip", "onvif_url", "brand", "model"}`
  - `local_subnet() -> list[str]` – de 254 adresserna i Macens /24 (Macens egen IP via `socket.connect(("10.255.255.255", 1))` på UDP, utan att skicka något), utom den egna.
  - `discover(timeout: float = 3.0, probe=None, scan=None) -> list[dict]` → `[{"ip", "onvif_url", "ports": [int], "brand", "model"}]`, sorterad på IP. `probe` och `scan` kan bytas ut i testerna.

- [ ] **Step 1: Skriv testerna**

```python
PROBE_MATCH = """<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Body><d:ProbeMatches><d:ProbeMatch>
 <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/hardware/DS-2CD2143G2-I
 onvif://www.onvif.org/name/HIKVISION</d:Scopes>
 <d:XAddrs>http://192.168.1.64/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs>
 </d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>"""

class ProbeMatchTest(unittest.TestCase):
    def test_parses_ip_url_brand_model(self):
        self.assertEqual(cd.parse_probe_match(PROBE_MATCH), {
            "ip": "192.168.1.64", "onvif_url": "http://192.168.1.64/onvif/device_service",
            "brand": "hikvision", "model": "DS-2CD2143G2-I"})
    def test_garbage(self):
        self.assertIsNone(cd.parse_probe_match("<not xml"))

class DiscoverTest(unittest.TestCase):
    def test_merges_onvif_and_port_scan(self):
        found = cd.discover(probe=lambda t: [{"ip": "192.168.1.64", "onvif_url": "http://192.168.1.64/onvif/device_service", "brand": "hikvision", "model": "X"}],
                            scan=lambda: {"192.168.1.64": [554, 80], "192.168.1.80": [554]})
        self.assertEqual([d["ip"] for d in found], ["192.168.1.64", "192.168.1.80"])
        self.assertEqual(found[0]["ports"], [80, 554])
        self.assertIsNone(found[1]["onvif_url"])
    def test_hosts_with_only_port_80_are_dropped(self):
        # en skrivare eller router är ingen kamera: utan ONVIF krävs port 554
        self.assertEqual(cd.discover(probe=lambda t: [], scan=lambda: {"192.168.1.1": [80]}), [])
```

- [ ] **Step 2: Kör – ska misslyckas** → `AttributeError: parse_probe_match`
- [ ] **Step 3: Skriv funktionerna.** `parse_probe_match` med `xml.etree.ElementTree` (fångar ParseError → None), väljer första XAddr med IPv4. Märket tas ur `name/`-scope via `brand_from_text`, och faller tillbaka på `hardware/`-scope. Standardvärdet för `probe` skickar `PROBE` som UDP multicast till `239.255.255.250:3702` och samlar svar i `timeout` sekunder. Standardvärdet för `scan` gör TCP-anslutning till portarna `[554, 80, 8000]` i `local_subnet()` med `concurrent.futures.ThreadPoolExecutor(max_workers=64)` och tidsgränsen 0,4 s per anslutning. Probe och scan körs parallellt.
- [ ] **Step 4: Kör – ska gå igenom**
- [ ] **Step 5: Commit** `git commit -am "Kameraguiden: hitta kameror i nätet"` (lägg till testfilen om den inte redan finns i git)

---

### Task 3: ONVIF – modell och exakt videoadress

**Files:**
- Modify: `camera_discovery.py`
- Test: `tests/test_camera_discovery.py`

**Interfaces:**
- Produces:
  - `wsse_header(user: str, password: str, nonce: bytes, created: str) -> str` – WS-UsernameToken med `PasswordDigest = base64(sha1(nonce + created + password))`.
  - `parse_device_info(xml: str) -> tuple[str | None, str | None]` → (tillverkare, modell)
  - `parse_profiles(xml: str) -> list[str]` → profiltokens
  - `parse_stream_uri(xml: str) -> str | None`
  - `with_credentials(url: str, user: str, password: str) -> str` – lägger in kodat användarnamn och lösenord i en rtsp-adress (ersätter de som redan står där).
  - `onvif_streams(onvif_url: str, user: str, password: str, post=None) -> tuple[dict, list[str]]` → (`{"brand", "model"}`, rtsp-adresser med inloggning, en per profil med unik sökväg och högsta upplösningen per kanal). `post(url, body) -> (status, text)` kan bytas ut i testerna. Status 401 eller ett `NotAuthorized`-fel ger `AuthError`.
  - `class AuthError(Exception)`

- [ ] **Step 1: Skriv testerna**

```python
class WsseTest(unittest.TestCase):
    def test_digest_matches_onvif_spec(self):
        h = cd.wsse_header("admin", "12345", b"\x00" * 16, "2026-11-15T10:00:00Z")
        expected = base64.b64encode(hashlib.sha1(b"\x00" * 16 + b"2026-11-15T10:00:00Z12345").digest()).decode()
        self.assertIn(expected, h)
        self.assertIn("<wsse:Username>admin</wsse:Username>", h)

class OnvifTest(unittest.TestCase):
    def test_streams_and_model(self):
        replies = {"GetDeviceInformation": DEVICE_INFO_XML, "GetProfiles": PROFILES_XML_TWO, "GetStreamUri": STREAM_URI_XML}
        post = lambda url, body: (200, next(v for k, v in replies.items() if k in body))
        info, urls = cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "p@ss", post=post)
        self.assertEqual(info, {"brand": "hikvision", "model": "DS-2CD2143G2-I"})
        self.assertTrue(urls[0].startswith("rtsp://admin:p%40ss@192.168.1.64:554/"))
    def test_wrong_password(self):
        with self.assertRaises(cd.AuthError):
            cd.onvif_streams("http://192.168.1.64/onvif/device_service", "admin", "x", post=lambda u, b: (401, ""))
    def test_xml_special_chars_in_password_are_escaped(self):
        self.assertNotIn("<&", cd.wsse_header("admin", "<&", b"\x01" * 16, "2026-11-15T10:00:00Z"))
```

(Fixturerna `DEVICE_INFO_XML`, `PROFILES_XML_TWO`, `STREAM_URI_XML` är korta ONVIF-svar som skrivs i testfilen: Manufacturer HIKVISION, Model DS-2CD2143G2-I, två profiler, Uri `rtsp://192.168.1.64:554/Streaming/Channels/101`.)

- [ ] **Step 2: Kör – ska misslyckas**
- [ ] **Step 3: Skriv funktionerna.** SOAP-kroppar som strängmallar, där användarnamnet escapas med `xml.sax.saxutils.escape`. Standardvärdet för `post` använder `urllib.request` med `Content-Type: application/soap+xml` och tidsgränsen 4 s. Media-tjänstens adress tas från `GetCapabilities` om den finns, annars samma adress som enhetens. Profiler som ger samma sökväg räknas bara en gång.
- [ ] **Step 4: Kör – ska gå igenom**
- [ ] **Step 5: Commit** `git commit -am "Kameraguiden: ONVIF-modell och videoadress"`

---

### Task 4: Koppla kameran och placeringskollen

**Files:**
- Modify: `camera_discovery.py`
- Test: `tests/test_camera_discovery.py`

**Interfaces:**
- Consumes: `is_private_ip`, `rtsp_url`, `RTSP_PATHS` (Task 1), `onvif_streams`, `AuthError` (Task 3)
- Produces:
  - `connect(ip: str, user: str, password: str, brand: str | None = None, onvif_url: str | None = None, grab=None, onvif=None) -> dict`
    - Ingen privat IP → `{"ok": False, "reason": "unreachable", "error": "Adressen måste vara en kamera i restaurangens nät."}`
    - Lyckat → `{"ok": True, "brand": str | None, "model": str | None, "channels": [{"channel": int, "stream_url": str}]}`. `stream_url` med inloggning. Förhandsbilden tas inte här.
    - Fel lösenord (AuthError från ONVIF, eller `grab` returnerar `"auth"`) → `{"ok": False, "reason": "auth", "error": "Fel användarnamn eller lösenord."}`
    - Ingen bild → `{"ok": False, "reason": "no_stream", "error": "Kameran svarar men ger ingen video. Slå på RTSP i kamerans app (se guiden) och försök igen."}`
    - `grab(url) -> "ok" | "auth" | None` byts ut i testerna. Standardvärdet: `cv2.VideoCapture` med 4 s tidsgräns. `"auth"` när OpenCV:s FFmpeg-logg innehåller 401, annars None.
    - Ordning: ONVIF-adresser först (om `onvif_url`). Annars märkets sökväg för kanal 1, 2, … till första kanal som inte svarar, högst 16. Utan märke prövas varje märke i `RTSP_PATHS` för kanal 1, och det första som ger bild bestämmer märket.
  - `placement(detections: list, frame_shape: tuple, problem: str | None, plan_tables: int) -> dict` → `{"tables_seen": int, "chairs_seen": int, "boxes": [[x1,y1,x2,y2] i 0–1], "plan_tables": int, "tips": [str]}`
    - Tipskoder: `too_dark` (problem är mörk), `blurry` (problem är suddig), `no_tables` (0 bord), `few_tables` (0 < bord < hälften av plan_tables), `too_low` (minst 2 bord och över hälften har boxens mittpunkt i nedre femtedelen av bilden).
    - Bord räknas med score ≥ 0,35, stolar med score ≥ 0,35.

- [ ] **Step 1: Skriv testerna**

```python
class ConnectTest(unittest.TestCase):
    def test_public_ip_refused_without_trying(self):
        calls = []
        r = cd.connect("8.8.8.8", "admin", "x", grab=lambda u: calls.append(u))
        self.assertEqual((r["ok"], r["reason"], calls), (False, "unreachable", []))
    def test_brand_channels_until_silence(self):
        ok = {"rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/101", "rtsp://admin:pw@192.168.1.64:554/Streaming/Channels/201"}
        r = cd.connect("192.168.1.64", "admin", "pw", brand="hikvision", grab=lambda u: "ok" if u in ok else None)
        self.assertEqual([c["channel"] for c in r["channels"]], [1, 2])
    def test_stops_at_16_channels(self):
        r = cd.connect("192.168.1.64", "admin", "pw", brand="hikvision", grab=lambda u: "ok")
        self.assertEqual(len(r["channels"]), 16)
    def test_wrong_password(self):
        r = cd.connect("192.168.1.64", "admin", "bad", brand="hikvision", grab=lambda u: "auth")
        self.assertEqual(r["reason"], "auth")
    def test_unknown_brand_finds_dahua(self):
        r = cd.connect("192.168.1.70", "admin", "pw", grab=lambda u: "ok" if "realmonitor?channel=1" in u else None)
        self.assertEqual(r["brand"], "dahua")
    def test_no_video(self):
        self.assertEqual(cd.connect("192.168.1.64", "admin", "pw", brand="axis", grab=lambda u: None)["reason"], "no_stream")
    def test_password_never_in_error(self):
        r = cd.connect("192.168.1.64", "admin", "hemligt", brand="axis", grab=lambda u: None)
        self.assertNotIn("hemligt", r["error"])

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
    def test_low_score_ignored(self):
        self.assertEqual(cd.placement([det(60, 0, 0, 10, 10, 0.2)], self.shape, None, 1)["tables_seen"], 0)
```

- [ ] **Step 2: Kör – ska misslyckas**
- [ ] **Step 3: Skriv `connect` och `placement`.** `placement` importerar `ISSUE_DARK`/`ISSUE_BLURRY` och `DINING_TABLE`/`CHAIR` från `local_ai`, och tipsen ges i ordningen too_dark, blurry, no_tables, few_tables, too_low.
- [ ] **Step 4: Kör hela testsviten** `.venv/bin/python -m unittest discover -s tests` → `OK` (även de gamla testerna)
- [ ] **Step 5: Commit** `git commit -am "Kameraguiden: koppla kameran och placeringskollen"`

---

### Task 5: AI-motorns nya anrop

**Files:**
- Modify: `AI.py` (do_POST, nära `/test-camera` kring rad 321–360, och en ny hjälpfunktion efter `test_camera` kring rad 733)
- Modify: `local_menu.py` – exportera ingenting nytt. Etiketten läses med befintliga `local_menu.read_text(image: bytes)`.

**Interfaces:**
- Consumes: `camera_discovery.discover`, `connect`, `placement`, `brand_from_text`, `is_private_ip`; befintliga `test_camera(url)`, `local_model.detector()`, `local_ai.frame_problem`, `local_menu.read_text`
- Produces (HTTP, alla kräver motorns nyckel som i dag):
  - `POST /discover-cameras` `{}` → `200 {"cameras": [...discover()]}`. Kräver inte local_model.
  - `POST /read-camera-label` `{"photo": base64}` → `200 {"text", "brand", "model"}`. Kräver inte local_model. Gräns 10 MB.
  - `POST /connect-camera` `{"ip", "username", "password", "brand"?, "onvif_url"?}` → `200 {"ok": true, "brand", "model", "channels": [{"channel", "stream_url", "preview", "warning", "placement"}]}` eller `422 {"ok": false, "reason", "error"}`. Varje kanal får förhandsbild via `test_camera(stream_url)` och placering via `camera_placement`.
  - `POST /camera-placement` `{"stream_url"}` → `200 {...placement}` eller `422 {"error"}`.
  - `camera_placement(frame) -> dict | None` i AI.py: `None` om `local_model` saknas, annars `camera_discovery.placement(local_model.detector()(frame), frame.shape, local_ai.frame_problem(frame), plan_tables)`, där `plan_tables` = antalet bord i restaurangen (`supabase.table("tables").select("id", count="exact").eq("restaurant_id", RESTAURANT_ID)`).
  - `test_camera` utökas så att den också returnerar ramen till anroparen: dela upp i `grab_frame(url) -> np.ndarray | None` + befintligt svar, så att `/connect-camera` inte öppnar kameran två gånger.
  - `/camera-placement` kontrollerar att `stream_url`:s värd är privat (`urllib.parse.urlsplit(url).hostname` + `is_private_ip`).
  - Lösenord: varken `print` eller felmeddelanden innehåller kroppen. Det befintliga `except Exception as e: print(f"{path} misslyckades: {e}")` får för dessa vägar bara skriva ut typen (`type(e).__name__`).

- [ ] **Step 1: Lägg in anropen och `grab_frame`/`camera_placement`** enligt ovan.
- [ ] **Step 2: Kontrollera att filen går att läsa in** `.venv/bin/python -c "import ast,sys; ast.parse(open('AI.py').read())"` → ingen utskrift. Kör `.venv/bin/python -m unittest discover -s tests` → `OK`.
- [ ] **Step 3: Starta om motorn och prova** `launchctl kickstart -k gui/$(id -u)/se.bordvakt.engine`. Vänta tills `tail -5 ~/Library/Logs/Bordvakt/engine.log` visar att motorn är igång. Anropa sedan `/discover-cameras` med motorns nyckel (`X-Bordvakt-Key`, räknas som i `web/lib/engine.ts` – enklast via webbappen i Task 6). Förväntat: `200` med en lista, eventuellt tom.
- [ ] **Step 4: Commit** `git commit -am "AI-motorn: hitta, koppla och placera kameror"`

---

### Task 6: Webbappens API-rutter

**Files:**
- Create: `web/app/api/setup/cameras/discover/route.ts`, `.../connect/route.ts`, `.../label/route.ts`, `.../placement/route.ts`
- Modify: `web/proxy.ts` (LIMITS, före `['/api/', 120, 600]`)

**Interfaces:**
- Consumes: `currentRestaurantId`, `serverSupabase`, `errorResponse`, `UserError` (`lib/server.ts`); `enginePost(restaurantId, path, body, contentType, timeoutMs)` (`lib/engine.ts`)
- Produces (för Task 8):
  - `POST /api/setup/cameras/discover` → `{ cameras: FoundCamera[] }`, tidsgräns 25 s
  - `POST /api/setup/cameras/connect` `{ ip, username, password, brand?, onvif_url? }` → `ConnectResult`, tidsgräns 120 s (många kanaler). 422 från motorn skickas vidare med samma kropp.
  - `POST /api/setup/cameras/label` (FormData fält `photo`, max 8 MB, bild) → `{ text, brand, model }`, tidsgräns 60 s
  - `POST /api/setup/cameras/placement` `{ stream_url }` → `Placement`, tidsgräns 30 s
  - Typer i `web/lib/cameraGuides.ts` (Task 7): `FoundCamera`, `ConnectResult`, `Placement`
  - LIMITS: `['/api/setup/cameras/discover', 5, 60]`, `['/api/setup/cameras/connect', 20, 60]`
- Inmatning kontrolleras i rutten: `ip` matchar `/^\d{1,3}(\.\d{1,3}){3}$/`, `username` ≤ 64 tecken, `password` ≤ 128 tecken, `onvif_url` börjar med `http://` och är ≤ 300 tecken, `brand` finns i `BRANDS`. Lösenordet loggas aldrig. Rutterna anropar inte `console.error` med kroppen.

- [ ] **Step 1: Skriv de fyra rutterna** i samma mönster som `app/api/setup/cameras/test/route.ts`. Status 404 från motorn ger "AI-motorn är en äldre version. Uppdatera den med: bash install/install-mac.sh" (samma text som i menyrutten).
- [ ] **Step 2: Lägg till gränserna i `proxy.ts`.**
- [ ] **Step 3: Kontrollera** `cd web && npx tsc --noEmit && npx eslint app/api/setup proxy.ts` → ingen utskrift.
- [ ] **Step 4: Prova mot den riktiga motorn.** Logga in i appen med `npm run dev`. Kör sedan `fetch('/api/setup/cameras/discover',{method:'POST'}).then(r=>r.json())` i webbläsarens konsol. Förväntat: `{ cameras: [...] }`.
- [ ] **Step 5: Commit** `git commit -m "Webbappen: API för kameraguiden"` (med de nya filerna tillagda)

---

### Task 7: Guider per märke

**Files:**
- Create: `web/lib/cameraGuides.ts`

**Interfaces:**
- Consumes: `CameraBrand` (`lib/types.ts`)
- Produces:
  - `interface CameraGuide { brand: CameraBrand; app: string; findIp: string[]; enableStream: string[]; user: string; note?: string }`
  - `CAMERA_GUIDES: Record<CameraBrand, CameraGuide>` för alla märken i BRANDS. `other` är en allmän guide: hitta IP i routerns lista över enheter, sök på "modellnamn RTSP" i manualen.
  - `guideFor(brand: CameraBrand | null): CameraGuide`
  - `defaultUser(brand: CameraBrand | null): string` – samma värden som `DEFAULT_USER` i Python (Task 1)
  - Typer: `FoundCamera = { ip: string; onvif_url: string | null; ports: number[]; brand: CameraBrand | null; model: string | null }`, `Placement = { tables_seen: number; chairs_seen: number; boxes: [number, number, number, number][]; plan_tables: number; tips: PlacementTip[] }`, `PlacementTip = 'too_dark' | 'blurry' | 'no_tables' | 'few_tables' | 'too_low'`, `ConnectResult = { ok: true; brand: CameraBrand | null; model: string | null; channels: { channel: number; stream_url: string; preview: string | null; warning: string | null; placement: Placement | null }[] } | { ok: false; reason: 'auth' | 'no_stream' | 'unreachable'; error: string }`
  - `TIP_TEXT: Record<PlacementTip, string>`, t.ex. too_low: "Kameran sitter för lågt eller pekar för långt ned. Sätt den högre upp (helst 2,5–3 m) och vinkla ned mot borden."

- [ ] **Step 1: Skriv filen.** Texterna ska vara korta (3–5 punkter per del) och överst i filen ha kommentaren `// Granska mot tillverkarens manual innan lansering.` App per märke: Hikvision Hik-Connect/SADP, Dahua DMSS/ConfigTool, Reolink Reolink-appen (Inställningar → Nätverk → Avancerat → Portinställningar: RTSP och ONVIF på), Axis AXIS IP Utility, Hanwha Wisenet, Uniview EZView, TP-Link Tapo/VIGI (Tapo: Avancerat → Kamerakonto), Foscam Foscam-appen, Amcrest Amcrest View, UniFi Protect (RTSP slås på per kamera, adressen klistras in under "Ange adressen själv").
- [ ] **Step 2: Kontrollera** `npx tsc --noEmit` → ingen utskrift
- [ ] **Step 3: Commit** `git add web/lib/cameraGuides.ts && git commit -m "Kameraguiden: guider per märke"`

---

### Task 8: Kamerasteget – hitta, koppla, placera, etikett

**Files:**
- Create: `web/app/setup/CameraFinder.tsx` (sök, lista, koppla, förhandsbild med placering, spara)
- Create: `web/app/setup/CameraLabel.tsx` (fota/skriv modell → märke → guide → "Fyll i formuläret")
- Create: `web/app/setup/PlacementView.tsx` (förhandsbild med bordens rutor + "Ser X av Y bord" + tips + "Kolla igen")
- Modify: `web/app/setup/page.tsx` – `CamerasStep` (rad ~292): överst `CameraFinder`, sedan "Hittar du inte din kamera?" med `CameraLabel`, sedan det befintliga formuläret under rubriken "Ange adressen själv" (hopfällt som standard när det inte finns några kameror i nätet och det första sökresultatet har kommit).

**Interfaces:**
- Consumes: API-rutterna (Task 6), `CAMERA_GUIDES`, `guideFor`, `defaultUser`, `TIP_TEXT` och typerna (Task 7), `shrinkImage` (`lib/shrinkImage.ts`), `brandInfo` (`lib/cameras.ts`), befintliga `api()` och `load()` i CamerasStep
- Produces:
  - `<CameraFinder onSaved={() => void} />` – sparar med `POST /api/setup/cameras { name, brand, stream_url }`. Namnet föreslås som "Kamera N" (N = antal befintliga + 1) och kan ändras. Inspelare: en rad per kanal med kryssruta, och "Spara valda".
  - `<CameraLabel onUseBrand={(brand: CameraBrand, model: string | null) => void} />`
    - **Foto:** krymps med `shrinkImage(file, 2000, 0.85)` och skickas till `/api/setup/cameras/label`.
    - **Skriva modellen:** ett textfält och knappen "Känn igen". Matchningen görs direkt i webbläsaren med `brandFromText(text)` (Step 1), utan anrop till motorn.
  - `<PlacementView preview={string} placement={Placement | null} onRecheck={() => Promise<void>} />`
  - `CamerasStep` får `prefill(brand)` som sätter formulärets märke via befintliga `change({ brand })` och öppnar formuläret.
- Fel visas med samma röda ruta som i resten av installationen. `reason: 'auth'` visar felet vid lösenordsfältet.
- När motorn inte är kopplad (`engine` säger NO_ENGINE): visa befintlig hjälptext om att koppla AI-datorn i stället för sökknappen.

- [ ] **Step 1: Lägg till `brandFromText(text: string): { brand: CameraBrand | null; model: string | null }`** i `cameraGuides.ts`, med samma mönster och normalisering som Python-versionen.
- [ ] **Step 2: Skriv `PlacementView`.** Rutorna ritas som absolut placerade `div` med procentsatser ovanpå `<img>` (inget canvas).
- [ ] **Step 3: Skriv `CameraFinder`** (lägen: idle → söker → lista → koppla (formulär) → kopplar → resultat).
- [ ] **Step 4: Skriv `CameraLabel`.**
- [ ] **Step 5: Bygg in dem i `CamerasStep`.**
- [ ] **Step 6: Kontrollera** `npx tsc --noEmit && npx eslint app/setup lib` → ingen utskrift
- [ ] **Step 7: Prova i webbläsaren** (`npm run dev`, logga in, /setup?step=cameras, mobil och dator):
  - "Hitta mina kameror" visar kamerorna i nätet.
  - Fel lösenord ger texten vid lösenordsfältet.
  - Rätt lösenord ger förhandsbild och "Ser X av Y bord".
  - "Spara kameran" lägger in den i listan.
  - Fotot av en etikett (eller texten "DS-2CD2143G2-I") visar Hikvision-guiden, och "Fyll i formuläret" väljer Hikvision.
- [ ] **Step 8: Commit** `git commit -m "Installationen: hitta, koppla och placera kamerorna själv"` (med de nya filerna tillagda)

---

### Task 9: Kalibreringen visar bord som ingen kamera ser

**Files:**
- Modify: `web/app/setup/page.tsx` – `CalibrateStep` (rad ~618)

**Interfaces:**
- Consumes: `status.unmapped_tables: number[]` (finns redan i `SetupStatus`)

- [ ] **Step 1: Visa en rad överst i `CalibrateStep`** när `status.unmapped_tables.length > 0`: "Bord som ingen kamera ser ännu: 6, 7, 8. Rita dem i en kamera nedan, eller lägg till en kamera till." Länken "lägg till en kamera" går till `/setup?step=cameras`.
- [ ] **Step 2: Kontrollera** `npx tsc --noEmit && npx eslint app/setup` → ingen utskrift. Kör sedan `npm run build` → avslutas utan fel.
- [ ] **Step 3: Kör Python-testerna en sista gång** `.venv/bin/python -m unittest discover -s tests` → `OK`
- [ ] **Step 4: Commit** `git commit -am "Kalibreringen: visa bord som ingen kamera ser"`
