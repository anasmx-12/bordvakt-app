'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Banner from '../../components/Banner';
import { FEATURE_GROUPS, FEATURES, FeatureId, FeatureInfo } from '@/lib/features';
import { setFeatures, useFeatures } from '@/lib/useFeatures';

// Ägaren väljer vilka funktioner restaurangen använder. Avstängda försvinner för all personal och alla gäster.

export default function FeaturesPage() {
  const { features, on, loaded } = useFeatures();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<FeatureId | null>(null);

  async function toggle(id: FeatureId) {
    const next = !on(id);
    setSaving(id);
    setError(null);
    const before = features;
    setFeatures({ ...features, [id]: next }); // visa direkt, ångra om det misslyckas
    const res = await fetch('/api/features', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [id]: next }) });
    const body = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) {
      setFeatures(before);
      return setError(body.error ?? 'Kunde inte spara');
    }
    setFeatures(body.features);
  }

  const groups = Object.entries(FEATURE_GROUPS) as [FeatureInfo['group'], string][];
  const offCount = FEATURES.filter((f) => !on(f.id)).length;

  return (
    <AppShell
      title="Anpassa funktioner"
      subtitle="Stäng av det ni inte använder, så blir appen enklare för personalen. Allt går att slå på igen när som helst."
      actions={
        <Link href="/settings" className="btn btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Inställningar
        </Link>
      }
    >
      <div className="flex max-w-[760px] flex-col gap-5">
        {error && (
          <Banner role="alert" action={<button onClick={() => setError(null)} className="btn btn-ghost btn-sm">Stäng</button>}>
            {error}
          </Banner>
        )}
        <p className="text-sm text-muted">
          {loaded ? (offCount ? `${offCount} av ${FEATURES.length} funktioner är avstängda.` : 'Alla funktioner är på.') : 'Läser in…'}
        </p>
        {groups.map(([group, title], gi) => (
          <motion.section
            key={group}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: gi * 0.06, duration: 0.3, ease: 'easeOut' }}
            className="card overflow-hidden"
          >
            <h2 className="border-b border-line-soft px-5 py-3 font-display text-[16px] font-bold">{title}</h2>
            <ul className="divide-y divide-line-soft">
              {FEATURES.filter((f) => f.group === group).map((f) => {
                const active = on(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => toggle(f.id)}
                      disabled={saving === f.id}
                      className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-paper-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block font-semibold transition-colors ${active ? 'text-ink' : 'text-muted'}`}>{f.title}</span>
                        <span className="block text-[13px] text-muted">{f.text}</span>
                      </span>
                      <Switch on={active} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        ))}
        <p className="text-[13px] text-muted">
          QR-beställning slås av och på i Installation → Meny. Ljud, vibration och språk väljs per mobil under Inställningar.
        </p>
      </div>
    </AppShell>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`flex h-7 w-12 flex-none items-center rounded-full p-1 transition-colors duration-200 ${on ? 'justify-end bg-teal' : 'justify-start bg-line'}`}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className="h-5 w-5 rounded-full bg-white shadow" />
    </span>
  );
}
