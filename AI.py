"""
Bordvakt AI-motor.

1. Läser videoflödet från varje kamera i camera_feeds (RTSP, eller "0" = webbkamera).
2. Var FRAME_INTERVAL:e sekund analyseras varje bords ruta (ROI) av Bordvakts
   egen AI i local_ai.py. Allt körs på datorn: gratis, och inga bilder lämnar den.
3. En ny status sparas först när den varit stabil i STABLE_FRAMES analyser i rad.
4. Statusändringar skapar/avslutar uppgifter i tabellen tasks.
5. Videoflödet delas som MJPEG på http://localhost:STREAM_PORT/stream/<kamera-id>
   så att dashboarden kan visa det (webbläsare kan inte spela RTSP direkt).
6. http://localhost:STREAM_PORT/status talar om för dashboarden om kamerorna
   ger bild och om AI-analysen är igång.

7. POST /analyze-floor-plan tar emot ett foto av matsalen och returnerar ett
   utkast till planritning.

Utan service-nyckel körs motorn i "bara video"-läge: videon visas, men inga statusar sparas.
"""

import base64
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import cv2
import numpy as np
from dotenv import load_dotenv

import sys  # noqa: E402

# Skriv ut direkt (annars syns inget i loggen förrän bufferten är full)
sys.stdout.reconfigure(line_buffering=True)
from supabase import Client, create_client

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import local_ai  # noqa: E402 (läser inställningar från .env, så den laddas efter)
import local_chat  # noqa: E402
import local_menu  # noqa: E402
import engine_security as sec  # noqa: E402
import engine_tunnel  # noqa: E402


def read_env(name: str) -> str:
    """Tom sträng om värdet saknas eller fortfarande är en platshållare."""
    value = os.environ.get(name, "").strip()
    return "" if not value or "DIN_" in value or "DITT-" in value else value


SUPABASE_URL = read_env("SUPABASE_URL")
SUPABASE_SERVICE_KEY = read_env("SUPABASE_SERVICE_KEY")
SUPABASE_ANON_KEY = read_env("SUPABASE_ANON_KEY")
# Kopplingskoden från webbappen (Inställningar → AI-datorn). Med den behövs ingen
# service-nyckel: datorn loggar in med ett eget konto som bara når den egna restaurangen.
ENGINE_CODE = sec.parse_code(os.environ.get("ENGINE_CODE", ""))
if os.environ.get("ENGINE_CODE", "").strip() and not ENGINE_CODE:
    raise SystemExit("Fel: ENGINE_CODE i .env är trasig. Skapa en ny i webbappen: Inställningar → AI-datorn.")
if ENGINE_CODE:
    SUPABASE_URL, SUPABASE_ANON_KEY = ENGINE_CODE["u"], ENGINE_CODE["a"]
    if SUPABASE_SERVICE_KEY:
        print("Obs: ENGINE_CODE används. Ta bort SUPABASE_SERVICE_KEY ur .env, den behövs inte längre.")
        SUPABASE_SERVICE_KEY = ""
if not SUPABASE_URL or not (SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY):
    raise SystemExit("Fel: SUPABASE_URL och SUPABASE_SERVICE_KEY (eller SUPABASE_ANON_KEY) måste fyllas i i .env.")

# Analysen kräver att datorn får spara statusar: kopplingskoden (eller service-nyckeln)
CAN_WRITE = bool(ENGINE_CODE or SUPABASE_SERVICE_KEY)
if not CAN_WRITE:
    AI_DISABLED_REASON = "Kopplingskoden (ENGINE_CODE) saknas i .env"
else:
    AI_DISABLED_REASON = None
AI_ENABLED = AI_DISABLED_REASON is None
FRAME_INTERVAL = float(os.environ.get("FRAME_INTERVAL", "1"))
STABLE_FRAMES = int(os.environ.get("STABLE_FRAMES", "5"))
STREAM_PORT = int(os.environ.get("STREAM_PORT", "8080"))
CAMERA_WIDTH = int(os.environ.get("CAMERA_WIDTH", "1280"))  # bildbredd som läses från kameran
# Hur ofta en bild avkodas när ingen tittar på videon (räcker för analysen)
ANALYZE_DECODE_SEC = min(0.5, FRAME_INTERVAL / 2)
CONFIG_RELOAD_SECONDS = 60
CONTEXT_SECONDS = 5  # hur ofta beställningar och avdukningar hämtas
STRICT_RELOAD_SECONDS = 300  # hur ofta falsklarmen läses in
PREP_RELOAD_SECONDS = 600    # hur ofta kökets tider per rätt räknas om

# Vilken uppgift en status skapar
TASK_FOR_STATUS = {
    "AWAITING_FOOD": "FOOD_DELIVERY",
    "NEEDS_ATTENTION": "SERVICE",
    "NEEDS_CLEANING": "CLEANING",
    "DESSERT_OPPORTUNITY": "DESSERT",
    "WANTS_BILL": "BILL",  # gästerna har ätit klart och vill troligen betala
    "EMERGENCY": "EMERGENCY",  # Akut läge: en gäst har tappat något. Avslutas bara av personalen.
}
# Uppgifter som löser sig själva när bordet byter status, t.ex. maten har kommit fram
AUTO_RESOLVE = {
    "OCCUPIED": ("FOOD_DELIVERY", "CLEANING", "BILL"),
    "AVAILABLE": ("CLEANING", "DESSERT", "FOOD_DELIVERY", "BILL"),
    "NEEDS_CLEANING": ("DESSERT", "FOOD_DELIVERY", "BILL"),
    "DESSERT_OPPORTUNITY": ("FOOD_DELIVERY",),
    "WANTS_BILL": ("FOOD_DELIVERY", "DESSERT"),
}

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY)
# Vilken restaurang den här datorn bevakar (sätts i main(), från RESTAURANT_ID i .env)
RESTAURANT_ID = ENGINE_CODE["r"] if ENGINE_CODE else read_env("RESTAURANT_ID")
local_model: local_ai.LocalTableAI | None = None  # skapas i main()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Flera foton av matsalen (väggar och hörn) skickas tillsammans
MAX_MULTI_UPLOAD_BYTES = 40 * 1024 * 1024
# En kamera räknas som frånkopplad om ingen bild kommit på så här många sekunder
FRAME_TIMEOUT = 5


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- Video ingest

