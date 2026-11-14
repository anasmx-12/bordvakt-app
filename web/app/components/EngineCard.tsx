'use client';

import { useEffect, useState } from 'react';
import { Copy, Cpu, Loader2 } from 'lucide-react';

// Inställningar → AI-datorn (bara ägaren). Skapar kopplingskoden som klistras in
// när AI-motorn installeras på restaurangens dator. Koden visas bara en gång.

export default function EngineCard() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [owner, setOwner] = useState(true);
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
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Cpu className="h-5 w-5 text-teal" />
        <h2 className="font-display text-lg font-bold">AI-datorn</h2>
      </div>
      <p className="text-sm text-body">
        Datorn som kör kamerorna kopplas till restaurangen med en kopplingskod. Klistra in den när du installerar
        Bordvakt på datorn. Koden ger bara tillgång till er egen restaurang.
      </p>
      {paired !== null && (
        <p className="text-sm font-semibold">{paired ? 'Status: en dator är kopplad.' : 'Status: ingen dator är kopplad än.'}</p>
      )}
      {code ? (
        <div className="flex flex-col gap-2 animate-rise">
          <p className="text-[13px] font-semibold text-red-700">Koden visas bara nu. Spara den inte i mejl eller chatt.</p>
          <code className="max-h-28 overflow-auto break-all rounded-lg bg-paper p-3 text-[12px]">{code}</code>
          <button type="button" onClick={copy} className="btn btn-secondary self-start">
            <Copy className="h-4 w-4" /> {copied ? 'Kopierad!' : 'Kopiera koden'}
          </button>
        </div>
      ) : (
        <button type="button" onClick={create} disabled={busy} className="btn btn-primary self-start">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {paired ? 'Skapa ny kopplingskod' : 'Skapa kopplingskod'}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
