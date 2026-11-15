'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { m as motion } from 'framer-motion';
import Link from 'next/link';
import { Settings2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useT } from '@/lib/i18n';
import Vakti from './Vakti';
import { requiredDone } from '@/lib/setupProgress';

const REDIRECT_SEC = 5;

/** Matsal och Kök fungerar inte förrän installationen är klar.
 *  Då blurras hela sidan, ett meddelande visas och användaren skickas till installationen. */
export default function SetupGate() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [left, setLeft] = useState(REDIRECT_SEC);

  useEffect(() => {
    let alive = true;
    supabase.rpc('setup_status').then(({ data }) => {
      const status = data as { step: string; complete: boolean } | null;
      if (alive && status && !status.complete) setStep(status.step === 'done' ? 'restaurant' : status.step);
    });
    return () => {
      alive = false;
    };
  }, []);

  const target = `/setup?step=${step}`;

  useEffect(() => {
    if (!step) return;
    const timer = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step && left <= 0) router.replace(target);
  }, [step, left, router, target]);

  if (!step) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="setup-gate-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-paper/40 p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-white p-6 text-center shadow-[0_24px_48px_-16px_rgba(15,20,25,.5)]"
      >
        <Vakti mood="worried" size={72} />
        <h2 id="setup-gate-title" className="font-display text-xl font-bold">
          {t('gate.title')}
        </h2>
        <p className="text-[15px] text-body">{t('gate.body')}</p>
        <div className="w-full">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-teal" style={{ width: `${(requiredDone(step) / 4) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] font-semibold text-body">{t('gate.progress', { n: requiredDone(step) })}</p>
        </div>
        <button type="button" onClick={() => router.replace(target)} className="btn btn-primary btn-lg w-full" autoFocus>
          <Settings2 className="h-5 w-5" />
          {t('gate.go')}
        </button>
        <Link href="/matsal/demo" className="btn btn-secondary w-full">
          <Sparkles className="h-4 w-4" />
          {t('gate.demo')}
        </Link>
        <p className="text-[13px] text-muted" aria-live="polite">
          {t('gate.redirect', { n: Math.max(0, left) })}
        </p>
      </motion.div>
    </div>
  );
}
