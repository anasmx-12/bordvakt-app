"""
Bordvakt AI (Vakti): chatboten som hjälper användaren att få igång appen.

Körs helt på den här datorn med Ollama och en liten öppen språkmodell
(standard: Qwen3 4B Instruct, Apache 2.0). Inget skickas till något AI-företag
och det kostar inget per fråga.

En liten modell kan missförstå och hitta på. Därför:
- Fakta om installationen (vilket steg, vilka bord och kameror) räknas fram av
  appen och skickas med. Modellen ska utgå från dem, inte gissa.
- Knapparna i chatten ("Öppna Kameror" osv.) väljs av appen, inte av modellen.
- Manualen nedan är det enda den ska svara utifrån.

Modellen laddas av Ollama vid första frågan och släpps ur minnet efter
KEEP_ALIVE utan frågor.
"""

import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "qwen3:4b-instruct")
KEEP_ALIVE = "5m"
MAX_MESSAGES = 12      # så många tidigare meddelanden som skickas med
MAX_CHARS = 1500       # per meddelande
MAX_FACTS = 4000

LANGUAGES = {
    "sv": "svenska", "en": "English", "de": "Deutsch", "es": "español", "fr": "français",
    "pt": "português", "tr": "Türkçe", "ru": "русский", "ar": "العربية", "ur": "اردو",
    "hi": "हिन्दी", "bn": "বাংলা", "zh": "中文", "ja": "日本語", "ko": "한국어", "id": "Bahasa Indonesia",
}

MANUAL = """\
# Bordvakts installation (4 steg, i appen under Installation)

## Steg 1: Restaurang
Skriv restaurangens namn och spara.

## Steg 2: Planritning
Rita matsalen uppifrån: lägg till bord (runda, fyrkantiga, avlånga), ge varje bord ett unikt nummer
och antal platser. Lägg gärna till inredning som bar, kök, entré, växter och soffor.
Snabbare: ta foton av matsalen från mitten av varje vägg (mobilen på bredden, bra ljus, få personer i bild).
AI:n gör ett utkast som man sedan rättar och sparar. Två bord får inte ha samma nummer.

## Steg 3: Kameror
Välj sorts kamera:
- IP-kamera: nätverkskamera med egen IP-adress. Ange IP-adress, användare och lösenord.
- Inspelare (NVR/DVR): ange boxens IP-adress och kamerans kanal (1, 2, 3 ...).
- USB-/webbkamera: kamera i eller kopplad till datorn som kör AI-motorn. 0 = inbyggda kameran, 1 = nästa.
- Mobilen som kamera: en gammal mobil med appen "IP Webcam" (Android). Appen visar adressen, port 8080.
Välj märket i listan: då bygger appen adressen själv och man skriver bara IP-adress, användare och lösenord.
Hela adressen behöver bara skrivas för "Annat märke", UniFi eller "Egen adress".
Kamerans IP-adress hittar man i kamerans app, i inspelaren eller i routerns lista över enheter.
Anslutning: RTSP rekommenderas (bäst bild, port 554). RTSPS är krypterad. HTTP/MJPEG fungerar genom fler nätverk men ger sämre bild.
Märken:
- Axis: användare root.
- Hikvision: användare admin, kanal 1 = första kameran.
- Dahua och Amcrest: användare admin.
- Hanwha (Wisenet), Uniview: användare admin.
- Reolink: användare admin. Slå på RTSP i Reolink-appen under Nätverk -> Avancerat -> Porttjänster.
- TP-Link Tapo/VIGI: skapa ett "kamerakonto" i Tapo-appen (Avancerade inställningar) och använd det.
- Foscam: port 88 på de flesta modeller.
- UniFi Protect: slå på RTSP för kameran i UniFi Protect och klistra in adressen (rtsps://...:7441/...).
- Annat märke: klistra in kamerans hela adress från manualen eller kamerans app.
Tryck "Testa" innan du sparar: då syns en förhandsbild.
Kameran ska sitta still, snett ovanför borden, och se hela bordet med stolarna.

## Steg 4: Kalibrering
För varje bord: välj bordet, välj kameran som ser det och rita en ruta runt bordet i kamerabilden. Ta med stolarna.
AI:n sparar hur bordet ser ut. Tomt och dukat bord, bra ljus och inga personer framför ger bäst resultat.
Flyttas kameran måste borden kalibreras om.

## Steg 5: Meny (valfritt)
Hoppa över steget om gästerna ska beställa som vanligt hos personalen. Det går att komma tillbaka senare.
Lägg till kategorier (t.ex. Förrätter, Varmrätter, Dryck) och rätter med namn, pris, beskrivning och allergener.
"Slut i dag" på en rätt gör att gästerna inte kan beställa den.
Beställning via QR-kod: Av, Direkt till köket, eller Personalen godkänner först. Gästerna betalar som vanligt hos personalen.
"Skriv ut QR-koder till borden" ger ett ark med en kod per bord. "Byt kod" gör den gamla koden ogiltig.
QR-koderna fungerar på gästernas mobiler först när appen ligger på internet och adressen står i NEXT_PUBLIC_SITE_URL.
Menyn kräver att supabase/010_menu.sql är körd.

## Bordvakt support
Det som måste göras på plats (sätta upp QR-koder vid borden, montera eller koppla in kameror, kalibrera) kan Bordvakts support hjälpa till med.
Öppna Installation → "Kontakta Bordvakt support", fyll i formuläret, så hör supporten av sig via e-post och föreslår dagar att komma.
Hänvisa dit när du inte kan lösa problemet eller när något behöver göras på plats.

## AI-motorn
AI-motorn är programmet på restaurangens dator som läser kamerorna. Den måste vara igång för att något ska fungera.
Den installeras med installationsprogrammet (install/install-mac.sh) och startar sedan av sig själv när datorn slås på.
Den kopplas till restaurangen med en kopplingskod: ägaren skapar den i Inställningar → AI-datorn och klistrar in den när programmet installeras.
Fungerar inte koden längre (t.ex. om en ny har skapats) skapar ägaren en ny och kör installationsprogrammet igen.

# Vanliga problem
- "Kunde inte ansluta": fel IP-adress, användare eller lösenord, eller kameran är avstängd. Kameran och datorn måste vara på samma nätverk. Testa adressen i VLC (Media -> Öppna nätverksström).
- "Adressen ska börja med rtsp://": skriv hela adressen, eller ett nummer för webbkamera.
- Svart bild: linsen är övertäckt, rummet är mörkt eller kameran har IR-läge avstängt. Kontrollera ljuset och att inget täcker kameran.
- Suddig bild: rengör linsen och ställ in kamerans fokus.
- "Bordet syns inte där det ska": kameran har flyttats eller något skymmer. Kalibrera om bordet.
- "Bordet är inte kalibrerat": gör steg 4 för bordet.
- "Kameran ger ingen bild": kameran är frånkopplad eller strömlös, eller nätverket är nere. Starta om kameran.
- "AI-motorn är avstängd": starta AI-motorn på datorn (se ovan).
- Databasfel om saknade tabeller: kör filerna i mappen supabase/ i Supabase -> SQL Editor, i nummerordning.
- Webbkamera på Mac: macOS frågar om kameratillstånd första gången. Tillåt Terminal/Python under Systeminställningar -> Integritet och säkerhet -> Kamera.
"""

