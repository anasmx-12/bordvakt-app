'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';

// Inställningar → Mobil-larm: den här mobilen plingar även när appen är stängd.
// Servitören kan välja "mina bord" och får då bara larm för dem.

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type State = 'loading' | 'unsupported' | 'ios' | 'off' | 'on' | 'blocked' | 'missing';

export default function PushCard() {
  const t = useT();
  const { language } = useSettings();
  const [state, setState] = useState<State>('loading');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [tables, setTables] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !KEY) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
      return setState(ios ? 'ios' : 'unsupported');
    }
    if (Notification.permission === 'denied') return setState('blocked');
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return setState('off');
    setEndpoint(sub.endpoint);
    const res = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setState(String(body.error).includes('012') ? 'missing' : 'off');
    if (!body.subscription) return setState('off');
    setTables((body.subscription.tables ?? []).join(', '));
    setState('on');
  }, []);

  useEffect(() => {
    const first = setTimeout(() => check().catch(() => setState('unsupported')), 0);
    return () => clearTimeout(first);
  }, [check]);

  const parsedTables = () =>
    tables
      .split(/[\s,;]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);

  async function save(sub: PushSubscriptionJSON) {
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, tables: parsedTables(), lang: language }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? t('common.error'));
  }

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }));
      await save(sub.toJSON());
      setEndpoint(sub.endpoint);
      setState('on');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function update() {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return setState('off');
    try {
      await save(sub.toJSON());
      setMessage(t('push.saved'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('common.error'));
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState('off');
  }

  async function test() {
    if (!endpoint) return;
    await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    setMessage(t('push.testSent'));
  }

  return (
    <section className="card">
      <div className="border-b border-line-soft px-5 py-4">
        <h2 className="flex items-center gap-2 font-display text-[17px] font-bold">
          <Smartphone className="h-5 w-5" /> {t('push.title')}
        </h2>
        <p className="mt-0.5 text-sm text-muted">{t('push.help')}</p>
      </div>
      <div className="flex flex-col gap-3 p-5">
        {state === 'unsupported' && <p className="text-sm text-body">{t('push.unsupported')}</p>}
        {state === 'ios' && <p className="text-sm text-body">{t('push.ios')}</p>}
        {state === 'blocked' && <p className="text-sm text-body">{t('push.blocked')}</p>}
        {state === 'missing' && <p className="text-sm text-body">{t('entre.missing')}</p>}
        {(state === 'off' || state === 'on') && (
          <>
            <label className="flex flex-col gap-1">
              <span className="field-label">{t('push.myTables')}</span>
              <input value={tables} onChange={(e) => setTables(e.target.value)} placeholder="1, 2, 5" inputMode="numeric" className="field" />
              <span className="text-[12px] text-muted">{t('push.myTablesHelp')}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {state === 'off' ? (
                <button type="button" onClick={enable} disabled={busy} className="btn btn-primary">
                  <BellRing className="h-4 w-4" /> {t('push.enable')}
                </button>
              ) : (
                <>
                  <button type="button" onClick={update} className="btn btn-secondary">
                    {t('push.save')}
                  </button>
                  <button type="button" onClick={test} className="btn btn-secondary">
                    {t('push.test')}
                  </button>
                  <button type="button" onClick={disable} className="btn btn-ghost">
                    {t('push.disable')}
                  </button>
                </>
              )}
            </div>
            {state === 'on' && <p className="text-sm font-semibold text-teal">{t('push.on')}</p>}
          </>
        )}
        {message && <p role="status" className="text-sm text-body">{message}</p>}
      </div>
    </section>
  );
}
