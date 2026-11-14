# Tillväxtfunktioner (godkänt 2026-11-06: "lägg till alla dina förslag förutom 6 och 7")

Byggs i denna ordning. Ägarens sidor på svenska, gästens och personalens texter på 16 språk.

1. **Statistik + morgonrapport** — ny sida /statistik (dag/vecka/månad): gäster, sittningar, sittningstid,
   väntan på mat, personalens svarstid, SOS, intäkt per dag/timme, mest sålda rätter.
   Ny logg `table_sessions` (AI.py sparar varje avslutad sittning: start, slut, flest gäster).
   Morgonmejl kl. 07 till ägaren via Gmail (lib/mail.ts), gårdagens siffror.
2. **Skylt och integritet** — /setup/skylt: utskrivbar kameraskylt (kamerabevakningslagen) och
   informationstext till gästerna. Ingen ansiktsigenkänning, ingen video sparas.
3. **Recension** — på QR-sidan när gästens beställningar är serverade: 1–5 stjärnor.
   4–5 → restaurangens Google-recensionslänk (ny inställning). 1–3 → text till ägaren (sparas, syns i Statistik).
4. **Mobil-larm** — appen kan installeras på mobilen (PWA) och få pushnotiser (Web Push, VAPID, gratis).
   Varje mobil väljer "mina bord" (tomt = alla). AI.py skickar push för nya uppgifter, Next.js för QR-beställningar.
5. **Bemanningsprognos** — i Statistik: snitt gäster per veckodag och timme senaste 8 veckorna →
   föreslaget antal servitörer (inställning: gäster per servitör, standard 12).
6. **Matens väntetid** — snittid per rätt (beställd → klar i köket). Beräknad tid visas för gästen,
   i bordets panel och i köket (sen = rött).
7. **Merförsäljning** — QR-kundvagnen föreslår rätter som ofta beställs tillsammans, och dryck om ingen finns.
   När bordet är i dessertläge visar QR-sidan "Sugen på dessert eller kaffe?".
8. **Entré och väntelista** — /entre: värden lägger till sällskap (namn, antal). Beräknad väntetid från
   lediga bord och snittid per sittning. Larm när ett passande bord blir ledigt. Gästen får en länk
   (/w/<kod>) som visar platsen i kön (sms senare).
9. **Svinn** — knappen "Kom tillbaka med mat" i köket per serverad rätt, plus nya portioner efter SOS
   och makulerade beställningar. Syns i Statistik. (Kameran kan inte säkert se halvätna tallrikar än.)
10. **Stämpelkort** — ägaren väljer "var N:e <rätt/kategori> gratis". Gästens mobil samlar stämplar
    (anonymt id i mobilen, inget konto). Belöningen visas med en kod som personalen löser in.

Databas: supabase/012_growth.sql (allt ovan i en fil).
