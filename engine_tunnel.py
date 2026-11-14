"""Krypterad tunnel från internet till AI-motorn, så att webbappen (på Vercel) når
restaurangens dator utan att något öppnas i routern.

Tre lägen, valda i .env:
- CLOUDFLARE_TUNNEL_TOKEN + ENGINE_PUBLIC_URL: en fast tunnel i Cloudflare (för drift).
  Adressen (t.ex. https://ai-restaurangen.bordvakt.se) ändras aldrig.
- Inget av dem, men cloudflared är installerat: en snabbtunnel med en slumpad adress
  (https://<ord>.trycloudflare.com). Den nya adressen sparas automatiskt i databasen.
- ENGINE_TUNNEL=off: ingen tunnel (bara den egna datorn och det lokala nätet).

Adressen sparas i restaurants.engine_url, där webbappen hämtar den.
"""

import re
import os
import shutil
import subprocess
import threading
import time
from typing import Callable

QUICK_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def find_cloudflared() -> str | None:
    for path in (shutil.which("cloudflared"), "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared",
                 os.path.expanduser("~/.local/bin/cloudflared")):
        if path and shutil.which(path):
            return path
    return None


def start(port: int, token: str, public_url: str, on_url: Callable[[str], None]) -> bool:
    """Startar tunneln i bakgrunden och startar om den om den stannar. False = ingen cloudflared."""
    binary = find_cloudflared()
    if not binary:
        return False
    if token:
        args = [binary, "tunnel", "--no-autoupdate", "run", "--token", token]
    else:
        args = [binary, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"]

    def run():
        delay = 5
        while True:
            started = time.time()
            try:
                proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
                if public_url:
                    on_url(public_url)
                for line in proc.stderr:
                    match = QUICK_URL.search(line) if not token else None
                    if match:
                        on_url(match.group(0))
                proc.wait()
            except Exception as e:
                print(f"Tunneln: {e}")
            # Startar om, men inte oftare än var 5:e sekund (upp till en minut om den kraschar hela tiden)
            delay = 5 if time.time() - started > 120 else min(60, delay * 2)
            print(f"Tunneln stannade. Startar om om {delay} s.")
            time.sleep(delay)

    threading.Thread(target=run, daemon=True, name="tunnel").start()
    return True
