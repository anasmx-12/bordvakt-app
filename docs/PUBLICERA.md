# Publicera Bordvakt: det som bara du kan göra

Koden är klar för drift. Det här kräver konton, betalning eller beslut, så det måste du göra själv.
Gör stegen i ordning.

## 1. Domän
Köp en domän, t.ex. `bordvakt.se` (Loopia, One.com eller Cloudflare). Appen kan ligga på `app.bordvakt.se`.

## 2. Supabase (databasen)
1. Uppgradera projektet till **Pro**. Då får ni dagliga backuper och databasen pausas inte.
2. Kör de SQL-filer som inte är körda än i SQL Editor: `014_engine_accounts.sql`, `015_webhooks.sql`, `016_identity.sql`, `017_remove_bankid.sql`, `018_rate_limits.sql`, `019_support_staff.sql` och `020_password_resets.sql`.
3. Authentication → URL Configuration:
   - Site URL: `https://app.bordvakt.se`
   - Redirect URLs: `https://app.bordvakt.se/**`
4. Authentication → Rate Limits: kontrollera att gränserna för inloggning är på (standard).
5. Notera vilken **region** projektet ligger i (Settings → General). Den ska in i `web/lib/company.ts`.

## 3. Vercel (webbappen)
1. Skapa ett konto. Välj **Pro**, för att morgonrapporten körs varje timme.
2. Importera mappen `web` och välj den som "Root Directory".
3. Lägg in miljövariablerna (Settings → Environment Variables). Ta samma värden som i `web/.env.local`, plus de nya:

| Namn | Värde |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | från Supabase |
| `NEXT_PUBLIC_SITE_URL` | `https://app.bordvakt.se` |
| `STRIPE_SECRET_KEY` | live-nyckeln (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | se steg 4 |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SUPPORT_EMAIL` | se steg 5 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | från `web/.env.local` |
| `CRON_SECRET` | en lång slumpad sträng, t.ex. från `openssl rand -hex 32` |
| `DB_WEBHOOK_SECRET` | en annan lång slumpad sträng (`openssl rand -hex 32`) |

4. Koppla domänen (Settings → Domains). https ordnas automatiskt.
5. Kör sedan sista raden i `supabase/015_webhooks.sql` med er adress och samma `DB_WEBHOOK_SECRET`.
   Det gör att mobil-larmen fungerar.

## 4. Stripe (betalning)
1. Aktivera kontot för riktiga betalningar (företagsuppgifter och bankkonto).
2. Developers → Webhooks → Add endpoint: `https://app.bordvakt.se/api/billing/webhook`.
   Välj händelserna `checkout.session.completed` och `customer.subscription.*`.
3. Kopiera "Signing secret" (`whsec_…`) till `STRIPE_WEBHOOK_SECRET` i Vercel.

## 5. Gmail (mejl)
1. Slå på tvåstegsverifiering på Gmail-kontot.
2. Skapa ett applösenord: myaccount.google.com → Säkerhet → Applösenord.
3. Lägg in det som `GMAIL_APP_PASSWORD`, och adressen som `GMAIL_USER` och `SUPPORT_EMAIL`.

## 6. Cloudflare (fast adress till AI-datorn, valfritt men rekommenderat)
Utan det här fungerar tunneln ändå, men adressen byts när AI-datorn startar om.
1. Skapa ett gratis konto och lägg till domänen.
2. Zero Trust → Networks → Tunnels → Create tunnel (en per restaurang).
   Public hostname: t.ex. `ai-restaurangnamn.bordvakt.se` → `http://127.0.0.1:8080`.
3. På restaurangens dator, i `.env`:
   - `CLOUDFLARE_TUNNEL_TOKEN=` (token som visas i Cloudflare)
   - `ENGINE_PUBLIC_URL=https://ai-restaurangnamn.bordvakt.se`

## 7. Juridik
1. Fyll i företagsuppgifterna i `web/lib/company.ts` (namn, org.nr, adress, e-post, region).
   Då försvinner "Utkast" från sidorna.
2. Låt en jurist läsa `/villkor`, `/integritet` och `/pub-avtal`.
3. Fyll i `[FÖRETAGSNAMN, ORG.NR]` och `[E-POST] · [TELEFON]` längst ner på startsidan (`web/public/landing/index.html`).

## 8. Installera hos en restaurang
1. Ägaren loggar in → Inställningar → **AI-datorn** → Skapa kopplingskod.
2. På restaurangens Mac: packa upp Bordvakt-mappen och kör `bash install/install-mac.sh`.
   Klistra in koden när programmet frågar efter den.
3. Klart: AI-motorn startar av sig själv, även efter omstart.

## 9. Namn och kort
Nya kunder skriver sitt fullständiga namn före betalningen. Stripe kräver kortinnehavarens namn, och efter
betalningen jämförs namnen. Stämmer de inte låses appen tills kunden byter till ett kort i sitt namn
(via "Hantera prenumeration") eller rättar en felstavning. Provperioden fortsätter, inget dras.
För att byte av kort ska kontrolleras automatiskt: välj även `customer.subscription.updated` i Stripes
webhook (steg 4), vilket redan ingår i `customer.subscription.*`.

## 10. Säkerhet (gör innan första kunden)
1. **Byt Stripe live-nyckeln.** En gammal live-nyckel låg lös i `web/.env.local` (borttagen 2026-11-06).
   Stripe → Developers → API keys → "Roll key" på secret key. Lägg den nya bara i Vercel, aldrig i en fil.
2. **Supabase → Authentication → Policies / Passwords:**
   - Minsta längd: **10** (samma som appen kräver).
   - Slå på **Leaked password protection** (stoppar lösenord som läckt på nätet, kräver Pro).
3. **Supabase → Authentication → Attack Protection:** slå på **CAPTCHA** (hCaptcha eller Turnstile) om ni
   får skräpkonton.
4. **Tvåstegsinloggning** på dina egna konton: Supabase, Vercel, Stripe, Cloudflare, Gmail och domänen.
   Den som kommer åt något av dem kommer åt allt.
5. **Ny kopplingskod till AI-datorn** (den gamla klistrades in i en chatt): Inställningar → AI-datorn →
   Skapa kopplingskod, och kör `bash install/install-mac.sh` igen.
6. **Radera `.env.backup-före-installation`** när AI-datorn fungerar. Den innehåller huvudnyckeln.

## 10b. Supportsajten (support.bordvakt.se)
1. Nytt Vercel-projekt med mappen `bordvakt support`. Samma Supabase-, Stripe- och Gmail-nycklar som webbappen.
2. `NEXT_PUBLIC_SITE_URL=https://support.bordvakt.se` och `CUSTOMER_SITE_URL` = webbappens adress.
3. Lägg till domänen support.bordvakt.se i projektet.
4. Kör `npm run create-admin` en gång (på datorn) och logga in med länken. Bjud in resten under Personal.
Se `bordvakt support/README.md`.

## 11. Testa allt på riktigt
Gör hela flödet med en riktig kamera innan första kunden:
1. Registrera konto: koden kommer i mejlet, skriv ditt namn, betala med ett riktigt kort i ditt namn (återbetala sedan i Stripe).
2. Gå igenom installationen: planritning, kamera, kalibrering.
3. Sätt dig vid ett bord: blir det "upptaget" i matsalen?
4. Beställ via QR-koden från en mobil. Kommer det till köket och plingar mobil-larmet?
5. Ställ dig i kön via kölistans QR-kod och ropa upp dig själv.
6. Kontrollera att morgonrapporten kommer nästa dag.
