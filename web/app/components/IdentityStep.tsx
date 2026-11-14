'use client';

import { useState } from 'react';
import { BadgeCheck, CreditCard, Loader2 } from 'lucide-react';
import Banner from './Banner';

// Steget före betalningen: ägarens fullständiga namn (som på legitimationen).
// Efter betalningen jämförs det med namnet på kortet (lib/cardName.ts).

export interface IdentityStatus {
  email?: string;
  email_confirmed: boolean;
  legal_name: string | null;
  card_name_mismatch: string | null;
  ready_for_checkout: boolean;
}

export async function loadIdentity(): Promise<IdentityStatus> {
  const res = await fetch('/api/identity', { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Kunde inte läsa kontot.');
  return data;
}

export default function IdentityStep({ identity, onReady }: { identity: IdentityStatus; onReady: () => void }) {
  const [editing, setEditing] = useState(false);

  if (identity.legal_name && !editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-teal-light px-4 py-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[#134E48]">
            <BadgeCheck className="h-5 w-5 flex-none text-teal" /> {identity.legal_name}
          </p>
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
            Ändra
          </button>
        </div>
        <CardHint />
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-bold">Ditt fullständiga namn</h2>
        <p className="mt-0.5 text-[14px] text-body">Skriv ditt namn som det står på din legitimation. Det står på kvittona.</p>
      </div>
      <LegalNameForm
        initial={identity.legal_name ?? ''}
        onSaved={() => {
          setEditing(false);
          onReady();
        }}
      />
      <CardHint />
    </section>
  );
}

function CardHint() {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-snug text-muted">
      <CreditCard className="mt-px h-4 w-4 flex-none" />
      Kortet måste vara i samma namn. Namnet på kortet kontrolleras efter betalningen.
    </p>
  );
}

export function LegalNameForm({ initial = '', onSaved }: { initial?: string; onSaved: (name: string, cardNameOk: boolean | null) => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(data.error ?? 'Kunde inte spara namnet.');
    else onSaved(data.legal_name, data.card_name_ok ?? null);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      {error && <Banner role="alert">{error}</Banner>}
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Förnamn och efternamn</span>
        <input
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="T.ex. Anna Lindqvist"
          className="field min-h-12 text-[16px]"
        />
      </label>
      <button type="submit" disabled={busy || name.trim().length < 5} className="btn btn-secondary self-start">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Spara namnet
      </button>
    </form>
  );
}
