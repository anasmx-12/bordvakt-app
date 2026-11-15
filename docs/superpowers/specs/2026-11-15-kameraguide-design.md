# Kameraguiden: hitta, koppla och placera kamerorna själv

Datum: 2026-11-15. Status: utkast, väntar på godkännande.

## Varför

Restaurangägare ska kunna installera Bordvakt helt själva. I dag kör de fast i kamerasteget på tre ställen:

1. De vet inte vilket märke eller vilken typ kameran är.
2. De hittar inte kamerans adress (IP, sökväg) och lösenord.
3. De vet inte var kamerorna ska sitta för att se borden.

Steg 1 och 2 ska AI-datorn lösa åt dem. Steg 3 går inte att gissa från en modell. Där guidar vi i stället med kamerans riktiga bild.

## Mål

- Ägaren behöver i normalfallet bara skriva **kamerans lösenord**. Adress, märke och sökväg hittas automatiskt.
- Kameror som inte hittas automatiskt kan identifieras genom att **fota etiketten** eller **skriva modellen**. Då visas en steg-för-steg-guide för just det märket.
- När en kamera är ansluten får ägaren veta **hur många bord kameran ser** jämfört med planritningen, och vad de kan göra om bord saknas.

## Inte mål (nu)

- Att placera eller rita bordens rutor automatiskt i kalibreringen. Ägaren ritar dem som i dag.
- Att ändra kamerans inställningar på distans (slå på RTSP/ONVIF åt användaren).
- Kameror utanför restaurangens lokala nät.
- Övriga förbättringar (demoläge, nätverksvarning, tydligare installation, passsammanfattning, färgförklaring). De tas som egna projekt efter det här, i ordningen 5, 7, 2, 4, 6.

## Anti-mål (misslyckande även om det "fungerar")

- AI:n hittar på adresser, menyval eller instruktioner. Allt som visas ska komma från kameran själv, från märkestabellen eller från texter vi skrivit och granskat. Språkmodellen används inte för att ta fram adresser eller guider.
- Kamerans lösenord sparas eller loggas någon annanstans än i dag (camera_streams, som webbläsaren inte kan läsa).
- Sökningen gör nätverket långsamt eller ser ut som ett angrepp. Den ska vara kort, bara gälla det lokala nätet och bara köras när ägaren trycker på knappen.

## Begränsningar

- All AI körs lokalt på restaurangens Mac (AI.py). Språkmodellen (Qwen3 4B) känner inte till kameramodeller tillförlitligt.
- Webbappen ligger på Vercel och når inte restaurangens nät. Allt som rör kamerorna går via AI-motorn (`enginePost`).
- Vercel tar högst 4,5 MB per anrop. Foton krymps i webbläsaren (`lib/shrinkImage.ts`).
- AI-motorn ska inte få nya Python-paket om det går att undvika. WS-Discovery och ONVIF görs med standardbiblioteket (socket, urllib, hashlib).

## Sätt som övervägdes

| Sätt | Fördel | Nackdel |
|---|---|---|
| **A. AI-datorn hittar kamerorna själv** (ONVIF och provning av adresser) | Löser adressproblemet helt för de flesta | Mest att bygga. Vissa kameror har ONVIF avstängt |
| **B. Fota eller skriv modellen, få en guide för märket** | Litet, fungerar på alla nät | Användaren måste fortfarande hitta adressen själv |
| C. Språkmodellen skriver guiden fritt | Täcker alla modeller | Hittar på fel. Strider mot målet |

**Valt: A med B som reserv, plus placeringshjälp med kamerabilden.** Godkänt av ägaren 2026-11-15.

## Hur det fungerar

### Användarens väg (kamerasteget i /setup)

```
[ Hitta mina kameror ]         ← förvalt, stor knapp
   AI-datorn söker i nätet (≈10 s)
   → Lista: "Hikvision DS-2CD2143G2 · 192.168.1.64"  [Koppla]
            "Okänd kamera · 192.168.1.80 (svarar på video)" [Koppla]
   [Koppla] → fråga: användarnamn (förifyllt efter märke) + lösenord
            → AI-datorn hittar rätt videoadress och testar
            → förhandsbild + placeringskoll → [Spara kameran]

Hittar du inte din kamera?
   [ Fota etiketten ]  [ Skriv modellen ]  → märke känns igen
   → guide för märket (hitta IP, slå på RTSP/ONVIF, användarnamn)
   → befintliga formuläret, förifyllt med märket

[ Ange adressen själv ]        ← det nuvarande formuläret, oförändrat
```

### AI-motorn: nya anrop (AI.py, ny modul `camera_discovery.py`)

1. **`POST /discover-cameras`**: ingen indata. Returnerar en lista med enheter.
   - **WS-Discovery** (UDP multicast 239.255.255.250:3702, Probe för NetworkVideoTransmitter). Väntar ≈3 s. Ger IP och ONVIF-adress.
   - **Portkoll** i Macens eget /24-nät: TCP-anslutning till 554 (RTSP), 80 och 8000, kort tidsgräns, begränsat antal samtidiga. Fångar kameror med ONVIF avstängt.
   - Märke från WS-Discovery-svarets scopes (`onvif://www.onvif.org/hardware/...`, `.../name/...`) när det finns.
   - Svar: `[{ ip, onvif_url | null, ports: [554, 80], brand_guess | null, model | null }]`. Inga lösenord behövs för sökningen.
