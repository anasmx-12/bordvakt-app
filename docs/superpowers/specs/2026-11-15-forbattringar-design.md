# Fem förbättringar för enklare användning – design

Godkänd av ägaren 2026-11-15 ("godkänner"). Ordning: 5, 7, 2, 4, 6.

## Varför
Ägare och personal ska komma igång och klara sig själva: veta var de är i installationen, förstå färgerna,
se hur appen ser ut innan allt är kopplat, inte tappa tryck när nätet går, och få en sammanfattning när passet är slut.

## 5. Tydligare installation
- Mobil (under `sm`): "Steg X av 7 · <namn>" och en framstegsstapel ovanför steglistan, och ungefärlig tid för steget
  (Restaurang 2 min, Planritning 5, Kameror 10, Kalibrering 5, Meny 5, Tillval 2).
- SetupGate (Matsal/Kök innan installationen är klar) visar "X av 4 steg klara" (restaurang, planritning, kameror, kalibrering).
- Finns redan: installationen fortsätter där man slutade.

## 7. Färgförklaring första gången
- Första gången Matsalen öppnas på en enhet: ett kort med varje färg, vad den betyder och vad personalen gör.
- Visas en gång per enhet (localStorage, tål att lagringen saknas), öppnas igen med en "?"-knapp vid färgförklaringen.
- Översätts till alla 16 språk (personalen väljer språk).

## 2. Demoläge
- "Se hur det ser ut (demo)" i SetupGate och på installationssidan → `/matsal?demo=1`.
- Låtsasplan med 8 bord vars status byter av sig själv var 4:e sekund, några uppgifter och en klar beställning.
- Tydlig rad: "Demo – låtsasdata, inte din restaurang" med länk tillbaka till installationen.
- Inget skrivs till databasen; tryck i demon ändrar bara låtsasdatan. SetupGate visas inte i demon.

## 4. Uppkoppling tappad + kö
- Gul rad i Matsalen när webbläsaren är offline eller realtidsanslutningen är nere: "Ingen uppkoppling – visar läget från HH:MM".
- Köas (localStorage) och skickas när nätet är tillbaka: "uppgift klar" (inkl. falsklarm) och "beställning serverad".
- Kön: ett tryck per id (senaste vinner), tryck äldre än 15 min slängs, 404/409 räknas som redan gjort.
- Annat (ny beställning, godkänna QR-beställning) stoppas med "Ingen uppkoppling – försök igen när nätet är tillbaka".
- Antal väntande tryck visas i den gula raden.

## 6. Sammanfattning efter passet
- Knappen "Avsluta passet" i Matsalen öppnar ett kort med dagens siffror från `/api/stats?from=idag&to=idag`
  (samma beräkning som morgonmejlet): gäster, beställningar, beställt för, väntan på maten, svarstid, SOS, betyg, mest beställt (topp 3).
- Bara visning; ingenting stängs eller nollställs.

## Avgränsningar
- Ingen ändring i AI-motorn eller databasen.
- Köket får inte kön (köksstatusar ändras ofta och sent skickade tryck kan bli fel).

## Tester
Webbappen saknar testramverk. Ren logik (kön, demodata, stegräkning) läggs i beroendefria moduler och testas med
`node --test` (Node 24 kör TypeScript direkt). UI kontrolleras i webbläsaren i mobil- och datorstorlek.
