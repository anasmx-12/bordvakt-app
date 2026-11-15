import Link from 'next/link';
import LegalPage from '../components/LegalPage';
import { COMPANY, field } from '@/lib/company';
import { WAITLIST_DAYS } from '@/lib/cleanup';

export const metadata = { title: 'Personuppgiftsbiträdesavtal – Bordvakt' };

export default function DpaPage() {
  const name = field(COMPANY.name, 'Företagsnamn');
  return (
    <LegalPage title="Personuppgiftsbiträdesavtal (PUB-avtal)">
      <p>
        Det här avtalet gäller mellan restaurangen som använder Bordvakt (&quot;den personuppgiftsansvarige&quot;) och{' '}
        {name}, org.nr {field(COMPANY.orgNr, 'org.nr')} (&quot;biträdet&quot;). Det är en del av{' '}
        <Link href="/villkor">användarvillkoren</Link> och gäller så länge restaurangen använder Bordvakt. Avtalet
        uppfyller kraven i artikel 28 i dataskyddsförordningen (GDPR).
      </p>

      <h2>1. Vad som behandlas</h2>
      <ul>
        <li><b>Ändamål:</b> att tillhandahålla Bordvakt (bordsstatus, larm, beställningar, kölista, statistik, recensioner, stämpelkort).</li>
        <li><b>Registrerade:</b> restaurangens gäster och personal.</li>
        <li><b>Uppgifter:</b> livebild från kamerorna (analyseras på restaurangens dator, sparas inte), bordsstatus, beställningar, kölistans namn och telefonnummer, recensioner, personalens konton och mobil-larm.</li>
        <li><b>Känsliga uppgifter:</b> ska inte behandlas. Akut läge visar bara att någon kan behöva hjälp, inte vem det är eller någon diagnos.</li>
      </ul>

      <h2>2. Biträdets åtaganden</h2>
      <ul>
        <li>Behandlar bara uppgifter enligt restaurangens dokumenterade instruktioner, alltså avtalet och hur restaurangen ställer in tjänsten.</li>
        <li>Ser till att alla som har tillgång till uppgifterna har tystnadsplikt.</li>
        <li>Har lämpliga tekniska och organisatoriska skyddsåtgärder (artikel 32): kryptering i transit, åtskillnad mellan restauranger i databasen, begränsade rättigheter för AI-datorn, tidsbegränsad åtkomst till video, begränsning av antal försök och automatisk radering (kölistan efter {WAITLIST_DAYS} dagar).</li>
        <li>Hjälper restaurangen att besvara de registrerades begäranden och med konsekvensbedömningar, så långt det är rimligt.</li>
        <li>Meddelar restaurangen utan onödigt dröjsmål, och senast inom 48 timmar, efter att ha upptäckt en personuppgiftsincident.</li>
      </ul>

      <h2>3. Underbiträden</h2>
      <p>
        Restaurangen godkänner att biträdet anlitar följande underbiträden:
      </p>
      <ul>
        <li>Supabase, för databasen, i {field(COMPANY.dataRegion, 'region')}.</li>
        <li>Vercel, för driften.</li>
        <li>Cloudflare, för tunneln.</li>
        <li>Stripe, för betalningar.</li>
        <li>46elks AB (Sverige), för sms till gäster i kölistan.</li>
        <li>Google, för e-post.</li>
      </ul>
      <p>
        Nya underbiträden meddelas minst 30 dagar i förväg. Restaurangen kan då invända och säga upp avtalet. Biträdet
        ställer samma krav på underbiträden som i det här avtalet. Överföring utanför EU/EES sker bara med stöd av
        standardavtalsklausuler eller EU–USA-ramverket för dataskydd.
      </p>

      <h2>4. Granskning</h2>
      <p>
        Restaurangen har rätt att få den information som behövs för att visa att avtalet följs, och att låta granska
        det med rimligt varsel. Det sker i första hand genom skriftlig information.
      </p>

      <h2>5. När avtalet upphör</h2>
      <p>
        När restaurangen slutar använda Bordvakt raderas restaurangens uppgifter inom 90 dagar, om inte lag kräver att
        de sparas (till exempel bokföring). Inom den tiden kan restaurangen begära ut sina uppgifter.
      </p>

      <h2>6. Restaurangens ansvar</h2>
      <p>
        Restaurangen ansvarar för att det finns en rättslig grund för behandlingen, särskilt för kamerabevakningen. Den
        ansvarar också för att informera gäster och personal (skylt och text finns under Installation → Skylt och
        integritet) och för att samverka med personalen enligt arbetsrätten.
      </p>

      <h2>7. Kontakt</h2>
      <p>Frågor om avtalet eller incidenter: {field(COMPANY.email, 'e-post')}.</p>
    </LegalPage>
  );
}
