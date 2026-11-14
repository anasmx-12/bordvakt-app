'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// Utskriftsark: en QR-kod per bord. Gästen skannar och kommer till bordets beställningssida.

interface Row {
  id: string;
  table_number: number;
  qr_token: string | null;
}

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');

export default function QrSheet() {
  const [tables, setTables] = useState<Row[]>([]);
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [restaurant, setRestaurant] = useState('');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: plan }, { data: r }] = await Promise.all([
      supabase.from('floor_plans').select('id').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('restaurants').select('name').maybeSingle(),
    ]);
    setRestaurant(r?.name ?? '');
    let query = supabase.from('tables').select('id, table_number, qr_token').order('table_number');
    if (plan) query = query.eq('floor_plan_id', plan.id);
    const { data, error } = await query;
    if (error) {
      setError(error.message.includes('qr_token') ? 'Kör supabase/010_menu.sql i Supabase först.' : error.message);
      return;
    }
    setTables(data as Row[]);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      setOrigin(BASE || window.location.origin);
      load();
    }, 0);
    return () => clearTimeout(first);
  }, [load]);

  useEffect(() => {
    if (!origin) return;
    let alive = true;
    Promise.all(
      tables
        .filter((t) => t.qr_token)
        .map(async (t) => [t.id, await QRCode.toDataURL(`${origin}/b/${t.qr_token}`, { width: 512, margin: 1, errorCorrectionLevel: 'M' })] as const)
    ).then((list) => alive && setImages(new Map(list)));
    return () => {
      alive = false;
    };
  }, [tables, origin]);

  async function renew(t: Row) {
    if (!window.confirm(`Byta QR-kod för bord ${t.table_number}? Den gamla koden slutar fungera direkt.`)) return;
    const res = await fetch(`/api/tables/${t.id}/qr`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Kunde inte byta koden');
    setTables((prev) => prev.map((x) => (x.id === t.id ? { ...x, qr_token: body.qr_token } : x)));
  }

  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(origin);

  return (
    <main className="mx-auto max-w-[1000px] p-6 print:p-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-bold">QR-koder till borden</h1>
          <p className="text-sm text-body">Skriv ut, klipp isär och ställ en vid varje bord.</p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn btn-primary btn-lg">
          <Printer className="h-5 w-5" /> Skriv ut
        </button>
      </div>

      {local && (
        <p role="alert" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          Koderna pekar på <b>{origin}</b>, som bara fungerar på den här datorn. För att gästernas mobiler ska nå sidan måste
          appen ligga på internet. Skriv sedan dess adress i <code>NEXT_PUBLIC_SITE_URL</code> i <code>web/.env.local</code>.
        </p>
      )}
      <p className="mb-5 text-sm text-body print:hidden">
        Vill ni ha hjälp att skriva ut och sätta upp koderna?{' '}
        <a href="/setup/support?topic=qr" className="font-semibold underline">Kontakta Bordvakt support</a>
      </p>
      {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {tables.length === 0 && !error && <p className="text-muted">Inga bord än. Rita planritningen först.</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-0">
        {tables.map((t) => (
          <figure
            key={t.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-line bg-white p-4 text-center print:rounded-none print:border-dashed"
          >
            <figcaption className="text-[13px] font-semibold text-muted">{restaurant}</figcaption>
            <p className="font-display text-2xl font-bold">Bord {t.table_number}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {images.get(t.id) ? <img src={images.get(t.id)} alt={`QR-kod för bord ${t.table_number}`} className="h-40 w-40" /> : <div className="h-40 w-40 rounded bg-paper" />}
            <p className="text-[14px] font-semibold">Skanna och beställ</p>
            <p className="text-[12px] text-muted">Scan to order</p>
            <button type="button" onClick={() => renew(t)} className="btn btn-ghost btn-sm print:hidden">
              <RefreshCw className="h-3.5 w-3.5" /> Byt kod
            </button>
          </figure>
        ))}
      </div>
    </main>
  );
}
