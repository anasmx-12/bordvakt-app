'use client';

import { useState } from 'react';
import { CheckCircle2, Lightbulb, Loader2, RefreshCw } from 'lucide-react';
import { Placement, TIP_TEXT } from '@/lib/cameraGuides';

/** Förhandsbilden med borden kameran ser, och tips om placeringen. Vägledning, inget krav. */
export default function PlacementView({
  preview,
  placement,
  warning,
  onRecheck,
}: {
  preview: string | null;
  placement: Placement | null;
  warning: string | null;
  onRecheck?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const good = placement && placement.tips.length === 0;

  async function recheck() {
    if (!onRecheck) return;
    setBusy(true);
    try {
      await onRecheck();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {preview && (
        <div className="relative overflow-hidden rounded-xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- förhandsbild från AI-motorn */}
          <img src={preview} alt="Förhandsbild från kameran" className="block w-full" />
          {placement?.boxes.map(([x1, y1, x2, y2], i) => (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-md border-2 border-teal bg-teal/10"
              style={{
                left: `${x1 * 100}%`,
                top: `${y1 * 100}%`,
                width: `${(x2 - x1) * 100}%`,
                height: `${(y2 - y1) * 100}%`,
              }}
            />
          ))}
        </div>
      )}
      {placement ? (
        <div
          className={`flex flex-col gap-1.5 rounded-lg p-3 text-sm ${good ? 'bg-teal-light' : 'bg-dessert-light/60'}`}
        >
          <p className="flex items-center gap-2 font-semibold">
            {good ? <CheckCircle2 className="h-4 w-4 text-teal" /> : <Lightbulb className="h-4 w-4 text-accent-dark" />}
            {placement.plan_tables > 0
              ? `Kameran ser ${placement.tables_seen} av ${placement.plan_tables} bord`
              : `Kameran ser ${placement.tables_seen} bord`}
          </p>
          {placement.tips.map((tip) => (
            <p key={tip} className="text-body">
              {TIP_TEXT[tip]}
            </p>
          ))}
          {!good && (
            <p className="text-xs text-muted">
              Det här är bara råd. Bord som skyms av folk eller ligger långt bort räknas inte alltid. Flera kameror
              tillsammans ska se alla bord.
            </p>
          )}
        </div>
      ) : (
        warning && <p className="text-sm font-semibold text-accent-dark">Ansluten, men: {warning}</p>
      )}
      {onRecheck && (
        <button type="button" onClick={recheck} disabled={busy} className="btn btn-ghost btn-sm self-start">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Kolla igen (efter
          att du flyttat kameran)
        </button>
      )}
    </div>
  );
}
