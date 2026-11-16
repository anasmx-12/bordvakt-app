'use client';

import { useSyncExternalStore } from 'react';
import { CheckCircle2, MonitorSmartphone, Share, X } from 'lucide-react';
import { useInstall } from '@/lib/useDevice';
import { useT } from '@/lib/i18n';

const DISMISSED = 'bordvakt.installDismissed';

function dismissed() {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}
// Läses efter första ritningen (servern vet inte vad som sparats i webbläsaren), annars blir
// serverns och webbläsarens HTML olika (hydreringsfel).
const dismissListeners = new Set<() => void>();
const subscribeDismissed = (l: () => void) => {
  dismissListeners.add(l);
  return () => dismissListeners.delete(l);
};

/**
 * "Lägg Bordvakt på hemskärmen": en knapp där webbläsaren erbjuder det, annars stegen.
 * inline = i Matsalen (kan stängas). Annars i Inställningar (visas alltid, även när appen är installerad).
 */
export default function InstallCard({ inline = false }: { inline?: boolean }) {
  const t = useT();
  const { method, install } = useInstall();
  const hidden = useSyncExternalStore(subscribeDismissed, () => inline && dismissed(), () => true);

  if (inline && (hidden || method === 'installed')) return null;

  function hide() {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {}
    dismissListeners.forEach((l) => l());
  }

  if (method === 'installed') {
    return (
      <p className="flex items-center gap-2 text-sm text-body">
        <CheckCircle2 className="h-4 w-4 text-teal" /> {t('install.done')}
      </p>
    );
  }

  return (
    <div className={`flex gap-3 ${inline ? 'mb-5 rounded-xl border border-line bg-white p-4' : ''}`}>
      <MonitorSmartphone className="mt-0.5 h-6 w-6 flex-none text-ink" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div>
          <p className="font-semibold">{t('install.title')}</p>
          <p className="text-body">{t('install.body')}</p>
        </div>
        {method === 'ios' && (
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-body">
            <li>
              {t('install.ios1')} <Share className="inline h-4 w-4 align-text-bottom" aria-hidden />
            </li>
            <li>{t('install.ios2')}</li>
            <li>{t('install.ios3')}</li>
          </ol>
        )}
        {method === 'other' && <p className="text-body">{t('install.other')}</p>}
        <div className="flex flex-wrap gap-2">
          {method === 'prompt' && (
            <button type="button" onClick={() => install().then((ok) => ok && hide())} className="btn btn-primary btn-sm">
              {t('install.button')}
            </button>
          )}
          {inline && (
            <button type="button" onClick={hide} className="btn btn-ghost btn-sm">
              {t('install.later')}
            </button>
          )}
        </div>
      </div>
      {inline && (
        <button type="button" onClick={hide} aria-label={t('install.later')} className="btn btn-ghost btn-icon -me-2 -mt-2 flex-none">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