RULES = """\
Du är Vakti, Bordvakts egen AI. Din ENDA uppgift är att hjälpa användaren att installera Bordvakt och
lösa problem så att appen fungerar.
Regler:
- Svara på {language}. Skriver användaren tydligt på ett annat språk: svara på det språket.
- Svara kort: högst 5 meningar eller en kort numrerad lista. Ett steg i taget.
- Utgå från INSTALLATIONENS LÄGE nedan. Det är sant just nu. Säg aldrig emot det.
- Svara bara utifrån MANUALEN. Om svaret inte finns där: säg att du inte vet och föreslå att kontakta Bordvakts support. Hitta aldrig på knappar, menyer eller inställningar.
- Frågor som inte handlar om att installera eller felsöka Bordvakt: svara vänligt att du bara hjälper till med att få igång appen.
- Be aldrig om lösenord. Om användaren skriver ett lösenord: säg att det inte behövs i chatten.
- Skriv inte rubriker. Vanlig text, och listor bara när det är steg.
"""


class ChatUnavailable(Exception):
    """Ollama är inte igång eller modellen saknas."""


def clean_messages(messages) -> list[dict]:
    """Bara användarens och Vaktis meddelanden, korta och i rätt ordning."""
    result = []
    for m in messages if isinstance(messages, list) else []:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            continue
        text = str(m.get("content", "")).strip()[:MAX_CHARS]
        if text:
            result.append({"role": m["role"], "content": text})
    result = result[-MAX_MESSAGES:]
    while result and result[0]["role"] != "user":
        result.pop(0)  # en konversation börjar alltid med användaren
    return result


