"""Kameraguiden: hittar kamerorna i restaurangens nät, kopplar dem och kontrollerar placeringen.

Allt här bygger på det kameran själv svarar (ONVIF) eller på märkenas kända videoadresser.
Ingen språkmodell används: en gissad adress är värre än ingen.
Lösenord skrivs aldrig ut och står aldrig i felmeddelanden.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import quote

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
