'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, CreditCard, KeyRound, Loader2, Volume2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { hasAccess, PlanId } from '@/lib/plans';
import { Accent, Settings, StartPage, TextSize, Theme, updateSettings, useSettings } from '@/lib/settings';
import { Key, LANGUAGES, useFormatDate, useT } from '@/lib/i18n';
import { useStaffAlerts } from '@/lib/useStaffAlerts';
import AppShell from '../components/AppShell';
import Banner from '../components/Banner';
import PushCard from '../components/PushCard';
import EngineCard from '../components/EngineCard';
import { useFeatures } from '@/lib/useFeatures';
import { ToggleRight } from 'lucide-react';
import { m as motion } from 'framer-motion';
import { useId } from 'react';

interface Billing {
  plan: PlanId | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_exempt: boolean;
  stripe_subscription_id: string | null;
}

const ACCENTS: { id: Accent; label: Key; color: string }[] = [
  { id: 'orange', label: 'set.accentOrange', color: '#c2410c' },
  { id: 'blue', label: 'set.accentBlue', color: '#1d4ed8' },
  { id: 'green', label: 'set.accentGreen', color: '#15803d' },
  { id: 'purple', label: 'set.accentPurple', color: '#7e22ce' },
  { id: 'graphite', label: 'set.accentGraphite', color: '#374151' },
];

