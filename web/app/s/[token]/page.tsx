'use client';

import { use, useCallback, useEffect, useState } from 'react';
import TicketThread, { TicketData } from '../../components/TicketThread';

// Länken i supportmejlen: kunden svarar och väljer dag utan att logga in.
export default function SupportLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/support-link/${token}`, { cache: 'no-store' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) return setError(body?.error ?? 'Kunde inte öppna ärendet');
    setTicket(body);
  }, [token]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  async function post(payload: object) {
    const res = await fetch(`/api/support-link/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Något gick fel');
      return false;
    }
    setError(null);
    setTicket(body);
    return true;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 bg-paper p-5">
      <header>
        <p className="font-display text-xl font-bold">Bordvakt support</p>
        <p className="text-sm text-muted">Svara eller välj en dag. Supporten får ett mejl direkt.</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!ticket && !error && <p className="py-10 text-center text-muted">Laddar…</p>}
      {ticket && (
        <section className="card p-4">
          <TicketThread ticket={ticket} onSend={(body) => post({ body })} onChoose={(slot_id) => post({ slot_id })} />
        </section>
      )}
    </main>
  );
}
