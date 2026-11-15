'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m as motion } from 'framer-motion';
import QRCode from 'qrcode';
import { BellRing, Check, Clock, QrCode, UserPlus, Users, X } from 'lucide-react';
import AppShell from '../components/AppShell';
import AlertToasts from '../components/AlertToasts';
import Banner from '../components/Banner';
import { supabase } from '@/lib/supabase';
import { useStaffAlerts } from '@/lib/useStaffAlerts';
import { useT } from '@/lib/i18n';
import { DiningTable } from '@/lib/types';

// Entré: väntelistan vid dörren. Personalen ställer sällskap i kön, gästen skannar en QR-kod
// och ser sin plats i mobilen. När ett passande bord blir ledigt larmar sidan.

interface Party {
  id: string;
  name: string;
  party_size: number;
  phone: string | null;
  note: string | null;
  status: 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT';
  table_id: string | null;
  quoted_minutes: number | null;
  token: string;
  created_at: string;
  notified_at: string | null;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
const fits = (t: DiningTable, size: number) => t.seats === null || t.seats >= size;

function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

export default function EntrancePage() {
  const t = useT();
  const alerts = useStaffAlerts();
  const { notifyTableFree } = alerts;
  const now = useNow();
  const [parties, setParties] = useState<Party[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [avgSitting, setAvgSitting] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [smsNote, setSmsNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [size, setSize] = useState(2);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [qr, setQr] = useState<{ party: Party; image: string } | null>(null);
  const partiesRef = useRef(parties);
  const tablesRef = useRef(tables);
  useEffect(() => {
    partiesRef.current = parties;
    tablesRef.current = tables;
  }, [parties, tables]);

  const load = useCallback(async () => {
    const res = await fetch('/api/waitlist', { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (String(body.error).includes('012')) setMissing(true);
      else setError(body.error ?? t('common.error'));
      return;
    }
    setMissing(false);
    setParties(body.parties);
    setAvgSitting(body.avg_sitting_min);
  }, [t]);

  useEffect(() => {
    const first = setTimeout(async () => {
      load();
      const { data: plan } = await supabase.from('floor_plans').select('id').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
      let query = supabase.from('tables').select('*').order('table_number');
      if (plan) query = query.eq('floor_plan_id', plan.id);
      const { data } = await query;
      setTables((data as DiningTable[]) ?? []);
    }, 0);
    const channel = supabase
      .channel('bordvakt-entre')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables' }, (payload) => {
        const row = payload.new as DiningTable;
        const before = tablesRef.current.find((x) => x.id === row.id);
        if (!before) return;
        setTables((prev) => prev.map((x) => (x.id === row.id ? row : x)));
        // Bordet blev ledigt: passar det någon i kön? Larma för den som väntat längst.
        if (row.status === 'AVAILABLE' && before.status !== 'AVAILABLE') {
          const first = partiesRef.current.find((p) => p.status === 'WAITING' && fits(row, p.party_size));
          if (first) notifyTableFree(row.id, row.table_number, first.name, first.party_size);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, () => load())
      .subscribe();
    const timer = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [load, notifyTableFree]);

  const free = useMemo(() => tables.filter((x) => x.status === 'AVAILABLE'), [tables]);
  const waiting = parties.filter((p) => p.status === 'WAITING');

  /** Ungefärlig väntetid: hur många före i kön som behöver ett lika stort bord, delat på antalet sådana bord. */
  const estimate = useCallback(
    (partySize: number, ahead: number) => {
      const fitting = tables.filter((x) => fits(x, partySize));
      if (free.some((x) => fits(x, partySize)) && ahead === 0) return 0;
      const turns = (ahead + 1) / Math.max(1, fitting.length);
      return Math.min(180, Math.max(5, Math.round((turns * avgSitting) / 2 / 5) * 5));
    },
    [tables, free, avgSitting]
  );

  function showSms(result: unknown) {
    if (result === 'sent') setSmsNote({ ok: true, text: t('entre.smsSent') });
    else if (result === 'logged') setSmsNote({ ok: false, text: t('entre.smsOff') });
    else if (result === 'failed' || result === 'invalid') setSmsNote({ ok: false, text: t('entre.smsFailed') });
    else setSmsNote(null);
  }

  async function patch(p: Party, status: Party['status'], tableId?: string) {
    const res = await fetch(`/api/waitlist/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, table_id: tableId }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? t('common.error'));
    if (status === 'NOTIFIED') showSms(body.sms);
    load();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const quoted = estimate(size, waiting.filter((p) => p.party_size <= size + 2).length);
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, party_size: size, phone, note, quoted_minutes: quoted || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? t('common.error'));
    setName('');
    setPhone('');
    setNote('');
    setSize(2);
    showSms(body.sms);
    await load();
    showQr(body as Party);
  }

  async function showQr(p: Party) {
    const url = `${SITE || window.location.origin}/w/${p.token}`;
    setQr({ party: p, image: await QRCode.toDataURL(url, { width: 360, margin: 1 }) });
  }

  const minutes = (iso: string) => (now ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60000)) : 0);

  return (
    <AppShell
      title={t('entre.title')}
      subtitle={t('entre.subtitle')}
      actions={
        <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-body">
          <Users className="h-4 w-4" /> {t('entre.inQueue', { n: waiting.length })} · {t('entre.freeTables', { n: free.length })}
        </span>
      }
    >
      <AlertToasts toasts={alerts.toasts} onDismiss={alerts.dismiss} onSelectTable={() => {}} />
      <div className="grid max-w-[1100px] gap-5 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-4">
          {missing && <Banner title={t('entre.missingTitle')}>{t('entre.missing')}</Banner>}
          {smsNote && (
            <p role="status" className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${smsNote.ok ? 'bg-teal-light text-teal' : 'bg-amber-100 text-amber-900'}`}>
              <span>{smsNote.text}</span>
              <button type="button" onClick={() => setSmsNote(null)} aria-label={t('common.close')} className="min-h-6 flex-none px-1">
                <X className="h-4 w-4" />
              </button>
            </p>
          )}
          {error && (
            <Banner role="alert" action={<button onClick={() => setError(null)} className="btn btn-ghost btn-sm">{t('common.close')}</button>}>
              {error}
            </Banner>
          )}
          <form onSubmit={add} className="card flex flex-col gap-3 p-5">
            <p className="eyebrow flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> {t('entre.add')}
            </p>
            <label className="flex flex-col gap-1">
              <span className="field-label">{t('entre.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className="field" />
            </label>
            <div className="flex flex-col gap-1">
              <span className="field-label">{t('entre.size')}</span>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSize(n)}
                    aria-pressed={size === n}
                    className={`h-10 min-w-10 rounded-lg border px-2 font-semibold ${size === n ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}
                  >
                    {n}
                  </button>
                ))}
                <input type="number" min={1} max={50} value={size} onChange={(e) => setSize(Number(e.target.value) || 1)} aria-label={t('entre.size')} className="field h-10 w-16" />
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">{t('entre.phone')}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" autoComplete="off" placeholder="070-123 45 67" className="field" />
              <span className="text-[12px] text-muted">{t('entre.phoneHint')}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">{t('entre.note')}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('entre.notePlaceholder')} className="field" />
            </label>
            <p className="text-[13px] text-muted">
              {(() => {
                const m = estimate(size, waiting.filter((p) => p.party_size <= size + 2).length);
                return m === 0 ? t('entre.freeNow') : t('entre.estimate', { n: m });
              })()}
            </p>
            <button type="submit" disabled={missing} className="btn btn-primary btn-lg">
              {t('entre.addBtn')}
            </button>
          </form>

          <section className="card flex flex-col gap-2 p-5">
            <p className="eyebrow">{t('entre.freeTitle')}</p>
            {free.length === 0 ? (
              <p className="text-sm text-muted">{t('entre.noneFree')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {free.map((x) => (
                  <span key={x.id} className="rounded-lg bg-teal-light px-3 py-1.5 text-sm font-semibold text-teal">
                    {t('common.table', { n: x.table_number })}
                    {x.seats ? ` · ${t('entre.seats', { n: x.seats })}` : ''}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="flex flex-col gap-2">
          <p className="eyebrow">{t('entre.queue')}</p>
          {parties.length === 0 && <p className="rounded-lg border border-dashed border-line py-10 text-center text-sm text-muted">{t('entre.empty')}</p>}
          <AnimatePresence initial={false}>
            {parties.map((p, i) => {
              const match = free.find((x) => fits(x, p.party_size));
              const waited = minutes(p.created_at);
              const notified = p.status === 'NOTIFIED';
              return (
                <motion.article
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className={`card flex flex-col gap-3 p-4 ${notified ? 'border-teal ring-1 ring-teal' : match && p.status === 'WAITING' ? 'border-[#9FD0C8]' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-paper font-bold">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] font-semibold">
                        {p.name} <span className="text-muted">· {t('entre.people', { n: p.party_size })}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" /> {t('entre.waited', { n: waited })}
                          {p.quoted_minutes ? ` (${t('entre.quoted', { n: p.quoted_minutes })})` : ''}
                        </span>
                        {p.phone && <span>{p.phone}</span>}
                      </p>
                      {p.note && <p className="mt-1 text-[13px] text-body">{p.note}</p>}
                    </div>
                    <button type="button" onClick={() => showQr(p)} aria-label={t('entre.showQr')} className="btn btn-ghost btn-icon">
                      <QrCode className="h-5 w-5" />
                    </button>
                  </div>
                  {notified && (
                    <p className="rounded-lg bg-teal-light px-3 py-2 text-sm font-semibold text-teal">{t('entre.notifiedInfo', { n: minutes(p.notified_at ?? p.created_at) })}</p>
                  )}
                  {!notified && match && <p className="text-sm font-semibold text-teal">{t('entre.match', { n: match.table_number })}</p>}
                  <div className="flex flex-wrap gap-2">
                    {!notified && (
                      <button type="button" onClick={() => patch(p, 'NOTIFIED')} className="btn btn-secondary">
                        <BellRing className="h-4 w-4" /> {t('entre.ready')}
                      </button>
                    )}
                    <button type="button" onClick={() => patch(p, 'SEATED', match?.id)} className="btn btn-success">
                      <Check className="h-4 w-4" /> {match ? t('entre.seatAt', { n: match.table_number }) : t('entre.seated')}
                    </button>
                    <button type="button" onClick={() => patch(p, 'LEFT')} className="btn btn-ghost">
                      <X className="h-4 w-4" /> {t('entre.left')}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </section>
      </div>

      {qr && (
        <div role="dialog" aria-modal="true" aria-label={t('entre.showQr')} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={() => setQr(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="card flex max-w-sm flex-col items-center gap-3 p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-xl font-bold">{qr.party.name}</p>
            <p className="text-sm text-body">{t('entre.qrInfo')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.image} alt="QR" className="h-64 w-64" />
            <button type="button" onClick={() => setQr(null)} className="btn btn-primary btn-lg w-full">
              {t('common.close')}
            </button>
          </motion.div>
        </div>
      )}
    </AppShell>
  );
}
