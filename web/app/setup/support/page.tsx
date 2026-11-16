'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, ChevronDown, LifeBuoy } from 'lucide-react';
import AppShell from '../../components/AppShell';
import Banner from '../../components/Banner';
import SectionLabel from '../../components/SectionLabel';
import TicketThread, { TicketData } from '../../components/TicketThread';
import { supabase } from '@/lib/supabase';
import { isTopic, SUPPORT_STATUS, SUPPORT_TOPICS, SupportTopic } from '@/lib/supportTopics';

// Installation → Support: be Bordvakt om hjälp, t.ex. med det som måste göras på plats
// (sätta upp QR-koder, montera kameror). Ärendet går som mejl till supporten.

export default function SupportPage() {
  const [topic, setTopic] = useState<SupportTopic>('other');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [times, setTimes] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('id, number, topic, status, scheduled_at, created_at, support_messages(id, author, body, created_at), support_slots(id, starts_at, chosen)')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setTickets(
      (data ?? []).map((t) => ({
        ...t,
        messages: [...(t.support_messages ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        slots: [...(t.support_slots ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      })) as TicketData[]
    );
  }, []);

  useEffect(() => {
    const first = setTimeout(async () => {
      const wanted = new URLSearchParams(window.location.search).get('topic');
      if (isTopic(wanted)) setTopic(wanted);
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) setEmail((e) => e || data.user!.email!);
      load();
    }, 0);
    return () => clearTimeout(first);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message, contact_name: name, contact_email: email, contact_phone: phone, preferred_times: times }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte skicka ärendet');
      setSent(body.number);
      setMessage('');
      setTimes('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte skicka ärendet');
    } finally {
      setSending(false);
    }
  }

  async function post(id: string, payload: object) {
    const res = await fetch(`/api/support/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? 'Något gick fel');
      return false;
    }
    await load();
    return true;
  }

  return (
    <AppShell
      title="Kontakta Bordvakt support"
      subtitle="Vi hjälper er med det som behöver göras på plats, till exempel att skriva ut och sätta upp QR-koderna vid borden eller montera kamerorna."
      actions={
        <Link href="/setup" className="btn btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Till installationen
        </Link>
      }
    >
      <div className="flex max-w-[760px] flex-col gap-5">
        {missing && (
          <Banner role="alert" title="Supporten är inte aktiverad">
            Kör <code className="font-semibold">supabase/011_support.sql</code> i Supabase → SQL Editor och ladda om sidan.
          </Banner>
        )}
        {error && (
          <Banner role="alert" action={<button onClick={() => setError(null)} className="btn btn-ghost btn-sm">Stäng</button>}>
            {error}
          </Banner>
        )}

        {sent !== null ? (
          <section className="flex flex-col items-start gap-3 rounded-xl border border-[#1D5A55] bg-teal-light p-6">
            <CheckCircle2 className="h-9 w-9 text-teal" />
            <h2 className="font-display text-xl font-bold">Ärende #{sent} är skickat</h2>
            <p className="text-[#A9C9C4]">
              Vi har mejlat en bekräftelse till {email}. Supporten hör av sig, oftast inom en arbetsdag. Behöver vi komma till er
              föreslår vi några dagar som ni väljer mellan här nedan eller via länken i mejlet.
            </p>
            <button type="button" onClick={() => setSent(null)} className="btn btn-secondary">
              Skicka ett ärende till
            </button>
          </section>
        ) : (
          <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <LifeBuoy className="h-5 w-5 text-accent" />
              <SectionLabel>Nytt ärende</SectionLabel>
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">Vad gäller det?</span>
              <select value={topic} onChange={(e) => setTopic(e.target.value as SupportTopic)} className="field">
                {Object.entries(SUPPORT_TOPICS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">Beskriv vad ni behöver hjälp med</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={4000}
                required
                placeholder={topic === 'qr' ? 'T.ex. Vi har 12 bord och vill ha hjälp att skriva ut och sätta upp QR-koderna.' : 'Berätta så mycket ni kan.'}
                className="field resize-y"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="field-label">Ert namn</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" className="field" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Telefon (valfritt)</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" inputMode="tel" className="field" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">E-post (svaren kommer hit)</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required maxLength={200} autoComplete="email" className="field" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="field-label">När passar det att vi kommer? (valfritt)</span>
              <input
                value={times}
                onChange={(e) => setTimes(e.target.value)}
                maxLength={500}
                placeholder="T.ex. vardagar före kl. 11, inte fredagar"
                className="field"
              />
            </label>
            <button type="submit" disabled={sending || missing} className="btn btn-lg btn-primary self-start">
              {sending ? 'Skickar…' : 'Skicka till supporten'}
            </button>
          </form>
        )}

        {tickets.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionLabel>Era ärenden</SectionLabel>
            {tickets.map((t) => {
              const status = SUPPORT_STATUS[t.status] ?? SUPPORT_STATUS.NEW;
              const open = openId === t.id;
              return (
                <div key={t.id} className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : t.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="font-semibold">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-body">{SUPPORT_TOPICS[t.topic] ?? t.topic}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${status.chip}`}>{status.label}</span>
                    <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="border-t border-line-soft p-4">
                      <TicketThread ticket={t} onSend={(body) => post(t.id, { body })} onChoose={(slot_id) => post(t.id, { slot_id })} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </AppShell>
  );
}
