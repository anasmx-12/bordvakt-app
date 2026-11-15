"""
Fota menyn: gör ett utkast till restaurangens meny från foton av den tryckta menyn.

1. Macens inbyggda textigenkänning (tools/ocr.swift, byggs första gången) läser texten.
2. En vanlig meny (rubrik, "Rätt ... 115 kr", ingredienser under) sorteras med fasta regler,
   som ger samma svar varje gång (parse_rules).
3. Annars (t.ex. två spalter, priset på egen rad) sorterar samma lokala språkmodell som
   Vakti (Ollama) texten i kategorier, rätter och priser.

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
    return layout(json.loads(done.stdout or b"[]"))


def _split(rows: list[dict]):
    """Hittar en lodrät linje som ingen text korsar, med minst tre rader på var sida.
    Rubriker överst som går tvärs över (restaurangens namn) får korsa. None = en spalt."""
    if any("w" not in r for r in rows):
        return None
    best = None
    for step in range(15, 86):
        g = step / 100
        left = [r for r in rows if r["x"] + r["w"] <= g]
        right = [r for r in rows if r["x"] >= g]
        across = [r for r in rows if r["x"] < g < r["x"] + r["w"]]
        if len(left) < 3 or len(right) < 3:
            continue
        if across and max(r["y"] for r in across) >= min(r["y"] for r in left + right):
            continue  # text tvärs över mitt i menyn: inte två spalter
        if sum(bool(PRICE_ONLY.match(r["text"])) for r in right) * 2 >= len(right):
            continue  # till höger står bara priser: det är samma spalt
        score = min(len(left), len(right))
        if not best or score > best[0]:
            best = (score, across, left, right)
    return best[1:] if best else None


def layout(rows: list[dict], depth: int = 0) -> str:
    """Texten i läsordning: spalt för spalt (vänster först), rad för rad i varje spalt."""
    split = _split(rows) if depth < 2 else None
    if not split:
        return join_rows(rows)
    across, left, right = split
    parts = [join_rows(across) if across else "", layout(left, depth + 1), layout(right, depth + 1)]
    return "\n".join(p for p in parts if p)


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


# ------------------------------------------------------------ Fasta regler

_CURRENCY = r"(?:kr\.?|:-|sek|€|eur|\$|nok|dkk)"
_NUMBER = r"\d{1,5}(?:[.,]\d{1,2})?"
# Priset sist på raden: "115 kr", "229:-", "kr 289", "- 30", "12.5 €"
PRICE_END = re.compile(rf"(?:^|\s)(?:[-–:]\s*)?(?:(?:kr|sek|€|\$)\s*)?({_NUMBER})\s*{_CURRENCY}?$", re.I)
PRICE_ONLY = re.compile(rf"^\s*(?:kr\s*)?{_NUMBER}\s*{_CURRENCY}?\s*$", re.I)
PRICE_INSIDE = re.compile(rf"\d{{2,5}}\s*{_CURRENCY}(?:\s|$)", re.I)
CONTACT = re.compile(r"(?i)(\b(öppet|öppettider|tel|telefon|adress|open|hours|swish|org\.?\s?nr|välkomna)\b|www\.|https?:|@)")


def _is_heading(line: str, prev: str | None, next_is_item: bool) -> bool:
    letters = [c for c in line if c.isalpha()]
    if len(letters) < 2 or "," in line or len(line) > 40:
        return False
    if all(c.isupper() for c in letters) or line.endswith(":"):
        return True
    words = line.split()
    if not next_is_item or not line[0].isupper() or any(c.isdigit() for c in line):
        return False
    return len(words) <= (2 if prev == "item" else 3)


def parse_rules(text: str) -> dict | None:
    """Sorterar en vanlig meny utan språkmodell. None = menyn ser annorlunda ut, låt AI:n ta den."""
    lines = [re.sub(r"\s+", " ", l).strip(" .") for l in text.splitlines()]
    lines = [l for l in lines if l and not CONTACT.search(l)]
    priced = [PRICE_END.search(l) for l in lines]
    categories: list[dict] = []
    prev = None
    count = 0
    for n, line in enumerate(lines):
        if PRICE_ONLY.match(line):
            return None  # priset står på egen rad
        match = priced[n]
        name = line[: match.start()].strip(" .–-:") if match else ""
        if match and any(c.isalpha() for c in name):
            if PRICE_INSIDE.search(name):
                return None  # två rätter på samma rad (två spalter)
            if not categories:
                categories.append({"name": "", "items": []})
            categories[-1]["items"].append({"name": name, "description": "", "price": _price(match.group(1))})
            prev, count = "item", count + 1
            continue
        next_is_item = n + 1 < len(lines) and bool(priced[n + 1])
        if _is_heading(line, prev, next_is_item):
            categories.append({"name": line.rstrip(":"), "items": []})
            prev = "heading"
        elif prev in ("item", "desc"):
            item = categories[-1]["items"][-1]
            item["description"] = f"{item['description']} {line}".strip()
            prev = "desc"
    return {"categories": categories} if count >= 2 else None


def _price(value) -> float:
    try:
        price = round(float(str(value).replace(",", ".").replace(" ", "")), 2)
    except ValueError:
        return 0.0
    return price if 0 <= price < 100000 else 0.0


def clean(data: dict) -> dict:
    """Bara giltiga kategorier och rätter, med rimliga längder."""
    result, count, seen = [], 0, set()
    for c in data.get("categories", []) if isinstance(data, dict) else []:
        items = []
        for i in c.get("items", []) if isinstance(c, dict) else []:
            name = str(i.get("name", "")).strip()[:80] if isinstance(i, dict) else ""
            price = _price(i.get("price", 0)) if name else 0.0
            if not name or count >= MAX_ITEMS or (name.lower(), price) in seen:
                continue  # tom, för många, eller samma rätt två gånger
            seen.add((name.lower(), price))
            count += 1
            items.append({
                "name": name,
                "description": str(i.get("description") or "").strip()[:300],
                "price": price,
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
    rules = parse_rules(text)
    menu = clean(rules) if rules else structure(text)
    if not menu["categories"]:
        raise MenuReadError("AI:n hittade inga rätter på fotot. Lägg in dem för hand eller ta ett skarpare foto.")
    return menu
