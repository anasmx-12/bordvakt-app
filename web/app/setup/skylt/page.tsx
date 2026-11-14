'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, Copy, Printer } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Skylt om kamerorna (för entrén) och en färdig integritetstext till restaurangens hemsida.
// Det som står här stämmer med hur Bordvakt fungerar: bilderna analyseras på restaurangens
// egen dator, inga bilder eller filmer sparas och ingen ansiktsigenkänning används.

const policy = (name: string, contact: string) => `Kamerabevakning på ${name}

Vi använder kameror i matsalen för att ge snabbare service. Kamerorna är kopplade till Bordvakt, som ser när ett bord behöver hjälp (till exempel när gästerna vill beställa, betala eller när bordet behöver dukas av) och om någon har ramlat eller skadat sig.

Så behandlas bilderna
- Bilderna analyseras direkt på restaurangens egen dator. De skickas inte till någon molntjänst för analys.
- Inga bilder eller filmer sparas. Det som sparas är bordets status (till exempel "väntar på mat") och statistik utan personuppgifter, som hur många gäster som satt vid ett bord och hur länge.
- Ingen ansiktsigenkänning används och ingen identifieras.
- Livebilden kan ses av inloggad personal, för att kunna hjälpa till snabbt.

Varför
Vi har ett berättigat intresse av att ge god service och snabbt upptäcka olyckor (artikel 6.1 f i dataskyddsförordningen, GDPR).

Dina rättigheter
Du har rätt att få information om och invända mot behandlingen. Eftersom inga bilder sparas finns det inga inspelningar att lämna ut eller radera. Frågor: ${contact}.
Du kan också vända dig till Integritetsskyddsmyndigheten (imy.se).`;

export default function SignPage() {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const first = setTimeout(async () => {
      const [{ data: r }, { data: u }] = await Promise.all([supabase.from('restaurants').select('name').maybeSingle(), supabase.auth.getUser()]);
      setName(r?.name ?? 'restaurangen');
      setContact((c) => c || u.user?.email || '');
    }, 0);
    return () => clearTimeout(first);
  }, []);

  const text = policy(name || 'restaurangen', contact || '[er e-postadress]');

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto flex max-w-[900px] flex-col gap-6 p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/setup" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Till installationen
          </Link>
          <h1 className="font-display text-2xl font-bold">Skylt och integritet</h1>
          <p className="max-w-[60ch] text-sm text-body">
            Gäster ska få veta att det finns kameror. Skriv ut skylten och sätt den vid entrén, och lägg texten nedan på er hemsida.
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-lg">
          <Printer className="h-5 w-5" /> Skriv ut skylten
        </button>
      </div>

      {/* Skylten (A5/A4) */}
      <section className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-4 rounded-2xl border-4 border-ink bg-white p-8 text-center print:max-w-none print:rounded-none print:border-8 print:p-14">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-ink text-white">
          <Camera className="h-11 w-11" strokeWidth={2.2} />
        </span>
        <h2 className="font-display text-3xl font-bold print:text-5xl">Kamerabevakning</h2>
        <p className="text-lg print:text-2xl">
          {name ? <b>{name}</b> : 'Vi'} använder kameror i matsalen för snabbare service och för att upptäcka olyckor.
        </p>
        <ul className="flex flex-col gap-1 text-[15px] font-semibold print:text-xl">
          <li>Inga bilder eller filmer sparas</li>
          <li>Ingen ansiktsigenkänning</li>
          <li>Bilderna stannar på restaurangens dator</li>
        </ul>
        <hr className="w-2/3 border-line" />
        <p className="text-[15px] text-body print:text-xl">
          <b>Camera monitoring.</b> Cameras help us serve you faster and spot accidents. No images or video are stored. No face recognition.
        </p>
        <p className="text-[13px] text-muted print:text-base">
          Ansvarig: {name || 'restaurangen'}
          {contact ? ` · ${contact}` : ''} · Mer information: fråga personalen
        </p>
      </section>

      <section className="card flex flex-col gap-3 p-5 print:hidden">
        <h2 className="font-display text-lg font-bold">Text till er hemsida</h2>
        <label className="flex flex-col gap-1">
          <span className="field-label">Kontakt för frågor (visas i texten och på skylten)</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} className="field" />
        </label>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-4 font-sans text-sm text-body">{text}</pre>
        <button type="button" onClick={copy} className="btn btn-secondary self-start">
          <Copy className="h-4 w-4" /> {copied ? 'Kopierad!' : 'Kopiera texten'}
        </button>
        <p className="text-[13px] text-muted">
          Det här är en mall, inte juridisk rådgivning. Läs mer om kamerabevakning hos{' '}
          <a href="https://www.imy.se/verksamhet/kamerabevakning/" target="_blank" rel="noreferrer" className="font-semibold underline">
            Integritetsskyddsmyndigheten
          </a>
          .
        </p>
      </section>
    </main>
  );
}
