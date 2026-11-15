'use client';

import { useEffect, useState } from 'react';
import { Brain, ChefHat, Hand, IceCreamCone, Receipt, ShieldAlert, Zap } from 'lucide-react';
import SectionLabel from '../components/SectionLabel';

// Statistik → Det här har AI:n lärt sig. AI:n anpassar sig efter restaurangen med tiden;
// här ser ägaren och personalen vad den har lärt sig och varför den larmar som den gör.

interface Learned {
  online: boolean;
  loaded?: boolean;
  prep?: { dish: string; minutes: number }[];
  bill_delay_min?: number | null;
  bill_default_min?: number;
  bill_min_sittings?: number;
  dessert_off_tables?: number[];
  dessert_off_hours?: number[];
  careful_tables?: number[];
  strict_tables?: number[];
  rush?: boolean;
}

const list = (n: number[]) => (n.length === 1 ? `bord ${n[0]}` : `bord ${n.slice(0, -1).join(', ')} och ${n[n.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (h: number) => String(h).padStart(2, '0');

function Row({ icon: Icon, title, children }: { icon: typeof Brain; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 h-5 w-5 flex-none text-teal" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold">{title}</p>
        <div className="text-[14px] text-body">{children}</div>
      </div>
    </li>
  );
}

export default function LearnedCard() {
  const [data, setData] = useState<Learned | null>(null);

  useEffect(() => {
    fetch('/api/engine/learned', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { online: false }))
      .then(setData)
      .catch(() => setData({ online: false }));
  }, []);

  if (!data) return <div aria-busy="true" className="skeleton h-40" />;

  const prep = data.prep ?? [];
  const dessertTables = data.dessert_off_tables ?? [];
  const dessertHours = data.dessert_off_hours ?? [];
  const careful = data.careful_tables ?? [];
  const strict = data.strict_tables ?? [];

  return (
    <section className="card scroll-reveal flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-accent" />
        <SectionLabel>Det här har AI:n lärt sig</SectionLabel>
      </div>
      {!data.online ? (
        <p className="text-[14px] text-muted">AI-datorn svarar inte just nu. Det AI:n har lärt sig visas när den är igång.</p>
      ) : !data.loaded ? (
        <p className="text-[14px] text-muted">AI:n har inte läst in restaurangens historik än. Det sker när installationen är klar och AI:n analyserar borden.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          <Row icon={ChefHat} title="Hur lång tid rätterna tar i köket">
            {prep.length ? (
              <>
                <p>Larmet Väntar på mat kommer när maten är sen för just de rätterna, inte efter en fast tid.</p>
                <ul className="mt-1.5 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {prep.map((p) => (
                    <li key={p.dish} className="flex justify-between gap-3">
                      <span className="truncate">{capital(p.dish)}</span>
                      <span className="flex-none tabular-nums text-muted">{Math.round(p.minutes)} min</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Inte än. AI:n behöver se varje rätt lagas minst 3 gånger (när köket markerar den som klar). Fram till dess används 15 minuter.</p>
            )}
          </Row>
          <Row icon={Receipt} title="När gästerna vill ha notan">
            {data.bill_delay_min != null ? (
              <p>Era gäster brukar vilja ha notan ungefär {Math.round(data.bill_delay_min)} min efter att tallrikarna plockats bort. AI:n påminner då.</p>
            ) : (
              <p>Inte än: AI:n behöver {data.bill_min_sittings ?? 10} sittningar. Fram till dess påminner den efter {data.bill_default_min ?? 7} min.</p>
            )}
          </Row>
          <Row icon={IceCreamCone} title="Dessert">
            {dessertTables.length || dessertHours.length ? (
              <p>
                Gästerna beställer nästan aldrig dessert
                {dessertTables.length ? ` vid ${list(dessertTables)}` : ''}
                {dessertTables.length && dessertHours.length ? ' och' : ''}
                {dessertHours.length ? ` kl. ${dessertHours.map((h) => `${pad(h)}–${pad(h + 2)}`).join(', ')}` : ''}. Där föreslår AI:n ingen dessert.
              </p>
            ) : (
              <p>AI:n föreslår dessert vid alla bord. Visar det sig att någon tid eller något bord nästan aldrig beställer, slutar den där.</p>
            )}
          </Row>
          <Row icon={Hand} title="Vill ha hjälp">
            {careful.length ? (
              <p>Vid {list(careful)} har en uppräckt hand ofta larmat fel. Där ska handen vara uppe längre innan AI:n larmar.</p>
            ) : (
              <p>Inga bord med många falsklarm. Tryck Falsklarm på en uppgift som var fel, så lär sig AI:n.</p>
            )}
          </Row>
          {strict.length > 0 && (
            <Row icon={ShieldAlert} title="SOS">
              <p>Vid {list(strict)} har SOS larmat fel. Där krävs ett tecken till innan AI:n larmar.</p>
            </Row>
          )}
          <Row icon={Zap} title="Rusning">
            <p>
              {data.rush ? 'Det är rusning just nu: ' : 'När de flesta borden har gäster '}
              larmar AI:n 3 minuter tidigare om maten dröjer.
            </p>
          </Row>
        </ul>
      )}
    </section>
  );
}
