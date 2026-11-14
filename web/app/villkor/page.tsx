import Link from 'next/link';
import LegalPage from '../components/LegalPage';
import { COMPANY, field } from '@/lib/company';
import { PLANS, TRIAL_DAYS, kr } from '@/lib/plans';

export const metadata = { title: 'Användarvillkor – Bordvakt' };

export default function TermsPage() {
  const name = field(COMPANY.name, 'Företagsnamn');
  return (
    <LegalPage title="Användarvillkor">
      <p>
        De här villkoren gäller när en restaurang (&quot;Kunden&quot;) använder Bordvakt, som tillhandahålls av {name},
        org.nr {field(COMPANY.orgNr, 'org.nr')} (&quot;vi&quot;). Genom att skapa ett konto godkänner Kunden villkoren.
        Bordvakt säljs bara till företag.
      </p>

      <h2>1. Tjänsten</h2>
      <p>
        Bordvakt är ett system för restauranger: en webbapp för personalen och en AI-motor som körs på Kundens egen
        dator och läser Kundens kameror. AI-motorn bedömer bordens status (till exempel att gäster väntar på mat) och
        kan larma om någon verkar ha ramlat. Webbappen innehåller bland annat matsal, kök, QR-beställning, kölista,
        statistik och mobil-larm. Vi utvecklar tjänsten löpande och kan ändra eller ta bort funktioner.
      </p>

      <h2>2. AI:n är ett hjälpmedel</h2>
      <p>
        AI:ns bedömningar kan vara fel eller utebli, till exempel vid dåligt ljus, skymd kamera, strömavbrott eller
        nätverksfel. Bordvakt ersätter inte personalens egen uppmärksamhet, och larmfunktionen (Akut läge) ersätter inte
        larmnummer 112 eller Kundens egna rutiner för olyckor. Kunden ansvarar för att personalen vet detta.
      </p>

      <h2>3. Kundens ansvar</h2>
      <ul>
        <li>Att kamerabevakningen är laglig: Kunden är personuppgiftsansvarig för bevakningen, ska ha ett berättigat intresse, informera gäster och personal (skylt finns i appen) och följa kamerabevakningslagen och GDPR.</li>
        <li>Att samverka med personalen enligt arbetsrätten (MBL) innan kameror används där personal arbetar.</li>
        <li>Datorn som kör AI-motorn: att den står på, har internet och uppdateras, och att kopplingskoden hålls hemlig.</li>
        <li>Inloggningar: att bara behöriga har konton och att lösenord inte delas.</li>
        <li>Att inte använda tjänsten för ansiktsigenkänning, identifiering av personer eller annat än det tjänsten är byggd för.</li>
      </ul>

      <h2>4. Pris och betalning</h2>
      <p>
        Nya kunder får {TRIAL_DAYS} dagars gratis provperiod. Därefter gäller valt abonnemang:{' '}
        {PLANS.map((p) => `${p.label} ${kr(p.price)}`).join(', ')} (exklusive moms om inget annat anges). Betalning
        sker i förskott via Stripe och abonnemanget förnyas automatiskt tills det sägs upp. Vid utebliven betalning kan
        vi stänga av tjänsten tills betalning sker. Prisändringar meddelas minst 30 dagar i förväg.
      </p>

      <h2>5. Uppsägning</h2>
      <p>
        Kunden kan säga upp abonnemanget när som helst i appen (Inställningar → Abonnemang). Det gäller då till slutet
        av betald period. Betalda perioder återbetalas inte. Vi kan säga upp avtalet med 30 dagars varsel, eller
        direkt om Kunden väsentligt bryter mot villkoren. Efter avslut raderar vi Kundens data enligt PUB-avtalet.
      </p>

      <h2>6. Tillgänglighet och support</h2>
      <p>
        Vi strävar efter att tjänsten alltid ska fungera men lovar ingen viss drifttid. Planerat underhåll görs om
        möjligt när restauranger normalt har stängt. Support ges via appens supportsida.
      </p>

      <h2>7. Ansvarsbegränsning</h2>
      <p>
        Vi ansvarar inte för indirekta skador, till exempel förlorad omsättning, förlorad data eller skador till följd av
        att AI:n missat eller felbedömt något. Vårt sammanlagda ansvar är begränsat till vad Kunden betalat de senaste
        tolv månaderna. Begränsningen gäller inte vid uppsåt eller grov vårdslöshet.
      </p>

      <h2>8. Personuppgifter</h2>
      <p>
        Hur vi behandlar personuppgifter står i <Link href="/integritet">integritetspolicyn</Link>. När vi behandlar
        personuppgifter för Kundens räkning gäller <Link href="/pub-avtal">personuppgiftsbiträdesavtalet</Link>, som är
        en del av de här villkoren.
      </p>

      <h2>9. Ändringar, lag och tvist</h2>
      <p>
        Väsentliga ändringar av villkoren meddelas minst 30 dagar i förväg via e-post eller i appen. Svensk lag gäller.
        Tvister avgörs av svensk allmän domstol. Kontakt: {field(COMPANY.email, 'e-post')}.
      </p>
    </LegalPage>
  );
}
