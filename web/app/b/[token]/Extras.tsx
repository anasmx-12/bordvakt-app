'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gift, Star } from 'lucide-react';
import type { TFunction } from '@/lib/i18n';

// Gästsidans extradelar: betyg på besöket och stämpelkort.

/** Stämpelkortets id (slumpat, bara i den här mobilen). Skapas första gången det behövs. */
export function cardKey(scope: string, create = false): string | null {
  const k = `bordvakt-card-${scope}`;
  let key = localStorage.getItem(k);
  if (!key && create) {
    key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(k, key);
  }
  return key;
}

interface Card {
  id: string;
  label: string;
  stamps_needed: number;
  stamps: number;
  codes: string[];
}

export function GuestCard({ token, scope, t }: { token: string; scope: string; t: TFunction }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  const load = useCallback(async () => {
    const key = cardKey(scope, true);
    const res = await fetch(`/api/guest/${token}/loyalty?key=${key}`, { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setCards(await res.json());
  }, [token, scope]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  if (!cards?.length) return null;
  return (
    <section className="mt-2 flex flex-col gap-2">
      <h2 className="eyebrow">{t('guest.cardTitle')}</h2>
      {cards.map((c) => (
        <div key={c.id} className="card flex flex-col gap-2 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Gift className="h-5 w-5 text-accent" /> {c.label}
          </p>
          <div className="flex flex-wrap gap-1.5" aria-label={t('guest.cardStamps', { n: c.stamps, m: c.stamps_needed })}>
            {Array.from({ length: c.stamps_needed }, (_, i) => (
              <span key={i} className={`h-6 w-6 rounded-full border-2 ${i < c.stamps ? 'border-accent bg-accent' : 'border-line bg-white'}`} />
            ))}
          </div>
          <p className="text-[13px] text-muted">{t('guest.cardStamps', { n: c.stamps, m: c.stamps_needed })}</p>
          {c.codes.map((code) => (
            <p key={code} className="rounded-lg bg-teal-light p-3 text-center text-[15px] font-semibold text-teal">
              {t('guest.cardCode')}
              <span className="mt-1 block font-display text-3xl tracking-[0.2em]">{code}</span>
            </p>
          ))}
        </div>
      ))}
      <p className="px-1 text-[12px] text-muted">{t('guest.cardInfo')}</p>
    </section>
  );
}

const reviewedKey = (token: string) => `bordvakt-reviewed-${token}`;
const markReviewed = (token: string) => localStorage.setItem(reviewedKey(token), String(Date.now()));

export function GuestReview({ token, t }: { token: string; t: TFunction }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [result, setResult] = useState<{ id: string; google_url: string | null } | null>(null);
  const [comment, setComment] = useState('');
  const [step, setStep] = useState<'ask' | 'after' | 'done' | 'hidden'>('ask');
  const [error, setError] = useState(false);

  useEffect(() => {
    const first = setTimeout(() => {
      const at = Number(localStorage.getItem(reviewedKey(token)) ?? 0);
      if (Date.now() - at < 4 * 3600_000) setStep('hidden');
    }, 0);
    return () => clearTimeout(first);
  }, [token]);

  async function rate(n: number) {
    setRating(n);
    setError(false);
    const res = await fetch(`/api/guest/${token}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: n }) }).catch(() => null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    markReviewed(token);
    setResult(await res.json());
    setStep('after');
  }

  async function sendComment() {
    if (!result || !comment.trim()) return;
    const res = await fetch(`/api/guest/${token}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: result.id, comment }) }).catch(() => null);
    if (res?.ok) setStep('done');
    else setError(true);
  }

  if (step === 'hidden') return null;
  const happy = rating >= 4;
  return (
    <section key={step} className="card animate-rise mt-4 flex flex-col items-center gap-3 p-5 text-center">
      {step === 'ask' && (
        <>
          <h2 className="font-display text-lg font-bold">{t('guest.rateTitle')}</h2>
          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => rate(n)}
                onMouseEnter={() => setHover(n)}
                aria-label={t('guest.rateStars', { n })}
                className="flex h-12 w-12 items-center justify-center"
              >
                <Star
                  className={`h-9 w-9 transition-[transform,color,fill] duration-150 ${n <= (hover || rating) ? 'scale-110 fill-amber-400 text-amber-400' : 'text-line'}`}
                  style={{ transitionDelay: `${(n - 1) * 25}ms` }}
                />
              </button>
            ))}
          </div>
        </>
      )}
      {step === 'after' && happy && (
        <>
          <p className="font-display text-lg font-bold">{t('guest.rateThanks')}</p>
          {result?.google_url && (
            <>
              <p className="text-[14px] text-body">{t('guest.rateGoogle')}</p>
              <a href={result.google_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
                {t('guest.rateGoogleBtn')}
              </a>
            </>
          )}
        </>
      )}
      {step === 'after' && !happy && (
        <>
          <p className="text-[15px] font-semibold">{t('guest.rateBetter')}</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} aria-label={t('guest.rateBetter')} className="field w-full resize-none" />
          <button type="button" onClick={sendComment} disabled={!comment.trim()} className="btn btn-primary">
            {t('guest.rateSend')}
          </button>
        </>
      )}
      {step === 'done' && <p className="text-[15px] font-semibold">{t('guest.rateSent')}</p>}
      {error && <p role="alert" className="text-[13px] text-red-800">{t('guest.error')}</p>}
    </section>
  );
}
