'use client';

import { Loader2, WifiOff } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** Gul rad i Matsalen när uppkopplingen är borta, och medan väntande tryck skickas. */
export default function OfflineNotice({ down, downSince, pending }: { down: boolean; downSince: Date | null; pending: number }) {
  const t = useT();
  if (!down && pending === 0) return null;
  const time = downSince?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) ?? '';
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {down ? <WifiOff className="mt-0.5 h-5 w-5 flex-none" /> : <Loader2 className="mt-0.5 h-5 w-5 flex-none animate-spin" />}
      <p>
        <strong className="font-semibold">{down ? t('offline.banner', { time }) : t('offline.sending', { n: pending })}</strong>
        {down && pending > 0 && <span className="block">{t('offline.queued', { n: pending })}</span>}
      </p>
    </div>
  );
}