const STATUS_KEY: Record<string, Key> = {
  trialing: 'sub.statusTrialing',
  active: 'sub.statusActive',
  past_due: 'sub.statusPastDue',
  canceled: 'sub.statusCanceled',
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export default function SettingsPage() {
  const t = useT();
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const alerts = useStaffAlerts();
  const features = useFeatures();

  return (
    <AppShell title={t('set.title')} subtitle={t('set.subtitle')}>
      <div className="stagger grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          {/* Utseende */}
          <Card title={t('set.appearance')}>
            <Row label={t('set.theme')}>
              <Segmented<Theme>
                value={s.theme}
                onChange={(theme) => set({ theme })}
                options={[
                  { id: 'light', label: t('set.themeLight') },
                  { id: 'dark', label: t('set.themeDark') },
                  { id: 'system', label: t('set.themeSystem') },
                ]}
              />
            </Row>
            <Row label={t('set.accent')}>
              <div role="radiogroup" aria-label={t('set.accent')} className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => {
                  const active = s.accent === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={t(a.label)}
                      title={t(a.label)}
                      onClick={() => set({ accent: a.id })}
                      className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition ${
                        active ? 'border-ink' : 'border-transparent hover:border-line'
                      }`}
                    >
                      {/* Visar den riktiga färgen även i mörkt läge */}
                      <span
                        data-keep-colors
                        className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                        style={{ background: a.color }}
                      >
                        {active && <Check className="h-4 w-4" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label={t('set.textSize')}>
              <Segmented<TextSize>
                value={s.textSize}
                onChange={(textSize) => set({ textSize })}
                options={[
                  { id: 'normal', label: t('set.textNormal') },
                  { id: 'large', label: t('set.textLarge') },
                  { id: 'xlarge', label: t('set.textXLarge') },
                ]}
              />
            </Row>
            <Toggle
              label={t('set.motion')}
              help={t('set.motionHelp')}
              checked={s.reduceMotion}
              onChange={(reduceMotion) => set({ reduceMotion })}
            />
          </Card>

          {/* Språk */}
          <Card title={t('set.language')} description={t('set.languageHelp')}>
            <div role="radiogroup" aria-label={t('set.language')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((l) => {
                const active = s.language === l.code;
                return (
                  <button
                    key={l.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    lang={l.code}
                    onClick={() => set({ language: l.code })}
                    className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border px-3 text-start text-[14px] font-semibold transition-colors ${
                      active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{l.name}</span>
                      {l.name !== l.english && (
                        <span className={`text-[11px] font-medium ${active ? 'text-white/70' : 'text-muted'}`} lang="en">
                          {l.english}
                        </span>
                      )}
                    </span>
                    {active && <Check className="h-4 w-4 flex-none" />}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {/* Funktioner (ägaren väljer vad restaurangen använder) */}
          <Card title={t('set.features')} description={t('set.featuresHelp')}>
            <Link href="/settings/funktioner" className="btn btn-secondary self-start">
              <ToggleRight className="h-4 w-4" /> {t('set.featuresOpen')}
            </Link>
          </Card>

          <EngineCard />

          {/* Arbete */}
          <Card title={t('set.work')}>
            <Row label={t('set.startPage')}>
              <Segmented<StartPage>
                value={s.startPage}
                onChange={(startPage) => set({ startPage })}
                options={[
                  { id: '/matsal', label: t('nav.dining') },
                  { id: '/kitchen', label: t('nav.kitchen') },
                ]}
              />
            </Row>
          </Card>

          {/* Larm */}
          <Card title={t('set.alerts')}>
            <Toggle
              label={t('set.sound')}
              help={t('set.soundHelp')}
              checked={s.sound}
              onChange={(sound) => set({ sound })}
            />
            <Toggle
              label={t('set.vibration')}
              help={t('set.vibrationHelp')}
              checked={s.vibration}
              onChange={(vibration) => set({ vibration })}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={alerts.testSound} className="btn btn-secondary">
                <Volume2 className="h-4 w-4" /> {t('set.testSound')}
              </button>
              {alerts.permission !== 'unsupported' && (
                <button
                  type="button"
                  onClick={alerts.enableNotifications}
                  disabled={alerts.permission !== 'default'}
                  title={alerts.permission === 'denied' ? t('dash.notifBlockedHelp') : t('set.notifications')}
                  className="btn btn-secondary disabled:opacity-100"
                >
                  {alerts.permission === 'granted'
                    ? t('dash.notifIsOn')
                    : alerts.permission === 'denied'
                      ? t('dash.notifBlocked')
                      : t('dash.notifEnable')}
                </button>
              )}
            </div>
          </Card>

          {features.on('push') && <PushCard />}
          <SosAccuracyCard />
          <AccountCard />
          <SubscriptionCard />
        </div>
      </div>
    </AppShell>
  );
}

/** Hur ofta Akut läge (SOS) har haft rätt, enligt personalens Klar/Falsklarm. */
function SosAccuracyCard() {
  const t = useT();
  const [stats, setStats] = useState<{ real: number; false: number } | 'missing' | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    supabase
      .from('tasks')
      .select('false_alarm')
      .eq('type', 'EMERGENCY')
      .eq('status', 'COMPLETED')
      .gte('created_at', since)
      .then(({ data, error }) => {
        if (error) {
          setStats(error.code === '42703' ? 'missing' : null);
          return;
        }
        const rows = (data as { false_alarm: boolean }[] | null) ?? [];
        const falseAlarms = rows.filter((r) => r.false_alarm).length;
        setStats({ real: rows.length - falseAlarms, false: falseAlarms });
      });
  }, []);

  const total = stats && stats !== 'missing' ? stats.real + stats.false : 0;
  return (
    <Card title={t('set.sos')} description={t('set.sosHelp')}>
      {stats === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      ) : stats === 'missing' ? (
        <p className="text-sm text-body">{t('set.sosNeeds008')}</p>
      ) : total === 0 ? (
        <p className="text-sm text-body">{t('set.sosNone')}</p>
      ) : (
        <p className="text-[15px] font-semibold text-ink">
          {t('set.sosStats', { real: stats.real, false: stats.false, pct: Math.round((stats.real / total) * 100) })}
        </p>
      )}
      <p className="text-sm text-muted">{t('set.sosLearn')}</p>
    </Card>
  );
}

function AccountCard() {
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);
  // Steg 1: det nuvarande lösenordet. Steg 2: det nya, två gånger.
  const [step, setStep] = useState<'current' | 'new'>('current');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function send(body: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMessage({ ok: false, text: data.error ?? 'Error' });
    return res.ok;
  }

  async function checkCurrent(e: React.FormEvent) {
    e.preventDefault();
    if (await send({ current })) setStep('new');
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setMessage({ ok: false, text: t('set.passwordShort') });
    if (password !== again) return setMessage({ ok: false, text: t('set.passwordMismatch') });
    if (await send({ current, password })) {
      setStep('current');
      setCurrent('');
      setPassword('');
      setAgain('');
      setMessage({ ok: true, text: t('set.passwordChanged') });
    }
  }

  const status = message && (
    <p role="status" className={`text-sm ${message.ok ? 'text-teal' : 'text-red-700'}`}>
      {message.text}
    </p>
  );

  return (
    <Card title={t('set.account')} description={email ? t('set.loggedInAs', { email }) : undefined}>
      {step === 'current' ? (
        <form onSubmit={checkCurrent} className="flex flex-col gap-2">
          <input type="email" value={email ?? ''} autoComplete="username" readOnly hidden />
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t('set.currentPassword')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="field"
            />
          </label>
          {status}
          <button type="submit" disabled={busy || !current} className="btn btn-secondary self-start">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {t('set.passwordContinue')}
          </button>
        </form>
      ) : (
        <form onSubmit={changePassword} className="animate-rise flex flex-col gap-2">
          <p className="text-sm text-body">{t('set.passwordStep2')}</p>
          <input type="email" value={email ?? ''} autoComplete="username" readOnly hidden />
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t('set.newPassword')}</span>
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              minLength={10}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t('set.repeatPassword')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              className="field"
            />
          </label>
          {status}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || password.length < 10 || !again} className="btn btn-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t('set.changePassword')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('current');
                setCurrent('');
                setPassword('');
                setAgain('');
                setMessage(null);
              }}
              className="btn btn-ghost"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function SubscriptionCard() {
  const t = useT();
  const formatDate = useFormatDate();
  const [billing, setBilling] = useState<Billing | null | undefined>(undefined);
  const [busy, setBusy] = useState<'cancel' | 'undo' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('restaurants')
      .select(
        'plan, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, billing_exempt, stripe_subscription_id'
      )
      .maybeSingle();
    if (error) setError(error.message);
    setBilling((data as Billing) ?? null);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function run(kind: 'cancel' | 'undo' | 'portal') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'portal') {
        const { url } = await postJson('/api/billing/portal');
        window.location.assign(url);
        return;
      }
      await postJson('/api/billing/cancel', { undo: kind === 'undo' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }

  if (billing === undefined) {
    return (
      <Card title={t('sub.title')}>
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </Card>
    );
  }

  if (billing?.billing_exempt) {
    return (
      <Card title={t('sub.title')}>
        <p className="text-sm text-body">{t('sub.exempt')}</p>
      </Card>
    );
  }

  const active = billing ? hasAccess({ billing_exempt: false, subscription_status: billing.subscription_status }) : false;
  const trialing = billing?.subscription_status === 'trialing';
  // Sista dagen appen fungerar om man säger upp nu
  const endDate = trialing ? billing?.trial_ends_at : billing?.current_period_end;
  const statusKey = billing?.subscription_status ? STATUS_KEY[billing.subscription_status] : undefined;

  function confirmCancel() {
    const text = t(trialing ? 'sub.cancelTrialConfirm' : 'sub.cancelConfirm', { date: formatDate(endDate) });
    if (window.confirm(text)) run('cancel');
  }

  return (
    <Card title={t('sub.title')}>
      {error && <Banner role="alert">{error}</Banner>}

      {!billing || !active || !billing.stripe_subscription_id ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-body">{t('sub.none')}</p>
          <Link href="/billing" className="btn btn-accent">
            {t('sub.choose')}
          </Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted">{t('sub.plan')}</dt>
              <dd className="font-semibold">{billing.plan ? t(`plan.${billing.plan}`) : '–'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('sub.status')}</dt>
              <dd className="font-semibold">{statusKey ? t(statusKey) : billing.subscription_status}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted">
                {billing.cancel_at_period_end ? t('sub.ends') : trialing ? t('sub.freeUntil') : t('sub.nextCharge')}
              </dt>
              <dd className="font-semibold">{formatDate(endDate)}</dd>
            </div>
          </dl>

          {billing.cancel_at_period_end && (
            <Banner title={t('sub.cancelled', { date: formatDate(endDate) })} />
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {billing.cancel_at_period_end ? (
              <button type="button" onClick={() => run('undo')} disabled={busy !== null} className="btn btn-accent">
                {busy === 'undo' && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('sub.resume')}
              </button>
            ) : (
              <Link href="/billing" className="btn btn-secondary">
                {t('sub.changePlan')}
              </Link>
            )}
            <button type="button" onClick={() => run('portal')} disabled={busy !== null} className="btn btn-secondary">
              {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {t('sub.manage')}
            </button>
          </div>

          {!billing.cancel_at_period_end && (
            <div className="border-t border-line-soft pt-3">
              <button
                type="button"
                onClick={confirmCancel}
                disabled={busy !== null}
                className="btn btn-ghost text-red-700 enabled:hover:bg-red-50"
              >
                {busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('sub.cancel')}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ Byggstenar

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card scroll-reveal">
      <div className="border-b border-line-soft px-5 py-4">
        <h2 className="font-display text-[17px] font-bold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const group = useId(); // egen glidande markering per grupp
  return (
    <div role="radiogroup" className="inline-flex flex-wrap gap-1 self-start rounded-lg bg-paper p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`relative min-h-10 rounded-md px-3.5 text-[14px] font-semibold transition-colors ${
            value === o.id ? 'text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {value === o.id && (
            <motion.span
              layoutId={`seg-${group}`}
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              className="absolute inset-0 rounded-md bg-white shadow-[0_1px_2px_rgba(15,20,25,.12)]"
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold text-ink">{label}</span>
        {help && <span className="text-sm text-muted">{help}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex flex-none">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-7 w-12 rounded-full bg-gray-300 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-focus-visible:ring-offset-2" />
        <span className="absolute start-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
      </span>
    </label>
  );
}
