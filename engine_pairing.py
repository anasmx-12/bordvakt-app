"""Kopplar AI-datorn till restaurangen av sig själv, utan installationsskriptet.

Används när kopplingskoden (ENGINE_CODE) saknas eller inte längre godtas, t.ex. för att
ägaren har tryckt "Koppla dator" igen i webbappen. I stället för att krascha (och startas
om av launchd i en evig loop) gör motorn så här:

1. Ber webbappen om en kort kod (POST /api/engine/device/start).
2. Visar koden i en ruta på Macen: "Skriv in koden i Bordvakt: Inställningar → AI-datorn".
3. Frågar var 4:e sekund om ägaren har godkänt (POST /api/engine/device/poll).
4. Sparar den nya kopplingskoden i .env och startar om sig själv.

Samma flöde som install/install-mac.sh (pair_with_code). Bara standardbiblioteket.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import engine_security as sec

DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(DIR, ".env")
DEFAULT_WEB_URL = "https://app.bordvakt.se"
# Efter så här många koder som ingen har skrivit in väntar datorn längre mellan försöken,
# så att rutan inte dyker upp var tionde minut hela natten.
QUIET_AFTER = 3
QUIET_WAIT_SECONDS = 15 * 60


def _post(url: str, body: dict, timeout: int = 15) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode() or "{}")
        except ValueError:
            return {"error": f"HTTP {e.code}"}


def _reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "/login", timeout=2):
            return True
    except Exception:
        return False


def web_url(old_code: dict | None = None) -> str:
    """Webbappens adress. Samma ordning som installationsskriptet, men först adressen
    som den gamla kopplingskoden pekade på (då hamnar datorn hos samma webbapp)."""
    if old_code and old_code.get("w"):
        origins = sec.parse_origins(old_code["w"])
        if origins:
            return origins[0]
    url = os.environ.get("BORDVAKT_WEB_URL", "").strip()
    if not url:
        path = os.path.join(DIR, "install", "web-url.txt")
        if os.path.exists(path):
            url = open(path, encoding="utf-8").readline().strip()
    if not url:
        path = os.path.join(DIR, "web", ".env.local")
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                if line.startswith("NEXT_PUBLIC_SITE_URL=http"):
                    url = line.split("=", 1)[1].strip()
                    break
    if not url and _reachable("http://localhost:3000"):
        url = "http://localhost:3000"
    return (url or DEFAULT_WEB_URL).rstrip("/")


def _show_code(code: str, minutes: int) -> subprocess.Popen | None:
    """Visar koden i en ruta på Macen (stängs själv när koden går ut)."""
    if sys.platform != "darwin":
        return None
    text = f"Skriv in koden i Bordvakt:\\n\\nInställningar → AI-datorn → Koppla dator\\n\\n{code}"
    script = (
        f'display dialog "{text}" with title "Koppla Bordvakt" buttons {{"OK"}} '
        f'default button "OK" giving up after {minutes * 60}'
    )
    try:
        subprocess.Popen(
            ["osascript", "-e", 'display notification "AI-datorn behöver kopplas till restaurangen." with title "Bordvakt"'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return subprocess.Popen(["osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return None


def _close(dialog: subprocess.Popen | None) -> None:
    if dialog and dialog.poll() is None:
        dialog.kill()


def save_code(code: str, env_path: str = ENV_PATH) -> None:
    """Skriver den nya kopplingskoden till .env (som installationsskriptet gör).
    Gamla ENGINE_CODE, SUPABASE_SERVICE_KEY och RESTAURANT_ID tas bort."""
    lines = []
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            lines = [
                line for line in f
                if not line.startswith(("ENGINE_CODE=", "SUPABASE_SERVICE_KEY=", "RESTAURANT_ID="))
                and "Kopplingskoden (Inställningar → AI-datorn)" not in line
            ]
    while lines and not lines[-1].strip():
        lines.pop()
    lines.append("\n# Kopplingskoden (Inställningar → AI-datorn). Hemlig: dela den inte.\n")
    lines.append(f"ENGINE_CODE={code}\n")
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(env_path), prefix=".env.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.chmod(tmp, 0o600)  # bara den här användaren kan läsa filen
    os.replace(tmp, env_path)


def pair(old_code: dict | None = None) -> str:
    """Väntar tills ägaren har godkänt datorn och returnerar den nya kopplingskoden.
    Ger aldrig upp: nya koder tas fram tills någon skriver in en."""
    url = web_url(old_code)
    name = (socket.gethostname().split(".")[0] or "Mac")[:60]
    try:
        name = subprocess.run(["scutil", "--get", "ComputerName"], capture_output=True, text=True, timeout=5).stdout.strip()[:60] or name
    except Exception:
        pass
    unanswered = 0
    wait = 30
    print(f"Kopplar AI-datorn till restaurangen via {url} ...")
    while True:
        try:
            start = _post(f"{url}/api/engine/device/start", {"name": name})
        except Exception as e:
            start = {"error": str(e)}
        code, device = start.get("code"), start.get("device")
        if not code or not device:
            print(f"Kunde inte få en kod från webbappen ({start.get('error', 'okänt fel')}). Försöker igen om {wait} s.")
            time.sleep(wait)
            wait = min(wait * 2, 300)
            continue
        wait = 30
        interval = int(start.get("interval") or 4)
        expires = int(start.get("expires_in") or 600)
        print(
            f"\n  Skriv in koden {code} i Bordvakt: Inställningar → AI-datorn → Koppla dator.\n"
            f"  (Gäller i {expires // 60} minuter. Väntar på att den godkänns ...)\n"
        )
        dialog = _show_code(code, expires // 60) if unanswered < QUIET_AFTER else None
        waited = 0
        status = "pending"
        while waited < expires:
            time.sleep(interval)
            waited += interval
            try:
                reply = _post(f"{url}/api/engine/device/poll", {"device": device})
            except Exception:
                continue
            status = reply.get("status", "pending")
            if status == "approved" and sec.parse_code(reply.get("code", "")):
                _close(dialog)
                print(f"Godkänd! Datorn är kopplad till {reply.get('restaurant') or 'restaurangen'}.")
                return reply["code"]
            if status == "expired":
                break
        _close(dialog)
        unanswered += 1
        if unanswered >= QUIET_AFTER:
            print(f"Ingen har skrivit in koden. Ny kod om {QUIET_WAIT_SECONDS // 60} minuter (eller starta om motorn).")
            time.sleep(QUIET_WAIT_SECONDS)
        else:
            print("Koden gick ut. Här kommer en ny.")


def pair_and_restart(old_code: dict | None = None) -> None:
    """Kopplar datorn, sparar koden och startar om motorn med den nya koden."""
    code = pair(old_code)
    save_code(code)
    print("Kopplingskoden är sparad. Startar om AI-motorn ...")
    os.environ.pop("ENGINE_CODE", None)  # läs om från .env, inte den gamla från miljön
    os.execv(sys.executable, [sys.executable, *sys.argv])
