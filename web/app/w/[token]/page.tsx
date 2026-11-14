'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { BellRing, Clock } from 'lucide-react';
import { Key, LANGUAGES, translate, TFunction } from '@/lib/i18n';
import type { Language } from '@/lib/settings';

// Gästens plats i kön (öppnas från QR-koden som värden visar). Ingen inloggning.

interface Spot {
  restaurant: string;
  name: string;
  party_size: number;
  status: 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT';
  ahead: number;
  quoted_minutes: number | null;
  created_at: string;
}

const LANG_KEY = 'bordvakt-guest-lang';

function phoneLanguage(): Language {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && LANGUAGES.some((l) => l.code === saved)) return saved as Language;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase();
    if (LANGUAGES.some((l) => l.code === code)) return code as Language;
  }
  return 'en';
}

function buzz() {
  navigator.vibrate?.([300, 120, 300, 120, 300]);
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // ljud går inte alltid utan att gästen tryckt på sidan först
  }
}

export default function WaitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [lang, setLang] = useState<Language>('en');
  const t: TFunction = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [problem, setProblem] = useState<Key | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/waitlist-link/${token}`, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return setProblem(res?.status === 404 ? 'wait.invalid' : 'guest.error');
    const next = (await res.json()) as Spot;
    setProblem(null);
    setSpot((prev) => {
      if (prev && prev.status !== 'NOTIFIED' && next.status === 'NOTIFIED') buzz();
      return next;
    });
  }, [token]);

  useEffect(() => {
    const first = setTimeout(() => {
      setLang(phoneLanguage());
      load();
    }, 0);
    const timer = setInterval(load, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function leave() {
    if (!window.confirm(t('wait.leaveConfirm'))) return;
    await fetch(`/api/waitlist-link/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leave' }) });
    load();
  }

  const rtl = lang === 'ar' || lang === 'ur';
  const ready = spot?.status === 'NOTIFIED';
  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={lang} className={`min-h-dvh ${ready ? 'bg-teal text-white' : 'bg-paper text-ink'}`}>
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-4">
        <p className="truncate font-display text-lg font-bold">{spot?.restaurant ?? 'Bordvakt'}</p>
        <select
          value={lang}
          onChange={(e) => {
            setLang(e.target.value as Language);
            localStorage.setItem(LANG_KEY, e.target.value);
          }}
          aria-label="Language"
          className="h-9 max-w-[8rem] rounded-lg border border-line bg-white px-2 text-[13px] font-semibold text-ink"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </header>
      <main className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 pb-16 pt-6 text-center" aria-live="polite">
        {problem && <p className="card p-5 text-body">{t(problem)}</p>}
        {!spot && !problem && <p className="py-16 text-muted">{t('guest.loading')}</p>}
        {spot && ready && (
          <>
            <BellRing className="h-20 w-20 animate-bounce" />
            <h1 className="font-display text-3xl font-bold">{t('wait.readyTitle')}</h1>
            <p className="text-lg">{t('wait.readyText')}</p>
          </>
        )}
        {spot && spot.status === 'WAITING' && (
          <>
            <p className="text-[15px] text-body">{t('wait.hello', { name: spot.name, n: spot.party_size })}</p>
            <div className="card flex w-full flex-col items-center gap-1 p-6">
              <span className="text-[13px] font-semibold text-muted">{t('wait.ahead')}</span>
              <span className="font-display text-6xl font-bold tabular-nums">{spot.ahead}</span>
            </div>
            {spot.quoted_minutes ? (
              <p className="flex items-center gap-2 text-[15px] text-body">
                <Clock className="h-4 w-4" /> {t('wait.quoted', { n: spot.quoted_minutes })}
              </p>
            ) : null}
            <p className="text-[14px] text-muted">{t('wait.info')}</p>
            <button type="button" onClick={leave} className="btn btn-ghost">
              {t('wait.leave')}
            </button>
          </>
        )}
        {spot && (spot.status === 'SEATED' || spot.status === 'LEFT') && (
          <p className="card p-5 text-[15px] text-body">{t(spot.status === 'SEATED' ? 'wait.seated' : 'wait.left')}</p>
        )}
      </main>
    </div>
  );
}
