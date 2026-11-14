"""Skyddet runt AI-motorns webbserver (AI.py).

- Varje restaurang har en egen nyckel, räknad ur service-nyckeln och restaurangens id.
  Next.js-servern skickar den i X-Bordvakt-Key. Läcker en restaurangs nyckel påverkar det
  inte någon annan restaurang.
- Webbläsaren får aldrig nyckeln. Den får en biljett ("<utgång>.<signatur>") från
  /api/engine/access som bara gäller för den här restaurangen och i högst några timmar.
- Bara webbappens egna adresser (WEB_ORIGINS i .env) får läsa svaren från en webbläsare.
"""

import hashlib
import hmac
import time

MAX_TICKET_SECONDS = 6 * 60 * 60


def base_key(service_key: str) -> str:
    return hashlib.sha256(f"bordvakt-engine:{service_key}".encode()).hexdigest() if service_key else ""


def engine_key(service_key: str, restaurant_id: str | None) -> str:
    """Restaurangens nyckel. Tom sträng = inget får anropa motorn."""
    base = base_key(service_key)
    if not base or not restaurant_id:
        return ""
    return hmac.new(base.encode(), f"restaurant:{restaurant_id}".encode(), hashlib.sha256).hexdigest()


def make_ticket(key: str, restaurant_id: str, seconds: int = 7200, now: float | None = None) -> str:
    exp = int((now or time.time()) + seconds)
    sig = hmac.new(key.encode(), f"view:{restaurant_id}:{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def ticket_ok(key: str, restaurant_id: str | None, ticket: str, now: float | None = None) -> bool:
    if not key or not restaurant_id or not ticket or len(ticket) > 200:
        return False
    exp_text, _, sig = ticket.partition(".")
    try:
        exp = int(exp_text)
    except ValueError:
        return False
    now = now or time.time()
    if exp < now or exp > now + MAX_TICKET_SECONDS:
        return False
    want = hmac.new(key.encode(), f"view:{restaurant_id}:{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, want)


def key_ok(key: str, given: str) -> bool:
    return bool(key) and hmac.compare_digest(given or "", key)


def parse_origins(raw: str) -> list[str]:
    return [o.strip().rstrip("/") for o in (raw or "").split(",") if o.strip()]


def allowed_origin(origin: str | None, allowed: list[str]) -> str | None:
    """Vilket värde Access-Control-Allow-Origin ska få, eller None (webbläsaren nekas).
    Utan WEB_ORIGINS släpps bara den egna datorn och det lokala nätet in (utveckling)."""
    if not origin:
        return None
    origin = origin.rstrip("/")
    if allowed:
        return origin if origin in allowed else None
    host = origin.split("://", 1)[-1].split(":", 1)[0]
    local = host in ("localhost", "127.0.0.1") or host.startswith(("192.168.", "10.")) or host.endswith(".local")
    if host.startswith("172."):
        parts = host.split(".")
        local = len(parts) > 1 and parts[1].isdigit() and 16 <= int(parts[1]) <= 31
    return origin if local else None


def parse_code(raw: str) -> dict | None:
    """Kopplingskoden från webbappen (Inställningar → AI-datorn): "BV1.<base64url-json>".
    Innehåller databasens adress (u), publika nyckel (a), restaurangen (r), AI-kontots
    inloggning (e, p) och nyckeln mot AI-motorn (k). None om koden saknas eller är trasig."""
    import base64
    import json

    raw = (raw or "").strip()
    if not raw.startswith("BV1."):
        return None
    body = raw[4:]
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:
        return None
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) and data[k] for k in "uarepk"):
        return None
    return data
