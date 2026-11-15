'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import Banner from '../components/Banner';
import EmailCodeForm from '../components/EmailCodeForm';
import Logo from '../components/Logo';
import { useT } from '@/lib/i18n';
import { getSettings } from '@/lib/settings';

/** Dit man skickas efter inloggning: ?next=/kitchen o.s.v., annars matsalen. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  // Bara sökvägar på den här sidan, aldrig en annan webbplats. Webbläsaren läser "/\" som "//",
  // så adressen tolkas och jämförs med sidans egen i stället för att bara titta på tecknen.
  if (!next || !next.startsWith('/')) return getSettings().startPage;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // ogiltig adress
  }
  return getSettings().startPage;
}

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kontot finns men e-postadressen är inte bekräftad: visa rutan för koden
  const [needsCode, setNeedsCode] = useState(false);
  // Skickad hit för att ett supportkonto försökte öppna kundappen (proxy.ts)
  const fromSupport = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('konto') === 'support',
    () => false
  );

  function goOn() {
    // Hel omladdning så att servern ser inloggningen direkt
    window.location.assign(nextPath());
  }

  async function signInAgain() {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(t('login.failed', { msg: error.message }));
    goOn();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (data.user?.app_metadata?.bordvakt_staff === true) {
      // Supportkonton får inte använda kundappen (loggas bara ut här, inte på supportsajten)
      await supabase.auth.signOut({ scope: 'local' });
      setBusy(false);
      setError(t('login.staffAccount'));
      return;
    }
    if (error) {
      setBusy(false);
      if (error.message === 'Email not confirmed') {
        setNeedsCode(true);
        return;
      }
      setError(error.message === 'Invalid login credentials' ? t('login.wrong') : t('login.failed', { msg: error.message }));
      return;
    }
    goOn();
  }

  if (needsCode) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center bg-paper px-4 py-12">
        <div className="stagger flex w-full max-w-[440px] flex-col gap-6">
          <Link href="/" aria-label={t('login.toStart')} className="self-center">
            <Logo />
          </Link>
          <div className="card flex flex-col gap-5 p-6 sm:p-8">
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Bekräfta din e-post</h1>
            <EmailCodeForm email={email.trim().toLowerCase()} onVerified={signInAgain} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-paper px-4 py-12">
      <div className="stagger flex w-full max-w-[400px] flex-col gap-6">
        <Link href="/" aria-label={t('login.toStart')} className="self-center">
          <Logo />
        </Link>
        <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{t('login.title')}</h1>
            <p className="mt-1 text-[15px] text-body">{t('login.subtitle')}</p>
          </div>

          {error && <Banner role="alert">{error}</Banner>}
          {!error && fromSupport && <Banner role="alert">{t('login.staffAccount')}</Banner>}

          <label className="flex flex-col gap-1.5">
            <span className="field-label">{t('login.email')}</span>
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
            <span className="field-label">{t('login.password')}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field min-h-12 text-[15px]"
            />
          </label>

          <button type="submit" disabled={busy} className="btn btn-lg btn-primary">
            {busy ? t('login.busy') : t('login.title')}
          </button>
        </form>
        <p className="self-center text-sm text-muted">
          {t('login.newCustomer')}{' '}
          <Link href="/signup" className="font-semibold text-ink underline">
            {t('login.createAccount')}
          </Link>
        </p>
        <Link href="/" className="self-center text-sm font-semibold text-muted hover:text-ink">
          {t('login.toStart')}
        </Link>
      </div>
    </main>
  );
}
