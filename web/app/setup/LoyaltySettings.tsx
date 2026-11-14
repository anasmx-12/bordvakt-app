'use client';

import { useCallback, useEffect, useState } from 'react';
import { Gift, Trash2 } from 'lucide-react';
import SectionLabel from '../components/SectionLabel';
import { MenuCategory, MenuItem } from '@/lib/types';

// Stämpelkort för stamgäster: "var N:e X gratis". Gästen samlar stämplar via QR-sidan.

interface Program {
  id: string;
  label: string;
  stamps_needed: number;
  menu_item_id: string | null;
  category_id: string | null;
  active: boolean;
}

export default function LoyaltySettings({ categories, items }: { categories: MenuCategory[]; items: MenuItem[] }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [target, setTarget] = useState('');
  const [stamps, setStamps] = useState(10);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/loyalty/programs');
    if (!res.ok) return setMissing(true);
    setPrograms(await res.json());
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const name = (p: Pick<Program, 'menu_item_id' | 'category_id'>) =>
    p.menu_item_id ? items.find((i) => i.id === p.menu_item_id)?.name : categories.find((c) => c.id === p.category_id)?.name;

  function pick(value: string) {
    setTarget(value);
    const [kind, id] = value.split(':');
    const n = kind === 'item' ? items.find((i) => i.id === id)?.name : categories.find((c) => c.id === id)?.name;
    if (n) setLabel(`Var ${stamps}:e ${n.toLowerCase()} gratis`);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const [kind, id] = target.split(':');
    const res = await fetch('/api/loyalty/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, stamps_needed: stamps, [kind === 'item' ? 'menu_item_id' : 'category_id']: id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? 'Kunde inte spara');
    setPrograms((p) => [...(p ?? []), body]);
    setTarget('');
    setLabel('');
  }

  async function toggle(p: Program) {
    const res = await fetch(`/api/loyalty/programs/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !p.active }) });
    if (res.ok) setPrograms((list) => list?.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)) ?? null);
  }

  async function remove(p: Program) {
    if (!window.confirm(`Ta bort "${p.label}"? Gästernas stämplar på kortet försvinner.`)) return;
    const res = await fetch(`/api/loyalty/programs/${p.id}`, { method: 'DELETE' });
    if (res.ok) setPrograms((list) => list?.filter((x) => x.id !== p.id) ?? null);
  }

  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-accent" />
        <SectionLabel>Stämpelkort (valfritt)</SectionLabel>
      </div>
      <p className="text-sm text-body">
        Få gästerna att komma tillbaka: t.ex. var 10:e kaffe gratis. Gästen samlar stämplar i mobilen när den beställer via QR-koden, och visar
        en kod för personalen när kortet är fullt. Koden löses in i matsalen under bordet.
      </p>
      {missing && <p className="text-sm text-muted">Kör supabase/012_growth.sql i Supabase för att använda stämpelkort.</p>}

      {programs?.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className={`font-semibold ${p.active ? '' : 'text-muted line-through'}`}>{p.label}</p>
            <p className="text-[12px] text-muted">
              {p.stamps_needed} stämplar · {name(p) ?? 'borttagen rätt'}
            </p>
          </div>
          <button type="button" onClick={() => toggle(p)} className="btn btn-ghost btn-sm">
            {p.active ? 'Pausa' : 'Starta'}
          </button>
          <button type="button" onClick={() => remove(p)} aria-label={`Ta bort ${p.label}`} className="btn btn-ghost btn-icon">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      {!missing && items.length > 0 && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_7rem]">
          <select value={target} onChange={(e) => pick(e.target.value)} required className="field" aria-label="Rätt eller kategori som ger stämplar">
            <option value="">Vad ger en stämpel?</option>
            <optgroup label="Hela kategorin">
              {categories.map((c) => (
                <option key={c.id} value={`category:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="En rätt">
              {items.map((i) => (
                <option key={i.id} value={`item:${i.id}`}>{i.name}</option>
              ))}
            </optgroup>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="number" min={2} max={50} value={stamps} onChange={(e) => setStamps(Number(e.target.value))} className="field w-20" aria-label="Antal stämplar" />
            st
          </label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} placeholder="Vad gästen får, t.ex. Var 10:e kaffe gratis" className="field sm:col-span-2" />
          <button type="submit" className="btn btn-secondary self-start sm:col-span-2 sm:justify-self-start">Lägg till stämpelkort</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </section>
  );
}
