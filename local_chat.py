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
import re
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
AI-motorn är programmet på restaurangens dator som läser kamerorna. Den måste vara igång för att kamerorna ska fungera.
Den installeras med installationsprogrammet (install/install-mac.sh) och startar sedan av sig själv när datorn slås på.
Koppla datorn: datorn visar en kort kod på skärmen. Ägaren skriver in den i appen under Inställningar → AI-datorn → Koppla dator.
Slutar kopplingen fungera (t.ex. om en ny kod har skapats) kopplar motorn om sig själv: en ny kod visas på datorn och skrivs in på samma ställe.
Händer ingenting: kontrollera att datorn är påslagen och har internet. Starta om motorn i Terminal:
launchctl kickstart -k gui/$(id -u)/se.bordvakt.engine
Chatten (Vakti) körs också på datorn. Den installeras i samma installationsprogram (svara Ja på frågan om chatten).

## Matsal: bordens färger och larm
Matsal visar planritningen med varje bord i en färg efter vad AI:n ser:
- Ledigt, Upptaget.
- Behöver dukas av: gästerna har gått och bordet är inte avdukat.
- Väntar på mat: gästerna har väntat längre än köket brukar behöva för rätterna (tidigare vid rusning).
- Söker kontakt: en gäst räcker upp handen en stund. Inget larm när personal redan står vid bordet.
- Dessertläge: maten är avplockad och gästerna sitter kvar. Föreslå dessert eller kaffe.
- Vill betala: en stund efter avplockning, eller när gästerna plockar fram väskor och reser sig.
- Akut läge (SOS): något har tappats eller spillts vid bordet.
- Kameran ser inte bordet: kameran är skymd, mörk, suddig eller har flyttats.
Varje larm blir en uppgift. Tryck Klar när den är gjord.
Falsklarm: tryck Falsklarm om AI:n larmat fel (på SOS och Söker kontakt). Vid bord med flera falsklarm blir AI:n försiktigare.
AI:n lär sig restaurangen: hur länge rätterna tar i köket, när gästerna brukar vilja betala och var dessert sällan beställs.

## Övriga sidor
- Kök: beställningarna till köket. Markera när maten är klar, då får personalen ett larm.
- Entré: väntelistan vid dörren. Sidan larmar när ett bord som passar blir ledigt. Kräver supabase/012_growth.sql.
- Statistik: sittningar, väntetider och hur ofta AI:n haft rätt.
- Planritning: ändra borden i efterhand.

## Inställningar
Utseende, språk och larm gäller bara den enhet man står på. Varje platta och mobil kan ha egna val.
- Utseende: Färg på knappar, Textstorlek (Normal, Stor, Extra stor), Färre animationer.
- Språk: menyer, knappar och larm på 16 språk.
- Arbete: Startsida efter inloggning, och att hålla skärmen vaken i Matsal och Kök.
- Larm: Larmljud, Vibration, Testa ljudet, och Notiser när appen ligger i bakgrunden.
- Lägg Bordvakt på hemskärmen: då öppnas appen som en vanlig app på plattan eller mobilen.
- Funktioner → Anpassa funktioner: stäng av det restaurangen inte använder. Gäller alla i personalen.
- Konto: Byt lösenord (minst 10 tecken).
- AI-datorn: koppla datorn med koden som visas på den.

