'use client';

import { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { SUPPORT_STATUS, SUPPORT_TOPICS, SupportTopic } from '@/lib/supportTopics';

export interface TicketData {
  id: string;
  number: number;
  topic: SupportTopic;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  messages: { id: string; author: 'customer' | 'support' | 'system'; body: string; created_at: string }[];
  slots: { id: string; starts_at: string; chosen: boolean }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Ett supportärende: konversationen, föreslagna dagar och svarsrutan. */
export default function TicketThread({
  ticket,
  onSend,
  onChoose,
}: {
  ticket: TicketData;
  onSend: (body: string) => Promise<boolean>;
  onChoose: (slotId: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const status = SUPPORT_STATUS[ticket.status] ?? SUPPORT_STATUS.NEW;
  const open = ticket.status !== 'CLOSED';
  const choosable = ticket.slots.length > 0 && ticket.status !== 'DONE' && ticket.status !== 'CLOSED';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-bold">Ärende #{ticket.number}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${status.chip}`}>{status.label}</span>
        <span className="text-[13px] text-muted">{SUPPORT_TOPICS[ticket.topic] ?? ticket.topic}</span>
      </div>

      {ticket.scheduled_at && ticket.status === 'SCHEDULED' && (
        <p className="flex items-center gap-2 rounded-lg bg-teal-light px-3 py-2 text-sm font-semibold text-[#7EE0D2]">
          <CalendarCheck className="h-4 w-4" /> Bokad: {when(ticket.scheduled_at)}
        </p>
      )}

      {choosable && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
          <p className="text-sm font-semibold text-violet-900">Supporten föreslår de här dagarna. Välj den som passar:</p>
          <div className="flex flex-wrap gap-2">
            {ticket.slots.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onChoose(s.id);
                  setBusy(false);
                }}
                className={`btn btn-sm ${s.chosen ? 'btn-primary' : 'btn-secondary'}`}
              >
                {s.chosen && '✓ '}
                {when(s.starts_at)}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {ticket.messages.map((m) =>
          m.author === 'system' ? (
            <li key={m.id} className="text-center text-[12px] text-muted">
              {m.body}
            </li>
          ) : (
            <li
              key={m.id}
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] ${
                m.author === 'customer' ? 'self-end rounded-ee-md bg-ink text-white' : 'self-start rounded-es-md bg-paper text-ink'
              }`}
            >
              <span className="mb-0.5 block text-[11px] opacity-70">
                {m.author === 'customer' ? 'Ni' : 'Bordvakt support'} · {when(m.created_at)}
              </span>
              {m.body}
            </li>
          )
        )}
      </ol>

      {open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            setBusy(true);
            if (await onSend(reply)) setReply('');
            setBusy(false);
          }}
        >
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Skriv till supporten…"
            aria-label="Meddelande till supporten"
            className="field resize-y"
          />
          <button type="submit" disabled={busy || !reply.trim()} className="btn btn-primary self-start">
            {busy ? 'Skickar…' : 'Skicka'}
          </button>
        </form>
      )}
    </div>
  );
}
