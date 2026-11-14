"""
Fota menyn: gör ett utkast till restaurangens meny från foton av den tryckta menyn.

1. Macens inbyggda textigenkänning (tools/ocr.swift, byggs första gången) läser texten.
2. Samma lokala språkmodell som Vakti (Ollama) sorterar texten i kategorier, rätter och priser.

Ingen ny modell behöver laddas ner och inget lämnar datorn. Ägaren rättar alltid utkastet
innan det sparas, eftersom läsningen kan bli fel.
"""

import json
import os
import re
import subprocess
import tempfile
import urllib.request

import local_chat

ROOT = os.path.dirname(os.path.abspath(__file__))
OCR_SOURCE = os.path.join(ROOT, "tools", "ocr.swift")
OCR_BINARY = os.path.join(ROOT, "models", "ocr")
MAX_TEXT = 7000      # tecken text som skickas till modellen
MAX_ITEMS = 200


class MenuReadError(Exception):
    """Fel som visas för ägaren som det är."""


def _ocr_binary() -> str:
    if os.path.exists(OCR_BINARY) and os.path.getmtime(OCR_BINARY) >= os.path.getmtime(OCR_SOURCE):
        return OCR_BINARY
    os.makedirs(os.path.dirname(OCR_BINARY), exist_ok=True)
    done = subprocess.run(["swiftc", "-O", OCR_SOURCE, "-o", OCR_BINARY], capture_output=True, timeout=180)
    if done.returncode != 0:
        raise MenuReadError("Textigenkänningen kunde inte byggas. Installera Xcode Command Line Tools (xcode-select --install).")
    return OCR_BINARY


def read_text(image: bytes) -> str:
    """Texten på fotot, rad för rad uppifrån och ned (ord på samma höjd blir en rad)."""
    with tempfile.NamedTemporaryFile(suffix=".jpg") as f:
        f.write(image)
        f.flush()
        done = subprocess.run([_ocr_binary(), f.name], capture_output=True, timeout=60)
    if done.returncode != 0:
        raise MenuReadError("Kunde inte läsa bilden. Använd JPG eller PNG.")
    return join_rows(json.loads(done.stdout or b"[]"))


def join_rows(rows: list[dict]) -> str:
    """Sätter ihop textbitar som står på samma rad (t.ex. "Pasta" ... "189 kr")."""
    rows = sorted(rows, key=lambda r: (r["y"], r["x"]))
    lines: list[list[dict]] = []
    for r in rows:
        last = lines[-1] if lines else None
        if last and abs(r["y"] - last[0]["y"]) < max(r["h"], last[0]["h"]) * 0.6:
            last.append(r)
        else:
            lines.append([r])
    out = []
    for line in lines:
        text = "  ".join(r["text"] for r in sorted(line, key=lambda r: r["x"]))
        text = re.sub(r"\s*\.{3,}\s*", "  ", text).strip()  # prickrader mellan rätt och pris
        if text:
            out.append(text)
    return "\n".join(out)


PROMPT = """Du får texten från foton av en restaurangmeny. Gör om den till JSON.
Regler:
- Behåll rätternas namn och beskrivningar på menyns eget språk. Översätt inte.
- Rubriker som Förrätter, Varmrätter, Dryck, Starters blir kategorier.
- price är bara siffran (t.ex. 189 eller 12.5), utan valuta. Saknas pris: 0.
- description är ingredienser eller kort text under rätten, annars tom.
- Hitta inte på rätter som inte står i texten. Hoppa över öppettider, adresser och annat som inte är rätter.

Texten:
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "categories": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "price": {"type": "number"},
                            },
                            "required": ["name", "price"],
                        },
                    },
                },
                "required": ["name", "items"],
            },
        }
    },
    "required": ["categories"],
}


def structure(text: str) -> dict:
    """Språkmodellen sorterar texten i kategorier och rätter."""
    if not local_chat.ensure_server():
        raise MenuReadError("Den lokala AI:n (Ollama) är inte igång.")
    body = json.dumps({
        "model": local_chat.CHAT_MODEL,
        "stream": False,
        "keep_alive": local_chat.KEEP_ALIVE,
        "format": SCHEMA,
        "messages": [{"role": "user", "content": PROMPT + text[:MAX_TEXT]}],
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 4000},
    }).encode()
    request = urllib.request.Request(f"{local_chat.OLLAMA_URL}/api/chat", data=body,
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=240) as r:
            content = json.loads(r.read())["message"]["content"]
        return clean(json.loads(content))
    except MenuReadError:
        raise
    except Exception as e:
        raise MenuReadError("AI:n kunde inte sortera menyn. Försök igen eller lägg in rätterna för hand.") from e


def _price(value) -> float:
    try:
        price = round(float(str(value).replace(",", ".").replace(" ", "")), 2)
    except ValueError:
        return 0.0
    return price if 0 <= price < 100000 else 0.0


def clean(data: dict) -> dict:
    """Bara giltiga kategorier och rätter, med rimliga längder."""
    result, count = [], 0
    for c in data.get("categories", []) if isinstance(data, dict) else []:
        items = []
        for i in c.get("items", []) if isinstance(c, dict) else []:
            name = str(i.get("name", "")).strip()[:80] if isinstance(i, dict) else ""
            if not name or count >= MAX_ITEMS:
                continue
            count += 1
            items.append({
                "name": name,
                "description": str(i.get("description") or "").strip()[:300],
                "price": _price(i.get("price", 0)),
            })
        name = str(c.get("name", "")).strip()[:60] if isinstance(c, dict) else ""
        if items:
            result.append({"name": name or "Övrigt", "items": items})
    return {"categories": result}


def menu_from_photos(images: list[bytes]) -> dict:
    """Utkast till meny från ett eller flera foton (t.ex. en sida i taget)."""
    texts = [read_text(image) for image in images]
    text = "\n\n".join(t for t in texts if t.strip())
    if not text.strip():
        raise MenuReadError("Ingen text hittades på fotot. Fota menyn rakt framifrån i bra ljus.")
    menu = structure(text)
    if not menu["categories"]:
        raise MenuReadError("AI:n hittade inga rätter på fotot. Lägg in dem för hand eller ta ett skarpare foto.")
    return menu