# Vanliga problem
- "Kunde inte ansluta": fel IP-adress, användare eller lösenord, eller kameran är avstängd. Kameran och datorn måste vara på samma nätverk. Testa adressen i VLC (Media -> Öppna nätverksström).
- "Adressen ska börja med rtsp://": skriv hela adressen, eller ett nummer för webbkamera.
- Svart bild: linsen är övertäckt, rummet är mörkt eller kameran har IR-läge avstängt. Kontrollera ljuset och att inget täcker kameran.
- Suddig bild: rengör linsen och ställ in kamerans fokus.
- "Bordet syns inte där det ska": kameran har flyttats eller något skymmer. Kalibrera om bordet.
- "Bordet är inte kalibrerat": gör steg 4 för bordet.
- "Kameran ger ingen bild": kameran är frånkopplad eller strömlös, eller nätverket är nere. Starta om kameran.
- "AI-motorn är avstängd": AI-motorn når inte appen. Visar datorn en kod: skriv in den under Inställningar → AI-datorn. Annars: se AI-motorn ovan.
- Vakti svarar inte: chatten är inte installerad eller startar. Den första frågan kan ta upp till en halv minut.
- Inget larmljud: kontrollera Inställningar → Larm och att plattans ljud är på. Tryck "Testa ljudet".
- Inga notiser på mobilen: slå på Notiser i Inställningar → Larm och tillåt notiser när mobilen frågar. På iPhone måste appen först läggas på hemskärmen.
- Databasfel om saknade tabeller: kör filerna i mappen supabase/ i Supabase -> SQL Editor, i nummerordning.
- Webbkamera på Mac: macOS frågar om kameratillstånd första gången. Tillåt Terminal/Python under Systeminställningar -> Integritet och säkerhet -> Kamera.
"""

RULES = """\
Du är Vakti, Bordvakts egen AI. Din uppgift är att hjälpa restaurangen att installera Bordvakt,
förstå hur appen fungerar och lösa problem.
Regler:
- Svara på {language}. Skriver användaren tydligt på ett annat språk: svara på det språket.
- Svara kort: högst 5 meningar eller en kort numrerad lista. Ett steg i taget.
- Utgå från INSTALLATIONENS LÄGE nedan. Det är sant just nu. Säg aldrig emot det.
- Visar läget ett problem som hör ihop med frågan (t.ex. en kamera utan bild): börja med det.
- Frågar användaren om ett bord: titta i läget efter bordets status och förklara vad den betyder.
- Svara bara utifrån MANUALEN. Om svaret inte finns där: säg att du inte vet och föreslå att kontakta Bordvakts support. Hitta aldrig på knappar, menyer eller inställningar.
- Frågor som inte handlar om Bordvakt: svara vänligt att du bara hjälper till med Bordvakt.
- Be aldrig om lösenord. Om användaren skriver ett lösenord: säg att det inte behövs i chatten.
- Skriv inte rubriker. Vanlig text, och listor bara när det är steg.
- Användaren ser inte manualen eller läget. Hänvisa aldrig till dem ("se manualen", "vanliga problem"): skriv själva stegen.
"""


class ChatUnavailable(Exception):
    """Ollama är inte igång eller modellen saknas.
    code = "not_installed" när chatten aldrig har installerats på den här datorn."""

    def __init__(self, message: str, code: str = "unavailable"):
        super().__init__(message)
        self.code = code


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


# ------------------------------------------------------------ Rätt del av manualen
# En liten modell svarar bättre (och snabbare) med det som rör frågan än med hela manualen.
# Manualen delas i avsnitt; de som delar flest ord med frågan skickas med, upp till MANUAL_BUDGET tecken.

MANUAL_BUDGET = 6000
_WORD = re.compile(r"\w+")
_STOP = {"och", "att", "det", "som", "en", "ett", "är", "på", "jag", "vi", "hur", "vad", "kan", "inte",
         "för", "med", "till", "av", "den", "har", "om", "man", "så", "the", "and", "how", "what", "is", "to"}


def _stems(text: str) -> set[str]:
    """Ordens början (5 tecken), så att "kameran", "kameror" och "kamerorna" räknas som samma ord."""
    return {w[:5] for w in (m.lower() for m in _WORD.findall(text)) if len(w) > 2 and w not in _STOP}


def _sections(manual: str | None = None) -> list[str]:
    manual = MANUAL if manual is None else manual
    parts: list[str] = []
    current: list[str] = []
    for line in manual.splitlines(keepends=True):
        if line.startswith(("# ", "## ")) and current:
            parts.append("".join(current))
            current = []
        current.append(line)
    if current:
        parts.append("".join(current))
    return [p for p in parts if p.strip()]


def relevant_manual(question: str, budget: int = MANUAL_BUDGET, manual: str | None = None) -> str:
    """Avsnitten som rör frågan mest, i manualens ordning. Ryms allt, eller känns inget
    igen (t.ex. en fråga på ett annat språk), skickas hela manualen."""
    manual = MANUAL if manual is None else manual
    if len(manual) <= budget:
        return manual
    words = _stems(question)
    sections = _sections(manual)
    # Träffar per avsnitt, lite lägre för långa avsnitt (annars vinner alltid det längsta)
    scored = sorted(((len(words & _stems(s)) / (1 + len(s) / 2000), i) for i, s in enumerate(sections)), reverse=True)
    if not scored or scored[0][0] == 0:
        return manual
    chosen: set[int] = set()
    used = 0
    for score, i in scored:
        if score == 0 or used + len(sections[i]) > budget:
            continue
        chosen.add(i)
        used += len(sections[i])
    return "".join(sections[i] for i in sorted(chosen))


def system_prompt(facts: str, language: str, question: str = "") -> str:
    lang = LANGUAGES.get(language, LANGUAGES["sv"])
    return (
        RULES.format(language=lang)
        + "\n# INSTALLATIONENS LÄGE\n" + (str(facts).strip()[:MAX_FACTS] or "Okänt.")
        + "\n\n# MANUALEN\n" + relevant_manual(question)
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
        if not _ollama_bin():
            raise ChatUnavailable("Chatten är inte installerad på datorn (Ollama saknas).", "not_installed")
        raise ChatUnavailable("Ollama är inte igång.")
    body = json.dumps({
        "model": CHAT_MODEL,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        # Manualen väljs efter de senaste frågorna (en följdfråga som "och sen?" har få egna ord)
        "messages": [{"role": "system", "content": system_prompt(
            facts, language, " ".join(m["content"] for m in history[-3:] if m["role"] == "user"))}] + history,
        "options": {"temperature": 0.2, "num_ctx": 8192, "num_predict": 400},
    }).encode()
    request = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=body,
                                     headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if e.code == 404 or "not found" in detail:
            raise ChatUnavailable(f"Modellen {CHAT_MODEL} saknas. Kör: ollama pull {CHAT_MODEL}", "not_installed") from e
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
