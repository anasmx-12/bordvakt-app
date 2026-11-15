'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy, Cpu, Loader2, Monitor } from 'lucide-react';

// Inställningar → AI-datorn (bara ägaren).
// Vanliga sättet: AI-datorn visar en kort kod (t.ex. K7P-4QX) när Bordvakt installeras.
// Ägaren skriver in den här, ser vilken dator det gäller och godkänner. Datorn hämtar sedan
// sin inloggning själv (lib/devicePairing.ts). Reserv: en lång kopplingskod att klistra in.

type Preview = { device_name: string | null; created_at: string; restaurant: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

export default function EngineCard() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [owner, setOwner] = useState(true);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engine/pair')
      .then(async (res) => {
        if (res.status === 403) return setOwner(false);
        const body = await res.json().catch(() => ({}));
        setPaired(Boolean(body.paired));
      })
      .catch(() => setPaired(false));
  }, []);

  async function send(previewOnly: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/engine/device/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: input, preview: previewOnly }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(body.error ?? 'Något gick fel. Försök igen.');
    if (previewOnly) return setPreview(body);
    setDone(body.device_name || 'Datorn');
    setPreview(null);
    setInput('');
    setPaired(true);
  }

  async function create() {
    if (paired && !window.confirm('En ny kod gör att datorn med den gamla koden kopplas bort. Fortsätta?')) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/engine/pair', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Kunde inte skapa koden.');
    setCode(body.code);
    setPaired(true);
  }

  async function copy() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!owner) return null;
  const ready = input.replace(/[^a-z0-9]/gi, '').length === 7;
  return (
    <section className="card flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Cpu className="h-5 w-5 flex-none text-teal" />
        <h2 className="font-display text-lg font-bold">AI-datorn</h2>
      </div>
      {paired !== null && (
        <p className="text-sm font-semibold">{paired ? 'Status: en dator är kopplad.' : 'Status: ingen dator är kopplad än.'}</p>
      )}

      {done ? (
        <div className="flex items-start gap-3 rounded-lg bg-teal-light p-4 animate-rise" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-teal" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{done} är kopplad till restaurangen.</p>
            <p className="text-sm text-body">AI-datorn startar av sig själv inom en minut. Du kan stänga fönstret på datorn.</p>
            <button type="button" onClick={() => setDone(null)} className="btn btn-ghost btn-sm self-start">
              Koppla en dator till
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4 animate-rise">
          <div className="flex items-start gap-3">
            <Monitor className="mt-0.5 h-5 w-5 flex-none text-muted" />
            <p className="text-[15px]">
              <span className="font-semibold">{preview.device_name || 'En dator'}</span> (koden visades kl. {time(preview.created_at)})
              kopplas till <span className="font-semibold">{preview.restaurant || 'er restaurang'}</span>.
            </p>
          </div>
          <p className="text-sm text-muted">Godkänn bara om det är er egen dator som visar koden just nu.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => send(false)} disabled={busy} className="btn btn-primary min-h-12 w-full sm:w-auto">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Godkänn och koppla
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className="btn btn-secondary min-h-12 w-full sm:w-auto">
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send(true);
          }}
        >
          <p className="text-sm text-body">
            Dubbelklicka på <span className="font-semibold">Installera Bordvakt</span> på restaurangens Mac. Den visar en kod.
            Skriv in koden här.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Koden som datorn visar</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().slice(0, 9))}
              placeholder="K7P-4QX"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-describedby="engine-code-help"
              className="field min-h-14 text-center font-mono text-2xl tracking-[0.2em] sm:max-w-xs"
            />
          </label>
          <button type="submit" disabled={!ready || busy} className="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Koppla dator
          </button>
          <p id="engine-code-help" className="text-[13px] text-muted">Koden gäller i 10 minuter och kan bara användas en gång.</p>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <details className="group border-t border-line-soft pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-semibold text-body">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Annat sätt: lång kopplingskod
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm text-body">
            Om datorn inte kan visa en kod: skapa en kopplingskod här och klistra in den när installationen frågar.
          </p>
          {code ? (
            <div className="flex flex-col gap-2 animate-rise">
              <p className="text-[13px] font-semibold text-red-700">Koden visas bara nu. Spara den inte i mejl eller chatt.</p>
              <code className="max-h-28 overflow-auto break-all rounded-lg bg-paper p-3 text-[12px]">{code}</code>
              <button type="button" onClick={copy} className="btn btn-secondary min-h-11 w-full sm:w-auto sm:self-start">
                <Copy className="h-4 w-4" /> {copied ? 'Kopierad!' : 'Kopiera koden'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={create} disabled={busy} className="btn btn-secondary min-h-11 w-full sm:w-auto sm:self-start">
              {paired ? 'Skapa ny kopplingskod' : 'Skapa kopplingskod'}
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
