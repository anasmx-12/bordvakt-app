'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Mail, Users } from 'lucide-react';
import AppShell from '../components/AppShell';
import Banner from '../components/Banner';
import SectionLabel from '../components/SectionLabel';
import { formatPrice } from '@/lib/types';
import { useFeatures } from '@/lib/useFeatures';
import { m as motion } from 'framer-motion';
import CountUp from '../components/CountUp';
import LearnedCard from './LearnedCard';

// Statistik för ägaren: gäster, sittningar, väntetider, försäljning, betyg, svinn och bemanning.

interface Stats {
  from: string;
  to: string;
  currency: string;
  guests: number;
  sittings: number;
  avgSittingMin: number | null;
  avgFoodWaitMin: number | null;
  avgResponseMin: number | null;
  sos: number;
  falseAlarms: number;
  revenue: number;
  orders: number;
  qrOrders: number;
  byDay: { day: string; revenue: number; guests: number }[];
  byHour: { hour: number; revenue: number; guests: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  reviews: { count: number; avg: number | null; low: { rating: number; comment: string | null; created_at: string }[] };
  waste: { count: number; value: number; top: { name: string; qty: number }[] };
  staffing: { weekday: number; hour: number; guests: number; waiters: number }[];
  guestsPerWaiter: number;
  missing: string[];
}

interface Settings {
  guests_per_waiter: number;
  daily_report: boolean;
  report_email: string | null;
  google_review_url: string | null;
}

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PERIODS = [
  { id: 'today', label: 'Idag', range: () => [today(), today()] },
  { id: 'yesterday', label: 'Igår', range: () => [shift(today(), -1), shift(today(), -1)] },
  { id: 'week', label: '7 dagar', range: () => [shift(today(), -6), today()] },
  { id: 'month', label: '30 dagar', range: () => [shift(today(), -29), today()] },
] as const;
type Period = (typeof PERIODS)[number]['id'];

const min = (m: number | null) => (m === null ? '–' : `${m < 10 ? m.toLocaleString('sv-SE') : Math.round(m)} min`);

function Tile({ label, value, hint, count }: { label: string; value: string; hint?: string; count?: { n: number; format: (n: number) => string } }) {
  return (
    <div className="card card-lift flex flex-col gap-1 p-4">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <span className="font-display text-2xl font-bold tabular-nums">{count ? <CountUp value={count.n} format={count.format} /> : value}</span>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

/** Enkelt stapeldiagram, en serie. Exakt värde visas när man håller över eller trycker på en stapel. */
function Bars({ data, format, label }: { data: { key: string; short: string; value: number }[]; format: (n: number) => string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const shown = active !== null ? data[active] : null;
  const every = Math.ceil(data.length / 12);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex min-h-5 items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold text-muted">{label}</span>
        <span className="tabular-nums text-ink">{shown ? `${shown.key}: ${format(shown.value)}` : ''}</span>
      </figcaption>
      <div className="flex h-36 items-end gap-[2px] border-b border-line" onMouseLeave={() => setActive(null)}>
        {data.map((d, i) => (
          <button
            key={d.key}
            type="button"
            aria-label={`${d.key}: ${format(d.value)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <motion.span
              className={`block w-full rounded-t-[4px] transition-colors ${active === i ? 'bg-accent-dark' : 'bg-accent'}`}
              initial={{ height: 0 }}
              animate={{ height: d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : 0 }}
              transition={{ duration: 0.6, delay: Math.min(i, 30) * 0.02, ease: [0.22, 1, 0.36, 1] }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px] text-[11px] text-muted">
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {i % every === 0 ? d.short : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}

export default function StatistikPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { on } = useFeatures();

  const load = useCallback(async (p: Period) => {
    const [from, to] = PERIODS.find((x) => x.id === p)!.range();
    const res = await fetch(`/api/stats?from=${from}&to=${to}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Kunde inte läsa statistiken');
    setError(null);
    setStats(body);
  }, []);

  useEffect(() => {
    const first = setTimeout(async () => {
      load(period);
      const res = await fetch('/api/stats/settings');
      if (res.ok) setSettings(await res.json());
    }, 0);
    return () => clearTimeout(first);
  }, [load, period]);

  async function save(patch: Partial<Settings>) {
    const res = await fetch('/api/stats/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Kunde inte spara');
    setSettings(body);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if ('guests_per_waiter' in patch) load(period);
  }

  const currency = stats?.currency ?? 'SEK';
  const money = useCallback((n: number) => formatPrice(n, currency), [currency]);
  const oneDay = stats && stats.from === stats.to;
  const hours = stats?.byHour.filter((h) => h.hour >= 6) ?? [];
  const staffHours = [...new Set(stats?.staffing.map((s) => s.hour) ?? [])].sort((a, b) => a - b);

  return (
    <AppShell
      title="Statistik"
      subtitle="Hur det går för restaurangen. Gäster och sittningar räknas av kamerorna, försäljningen kommer från beställningarna i Bordvakt."
      actions={
        <div role="group" aria-label="Period" className="flex rounded-lg border border-line bg-white p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${period === p.id ? 'bg-ink text-white' : 'text-body hover:bg-paper'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex max-w-[1100px] flex-col gap-6">
        {error && <Banner role="alert" title="Något gick fel">{error}</Banner>}
        {stats && stats.missing.length > 0 && (
          <Banner title="Statistiken är inte helt aktiverad">
            Kör <code className="font-semibold">supabase/012_growth.sql</code> i Supabase → SQL Editor. Gäster och sittningar räknas från och med då.
          </Banner>
        )}
        {!stats && !error && (
          <div aria-busy="true" aria-label="Läser in" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton h-[92px]" />
            ))}
            <div className="skeleton col-span-2 h-56 md:col-span-4" />
          </div>
        )}

        {stats && (
          <>
            <section className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Gäster" value={String(stats.guests)} count={{ n: stats.guests, format: String }} hint={`${stats.sittings} sittningar`} />
              <Tile label="Sittningstid" value={min(stats.avgSittingMin)} hint="i snitt per sällskap" />
              <Tile label="Väntan på maten" value={min(stats.avgFoodWaitMin)} hint="beställning → klar i köket" />
              <Tile label="Personalens svarstid" value={min(stats.avgResponseMin)} hint="vinkningar, avdukning, nota, SOS" />
              <Tile label="Beställt för" value={money(stats.revenue)} count={{ n: stats.revenue, format: money }} hint={`${stats.orders} beställningar${stats.qrOrders ? `, ${stats.qrOrders} via QR` : ''}`} />
              <Tile
                label="Snitt per gäst"
                value={stats.guests ? money(Math.round(stats.revenue / stats.guests)) : '–'}
                hint="beställt ÷ gäster"
              />
              {on('reviews') && <Tile label="Gästernas betyg" value={stats.reviews.avg !== null ? `${stats.reviews.avg.toLocaleString('sv-SE')} / 5` : '–'} hint={`${stats.reviews.count} betyg`} />}
              <Tile label="SOS" value={String(stats.sos)} hint={stats.falseAlarms ? `+ ${stats.falseAlarms} falsklarm` : 'inga falsklarm'} />
            </section>

            <section className="card scroll-reveal grid gap-6 p-5 md:grid-cols-2">
              {oneDay ? (
                <>
                  <Bars label="Beställt per timme" format={money} data={hours.map((h) => ({ key: `kl. ${h.hour}`, short: String(h.hour), value: h.revenue }))} />
                  <Bars label="Gäster per timme (när de kom)" format={(n) => `${n} gäster`} data={hours.map((h) => ({ key: `kl. ${h.hour}`, short: String(h.hour), value: h.guests }))} />
                </>
              ) : (
                <>
                  <Bars label="Beställt per dag" format={money} data={stats.byDay.map((d) => ({ key: d.day, short: d.day.slice(8), value: d.revenue }))} />
                  <Bars label="Gäster per dag" format={(n) => `${n} gäster`} data={stats.byDay.map((d) => ({ key: d.day, short: d.day.slice(8), value: d.guests }))} />
                </>
              )}
            </section>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="card scroll-reveal flex flex-col gap-3 p-5">
                <SectionLabel>Mest beställt</SectionLabel>
                {stats.topItems.length === 0 ? (
                  <p className="text-sm text-muted">Inga beställningar under perioden.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-[12px] text-muted">
                      <tr>
                        <th className="pb-1 font-semibold">Rätt</th>
                        <th className="pb-1 text-right font-semibold">Antal</th>
                        <th className="pb-1 text-right font-semibold">Summa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.topItems.map((i) => (
                        <tr key={i.name} className="border-t border-line-soft">
                          <td className="py-1.5">{i.name}</td>
                          <td className="py-1.5 text-right tabular-nums">{i.qty}</td>
                          <td className="py-1.5 text-right tabular-nums">{i.revenue ? money(i.revenue) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="card scroll-reveal flex flex-col gap-3 p-5">
                {on('waste') && <SectionLabel>Svinn</SectionLabel>}
                {!on('waste') ? null : stats.waste.count === 0 ? (
                  <p className="text-sm text-muted">Inget svinn registrerat. Köket trycker &quot;Kom tillbaka&quot; när en rätt skickas tillbaka.</p>
                ) : (
                  <>
                    <p className="text-sm">
                      <b>{stats.waste.count}</b> portioner{stats.waste.value ? <> för <b>{money(stats.waste.value)}</b></> : null} kom tillbaka, lagades om eller makulerades.
                    </p>
                    <ul className="text-sm">
                      {stats.waste.top.map((w) => (
                        <li key={w.name} className="flex justify-between border-t border-line-soft py-1.5">
                          <span>{w.name}</span>
                          <span className="tabular-nums">{w.qty}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {stats.reviews.low.length > 0 && (
                  <>
                    <SectionLabel>Gäster som inte var nöjda</SectionLabel>
                    <ul className="flex flex-col gap-2 text-sm">
                      {stats.reviews.low.map((r) => (
                        <li key={r.created_at} className="rounded-lg bg-paper p-2.5">
                          <b>{r.rating}/5</b> {r.comment ? `– ${r.comment}` : ''}
                          <span className="block text-[12px] text-muted">{new Date(r.created_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>

            <section className="card scroll-reveal flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-accent" />
                <SectionLabel>Bemanning: så många servitörer behövs</SectionLabel>
              </div>
              <p className="text-sm text-body">
                Från de senaste 4 veckorna: hur många gäster som brukar sitta inne varje timme, delat med{' '}
                <b>{stats.guestsPerWaiter} gäster per servitör</b>.
              </p>
              {staffHours.length === 0 ? (
                <p className="text-sm text-muted">Inte tillräckligt med data än. Förslagen dyker upp efter några dagar med kamerorna igång.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-center text-[13px] tabular-nums">
                    <thead className="text-muted">
                      <tr>
                        <th className="p-1 text-left font-semibold">Kl.</th>
                        {WEEKDAYS.map((d) => (
                          <th key={d} className="p-1 font-semibold">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffHours.map((h) => (
                        <tr key={h} className="border-t border-line-soft">
                          <td className="p-1 text-left text-muted">{String(h).padStart(2, '0')}</td>
                          {WEEKDAYS.map((_, wd) => {
                            const cell = stats.staffing.find((s) => s.weekday === wd && s.hour === h);
                            return (
                              <td key={wd} className="p-1" title={cell ? `${cell.guests} gäster i snitt` : 'Stängt / inga gäster'}>
                                {cell ? <span className="font-semibold">{cell.waiters}</span> : <span className="text-line">·</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <LearnedCard />

        {settings && (
          <section className="card scroll-reveal flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-accent" />
              <SectionLabel>Inställningar</SectionLabel>
              {saved && <span className="text-[13px] font-semibold text-teal">Sparat</span>}
            </div>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={settings.daily_report} onChange={(e) => save({ daily_report: e.target.checked })} className="h-5 w-5" />
              <span>Mejla mig gårdagens siffror kl. 07 varje morgon</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="field-label">Skicka rapporten till (tomt = ägarens e-post)</span>
                <input
                  type="email"
                  defaultValue={settings.report_email ?? ''}
                  onBlur={(e) => e.target.value !== (settings.report_email ?? '') && save({ report_email: e.target.value })}
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="field-label">Gäster en servitör hinner med</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={settings.guests_per_waiter}
                  onBlur={(e) => Number(e.target.value) !== settings.guests_per_waiter && save({ guests_per_waiter: Number(e.target.value) })}
                  className="field"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="field-label">Länk till era Google-recensioner</span>
              <input
                type="url"
                placeholder="https://g.page/r/…/review"
                defaultValue={settings.google_review_url ?? ''}
                onBlur={(e) => e.target.value !== (settings.google_review_url ?? '') && save({ google_review_url: e.target.value })}
                className="field"
              />
              <span className="text-[12px] text-muted">
                Gäster som ger 4–5 stjärnor på QR-sidan får en knapp hit. De som ger 1–3 får skriva till er i stället, och det
                hamnar här i statistiken. Länken hittar ni i Google Företagsprofil → &quot;Be om recensioner&quot;.
              </span>
            </label>
          </section>
        )}
        {!settings && stats && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <BarChart3 className="h-4 w-4" /> Inställningarna för rapporten syns när 012_growth.sql är körd.
          </p>
        )}
      </div>
    </AppShell>
  );
}
