'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Check, DoorOpen } from 'lucide-react';
import Banner from '../components/Banner';
import SectionLabel from '../components/SectionLabel';
import { FeatureId, Features, isOn } from '@/lib/features';
import { setFeatures, useFeatures } from '@/lib/useFeatures';

// Steg 6 i installationen: tillval. Entré och Statistik är av tills restaurangen väljer dem.
// Valen går att ändra när som helst under Inställningar → Anpassa funktioner.

const EXTRAS: { id: FeatureId; icon: typeof DoorOpen; title: string; text: string; points: string[] }[] = [
  {
    id: 'entrance',
    icon: DoorOpen,
    title: 'Entré (väntelista)',
    text: 'För restauranger där gäster ibland får vänta på bord.',
    points: [
      'Personalen ställer sällskap i kön vid dörren',
      'Gästen skannar en QR-kod och ser sin plats i mobilen',
      'Larm när ett bord som passar blir ledigt',
    ],
  },
  {
    id: 'stats',
    icon: BarChart3,
    title: 'Statistik och morgonrapport',
    text: 'För ägare som vill följa hur det går.',
    points: [
      'Gäster, sittningstid, väntan på maten och försäljning',
      'Förslag på hur många servitörer som behövs varje timme',
      'Mejl kl. 07 med gårdagens siffror',
    ],
  },
];

export default function ExtrasStep({ onDone }: { onDone: () => void }) {
  const { features, loaded } = useFeatures();
  // Vänta tills restaurangens val är inlästa, så att förvalet blir rätt
  if (!loaded) return <div className="skeleton h-64 max-w-[860px]" aria-busy="true" />;
  return <Choices features={features} onDone={onDone} />;
}

function Choices({ features, onDone }: { features: Features; onDone: () => void }) {
  // Förvalt: det restaurangen redan valt, annars nej
  const [choice, setChoice] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXTRAS.map((e) => [e.id, typeof features[e.id] === 'boolean' ? isOn(features, e.id) : false]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/features', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choice) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Kunde inte spara');
    setFeatures(body.features);
    onDone();
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <section className="card flex flex-col gap-2 p-5">
        <SectionLabel>6 · Tillval</SectionLabel>
        <p className="text-sm text-body">
          Välj det ni vill använda. Det ni inte väljer syns inte i appen, så den blir enklare för personalen. Ni kan slå på eller av
          tillvalen när som helst under <b>Inställningar → Anpassa funktioner</b>.
        </p>
      </section>

      {error && <Banner role="alert">{error}</Banner>}

      <div className="grid gap-4 md:grid-cols-2">
        {EXTRAS.map((e, i) => {
          const on = choice[e.id];
          const Icon = e.icon;
          return (
            <motion.button
              key={e.id}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => setChoice((c) => ({ ...c, [e.id]: !c[e.id] }))}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.3 }}
              whileTap={{ scale: 0.98 }}
              className={`card flex flex-col gap-3 p-5 text-left transition-[border-color,box-shadow] duration-200 ${
                on ? 'border-teal shadow-[0_0_0_2px_var(--color-teal)]' : 'hover:border-ink'
              }`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${on ? 'bg-teal text-white' : 'bg-paper text-ink'}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <span
                  className={`flex h-7 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                    on ? 'bg-teal-light text-teal' : 'bg-paper text-muted'
                  }`}
                >
                  {on ? (
                    <>
                      <Check className="h-4 w-4" strokeWidth={3} /> Ja, vi vill ha det
                    </>
                  ) : (
                    'Inte nu'
                  )}
                </span>
              </span>
              <span>
                <span className="block font-display text-lg font-bold">{e.title}</span>
                <span className="block text-sm text-muted">{e.text}</span>
              </span>
              <ul className="flex flex-col gap-1 text-sm text-body">
                {e.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-line" /> {p}
                  </li>
                ))}
              </ul>
            </motion.button>
          );
        })}
      </div>

      <p className="text-[13px] text-muted">
        Kamerorna räknar gäster och sittningar hela tiden. Slår ni på Statistik senare finns siffrorna redan där.
      </p>
      <button type="button" onClick={save} disabled={busy} className="btn btn-lg btn-primary self-start">
        {busy ? 'Sparar…' : 'Spara och fortsätt'}
      </button>
    </div>
  );
}
