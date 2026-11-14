'use client';

import { useEffect, useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import Banner from './Banner';

// Koden från mejlet (6 siffror) som bekräftar e-postadressen.

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Något gick fel. Försök igen.');
  return data;
}

export default function EmailCodeForm({ email, onVerified }: { email: string; onVerified: () => void | Promise<void> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await post('/api/signup/verify', { email, code });
      await onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await post('/api/signup/resend', { email });
      setInfo('En ny kod är skickad. Den gamla slutar gälla.');
      setCode('');
      setWait(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-lg bg-paper p-4">
        <MailCheck className="mt-0.5 h-5 w-5 flex-none text-teal" />
        <p className="text-[15px] text-body">
          Vi har mejlat en kod på 6 siffror till <strong className="break-all text-ink">{email}</strong>. Titta även i skräpposten.
        </p>
      </div>
      {error && <Banner role="alert">{error}</Banner>}
      {info && <Banner tone="info">{info}</Banner>}
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Koden från mejlet</span>
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          className="field min-h-14 text-center font-display text-[26px] font-bold tracking-[0.4em]"
          autoFocus
        />
      </label>
      <button type="submit" disabled={busy || code.length !== 6} className="btn btn-lg btn-accent">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Bekräfta e-postadressen
      </button>
      <button type="button" onClick={resend} disabled={wait > 0} className="btn btn-ghost btn-sm self-center">
        {wait > 0 ? `Skicka ny kod (${wait} s)` : 'Skicka ny kod'}
      </button>
    </form>
  );
}