def system_prompt(facts: str, language: str) -> str:
    lang = LANGUAGES.get(language, LANGUAGES["sv"])
    return (
        RULES.format(language=lang)
        + "\n# INSTALLATIONENS LÄGE\n" + (str(facts).strip()[:MAX_FACTS] or "Okänt.")
        + "\n\n# MANUALEN\n" + MANUAL
    )


_start_lock = threading.Lock()
_started = False


def _ollama_bin() -> str | None:
    custom = os.environ.get("OLLAMA_BIN")
    if custom and os.path.exists(custom):
        return custom
    local = os.path.expanduser("~/.local/ollama/ollama")
    return local if os.path.exists(local) else shutil.which("ollama")


def ensure_server(timeout: float = 8.0) -> bool:
    """Startar Ollama om den inte redan körs (en gång). True = servern svarar."""
    global _started
    if _ping():
        return True
    with _start_lock:
        if not _started and (binary := _ollama_bin()):
            _started = True
            subprocess.Popen([binary, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
            print("Chatten: startade Ollama.")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _ping():
            return True
        time.sleep(0.3)
    return False


def _ping() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/version", timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


def open_chat(messages, facts: str, language: str = "sv"):
    """Startar ett svar från modellen. Returnerar en generator med textbitar.
    Kastar ChatUnavailable innan något har skickats om modellen inte går att nå."""
    history = clean_messages(messages)
    if not history:
        raise ValueError("Skriv en fråga.")
    if not ensure_server():
        raise ChatUnavailable("Ollama är inte igång.")
    body = json.dumps({
        "model": CHAT_MODEL,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        "messages": [{"role": "system", "content": system_prompt(facts, language)}] + history,
        "options": {"temperature": 0.2, "num_ctx": 8192, "num_predict": 400},
    }).encode()
    request = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=body,
                                     headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if e.code == 404 or "not found" in detail:
            raise ChatUnavailable(f"Modellen {CHAT_MODEL} saknas. Kör: ollama pull {CHAT_MODEL}") from e
        raise ChatUnavailable(f"Ollama svarade med fel {e.code}.") from e
    except Exception as e:
        raise ChatUnavailable("Ollama svarar inte.") from e
    return _stream(response)


def _stream(response):
    with response:
        for line in response:
            if not line.strip():
                continue
            try:
                part = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = part.get("message", {}).get("content", "")
            if text:
                yield text
            if part.get("done"):
                return


# ------------------------------------------------------------ Supportärenden

SUMMARY_PROMPT = """Du hjälper Bordvakts supportpersonal. En restaurang har skickat ett supportärende.
Skriv på svenska:
- summary: 1-3 korta meningar om vad kunden behöver och om det kräver ett besök på plats.
- reply: ett vänligt, kort förslag på svar till kunden (högst 3 meningar), skrivet som Bordvakts support ("vi").
  Bekräfta vad kunden behöver och avsluta med att vi återkommer med förslag på dagar. Nämn inga egna datum.
Hitta inte på fakta. Använd INSTALLATIONENS LÄGE om det hjälper.

# INSTALLATIONENS LÄGE
{facts}

# ÄRENDET
Gäller: {topic}
{message}
"""


def summarize_ticket(topic: str, message: str, facts: str = "") -> dict:
    """AI-sammanfattning och svarsförslag till supporten. Kastar ChatUnavailable om modellen inte nås."""
    if not ensure_server():
        raise ChatUnavailable("Ollama är inte igång.")
    body = json.dumps({
        "model": CHAT_MODEL,
        "stream": False,
        "keep_alive": KEEP_ALIVE,
        "format": {
            "type": "object",
            "properties": {"summary": {"type": "string"}, "reply": {"type": "string"}},
            "required": ["summary", "reply"],
        },
        "messages": [{"role": "user", "content": SUMMARY_PROMPT.format(
            facts=str(facts).strip()[:MAX_FACTS] or "Okänt.", topic=str(topic)[:60], message=str(message).strip()[:4000])}],
        "options": {"temperature": 0.2, "num_ctx": 8192, "num_predict": 500},
    }).encode()
    request = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=90) as r:
            data = json.loads(json.loads(r.read())["message"]["content"])
    except Exception as e:
        raise ChatUnavailable("Modellen kunde inte sammanfatta ärendet.") from e
    return {"summary": str(data.get("summary", "")).strip()[:1000], "reply": str(data.get("reply", "")).strip()[:2000]}
