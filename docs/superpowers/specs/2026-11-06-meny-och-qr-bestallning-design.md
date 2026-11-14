# Meny och QR-beställning (valfritt)

Godkänd av ägaren 2026-11-06 ("sätt igång").

## Mål
Ägaren kan lägga in restaurangens meny i installationen. Gästerna kan då beställa
från sin mobil via en QR-kod på bordet. Allt är valfritt: den som hoppar över steget
fortsätter som i dag (personalen skriver in beställningar).

## Beslut
- Gästerna beställer bara. Betalning sker som vanligt hos personalen.
- Ägaren väljer: QR-beställning av / direkt till köket / personalen godkänner först.
- Menyn skrivs in för hand. Fota menyn (Macens textigenkänning + lokal AI) är fas 2.

## Delar
1. **Installation, steg 5 "Meny (valfritt)"** efter Kalibrering. "Hoppa över" sätter
   `restaurants.menu_step_done`. Installationen räknas som klar utan meny.
   Kategorier och rätter (namn, pris, beskrivning, allergener, slut i dag, ordning).
2. **QR**: `tables.qr_token` (slumpad, 32 tecken). Sidan `/b/<token>` är öppen utan
   inloggning. Utskriftsark med alla bordens koder. En kod kan bytas.
3. **Gästsidan**: meny, kundvagn, kommentar, skicka, status (Mottagen → Tillagas → På väg).
   Texterna på 16 språk efter telefonens språk.
4. **Godkännande**: status `PENDING_APPROVAL` på orders. Servitören trycker Godkänn/Neka.
5. **Skydd**: endast via serverrutter som kontrollerar token, prenumeration och
   `qr_ordering`. Priser från databasen. Max 5 beställningar/bord/10 min, max 30 rätter.
6. **Personalens panel** kan välja rätter ur menyn. Fritext finns kvar.

## Databas (supabase/010_menu.sql)
`menu_categories`, `menu_items`, `restaurants.qr_ordering`, `restaurants.menu_step_done`,
`restaurants.currency`, `tables.qr_token`, `orders.source`, status `PENDING_APPROVAL`.

## Test
tsc + eslint, API-rutterna med fel token / avstängd QR / slut rätt / för många beställningar.
