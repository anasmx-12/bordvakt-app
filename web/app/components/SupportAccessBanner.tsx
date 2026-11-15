'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, ShieldQuestion } from 'lucide-react';

// Överst i appen (bara för ägaren): supporten ber om att få se appen i läsläge,
// eller tittar just nu. Ägaren godkänner (en timme), nekar eller avslutar.

type Row = { id: string; requested_by_name: string; reason: string; requested_at: string; expires_at: string | null };
type State = { pending: Row | null; active: Row | null };

const clock = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

export default function SupportAccessBanner() {
  const [state, setState] = useState<State>({ pending: null, active: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/support-access', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setState({ pending: body.pending ?? null, active: body.active ?? null }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function answer(id: string, action: 'approve' | 'deny' | 'end') {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/support-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) setError(body.error ?? 'Något gick fel. Försök igen.');
    load();
  }

  const { pending, active } = state;
  if (!pending && !active) return null;

  if (active) {
    return (
      <div role="status" className="card mb-5 flex flex-col gap-3 border-teal/40 bg-teal-light p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Eye className="mt-0.5 h-5 w-5 flex-none text-teal" />
          <p className="text-[15px]">
            <span className="font-semibold">{active.requested_by_name} på Bordvakts support kan se appen till kl. {clock(active.expires_at!)}.</span>{' '}
            <span className="text-body">Bara titta, inte ändra. Kamerabilderna syns inte.</span>
          </p>
        </div>
        <button type="button" onClick={() => answer(active.id, 'end')} disabled={busy} className="btn btn-secondary min-h-11 w-full flex-none sm:w-auto">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Avsluta nu
        </button>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div role="alert" className="card mb-5 flex flex-col gap-3 border-accent/40 p-4">
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 h-5 w-5 flex-none text-accent" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[15px] font-semibold">{pending!.requested_by_name} på Bordvakts support vill se er app.</p>
          <p className="break-words text-sm text-body">Anledning: {pending!.reason}</p>
          <p className="text-[13px] text-muted">
            Supporten kan bara titta i en timme, inte ändra något, och ser aldrig kamerabilderna. Ni kan avsluta när som helst.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => answer(pending!.id, 'approve')} disabled={busy} className="btn btn-primary min-h-12 w-full sm:w-auto">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Godkänn i en timme
        </button>
        <button type="button" onClick={() => answer(pending!.id, 'deny')} disabled={busy} className="btn btn-secondary min-h-12 w-full sm:w-auto">
          Neka
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
