'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, CreditCard, LogOut, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { hasAccess, isPlanId, kr, PlanId, planById, TRIAL_DAYS } from '@/lib/plans';
import IdentityStep, { IdentityStatus, LegalNameForm, loadIdentity } from '../components/IdentityStep';
import Banner from '../components/Banner';
import Logo from '../components/Logo';
import PlanPicker from '../components/PlanPicker';

interface Billing {
  name: string;
  plan: PlanId | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_exempt: boolean;
  stripe_subscription_id: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  trialing: 'Provperiod',
  active: 'Aktiv',
  past_due: 'Betalningen misslyckades, Stripe försöker igen',
  canceled: 'Uppsagd',
  unpaid: 'Obetald',
  incomplete: 'Betalningen är inte klar',
  incomplete_expired: 'Betalningen avbröts',
  paused: 'Pausad',
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Något gick fel. Försök igen.');
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
  // Landningssidan är vanlig HTML (public/landing), inte en Next.js-sida: ladda om helt
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/');
}

function BillingView() {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const cancelled = params.get('avbrutet') === '1';
  const [billing, setBilling] = useState<Billing | null | undefined>(undefined);
  const initialPlan = params.get('plan');
  const [plan, setPlan] = useState<PlanId>(isPlanId(initialPlan) ? initialPlan : 'month');
  const [identity, setIdentity] = useState<IdentityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justPaid, setJustPaid] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('restaurants')
      .select('name, plan, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, billing_exempt, stripe_subscription_id')
      .maybeSingle();
    if (error) setError(`Kunde inte läsa prenumerationen: ${error.message}`);
    setBilling((data as Billing) ?? null);
  }, []);

  useEffect(() => {
    let cancelledEffect = false;
    (async () => {
      // Tillbaka från Stripe: spara prenumerationen direkt
      if (sessionId) {
        try {
          await postJson('/api/billing/sync', { session_id: sessionId });
          if (!cancelledEffect) setJustPaid(true);
          window.history.replaceState(null, '', '/billing');
        } catch (err) {
          if (!cancelledEffect) setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!cancelledEffect) await load();
      try {
        const id = await loadIdentity();
        if (!cancelledEffect) setIdentity(id);
      } catch (err) {
        if (!cancelledEffect) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelledEffect = true;
    };
  }, [sessionId, load]);

  async function go(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson(url, body);
      window.location.assign(data.url);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (billing === undefined) return <div className="card h-[420px] animate-pulse" />;
  if (billing === null) {
    return (
      <div className="card p-6 sm:p-8">
        <Banner role="alert" title="Kontot har ingen restaurang">
          {error ?? 'Kontakta oss så kopplar vi kontot till rätt restaurang.'}
        </Banner>
      </div>
    );
  }

  // Namnet på kortet stämmer inte med ägarens namn: appen är låst tills det är rättat
  if (identity?.card_name_mismatch) {
    return (
      <CardNameMismatch
        identity={identity}
        busy={busy}
        onPortal={() => go('/api/billing/portal')}
        onChanged={async () => setIdentity(await loadIdentity())}
      />
    );
  }

  const active = hasAccess(billing);
  const current = planById(billing.plan);
  const firstTime = !billing.stripe_subscription_id && !billing.trial_ends_at;

  if (active) {
    const trialing = billing.subscription_status === 'trialing';
    return (
      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        {justPaid && (
          <div className="flex items-start gap-3 rounded-lg border border-[#B9DAD4] bg-teal-light p-4 text-[#134E48]">
            <CheckCircle2 className="h-6 w-6 flex-none text-teal" />
            <div>
              <p className="font-semibold text-ink">{trialing ? 'Provperioden har startat!' : 'Tack för betalningen!'}</p>
              <p className="text-sm">Nästa steg är att installera Bordvakt: planritning, kameror och kalibrering.</p>
            </div>
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Prenumeration</h1>
          <p className="mt-1 text-[15px] text-body">{billing.name}</p>
        </div>

        {billing.billing_exempt ? (
          <Banner tone="info">Den här restaurangen behöver inte betala.</Banner>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
            <dt className="text-muted">Plan</dt>
            <dd className="font-semibold">{current ? `${current.label} – ${kr(current.price)} ${current.per}` : '–'}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="font-semibold">{STATUS_TEXT[billing.subscription_status ?? ''] ?? billing.subscription_status}</dd>
            {trialing && (
              <>
                <dt className="text-muted">Gratis till</dt>
                <dd className="font-semibold">{date(billing.trial_ends_at)}</dd>
              </>
            )}
            <dt className="text-muted">{billing.cancel_at_period_end ? 'Upphör' : 'Nästa dragning'}</dt>
            <dd className="font-semibold">{date(trialing ? billing.trial_ends_at : billing.current_period_end)}</dd>
          </dl>
        )}

        {billing.subscription_status === 'past_due' && (
          <Banner role="alert">Kortet nekades. Uppdatera kortet under &quot;Hantera prenumeration&quot;.</Banner>
        )}
        {error && <Banner role="alert">{error}</Banner>}

        <div className="flex flex-wrap gap-2">
          <Link href={justPaid ? '/setup' : '/matsal'} className="btn btn-lg btn-primary">
            {justPaid ? 'Starta installationen' : 'Till appen'}
          </Link>
          {!billing.billing_exempt && (
            <button type="button" disabled={busy} onClick={() => go('/api/billing/portal')} className="btn btn-lg btn-secondary">
              Hantera prenumeration
            </button>
          )}
        </div>
        {!billing.billing_exempt && (
          <p className="text-[13px] text-muted">Byt plan, byt kort, se kvitton eller säg upp. Det sker hos Stripe.</p>
        )}
      </div>
    );
  }

  const chosen = planById(plan)!;
  return (
    <div className="card flex flex-col gap-5 p-6 sm:p-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">
          {firstTime ? `Starta ${TRIAL_DAYS} dagar gratis` : 'Välj plan för att fortsätta'}
        </h1>
        <p className="mt-1 text-[15px] text-body">
          {firstTime
            ? `Inget dras under provperioden. Därefter ${kr(chosen.price)} ${chosen.per}, tills du säger upp.`
            : billing.subscription_status
              ? `Prenumerationen för ${billing.name} är inte aktiv (${STATUS_TEXT[billing.subscription_status] ?? billing.subscription_status}).`
              : `${billing.name} har ingen prenumeration än.`}
        </p>
      </div>
      {cancelled && <Banner tone="info">Betalningen avbröts. Inget har dragits.</Banner>}
      {error && <Banner role="alert">{error}</Banner>}
      {identity ? (
        <IdentityStep identity={identity} onReady={async () => setIdentity(await loadIdentity())} />
      ) : (
        <div className="skeleton h-24 rounded-lg" />
      )}
      <PlanPicker value={plan} onChange={setPlan} />
      <button
        type="button"
        disabled={busy || !identity?.ready_for_checkout}
        onClick={() => go('/api/billing/checkout', { plan })}
        className="btn btn-lg btn-accent"
      >
        {busy ? 'Öppnar betalningen…' : firstTime ? `Starta ${TRIAL_DAYS} dagar gratis` : `Betala ${kr(chosen.price)}`}
      </button>
    </div>
  );
}

function CardNameMismatch({ identity, busy, onPortal, onChanged }: {
  identity: IdentityStatus;
  busy: boolean;
  onPortal: () => void;
  onChanged: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [fixName, setFixName] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function checkAgain() {
    setChecking(true);
    setResult(null);
    try {
      const data = await postJson('/api/billing/check-name');
      if (data.card_name_ok) await onChanged();
      else setResult('Namnen stämmer fortfarande inte. Byt kort eller rätta ditt namn.');
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card flex flex-col gap-5 p-6 sm:p-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Namnet på kortet stämmer inte</h1>
        <p className="mt-1 text-[15px] text-body">
          Kortet måste vara i ditt namn. Appen är låst tills det är rättat. Provperioden fortsätter, inget dras.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-paper p-4 text-[15px]">
        <dt className="text-muted">Ditt namn</dt>
        <dd className="font-semibold">{identity.legal_name ?? '–'}</dd>
        <dt className="text-muted">Namn på kortet</dt>
        <dd className="font-semibold">{identity.card_name_mismatch}</dd>
      </dl>
      {result && <Banner role="alert">{result}</Banner>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" disabled={busy} onClick={onPortal} className="btn btn-lg btn-primary justify-center">
          <CreditCard className="h-5 w-5" /> Byt till ett kort i mitt namn
        </button>
        <button type="button" disabled={checking} onClick={checkAgain} className="btn btn-lg btn-secondary justify-center">
          <RefreshCw className={`h-5 w-5 ${checking ? 'animate-spin' : ''}`} /> Kontrollera igen
        </button>
      </div>
      <p className="text-[13px] text-muted">Kortet byts hos Stripe. Kom sedan tillbaka hit och tryck på Kontrollera igen.</p>
      <div className="border-t border-line-soft pt-4">
        {fixName ? (
          <LegalNameForm
            initial={identity.legal_name ?? ''}
            onSaved={async (_name, ok) => {
              setFixName(false);
              if (ok === false) setResult('Namnet är sparat, men det stämmer fortfarande inte med kortet.');
              await onChanged();
            }}
          />
        ) : (
          <button type="button" onClick={() => setFixName(true)} className="btn btn-ghost btn-sm">
            Mitt namn är felstavat – rätta det
          </button>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-paper px-4 py-12">
      <div className="stagger flex w-full max-w-[520px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Bordvakt – till startsidan">
            <Logo />
          </Link>
          <button type="button" onClick={signOut} className="btn btn-ghost btn-sm">
            <LogOut className="h-4 w-4" /> Logga ut
          </button>
        </div>
        <Suspense fallback={<div className="card h-[420px] animate-pulse" />}>
          <BillingView />
        </Suspense>
      </div>
    </main>
  );
}
