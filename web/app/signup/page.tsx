'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isPlanId, PlanId, planById, TRIAL_DAYS, kr } from '@/lib/plans';
import Banner from '../components/Banner';
import Logo from '../components/Logo';
import PlanPicker from '../components/PlanPicker';
import EmailCodeForm from '../components/EmailCodeForm';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Något gick fel. Försök igen.');
  return data;
}

function SignupForm() {
  const initial = useSearchParams().get('plan');
  const [plan, setPlan] = useState<PlanId>(isPlanId(initial) ? initial : 'month');
  const [restaurant, setRestaurant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Konto skapat: kunden skriver in koden från mejlet
  const [verifying, setVerifying] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await postJson('/api/signup', { restaurant, email, password });
      setVerifying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Adressen är bekräftad: logga in och gå vidare till namnet och betalningen
  async function verified() {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(`Adressen är bekräftad, men inloggningen misslyckades: ${error.message}`);
    // Hel omladdning så att servern ser inloggningen direkt
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/billing?plan=${plan}`);
  }

  const chosen = planById(plan)!;
  if (verifying) {
    return (
      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Steg 2 av 3</p>
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Bekräfta din e-post</h1>
        </div>
        <EmailCodeForm email={email.trim().toLowerCase()} onVerified={verified} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Steg 1 av 3</p>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Prova Bordvakt gratis i {TRIAL_DAYS} dagar</h1>
        <p className="mt-1 text-[15px] text-body">
          Inget dras under provperioden. Därefter {kr(chosen.price)} {chosen.per}, tills du säger upp.
        </p>
      </div>

      {error && <Banner role="alert">{error}</Banner>}

      <label className="flex flex-col gap-1.5">
        <span className="field-label">Restaurangens namn</span>
        <input
          required
          autoComplete="organization"
          value={restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          placeholder="T.ex. Trattoria Roma"
          className="field min-h-12 text-[15px]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">E-post</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="namn@restaurang.se"
          className="field min-h-12 text-[15px]"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Lösenord</span>
        <input
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minst 10 tecken"
          className="field min-h-12 text-[15px]"
        />
      </label>

      <PlanPicker value={plan} onChange={setPlan} />

      <p className="text-[13px] leading-snug text-muted">
        Nästa steg: bekräfta e-postadressen med en kod, skriv ditt fullständiga namn och lägg in ett kort i ditt namn hos Stripe.
      </p>
      <button type="submit" disabled={busy} className="btn btn-lg btn-accent">
        {busy ? 'Skapar konto…' : 'Fortsätt'}
      </button>
      <p className="flex items-start gap-2 text-[13px] leading-snug text-muted">
        <ShieldCheck className="mt-px h-4 w-4 flex-none text-teal" />
        Kortet läggs in hos Stripe. Bordvakt ser aldrig kortnumret. Säg upp när du vill, innan dag {TRIAL_DAYS + 1} kostar det
        ingenting.
      </p>
      <p className="text-[13px] leading-snug text-muted">
        Genom att skapa konto godkänner du{' '}
        <Link href="/villkor" target="_blank" className="font-semibold underline">villkoren</Link>,{' '}
        <Link href="/pub-avtal" target="_blank" className="font-semibold underline">PUB-avtalet</Link> och{' '}
        <Link href="/integritet" target="_blank" className="font-semibold underline">integritetspolicyn</Link>.
      </p>
    </form>
  );
}

export default function SignupPage() {
  return (
    <main className="aurora-bg flex min-h-screen flex-1 items-center justify-center px-4 py-12">
      <div className="stagger flex w-full max-w-[480px] flex-col gap-6">
        <Link href="/" aria-label="Bordvakt – till startsidan" className="self-center">
          <Logo />
        </Link>
        <Suspense fallback={<div className="card h-[640px]" />}>
          <SignupForm />
        </Suspense>
        <p className="self-center text-sm text-muted">
          Har du redan ett konto?{' '}
          <Link href="/login" className="font-semibold text-ink underline">
            Logga in
          </Link>
        </p>
      </div>
    </main>
  );
}