2. **`POST /connect-camera { ip, onvif_url?, username, password, brand? }`**:
   - Med ONVIF: `GetDeviceInformation` (märke, modell) och `GetProfiles` + `GetStreamUri` (exakt RTSP-adress), med WS-UsernameToken digest.
   - Utan ONVIF eller om det misslyckas: prova märkets sökvägar ur en tabell i AI-motorn (samma som `lib/cameras.ts`, kanal 1). Utan känt märke prövas alla märkens sökvägar i tur och ordning, med kort tidsgräns.
   - Den första adressen som ger en bild används och testas med befintliga `test_camera`.
   - Svar: `{ ok, stream_url, brand, model, preview, width, height, warning, placement }` eller `{ ok: false, error, reason: 'auth' | 'no_stream' | 'unreachable' }`. `stream_url` innehåller lösenordet och går bara tillbaka till webbappens server, som sparar den i camera_streams som i dag.
3. **`POST /read-camera-label { photo }`**: Macens textigenkänning (tools/ocr.swift, samma som menyn) läser etiketten. Svar: `{ text, brand, model }`, där märke och modell matchas med reguljära uttryck (t.ex. `DS-2CD…` → Hikvision, `IPC-HFW…` → Dahua, `RLC-…` → Reolink, `AXIS …`, `UVC-…` → UniFi, `Tapo/VIGI` → TP-Link, `XNV/QNV/PNM-…` → Hanwha, `IPC32…` → Uniview, `IP8M-…` → Amcrest, `FI98…/C1` → Foscam). Ingen språkmodell.
4. **Placeringskoll** (en del av svaret från `/connect-camera`, och ett eget anrop `POST /camera-placement { stream_url }` så att den kan köras igen efter att kameran flyttats): YOLOX på en bild. Räknar bord (klass 60) och stolar (56), mäter ljus (`frame_problem`) och skärpa. Svar: `{ tables_seen, chairs_seen, boxes: [[x1,y1,x2,y2]…], plan_tables, tips: [kod…] }`. Tipsen är fasta koder, till exempel `few_tables`, `too_dark`, `blurry`, `too_low`, `no_tables`, som webbappen översätter. `too_low` gäller när de flesta bord ligger i nedre femtedelen av bilden.

### Webbappen

- **API-rutter** (proxy till motorn med `currentRestaurantId` + `enginePost`, samma mönster som `/api/setup/cameras/test`): `/api/setup/cameras/discover`, `/api/setup/cameras/connect`, `/api/setup/cameras/label`, `/api/setup/cameras/placement`. Etikettfotot krymps i webbläsaren.
- **Spara**: `/api/setup/cameras/connect` sparar inte. Användaren trycker "Spara kameran", och då anropas befintliga `POST /api/setup/cameras` med `stream_url`, märke och ett namn. Det befintliga flödet för sparande och lösenord ändras inte.
- **Guider per märke**: fasta texter i `lib/cameraGuides.ts` (svenska först, via i18n-nycklar), en per märke i BRANDS. Varje guide innehåller: hur man hittar kamerans IP (märkets app eller routern), hur man slår på RTSP och ONVIF, standardanvändarnamn och var lösenordet sattes. Texterna skrivs av oss och ska granskas mot tillverkarnas manualer innan lansering.
- **Placeringskollen** visas under förhandsbilden: bilden med bordens rutor ritade, "Ser 5 av 8 bord" och tipsen. Spara går alltid att trycka på. Kollen är vägledning, inget krav.
- **Kalibreringssteget** får en rad överst: "Bord som ingen kamera ser: 6, 7, 8". Den bygger på vilka bord som saknar kamera, vilket redan finns i `setup_status.unmapped_tables`.

## Säkerhet

- Endast AI-motorn söker i nätet, och bara när ägaren trycker på knappen. Webbappen kan inte ange vilka adresser som söks. Motorn söker bara i sitt eget /24-nät.
- `/connect-camera` tar emot IP-adresser. Motorn godkänner bara privata adresser (10/8, 172.16/12, 192.168/16) så att den inte kan användas för att nå ut på internet.
- Lösenord loggas aldrig av motorn eller webbappen. Felmeddelanden innehåller aldrig `stream_url`.
- Begränsning av antalet anrop: discover högst 5 per minut per restaurang, connect högst 20 per minut (för att inte låsa kamerakonton efter felaktiga lösenord).

## Lämnat åt den som bygger

- Exakta tidsgränser och antal samtidiga anslutningar i portkollen, så länge en sökning tar under ≈15 s.
- Hur ONVIF-SOAP byggs (strängmallar är okej).
- Tröskelvärden för `blurry` och `too_low`.
- Utseendet i detalj, i samma stil som resten av installationen (kort, `btn`, ikoner från lucide).
- Tester: Python-tester för märkesmatchning av etiketter, tolkning av WS-Discovery-svar, ONVIF-digest och tipslogik (tests/, som befintliga). Nätverket mockas.

## Mina beslut (kan ändras)

- "Hitta mina kameror" blir förvalt i kamerasteget. Nuvarande formulär finns kvar som "Ange adressen själv".
- Inga nya Python-paket.
- Guidetexterna skrivs på svenska först. Övriga språk faller tillbaka till svenska tills de översätts.
- Telefon och USB-webbkamera hanteras som i dag (ingen sökning).
- Inspelare (NVR) med flera kameror: ger ONVIF flera videoprofiler (eller svarar märkets sökväg för kanal 2, 3, …), visas varje kanal som en egen kamera med förhandsbild. Ägaren väljer vilka som ska sparas. Utan ONVIF prövas kanalerna 1–16 tills en kanal inte svarar.
