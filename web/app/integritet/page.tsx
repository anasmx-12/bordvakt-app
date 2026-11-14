import Link from 'next/link';
import LegalPage from '../components/LegalPage';
import { COMPANY, field } from '@/lib/company';
import { WAITLIST_DAYS } from '@/lib/cleanup';

export const metadata = { title: 'Integritetspolicy – Bordvakt' };

export default function PrivacyPage() {
  const name = field(COMPANY.name, 'Företagsnamn');
  return (
    <LegalPage title="Integritetspolicy">
      <p>
        Här beskriver {name} (org.nr {field(COMPANY.orgNr, 'org.nr')}, {field(COMPANY.address, 'adress')}) hur
        personuppgifter behandlas i Bordvakt. Frågor: {field(COMPANY.email, 'e-post')}.
      </p>

      <h2>Två roller</h2>
      <ul>
        <li><b>Vi är personuppgiftsansvariga</b> för uppgifter om restaurangernas användare (konton, betalning, support).</li>
        <li><b>Restaurangen är personuppgiftsansvarig</b> för det som rör deras gäster och kamerabevakningen. Vi är då personuppgiftsbiträde och följer <Link href="/pub-avtal">PUB-avtalet</Link>. Gäster som har frågor ska i första hand vända sig till restaurangen.</li>
      </ul>

      <h2>Kamerorna</h2>
      <ul>
        <li>Bilderna analyseras på restaurangens egen dator. De skickas inte till någon molntjänst för analys.</li>
        <li>Inga bilder eller filmer sparas. Det som sparas är bordens status och statistik utan personuppgifter (till exempel antal gäster och hur länge de satt).</li>
        <li>Ingen ansiktsigenkänning används och ingen identifieras.</li>
        <li>Inloggad personal kan se livebilden. Den skickas då krypterat genom en tunnel hos Cloudflare till personalens enhet och sparas inte på vägen.</li>
      </ul>

      <h2>Vilka uppgifter, varför och hur länge</h2>
      <ul>
        <li><b>Konton</b> (e-post, lösenord i krypterad form, roll): för att logga in. Sparas så länge kontot finns.
          E-postadressen bekräftas med en kod som mejlas till den. Koden sparas i krypterad form och raderas när den har använts.</li>
        <li><b>Namn</b> (förnamn, efternamn): för att veta vem som tecknar abonnemanget och för kvittona. Jämförs med
          namnet på betalkortet hos Stripe. Sparas så länge kontot finns.</li>
        <li><b>Betalning</b> (företagsuppgifter, abonnemang): sköts av Stripe. Vi sparar inga kortuppgifter. Bokföringsunderlag sparas i 7 år enligt bokföringslagen.</li>
        <li><b>Support</b> (namn, e-post, telefon, meddelanden): för att hjälpa kunden. Sparas i högst 24 månader efter att ärendet är avslutat.</li>
        <li><b>Kölistan</b> (gästens namn, sällskapets storlek, telefon om gästen anger det): för att kunna ropa upp gästen. Raderas automatiskt efter {WAITLIST_DAYS} dagar.</li>
        <li><b>QR-beställningar</b> (vad som beställts, bord, tid): inga namn eller kontaktuppgifter. Används för köket och restaurangens statistik.</li>
        <li><b>Recensioner</b> (betyg och frivillig kommentar): skrivs inte om gästen inte vill. Gästen bör inte skriva personuppgifter i kommentaren.</li>
        <li><b>Stämpelkort</b>: en slumpad kod som sparas i gästens webbläsare, utan namn eller kontaktuppgifter.</li>
        <li><b>Mobil-larm</b>: en teknisk adress till personalens mobil och vilka bord larmen gäller. Tas bort när larmen stängs av eller adressen slutar fungera.</li>
      </ul>
      <p>
        Rättslig grund: avtal (konton, betalning, support), rättslig förpliktelse (bokföring) och berättigat intresse
        (säkerhet, felsökning, kölista). Restaurangen har sin egen rättsliga grund för kamerabevakningen.
      </p>

      <h2>Var uppgifterna finns</h2>
      <p>Vi använder de här underbiträdena:</p>
      <ul>
        <li>Supabase: databas och inloggning. Data lagras i {field(COMPANY.dataRegion, 'region')}.</li>
        <li>Vercel: driftar webbappen.</li>
        <li>Cloudflare: krypterad tunnel till restaurangens AI-dator.</li>
        <li>Stripe: betalningar. Stripe får ditt namn, kortinnehavarens namn och fakturaadress.</li>
        <li>Google (Gmail): e-post, till exempel morgonrapporten och supportsvar.</li>
      </ul>
      <p>
        Om uppgifter överförs utanför EU/EES sker det med stöd av EU-kommissionens standardavtalsklausuler eller
        EU–USA-ramverket för dataskydd.
      </p>

      <h2>Säkerhet</h2>
      <p>
        Trafiken är krypterad (https). Varje restaurang ser bara sina egna uppgifter, och det kontrolleras av databasen.
        AI-datorn har ett eget konto med begränsade rättigheter. Videon kräver inloggning, och de som släpps in
        får en biljett som bara gäller en kort stund. Vi begränsar antal försök för att stoppa intrångsförsök.
      </p>

      <h2>Cookies</h2>
      <p>
        Vi använder bara nödvändiga cookies och lagring i webbläsaren: inloggningen, appens inställningar, gästens
        stämpelkort. Inga cookies för reklam eller spårning.
      </p>

      <h2>Dina rättigheter</h2>
      <p>
        Du har rätt att få veta vilka uppgifter vi har om dig, få dem rättade eller raderade, invända mot behandlingen
        och få ut dina uppgifter (dataportabilitet). Kontakta oss på {field(COMPANY.email, 'e-post')}. Du kan också
        klaga hos Integritetsskyddsmyndigheten (<a href="https://www.imy.se" target="_blank" rel="noreferrer">imy.se</a>).
      </p>
    </LegalPage>
  );
}
