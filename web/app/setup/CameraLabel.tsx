'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Search } from 'lucide-react';
import { brandInfo } from '@/lib/cameras';
import { brandFromText, guideFor } from '@/lib/cameraGuides';
import { shrinkImage } from '@/lib/shrinkImage';
import type { CameraBrand } from '@/lib/types';

/** Hittar du inte kameran? Fota etiketten eller skriv modellen: märket känns igen och guiden för märket visas. */
export default function CameraLabel({ onUseBrand }: { onUseBrand: (brand: CameraBrand) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<{
    brand: CameraBrand | null;
    model: string | null;
    read?: string;
  } | null>(null);

  async function photo(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMatch(null);
    try {
      const form = new FormData();
      form.append('photo', await shrinkImage(file, 2000, 0.85), 'etikett.jpg');
      const res = await fetch('/api/setup/cameras/label', {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte läsa etiketten');
      setMatch({
        brand: body.brand ?? null,
        model: body.model ?? null,
        read: body.text,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function typed(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim()) setMatch(brandFromText(text));
  }

  const guide = match ? guideFor(match.brand) : null;

  return (
    <section className="flex flex-col gap-3 card p-5">
      <h3 className="font-display text-lg font-bold">Hittar du inte din kamera?</h3>
      <p className="text-sm text-body">
        Fota etiketten på kameran (där modellen står) eller skriv modellen. Då visar vi hur du hittar kameran och slår
        på videon för just ditt märke.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => photo(e.target.files?.[0])}
        />
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn btn-secondary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Fota etiketten
        </button>
        <form onSubmit={typed} className="flex min-w-[15rem] flex-1 gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="T.ex. DS-2CD2143G2-I"
            aria-label="Kamerans modell"
            className="field min-w-0 flex-1"
          />
          <button type="submit" className="btn btn-secondary" aria-label="Känn igen">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {match && guide && (
        <div className="flex flex-col gap-3 rounded-xl bg-paper p-4 text-sm">
          <p className="font-semibold">
            {match.brand
              ? `${brandInfo(match.brand).label}${match.model ? ` · ${match.model}` : ''}`
              : 'Vi känner inte igen modellen. Här är de allmänna stegen.'}
          </p>
          {!match.brand && match.read && (
            <p className="text-xs text-muted">Läst från fotot: {match.read.slice(0, 120)}</p>
          )}
          {guide.findIp.length > 0 && <Steps title="1. Hitta kamerans IP-adress" items={guide.findIp} />}
          {guide.enableStream.length > 0 && <Steps title="2. Slå på videon (RTSP/ONVIF)" items={guide.enableStream} />}
          <p>
            <strong>3. Användarnamn:</strong> {guide.user}. Lösenordet är det som sattes när kameran installerades.
          </p>
          {guide.note && <p className="rounded-lg bg-white p-3 text-body">{guide.note}</p>}
          <p className="text-body">Tryck sedan på &quot;Sök igen&quot; ovan, eller fyll i adressen själv:</p>
          {match.brand && (
            <button type="button" onClick={() => onUseBrand(match.brand!)} className="btn btn-secondary self-start">
              Fyll i formuläret för {brandInfo(match.brand).label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Steps({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc ps-5 text-body">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
