'use client';

import { useState } from 'react';
import { Gift } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** Personalen löser in gästens stämpelkortskod (6 siffror från gästens mobil). */
export default function RedeemCode() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/loyalty/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const body = await res.json().catch(() => ({}));
    setResult(res.ok ? { ok: true, text: t('panel.redeemOk', { label: body.label }) } : { ok: false, text: body.error ?? t('panel.redeemFail') });
    if (res.ok) setCode('');
  }

  return (
    <div className="border-t border-line-soft px-4 py-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-ink">
          <Gift className="h-4 w-4" /> {t('panel.redeem')}
        </button>
      ) : (
        <form onSubmit={redeem} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="field-label">{t('panel.redeem')}</span>
            <span className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="123456"
                className="field flex-1 tabular-nums tracking-widest"
              />
              <button type="submit" disabled={code.length !== 6} className="btn btn-secondary">
                {t('panel.redeemBtn')}
              </button>
            </span>
          </label>
          {result && (
            <p role="status" className={`text-sm font-semibold ${result.ok ? 'text-teal' : 'text-red-800'}`}>
              {result.text}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