class CameraReader(threading.Thread):
    """Läser kameran hela tiden och håller den senaste bildrutan.
    (RTSP buffrar annars gamla bildrutor om man bara läser då och då.)"""

    def __init__(self, camera_id: str, name: str, stream_url: str):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.name = name
        self.url = stream_url
        self.source = int(stream_url) if stream_url.isdigit() else stream_url
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.frame = None
        self.jpeg = None
        self.online = None
        self.last_frame_at = 0.0
        self.viewers = 0  # antal öppna videoflöden i webbläsare

    def is_live(self) -> bool:
        return time.time() - self.last_frame_at < FRAME_TIMEOUT

    def set_online(self, online: bool):
        if online == self.online:
            return
        self.online = online
        print(f"[{self.name}] {'Ansluten' if online else 'Ingen bild'}")
        if not online and isinstance(self.source, int):
            print(f"[{self.name}] Tips: tillåt kameran för Terminal i Systeminställningar → Integritet och säkerhet → Kamera.")
        if not CAN_WRITE:
            return  # anon-nyckeln får inte skriva
        try:
            supabase.table("camera_feeds").update(
                {"status": "ONLINE" if online else "OFFLINE"}
            ).eq("id", self.camera_id).execute()
        except Exception as e:
            print(f"[{self.name}] Kunde inte uppdatera kamerastatus: {e}")

    def stop(self):
        """Kameran har tagits bort eller fått ny adress."""
        self.stopped.set()

    def run(self):
        while not self.stopped.is_set():
            cap = cv2.VideoCapture(self.source)
            if not cap.isOpened():
                self.set_online(False)
                self.stopped.wait(5)
                continue
            # Lägre upplösning räcker för AI:n och sparar mycket CPU och RAM
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_WIDTH * 9 // 16)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            last_decode = last_encode = 0.0
            while not self.stopped.is_set():
                # grab() hämtar bildrutan (så att RTSP inte buffrar gamla), men
                # den avkodas bara när någon behöver den.
                if not cap.grab():
                    break
                now = time.time()
                watching = self.viewers > 0
                if now - last_decode < (0.1 if watching else ANALYZE_DECODE_SEC):
                    continue
                ok, frame = cap.retrieve()
                if not ok:
                    break
                last_decode = now
                self.set_online(True)
                if frame.shape[1] > CAMERA_WIDTH:  # kameran struntade i önskad storlek
                    frame = cv2.resize(frame, (CAMERA_WIDTH, frame.shape[0] * CAMERA_WIDTH // frame.shape[1]),
                                       interpolation=cv2.INTER_AREA)
                # JPEG till webbflödet görs bara när någon tittar (max ~10/s)
                encoded = None
                if watching and now - last_encode > 0.1:
                    ok_jpg, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    if ok_jpg:
                        encoded = buf.tobytes()
                        last_encode = now
                with self.lock:
                    self.last_frame_at = now
                    self.frame = frame
                    if encoded:
                        self.jpeg = encoded
                    elif not watching:
                        self.jpeg = None  # släpp gammal bild från minnet

            cap.release()
            if self.stopped.is_set():
                return
            self.set_online(False)
            self.stopped.wait(2)

    def latest_frame(self):
        # Bildrutan byts ut, den ändras aldrig på plats, så ingen kopia behövs
        with self.lock:
            return self.frame

    def latest_jpeg(self):
        with self.lock:
            return self.jpeg


cameras: dict[str, CameraReader] = {}
setup: dict = {}  # svaret från setup_status() i databasen
reload_requested = threading.Event()

# Restaurangens nyckel, som Next.js-servern skickar med (se engine_security.py). Räknas fram
# ur service-nyckeln och restaurangens id i main(), så inget mer behöver ställas in.
ENGINE_KEY = ""
# Webbappens adresser som får läsa svaren från en webbläsare, t.ex. https://app.bordvakt.se
WEB_ORIGINS = sec.parse_origins(os.environ.get("WEB_ORIGINS", ""))
if not WEB_ORIGINS and ENGINE_CODE and ENGINE_CODE.get("w"):
    WEB_ORIGINS = sec.parse_origins(ENGINE_CODE["w"])
# Tunnel till internet (engine_tunnel.py)
ENGINE_TUNNEL = os.environ.get("ENGINE_TUNNEL", "auto").strip().lower()
ENGINE_PUBLIC_URL = os.environ.get("ENGINE_PUBLIC_URL", "").strip().rstrip("/")
CLOUDFLARE_TUNNEL_TOKEN = os.environ.get("CLOUDFLARE_TUNNEL_TOKEN", "").strip()
# Högst så här många som tittar på samma kamera samtidigt (skydd mot överbelastning)
MAX_VIEWERS = int(os.environ.get("MAX_VIEWERS", "12"))


# ----------------------------------------------------------- MJPEG-videoserver

class StreamHandler(BaseHTTPRequestHandler):
    server_version = "Bordvakt"
    sys_version = ""
    timeout = 60  # stänger anslutningar som inte skickar något (långsamma attacker)

    def end_headers(self):
        origin = sec.allowed_origin(self.headers.get("Origin"), WEB_ORIGINS)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def query_param(self, name: str) -> str:
        values = parse_qs(urlsplit(self.path).query).get(name)
        return values[0] if values else ""

    def server_call(self) -> bool:
        """Anropet kommer från Next.js-servern (har restaurangens nyckel)."""
        return sec.key_ok(ENGINE_KEY, self.headers.get("X-Bordvakt-Key", ""))

    def viewer_call(self) -> bool:
        """Anropet kommer från en inloggad i webbappen (har en giltig biljett)."""
        ticket = self.headers.get("X-Bordvakt-Ticket") or self.query_param("t")
        return sec.ticket_ok(ENGINE_KEY, RESTAURANT_ID, ticket)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Access-Control-Allow-Headers", "X-Bordvakt-Ticket")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_status(self):
        body = json.dumps({
            "ai_enabled": AI_ENABLED,
            "ai_disabled_reason": AI_DISABLED_REASON,
            "setup_complete": bool(setup.get("complete")),
            "setup_step": setup.get("step"),
            "cameras": {cid: {"online": cam.is_live()} for cid, cam in cameras.items()},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit: int) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length <= 0 or length > limit:
            return None
        return self.rfile.read(length)

    def do_POST(self):
        """Anropas av Next.js-servern (inte av webbläsaren) och kräver motorns nyckel."""
        path = self.path.split("?")[0]
        if not self.server_call():
            self.send_json(403, {"error": "AI-motorn kräver service-nyckeln i både .env och web/.env.local."})
            return
        if path == "/chat":
            self.chat()  # behöver inte kamera-AI:n
            return
        if path == "/analyze-menu":
            self.analyze_menu()
            return
        if path == "/support-summary":
            try:
                body = json.loads(self.read_body(50_000) or b"{}")
                self.send_json(200, local_chat.summarize_ticket(
                    str(body.get("topic", "")), str(body.get("message", "")), str(body.get("facts", ""))))
            except local_chat.ChatUnavailable as e:
                self.send_json(503, {"error": str(e)})
            return
        if local_model is None:
            self.send_json(503, {"error": "AI:n startar fortfarande. Försök igen om en stund."})
            return
        try:
            if path == "/analyze-floor-plan":
                data = self.read_body(MAX_UPLOAD_BYTES)
                if data is None:
                    self.send_json(413, {"error": "Bilden saknas eller är för stor (max 10 MB)."})
                    return
                self.send_json(200, local_model.floor_plan_from_photo(data))
            elif path == "/analyze-floor-plan-multi":
                data = self.read_body(MAX_MULTI_UPLOAD_BYTES)
                if data is None:
                    self.send_json(413, {"error": "Fotona saknas eller är för stora (max 40 MB totalt)."})
                    return
                photos = json.loads(data).get("photos", [])
                self.send_json(200, local_model.floor_plan_from_photos(photos))
            elif path == "/reload":
                reload_requested.set()
                self.send_json(200, {"ok": True})
            elif path == "/test-camera":
                body = json.loads(self.read_body(10_000) or b"{}")
                self.send_json(200, test_camera(str(body.get("stream_url", "")).strip()))
            elif path == "/calibrate":
                body = json.loads(self.read_body(10_000) or b"{}")
                ok, result = calibrate_table(str(body.get("table_id", "")))
                self.send_json(200 if ok else 422, result)
            else:
                self.send_json(404, {"error": "Okänd adress"})
        except Exception as e:
            print(f"{path} misslyckades: {e}")
            message = "Kunde inte läsa bilden. Använd JPG eller PNG." if "läsa bilden" in str(e) else "Något gick fel i AI-motorn."
            self.send_json(500, {"error": message})

    def analyze_menu(self):
        """Fota menyn: utkast till kategorier och rätter. {photos: [base64, ...]}"""
        data = self.read_body(MAX_MULTI_UPLOAD_BYTES)
        if data is None:
            self.send_json(413, {"error": "Fotona saknas eller är för stora (max 40 MB totalt)."})
            return
        try:
            photos = [base64.b64decode(p) for p in json.loads(data).get("photos", [])[:8]]
            if not photos:
                self.send_json(400, {"error": "Inga foton skickades."})
                return
            self.send_json(200, local_menu.menu_from_photos(photos))
        except local_menu.MenuReadError as e:
            self.send_json(422, {"error": str(e)})
        except Exception as e:
            print(f"/analyze-menu misslyckades: {e}")
            self.send_json(500, {"error": "Något gick fel när menyn lästes."})

    def chat(self):
        """Vakti: svaret skickas i bitar medan modellen skriver."""
        try:
            body = json.loads(self.read_body(100_000) or b"{}")
            parts = local_chat.open_chat(body.get("messages"), str(body.get("facts", "")),
                                         str(body.get("language", "sv")))
        except ValueError as e:
            self.send_json(400, {"error": str(e)})
            return
        except local_chat.ChatUnavailable as e:
            print(f"Chatten: {e}")
            self.send_json(503, {"error": str(e)})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            for text in parts:
                self.wfile.write(text.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # användaren stängde chatten
        except Exception as e:
            print(f"Chatten avbröts: {e}")

    def do_GET(self):
        path = self.path.split("?")[0]  # ta bort ?k=... som webbläsaren lägger till
        if path == "/health":
            # Säger bara att motorn lever (för tunneln och felsökning), inget om restaurangen
            self.send_json(200, {"ok": True})
            return
        if not (self.server_call() or self.viewer_call()):
            self.send_json(401, {"error": "Biljett saknas eller har gått ut. Ladda om sidan."})
            return
        if path == "/status":
            self.send_status()
            return
        parts = path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "stream" or parts[1] not in cameras:
            self.send_json(404, {"error": "Okänd kamera"})
            return

        camera = cameras[parts[1]]
        if camera.viewers >= MAX_VIEWERS:
            self.send_json(429, {"error": "För många tittar på kameran just nu."})
            return
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        last = None
        with camera.lock:
            camera.viewers += 1
        last_sent = 0.0
        try:
            # Slutar när kameran tas bort. Senaste bilden skickas om då och då även om
            # kameran är tyst, annars märks det aldrig att webbläsaren har stängt fliken.
            while not camera.stopped.is_set():
                jpeg = camera.latest_jpeg()
                if jpeg is not None and (jpeg is not last or time.time() - last_sent > 2):
                    last, last_sent = jpeg, time.time()
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                    self.wfile.write(jpeg + b"\r\n")
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Webbläsaren stängde fliken
        finally:
            with camera.lock:
                camera.viewers -= 1

    def log_message(self, *args):
        pass


def save_engine_url(url: str):
    """Sparar tunnelns adress så att webbappen hittar hit."""
    try:
        supabase.table("restaurants").update({"engine_url": url}).eq("id", RESTAURANT_ID).execute()
        print(f"Tunnel öppen: {url} (sparad, webbappen hittar hit)")
    except Exception as e:
        hint = " Kör supabase/013_security.sql i Supabase." if "engine_url" in str(e) else ""
        print(f"Tunnel öppen: {url}, men adressen kunde inte sparas: {e}{hint}")


last_session_check = 0.0


def sign_in():
    """Loggar in med AI-datorns konto (kopplingskoden)."""
    supabase.auth.sign_in_with_password({"email": ENGINE_CODE["e"], "password": ENGINE_CODE["p"]})


def ensure_session():
    """Håller inloggningen vid liv (förnyas automatiskt; loggar in igen om det behövs)."""
    global last_session_check
    if not ENGINE_CODE or time.time() - last_session_check < 60:
        return
    last_session_check = time.time()
    try:
        if supabase.auth.get_session() is None:
            sign_in()
    except Exception as e:
        try:
            sign_in()
        except Exception:
            print(f"Kunde inte logga in med kopplingskoden: {e}")


def start_stream_server():
    tunnel = False
    if ENGINE_TUNNEL != "off" and AI_ENABLED:
        tunnel = engine_tunnel.start(STREAM_PORT, CLOUDFLARE_TUNNEL_TOKEN, ENGINE_PUBLIC_URL, save_engine_url)
        if not tunnel:
            print("Ingen tunnel: installera cloudflared (brew install cloudflared) så når webbappen hit från internet.")
    # Med tunnel behöver ingen annan på nätet nå datorn direkt
    host = os.environ.get("STREAM_HOST") or ("127.0.0.1" if tunnel else "0.0.0.0")
    server = ThreadingHTTPServer((host, STREAM_PORT), StreamHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"AI-motorn lyssnar på {host}:{STREAM_PORT} (video och status kräver inloggning i webbappen)")


# ------------------------------------------- Tröskelvärden & event-triggers

class TableTracker:
    """Håller bordets bekräftade status. En ny status bekräftas först efter
    STABLE_FRAMES likadana analyser i rad, för att undvika falsklarm."""

    def __init__(self, status: str):
        self.confirmed = status
        self.candidate = status
        self.count = 0

    def observe(self, status: str) -> bool:
        """Returnerar True när statusen precis har bytts."""
        if status == local_ai.EMERGENCY and self.confirmed != status:
            # Akut läge väntar inte: AI:n har redan vägt flera tecken över flera sekunder
            self.confirmed, self.candidate, self.count = status, status, 0
            return True
        if status == self.confirmed:
            self.candidate, self.count = status, 0
            return False
        if status == self.candidate:
            self.count += 1
        else:
            self.candidate, self.count = status, 1
        if self.count >= STABLE_FRAMES:
            self.confirmed, self.count = status, 0
            return True
        return False


trackers: dict[str, TableTracker] = {}
ai_resolved: set[str] = set()


def apply_status_change(table, new_status: str, issue: str | None = None):
    table_id = table["id"]
    number = table["table_number"]
    print(f"Bord {number}: {table['status']} -> {new_status}{f' ({issue})' if issue else ''}")

    supabase.table("tables").update(
        {"status": new_status, "camera_issue": issue, "last_updated": now_iso()}
    ).eq("id", table_id).execute()
    table["status"] = new_status
    table["camera_issue"] = issue

    resolved = AUTO_RESOLVE.get(new_status)
    if resolved:
        done = supabase.table("tasks").update(
            {"status": "COMPLETED", "resolved_at": now_iso()}
        ).eq("table_id", table_id).in_("type", list(resolved)).eq("status", "PENDING").execute()
        # Kom ihåg vad AI:n själv avslutade, så att det inte tolkas som att personalen dukat av
        ai_resolved.update(row["id"] for row in done.data or [])

    task_type = TASK_FOR_STATUS.get(new_status)
    if task_type:
        existing = (
            supabase.table("tasks").select("id")
            .eq("table_id", table_id).eq("type", task_type).eq("status", "PENDING")
            .execute()
        )
        if not existing.data:
            global sos_details_missing
            try:
                supabase.table("tasks").insert(new_task(table_id, task_type)).execute()
            except Exception as e:
                if task_type != "EMERGENCY" or sos_details_missing or "column" not in str(e).lower():
                    raise
                sos_details_missing = True
                print("Kör supabase/008_sos_details.sql för att spara vad som tappades och slå på Falsklarm.")
                supabase.table("tasks").insert(new_task(table_id, task_type)).execute()
            print(f"Bord {number}: ny uppgift {task_type}")


sos_details_missing = False  # 008 är inte körd: SOS sparas utan detaljer


def new_task(table_id: str, task_type: str) -> dict:
    """En ny uppgift. SOS får med vad som hände, och köket får veta om mat tappades."""
    row = {"table_id": table_id, "type": task_type}
    alarm = local_model.emergency(table_id) if task_type == "EMERGENCY" and local_model else None
    if alarm and not sos_details_missing:
        row.update(detail=alarm.reason, sos_kind=alarm.kind, sos_trigger=alarm.trigger)
        if alarm.kind == "food":
            row["kitchen_status"] = "PENDING"
    return row


# ------------------------------------------------------------- Huvudloop

def request_camera_permission(index: int):
    """macOS kan bara fråga om kameratillstånd från huvudtråden,
    så webbkameran öppnas en gång här innan läsartråden tar över."""
    cap = cv2.VideoCapture(index)
    cap.release()


TABLE_FIELDS = "id,table_number,camera_id,roi_x1,roi_y1,roi_x2,roi_y2,status,camera_issue,floor_plan_id"
anchor_cache: dict[str, tuple[str, np.ndarray | None]] = {}


def attach_anchor(table: dict, calibration: dict | None):
    """Lägger bordets kalibreringsbild i table["_anchor"] om kalibreringen gäller
    bordets nuvarande kamera och ruta, annars None (= inte kalibrerat)."""
    table["_anchor"] = None
    if not calibration or calibration["camera_id"] != table["camera_id"]:
        return
    if any(calibration[k] != table[k] for k in ("roi_x1", "roi_y1", "roi_x2", "roi_y2")):
        return
    cached = anchor_cache.get(table["id"])
    if cached is None or cached[0] != calibration["anchor_png"]:
        cached = (calibration["anchor_png"], local_ai.decode_anchor(calibration["anchor_png"]))
        anchor_cache[table["id"]] = cached
    table["_anchor"] = cached[1]


def pick_restaurant() -> str:
    """Restaurangen som bevakas: RESTAURANT_ID i .env, eller den enda som finns."""
    rows = supabase.table("restaurants").select("id,name").order("created_at").execute().data
    if RESTAURANT_ID:
        match = next((r for r in rows if r["id"] == RESTAURANT_ID), None)
        if match is None:
            raise SystemExit(f"Fel: RESTAURANT_ID={RESTAURANT_ID} i .env finns inte i databasen.")
        return match["id"]
    if len(rows) == 1:
        return rows[0]["id"]
    if not rows:
        raise SystemExit("Fel: det finns ingen restaurang än. Skapa ett konto på http://localhost:3000/signup först.")
    names = "\n".join(f"  RESTAURANT_ID={r['id']}   ({r['name']})" for r in rows)
    raise SystemExit("Fel: det finns flera restauranger. Skriv in vilken den här datorn bevakar i .env:\n" + names)


table_ids: list[str] = []  # restaurangens bord, för att bara hämta dess uppgifter


def load_config():
    """Hämtar installationens läge, kameror och bord. Körs om regelbundet så att
    ändringar i installationen slår igenom utan omstart."""
    global setup, table_ids
    setup = supabase.rpc("setup_status", {"p_restaurant_id": RESTAURANT_ID}).execute().data or {}

    feeds = supabase.table("camera_feeds").select("id,name").eq("restaurant_id", RESTAURANT_ID).execute().data
    feed_ids = [f["id"] for f in feeds]
    streams = {
        row["camera_id"]: row["stream_url"]
        for row in (supabase.table("camera_streams").select("camera_id,stream_url")
                    .in_("camera_id", feed_ids).execute().data if feed_ids else [])
    }
    wanted = {f["id"]: (f["name"], streams[f["id"]]) for f in feeds if streams.get(f["id"])}
    for camera_id in list(cameras):
        if camera_id not in wanted or cameras[camera_id].url != wanted[camera_id][1]:
            print(f"[{cameras[camera_id].name}] Kameran är borttagen eller ändrad.")
            cameras.pop(camera_id).stop()
    for camera_id, (name, url) in wanted.items():
        if camera_id in cameras:
            cameras[camera_id].name = name
            continue
        if url.isdigit():
            request_camera_permission(int(url))
        reader = CameraReader(camera_id, name, url)
        cameras[camera_id] = reader
        reader.start()

    # Bara bord som finns på den aktiva planritningen bevakas
    tables = (supabase.table("tables").select(TABLE_FIELDS).eq("restaurant_id", RESTAURANT_ID)
              .not_.is_("floor_plan_id", "null").execute().data)
    table_ids = [t["id"] for t in tables]
    calibrations = {
        row["table_id"]: row
        for row in (supabase.table("table_calibrations")
                    .select("table_id,camera_id,roi_x1,roi_y1,roi_x2,roi_y2,anchor_png")
                    .in_("table_id", table_ids).execute().data if table_ids else [])
    }
    for table in tables:
        attach_anchor(table, calibrations.get(table["id"]))
        tracker = trackers.get(table["id"])
        # Databasen avgör. Gick en sparning fel blir statusen annars aldrig sparad.
        if tracker is None or tracker.confirmed != table["status"]:
            trackers[table["id"]] = TableTracker(table["status"])
    return tables


# ------------------------------------------------------------- Installation

def test_camera(url: str) -> dict:
    """Försöker öppna en kamera innan den sparas. Returnerar en förhandsbild."""
    if not url:
        return {"ok": False, "error": "Ange kamerans adress."}
    if not (url.isdigit() or url.lower().startswith(("rtsp://", "rtsps://", "http://", "https://"))):
        return {"ok": False, "error": "Adressen ska börja med rtsp:// (eller vara ett nummer för webbkamera)."}
    frame = None
    running = next((c for c in cameras.values() if c.url == url and c.is_live()), None)
    if running is not None:
        frame = running.latest_frame()
    else:
        source = int(url) if url.isdigit() else url
        params = [] if url.isdigit() else [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000]
        cap = cv2.VideoCapture(source, cv2.CAP_ANY, params)
        try:
            if cap.isOpened():
                for _ in range(5):  # första bilderna kan vara tomma
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        break
        finally:
            cap.release()
    if frame is None:
        return {"ok": False, "error": "Kunde inte ansluta. Kontrollera IP-adress, användarnamn, lösenord och att kameran är på."}
    h, w = frame.shape[:2]
    preview = cv2.resize(frame, (480, max(1, h * 480 // w)), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 75])
    problem = local_ai.frame_problem(frame)
    return {
        "ok": True,
        "width": w,
        "height": h,
        "warning": problem,
        "preview": "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode() if ok else None,
    }


def calibrate_table(table_id: str) -> tuple[bool, dict]:
    """Sparar hur bordet ser ut i kameran just nu. Under drift jämförs bilden mot
    den, och bordet räknas bara som synligt när den stämmer."""
    rows = supabase.table("tables").select(TABLE_FIELDS).eq("id", table_id).eq("restaurant_id", RESTAURANT_ID).execute().data
    if not rows:
        return False, {"error": "Bordet finns inte."}
    table = rows[0]
    if not table["camera_id"] or table["roi_x1"] is None:
        return False, {"error": "Välj kamera och rita bordets ruta först."}

    # Nya kameror startas av huvudloopen: vänta tills den ger bild
    reload_requested.set()
    deadline = time.time() + 15
    camera = cameras.get(table["camera_id"])
    while time.time() < deadline and (camera is None or not camera.is_live()):
        time.sleep(0.5)
        camera = cameras.get(table["camera_id"])
    if camera is None or not camera.is_live():
        return False, {"error": "Kameran ger ingen bild. Testa anslutningen i steget Kameror."}

    frame = camera.latest_frame()
    roi = (table["roi_x1"], table["roi_y1"], table["roi_x2"], table["roi_y2"])
    box = local_model.table_box(frame, roi)
    anchor, error = local_ai.make_anchor(frame, frame[box[1]:box[3], box[0]:box[2]])
    if error:
        return False, {"error": error}
    supabase.table("table_calibrations").upsert({
        "table_id": table_id,
        "camera_id": table["camera_id"],
        "roi_x1": table["roi_x1"], "roi_y1": table["roi_y1"],
        "roi_x2": table["roi_x2"], "roi_y2": table["roi_y2"],
        "anchor_png": anchor,
    }).execute()
    local_model.forget_table(table_id)  # ny bild att jämföra mot: börja om
    reload_requested.set()
    print(f"Bord {table['table_number']}: kalibrerat.")
    return True, {"ok": True}


def parse_time(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


sessions_missing = False  # 012 är inte körd: statistiken sparas inte
unsaved_sessions: list[dict] = []


def save_sessions():
    """Sparar avslutade sittningar (för statistiken). Misslyckas det försöker vi igen nästa varv."""
    global sessions_missing
    if sessions_missing:
        return
    for table_id, start, end, guests in local_model.drain_sessions():
        unsaved_sessions.append({
            "restaurant_id": RESTAURANT_ID, "table_id": table_id, "guests": min(guests, 50),
            "started_at": datetime.fromtimestamp(start, timezone.utc).isoformat(),
            "ended_at": datetime.fromtimestamp(end, timezone.utc).isoformat(),
        })
    if not unsaved_sessions:
        return
    try:
        supabase.table("table_sessions").insert(unsaved_sessions).execute()
        unsaved_sessions.clear()
    except Exception as e:
        if "table_sessions" in str(e) and ("PGRST205" in str(e) or "does not exist" in str(e)):
            sessions_missing = True
            unsaved_sessions.clear()
            print("Tips: kör supabase/012_growth.sql i Supabase för att få statistik över sittningarna.")
        elif len(unsaved_sessions) > 500:
            del unsaved_sessions[:-500]
        else:
            print(f"Kunde inte spara sittningar: {e}")


class Context:
    """Det AI:n får veta från appen: beställningar och avdukningar."""

    def __init__(self):
        self.checked_from = now_iso()
        self.orders_missing = False
        self.restored = False  # har väntande SOS lästs in efter start?
        self.strict_at = 0.0     # när falsklarmen senast lästes in
        self.prep: dict[str, float] = {}  # minuter i köket per rätt (lär sig av beställningarna)
        self.prep_at = 0.0

    def sync(self):
        # Beställningar de senaste 6 timmarna
        if not self.orders_missing:
            if time.time() - self.prep_at > PREP_RELOAD_SECONDS:
                self.load_prep()
            since = datetime.fromtimestamp(time.time() - 6 * 3600, timezone.utc).isoformat()
            try:
                rows = (
                    supabase.table("orders").select("table_id,status,created_at,served_at,items")
                    .eq("restaurant_id", RESTAURANT_ID).gte("created_at", since).neq("status", "CANCELLED").execute().data
                )
                info: dict[str, local_ai.OrderInfo] = {}
                waiting: dict[str, list] = {}  # beställningar som köket inte gjort klara, per bord
                for row in rows:
                    o = info.setdefault(row["table_id"], local_ai.OrderInfo())
                    created_at = parse_time(row["created_at"])
                    if created_at:
                        o.orders += ((created_at, row["status"]),)
                    if row["status"] in ("RECEIVED", "PREPARING", "READY"):
                        created = parse_time(row["created_at"])
                        if created and (o.waiting_since is None or created < o.waiting_since):
                            o.waiting_since = created
                        if created:  # även READY: gästen väntar tills maten står på bordet
                            names = [i.get("name") for i in (row.get("items") or []) if isinstance(i, dict)]
                            waiting.setdefault(row["table_id"], []).append((created, names))
                    # served_at ligger kvar om någon backar SERVED -> READY, så kolla statusen också
                    served = parse_time(row["served_at"]) if row["status"] in ("SERVED", "COMPLETED") else None
                    if served and (o.served_at is None or served > o.served_at):
                        o.served_at = served
                for table_id, orders in waiting.items():
                    info[table_id].food_deadline = local_ai.food_deadline(orders, self.prep)
                local_model.set_orders(info)
            except Exception as e:
                if "orders" in str(e) and ("PGRST205" in str(e) or "does not exist" in str(e)):
                    self.orders_missing = True  # 003 är inte körd: AI:n klarar sig med bara kameran
                else:
                    print(f"Kunde inte hämta beställningar: {e}")

        # Avdukningar som personalen har klarmarkerat sedan förra gången
        if not table_ids:
            return
        if not self.restored:
            # SOS som väntade när AI-motorn stängdes ligger kvar tills personalen trycker Klar
            try:
                rows = (
                    supabase.table("tasks").select("table_id")
                    .in_("table_id", table_ids).eq("type", "EMERGENCY").eq("status", "PENDING").execute().data
                )
                for row in rows:
                    local_model.start_emergency(row["table_id"])
                self.restored = True
            except Exception as e:
                print(f"Kunde inte hämta väntande SOS: {e}")
        if time.time() - self.strict_at > STRICT_RELOAD_SECONDS and not sos_details_missing:
            self.load_strict()
        try:
            started = now_iso()
            rows = (
                supabase.table("tasks").select("id,table_id,type")
                .in_("table_id", table_ids).in_("type", ["CLEANING", "EMERGENCY", "BILL"]).eq("status", "COMPLETED")
                .gt("resolved_at", self.checked_from).execute().data
            )
            self.checked_from = started
            for row in rows:
                if row["type"] == "EMERGENCY":
                    local_model.clear_emergency(row["table_id"])
                    self.strict_at = 0.0  # kanske ett nytt falsklarm: läs in igen
                    continue
                if row["id"] in ai_resolved:
                    ai_resolved.discard(row["id"])
                    continue
                if row["type"] == "BILL":
                    local_model.bill_brought(row["table_id"])  # personalen har lämnat notan
                    continue
                local_model.mark_clean(row["table_id"])
        except Exception as e:
            print(f"Kunde inte hämta avdukningar: {e}")

    def load_prep(self):
        """Hur lång tid rätterna brukar ta i köket, från beställningarna de senaste 60 dagarna."""
        self.prep_at = time.time()
        since = datetime.fromtimestamp(time.time() - 60 * 86400, timezone.utc).isoformat()
        try:
            rows = (
                supabase.table("orders").select("items,created_at,ready_at")
                .eq("restaurant_id", RESTAURANT_ID).gte("created_at", since).not_.is_("ready_at", "null")
                .order("created_at", desc=True).limit(5000).execute().data
            )
        except Exception as e:
            print(f"Kunde inte läsa kökets tider: {e}")
            return
        prep = local_ai.learn_prep_times(rows)
        if len(prep) != len(self.prep):
            print(f"Väntar på mat: kökets tider kända för {len(prep)} rätter.")
        self.prep = prep

    def load_strict(self):
        """Falsklarm de senaste 14 dagarna: tecken som larmat fel vid ett bord kräver ett tecken till."""
        global sos_details_missing
        self.strict_at = time.time()
        since = datetime.fromtimestamp(time.time() - 14 * 86400, timezone.utc).isoformat()
        try:
            rows = (
                supabase.table("tasks").select("table_id,sos_trigger,false_alarm")
                .in_("table_id", table_ids).eq("type", "EMERGENCY").eq("status", "COMPLETED")
                .gte("created_at", since).execute().data
            )
        except Exception as e:
            if "column" in str(e).lower():
                sos_details_missing = True
            else:
                print(f"Kunde inte hämta falsklarm: {e}")
            return
        strict = local_ai.strict_triggers(rows)
        local_model.set_strict(strict)
        if strict:
            print(f"Försiktigare SOS efter falsklarm vid {len(strict)} bord.")


ISSUE_NO_CAMERA = "Bordet saknar kamera. Koppla det till en kamera i installationen."
ISSUE_CAMERA_OFFLINE = "Kameran ger ingen bild."
ISSUE_ENGINE_OFF = "AI-motorn är avstängd."


# Funktioner som ägaren stängt av i appen (Inställningar → Anpassa funktioner)
features: dict = {}
features_at = 0.0
SOS_FROM_ENV = local_ai.SOS_DETECTION
OFF_STATUS = {"dessert": "DESSERT_OPPORTUNITY", "bill": local_ai.WANTS_BILL}


def load_features():
    """Läser ägarens val. Avstängd SOS = ingen olycksbevakning; avstängd dessert/nota = bordet visas som Gäster."""
    global features, features_at
    if time.time() - features_at < 30:
        return
    features_at = time.time()
    try:
        row = supabase.table("restaurants").select("*").eq("id", RESTAURANT_ID).single().execute().data or {}
        features = row.get("features") or {}
    except Exception:
        return  # behåll det vi hade
    local_ai.SOS_DETECTION = SOS_FROM_ENV and features.get("sos", True) is not False


def report(table: dict, status: str, issue: str | None):
    """Sparar bordets status när den har varit stabil en stund."""
    for feature, off_status in OFF_STATUS.items():
        if status == off_status and features.get(feature, True) is False:
            status = "OCCUPIED"
    tracker = trackers[table["id"]]
    try:
        if tracker.observe(status):
            try:
                apply_status_change(table, status, issue)
            except Exception:
                tracker.confirmed = table["status"]  # inte sparat: försök igen vid nästa analys
                raise
        elif status == table["status"] == local_ai.CAMERA_BLIND and issue != table.get("camera_issue"):
            supabase.table("tables").update({"camera_issue": issue}).eq("id", table["id"]).execute()
            table["camera_issue"] = issue
    except Exception as e:
        hint = ""
        if "check" in str(e).lower() and status == local_ai.EMERGENCY:
            hint = " Kör supabase/007_emergency.sql i Supabase för att slå på Akut läge."
        elif "check" in str(e).lower() and status == local_ai.WANTS_BILL:
            hint = " Kör supabase/009_bill.sql i Supabase för att slå på Väntar på notan."
        print(f"Bord {table['table_number']}: kunde inte spara: {e}{hint}")


def main():
    global local_model, RESTAURANT_ID, ENGINE_KEY
    if ENGINE_CODE:
        try:
            sign_in()
        except Exception as e:
            raise SystemExit(
                f"Fel: kunde inte logga in med kopplingskoden ({e}).\n"
                "Koden kan ha bytts ut. Skapa en ny i webbappen: Inställningar → AI-datorn."
            )
    try:
        RESTAURANT_ID = pick_restaurant()
        ENGINE_KEY = ENGINE_CODE["k"] if ENGINE_CODE else sec.engine_key(SUPABASE_SERVICE_KEY, RESTAURANT_ID)
    except SystemExit:
        raise
    except Exception as e:
        raise SystemExit(f"Fel: kunde inte läsa restaurangerna från Supabase ({e}).")
    local_model = local_ai.LocalTableAI()
    try:
        tables = load_config()
    except Exception as e:
        raise SystemExit(
            f"Fel: kunde inte läsa installationen från Supabase ({e}).\n"
            "Har du kört alla filer i mappen supabase/ (schema.sql, 002, 003, 004 och 005) i Supabase SQL Editor?\n"
            "AI-motorn behöver också ENGINE_CODE (eller SUPABASE_SERVICE_KEY) i .env."
        )
    start_stream_server()
    if not AI_ENABLED:
        print(f"Bara video: AI-analysen är avstängd ({AI_DISABLED_REASON}).")
    elif not setup.get("complete"):
        print("Väntar på installationen: gör klart guiden på http://localhost:3000/setup. Videon fungerar redan.")
    else:
        print(f"Bevakar {len(tables)} bord med {len(cameras)} kamera(or) för {setup.get('restaurant_name')}.")

    try:
        run_loop(tables)
    except KeyboardInterrupt:
        print("Avslutar...")
    finally:
        for camera in cameras.values():
            camera.set_online(False)
        # Ingen bevakning = ingen status. Visa det i stället för gamla statusar.
        if AI_ENABLED and setup.get("complete"):
            try:
                supabase.table("tables").update({"status": local_ai.CAMERA_BLIND, "camera_issue": ISSUE_ENGINE_OFF}) \
                    .eq("restaurant_id", RESTAURANT_ID).not_.is_("floor_plan_id", "null").execute()
            except Exception:
                pass


def run_loop(tables):
    context = Context()
    last_reload = last_context = time.time()
    was_complete = bool(setup.get("complete"))
    while True:
        started = time.time()
        ensure_session()
        if reload_requested.is_set() or started - last_reload > CONFIG_RELOAD_SECONDS:
            reload_requested.clear()
            try:
                tables = load_config()
            except Exception as e:
                print(f"Kunde inte läsa in konfiguration: {e}")
            last_reload = started
            if bool(setup.get("complete")) != was_complete:
                was_complete = bool(setup.get("complete"))
                print("Installationen är klar: bevakningen startar." if was_complete
                      else "Installationen är inte klar längre: bevakningen pausas tills guiden är klar.")

        # Ingen bevakning förrän planritning, kameror och kalibrering är klara
        if not AI_ENABLED or not setup.get("complete"):
            reload_requested.wait(max(0.0, FRAME_INTERVAL - (time.time() - started)))
            continue
        if started - last_context > CONTEXT_SECONDS:
            context.sync()
            load_features()
            last_context = started

        by_camera: dict[str, list[dict]] = {}
        for table in tables:
            camera = cameras.get(table["camera_id"]) if table["camera_id"] else None
            if camera is None or table["roi_x1"] is None:
                report(table, local_ai.CAMERA_BLIND, ISSUE_NO_CAMERA)
            elif not camera.is_live():
                report(table, local_ai.CAMERA_BLIND, ISSUE_CAMERA_OFFLINE)
            else:
                by_camera.setdefault(table["camera_id"], []).append(table)

        for camera_id, camera_tables in by_camera.items():
            camera = cameras[camera_id]
            frame = camera.latest_frame()
            if frame is None:
                continue
            try:
                results = local_model.classify(frame, camera_tables)
            except Exception as e:
                print(f"[{camera.name}] AI-analys misslyckades: {e}")
                continue
            for table in camera_tables:
                status, issue = results.get(table["table_number"], (None, None))
                if status:
                    report(table, status, issue)

        save_sessions()
        reload_requested.wait(max(0.0, FRAME_INTERVAL - (time.time() - started)))


if __name__ == "__main__":
    main()
