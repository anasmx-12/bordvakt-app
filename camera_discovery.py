"""Kameraguiden: hittar kamerorna i restaurangens nät, kopplar dem och kontrollerar placeringen.

Allt här bygger på det kameran själv svarar (ONVIF) eller på märkenas kända videoadresser.
Ingen språkmodell används: en gissad adress är värre än ingen.
Lösenord skrivs aldrig ut och står aldrig i felmeddelanden.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import os
import re
import socket
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from xml.sax.saxutils import escape

# ------------------------------------------------------------- Märken
# Samma sökvägar som web/lib/cameras.ts (kanal 1 = första kameran på en inspelare)
RTSP_PATHS = {
    "axis": lambda ch: "/axis-media/media.amp",
    "hikvision": lambda ch: f"/Streaming/Channels/{ch}01",
    "dahua": lambda ch: f"/cam/realmonitor?channel={ch}&subtype=0",
    "amcrest": lambda ch: f"/cam/realmonitor?channel={ch}&subtype=0",
    "hanwha": lambda ch: f"/{ch - 1}/profile2/media.smp" if ch > 1 else "/profile2/media.smp",
    "reolink": lambda ch: f"/h264Preview_{ch:02d}_main",
    "uniview": lambda ch: f"/unicast/c{ch}/s0/live",
    "tplink": lambda ch: "/stream1",
    "foscam": lambda ch: "/videoMain",
}
# Märken med en enda kamera per adress: kanal 2 finns inte
SINGLE_CHANNEL = {"axis", "tplink", "foscam"}
RTSP_PORT = {"foscam": 88}
# Samma som defaultUser i web/lib/cameraGuides.ts
DEFAULT_USER = {"axis": "root"}


def default_user(brand: str | None) -> str:
    return DEFAULT_USER.get(brand or "", "admin")


def is_private_ip(ip: str) -> bool:
    """Bara adresser i ett lokalt nät (aldrig internet, aldrig värdnamn)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.version != 4:
        return False
    if addr.is_loopback:
        return True
    return any(addr in ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def rtsp_url(ip: str, brand: str, user: str, password: str, channel: int = 1) -> str | None:
    """Videoadressen för märket, med kodat användarnamn och lösenord. None för okänt märke."""
    path = RTSP_PATHS.get(brand)
    if path is None:
        return None
    port = RTSP_PORT.get(brand, 554)
    return f"rtsp://{quote(user, safe='')}:{quote(password, safe='')}@{ip}:{port}{path(channel)}"


# ------------------------------------------------------------- Etiketter
# (mönster, märke). Mönstret är modellnumret; text före det (märkesnamn) räcker inte ensamt.
_MODELS = [
    (r"DS-?2CD[0-9A-Z-]+|DS-?[0-9A-Z]{2,}-[0-9A-Z-]+", "hikvision"),
    (r"(?:IPC|HAC|SD|DH)-[A-Z]{2,}[0-9A-Z-]*", "dahua"),
    (r"RLC-?[0-9A-Z]+|E1 ?(?:PRO|ZOOM|OUTDOOR)?|ARGUS ?[0-9A-Z]*", "reolink"),
    (r"AXIS [A-Z][0-9]{3,4}[0-9A-Z-]*(?: MK ?I+)?", "axis"),
    (r"UVC-?[0-9A-Z-]+", "unifi"),
    (r"(?:TAPO|VIGI) ?C[0-9]{3}[0-9A-Z-]*", "tplink"),
    (r"(?:XNV|XND|XNO|QNV|QND|QNO|PNM|PNV|PND|ANV|ANO)-?[0-9A-Z-]+", "hanwha"),
    (r"IPC[0-9]{3}[0-9A-Z-]*", "uniview"),
    (r"IP[0-9]M-[0-9A-Z-]+", "amcrest"),
    (r"FI[0-9]{4}[A-Z]*", "foscam"),
]
_NAMES = {
    "HIKVISION": "hikvision", "DAHUA": "dahua", "REOLINK": "reolink", "AXIS": "axis", "UBIQUITI": "unifi",
    "UNIFI": "unifi", "TP-LINK": "tplink", "TAPO": "tplink", "HANWHA": "hanwha", "WISENET": "hanwha",
    "SAMSUNG": "hanwha", "UNIVIEW": "uniview", "UNV": "uniview", "AMCREST": "amcrest", "FOSCAM": "foscam",
}


def _normalize(text: str) -> str:
    return re.sub(r"[‐-―−]", "-", text or "").upper()


def brand_from_text(text: str) -> tuple[str | None, str | None]:
    """Märke och modell från en etikett eller det användaren skrivit. (None, None) om okänt."""
    t = _normalize(text)
    for pattern, brand in _MODELS:
        m = re.search(rf"(?<![0-9A-Z]){pattern}", t)
        if m:
            return brand, m.group(0).strip()
    for name, brand in _NAMES.items():
        if re.search(rf"(?<![0-9A-Z]){re.escape(name)}(?![0-9A-Z])", t):
            return brand, None
    return None, None


# ------------------------------------------------------------- Hitta kameror i nätet
WS_DISCOVERY = ("239.255.255.250", 3702)
SCAN_PORTS = [554, 80, 8000]

PROBE = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
    'xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
    'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
    'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
    "<s:Header>"
    "<a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>"
    "<a:MessageID>uuid:{id}</a:MessageID>"
    "<a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>"
    "</s:Header>"
    "<s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body>"
    "</s:Envelope>"
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_probe_match(xml: str) -> dict | None:
    """Ett svar på sökningen: kamerans IP, ONVIF-adress och (om kameran säger det) märke och modell."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    scopes, xaddrs = "", ""
    for el in root.iter():
        if _local(el.tag) == "Scopes":
            scopes = el.text or ""
        elif _local(el.tag) == "XAddrs":
            xaddrs = el.text or ""
    url = next((u for u in xaddrs.split() if re.match(r"https?://\d+\.\d+\.\d+\.\d+", u)), None)
    if not url:
        return None
    ip = re.match(r"https?://(\d+\.\d+\.\d+\.\d+)", url).group(1)
    hardware = re.search(r"onvif://www\.onvif\.org/hardware/(\S+)", scopes)
    name = re.search(r"onvif://www\.onvif\.org/name/(\S+)", scopes)
    hw_text = hardware.group(1).replace("%20", " ") if hardware else ""
    brand, model = brand_from_text(hw_text)
    if name:
        named = brand_from_text(name.group(1).replace("%20", " "))[0]
        brand = named or brand
    return {"ip": ip, "onvif_url": url, "brand": brand, "model": model or (hw_text or None)}


def _own_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # skickar inget, väljer bara nätkort
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def local_subnet() -> list[str]:
    """Adresserna i Macens eget /24-nät, utom Macen själv. Tomt om Macen inte har ett lokalt nät."""
    own = _own_ip()
    if not own or not is_private_ip(own) or own.startswith("127."):
        return []
    base = own.rsplit(".", 1)[0]
    return [f"{base}.{i}" for i in range(1, 255) if f"{base}.{i}" != own]


def _ws_probe(timeout: float) -> list[dict]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    found: dict[str, dict] = {}
    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        sock.settimeout(0.5)
        sock.sendto(PROBE.format(id=uuid.uuid4()).encode(), WS_DISCOVERY)
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                data, _ = sock.recvfrom(65535)
            except socket.timeout:
                continue
            match = parse_probe_match(data.decode("utf-8", "replace"))
            if match and is_private_ip(match["ip"]):
                found[match["ip"]] = match
    except OSError:
        pass
    finally:
        sock.close()
    return list(found.values())


def _open(ip: str, port: int) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=0.4):
            return True
    except OSError:
        return False


def _port_scan() -> dict[str, list[int]]:
    hosts = local_subnet()
    jobs = [(ip, port) for ip in hosts for port in SCAN_PORTS]
    with ThreadPoolExecutor(max_workers=64) as pool:
        results = list(pool.map(lambda j: _open(*j), jobs))
    out: dict[str, list[int]] = {}
    for (ip, port), ok in zip(jobs, results):
        if ok:
            out.setdefault(ip, []).append(port)
    return out


def discover(timeout: float = 3.0, probe=None, scan=None) -> list[dict]:
    """Kamerorna i restaurangens nät: de som svarar på ONVIF-sökningen och de som har RTSP-porten öppen."""
    probe = probe or _ws_probe
    scan = scan or _port_scan
    with ThreadPoolExecutor(max_workers=2) as pool:
        onvif_job = pool.submit(probe, timeout)
        scan_job = pool.submit(scan)
        onvif, ports = onvif_job.result(), scan_job.result()
    cameras: dict[str, dict] = {}
    for m in onvif:
        cameras[m["ip"]] = {"ip": m["ip"], "onvif_url": m.get("onvif_url"), "ports": [], "brand": m.get("brand"), "model": m.get("model")}
    for ip, open_ports in ports.items():
        if ip not in cameras and 554 not in open_ports:
            continue  # router, skrivare: ingen video
        cam = cameras.setdefault(ip, {"ip": ip, "onvif_url": None, "ports": [], "brand": None, "model": None})
        cam["ports"] = sorted(set(cam["ports"]) | set(open_ports))
    return sorted(cameras.values(), key=lambda c: tuple(int(x) for x in c["ip"].split(".")))


# ------------------------------------------------------------- ONVIF
# Kameran berättar själv vilket märke och vilken modell den är, och exakt vilken videoadress den har.

class AuthError(Exception):
    """Fel användarnamn eller lösenord."""


def wsse_header(user: str, password: str, nonce: bytes, created: str) -> str:
    """WS-UsernameToken (PasswordDigest = base64(sha1(nonce + created + lösenord)))."""
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()
    return (
        '<s:Header><wsse:Security s:mustUnderstand="1" '
        'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" '
        'xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">'
        f"<wsse:UsernameToken><wsse:Username>{escape(user)}</wsse:Username>"
        '<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">'
        f"{digest}</wsse:Password>"
        '<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">'
        f"{base64.b64encode(nonce).decode()}</wsse:Nonce>"
        f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>"
    )


def _envelope(user: str, password: str, body: str) -> str:
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" '
        'xmlns:tt="http://www.onvif.org/ver10/schema">'
        f"{wsse_header(user, password, os.urandom(16), created)}<s:Body>{body}</s:Body></s:Envelope>"
    )


def _find(xml: str, name: str) -> list[ET.Element]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    return [el for el in root.iter() if _local(el.tag) == name]


def _text(el: ET.Element, name: str) -> str | None:
    for child in el.iter():
        if _local(child.tag) == name and child.text:
            return child.text.strip()
    return None


def parse_device_info(xml: str) -> tuple[str | None, str | None]:
    found = _find(xml, "GetDeviceInformationResponse")
    if not found:
        return None, None
    return _text(found[0], "Manufacturer"), _text(found[0], "Model")


def parse_profiles(xml: str) -> list[str]:
    """En profil per videokälla (en kamera), den med högst upplösning."""
    best: dict[str, tuple[int, str]] = {}
    order: list[str] = []
    for i, prof in enumerate(_find(xml, "Profiles")):
        token = prof.get("token")
        if not token:
            continue
        source = _text(prof, "SourceToken") or f"_{i}"
        width = int(_text(prof, "Width") or 0)
        if source not in best:
            order.append(source)
        if source not in best or width > best[source][0]:
            best[source] = (width, token)
    return [best[s][1] for s in order]


def parse_stream_uri(xml: str) -> str | None:
    found = _find(xml, "Uri")
    return found[0].text.strip() if found and found[0].text else None


def with_credentials(url: str, user: str, password: str) -> str:
    parts = urlsplit(url)
    host = parts.hostname or ""
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}" + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _http_post(url: str, body: str) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body.encode(), headers={"Content-Type": "application/soap+xml; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=4) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def onvif_streams(onvif_url: str, user: str, password: str, post=None) -> tuple[dict, list[str]]:
    """Märke, modell och videoadresserna (med inloggning) som kameran själv anger. AuthError vid fel lösenord."""
    post = post or _http_post

    def call(url: str, body: str) -> str:
        status, text = post(url, _envelope(user, password, body))
        if status == 401 or "NotAuthorized" in text:
            raise AuthError()
        return text

    manufacturer, model = parse_device_info(call(onvif_url, "<tds:GetDeviceInformation/>"))
    brand = brand_from_text(f"{model or ''} {manufacturer or ''}")[0]
    caps = _find(call(onvif_url, '<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>'), "Media")
    media_url = (_text(caps[0], "XAddr") if caps else None) or onvif_url
    if urlsplit(media_url).hostname != urlsplit(onvif_url).hostname:
        media_url = onvif_url  # lösenordet skickas bara till kameran själv
    urls: list[str] = []
    for token in parse_profiles(call(media_url, "<trt:GetProfiles/>")):
        uri = parse_stream_uri(call(media_url,
            "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol>"
            f"</tt:Transport></trt:StreamSetup><trt:ProfileToken>{escape(token)}</trt:ProfileToken></trt:GetStreamUri>"))
        if uri and uri.lower().startswith("rtsp"):
            full = with_credentials(uri, user, password)
            if full not in urls:
                urls.append(full)
    return {"brand": brand, "model": model}, urls


# ------------------------------------------------------------- Koppla kameran
MAX_CHANNELS = 16
ERRORS = {
    "unreachable": "Adressen måste vara en kamera i restaurangens nät.",
    "auth": "Fel användarnamn eller lösenord.",
    "no_stream": "Kameran svarar men ger ingen video. Slå på RTSP i kamerans app (se guiden) och försök igen.",
}


def rtsp_digest(user: str, password: str, realm: str, nonce: str, method: str, uri: str) -> str:
    ha1 = hashlib.md5(f"{user}:{realm}:{password}".encode()).hexdigest()
    ha2 = hashlib.md5(f"{method}:{uri}".encode()).hexdigest()
    response = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
    return f'Digest username="{user}", realm="{realm}", nonce="{nonce}", uri="{uri}", response="{response}"'


def _describe(url: str, timeout: float = 3.0) -> int | None:
    """RTSP DESCRIBE med inloggningen i adressen. Svarskoden (200, 401, 404 …) eller None om kameran inte svarar."""
    parts = urlsplit(url)
    if not parts.hostname:
        return None
    user, password = unquote(parts.username or ""), unquote(parts.password or "")
    bare = urlunsplit((parts.scheme, f"{parts.hostname}:{parts.port or 554}", parts.path, parts.query, ""))

    def send(sock, cseq: int, auth: str | None) -> tuple[int | None, str]:
        lines = [f"DESCRIBE {bare} RTSP/1.0", f"CSeq: {cseq}", "Accept: application/sdp", "User-Agent: Bordvakt"]
        if auth:
            lines.append(f"Authorization: {auth}")
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head and len(head) < 16384:
            chunk = sock.recv(4096)
            if not chunk:
                break
            head += chunk
        text = head.decode("latin-1")
        m = re.match(r"RTSP/1\.0 (\d{3})", text)
        return (int(m.group(1)) if m else None), text

    try:
        with socket.create_connection((parts.hostname, parts.port or 554), timeout=timeout) as sock:
            sock.settimeout(timeout)
            status, text = send(sock, 1, None)
            if status != 401:
                return status
            digest = re.search(r'WWW-Authenticate:\s*Digest\s+([^\r\n]+)', text, re.I)
            if digest:
                fields = dict(re.findall(r'(\w+)="([^"]*)"', digest.group(1)))
                auth = rtsp_digest(user, password, fields.get("realm", ""), fields.get("nonce", ""), "DESCRIBE", bare)
            else:
                auth = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
            status, _ = send(sock, 2, auth)
            return status
    except OSError:
        return None


def _grab(url: str) -> str | None:
    """'ok' om adressen ger video, 'auth' vid fel inloggning, annars None."""
    status = _describe(url)
    if status == 401:
        return "auth"
    if status != 200:
        return None
    import cv2  # bara här: modulens rena funktioner ska gå att testa utan OpenCV
    cap = cv2.VideoCapture(url, cv2.CAP_ANY, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 4000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 4000])
    try:
        if cap.isOpened():
            for _ in range(5):
                ok, frame = cap.read()
                if ok and frame is not None:
                    return "ok"
    finally:
        cap.release()
    return None


def _fail(reason: str) -> dict:
    return {"ok": False, "reason": reason, "error": ERRORS[reason]}


def _channels(ip: str, brand: str, user: str, password: str, grab, start: int = 1) -> tuple[list[dict], bool]:
    """Kanal start, start+1, … tills en kanal inte svarar. (kanaler, fick fel lösenord)"""
    found: list[dict] = []
    last = 1 if brand in SINGLE_CHANNEL else MAX_CHANNELS
    for ch in range(start, last + 1):
        url = rtsp_url(ip, brand, user, password, ch)
        result = grab(url)
        if result == "auth" and not found:
            return [], True
        if result != "ok":
            break
        found.append({"channel": ch, "stream_url": url})
    return found, False


def connect(ip: str, user: str, password: str, brand: str | None = None, onvif_url: str | None = None,
            grab=None, onvif=None, reachable=None) -> dict:
    """Hittar kamerans videoadress(er). Lösenordet står bara i stream_url, aldrig i fel."""
    if not is_private_ip(ip):
        return _fail("unreachable")
    grab = grab or _grab
    onvif = onvif or onvif_streams
    model = None
    auth_failed = False

    if onvif_url and urlsplit(onvif_url).hostname == ip:
        try:
            info, urls = onvif(onvif_url, user, password)
            brand = brand or info.get("brand")
            model = info.get("model")
            channels = []
            for url in urls:
                if urlsplit(url).hostname != ip:
                    continue
                result = grab(url)
                auth_failed = auth_failed or result == "auth"
                if result == "ok":
                    channels.append({"channel": len(channels) + 1, "stream_url": url})
                if len(channels) >= MAX_CHANNELS:
                    break
            if channels:
                return {"ok": True, "brand": brand, "model": model, "channels": channels}
        except AuthError:
            return _fail("auth")
        except Exception:
            pass  # ONVIF avstängt eller trasigt: prova märkets sökvägar

    if brand in RTSP_PATHS:
        channels, auth = _channels(ip, brand, user, password, grab)
        if channels:
            return {"ok": True, "brand": brand, "model": model, "channels": channels}
        auth_failed = auth_failed or auth
    else:
        for candidate in RTSP_PATHS:
            result = grab(rtsp_url(ip, candidate, user, password, 1))
            if result == "auth":
                auth_failed = True
            if result == "ok":
                first = {"channel": 1, "stream_url": rtsp_url(ip, candidate, user, password, 1)}
                more = [] if candidate in SINGLE_CHANNEL else _channels(ip, candidate, user, password, grab, start=2)[0]
                return {"ok": True, "brand": candidate, "model": model, "channels": [first, *more]}
    if auth_failed:
        return _fail("auth")
    reachable = reachable or _open
    if not any(reachable(ip, port) for port in (RTSP_PORT.get(brand or "", 554), 80)):
        return {"ok": False, "reason": "unreachable",
                "error": f"Ingen kamera svarar på {ip}. Kontrollera att kameran är på och kopplad till samma nät som AI-datorn."}
    return _fail("no_stream")


# ------------------------------------------------------------- Placeringskollen
def placement(detections: list, frame_shape: tuple, problem: str | None, plan_tables: int) -> dict:
    """Hur många bord kameran ser, och vad som kan bli bättre. Tipsen är koder som webbappen översätter."""
    from local_ai import CHAIR, DINING_TABLE, ISSUE_BLURRY, ISSUE_DARK
    h, w = frame_shape[:2]
    tables = [d for d in detections if d.cls == DINING_TABLE and d.score >= 0.35]
    chairs = [d for d in detections if d.cls == CHAIR and d.score >= 0.35]
    boxes = [[round(d.box[0] / w, 3), round(d.box[1] / h, 3), round(d.box[2] / w, 3), round(d.box[3] / h, 3)] for d in tables]
    tips = []
    if problem == ISSUE_DARK:
        tips.append("too_dark")
    if problem == ISSUE_BLURRY:
        tips.append("blurry")
    if not tables:
        tips.append("no_tables")
    elif plan_tables and len(tables) < plan_tables / 2:
        tips.append("few_tables")
    low = [b for b in boxes if (b[1] + b[3]) / 2 > 0.8]
    if len(tables) >= 2 and len(low) > len(tables) / 2:
        tips.append("too_low")
    return {"tables_seen": len(tables), "chairs_seen": len(chairs), "boxes": boxes, "plan_tables": plan_tables, "tips": tips}
