'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, QrCode, Trash2, X } from 'lucide-react';
import Banner from '../components/Banner';
import SectionLabel from '../components/SectionLabel';
import MenuPhotoImport from './MenuPhotoImport';
import LoyaltySettings from './LoyaltySettings';
import { useFeatures } from '@/lib/useFeatures';
import SupportLink from '../components/SupportLink';
import { useMenu } from '@/lib/useMenu';
import { ALLERGENS, formatPrice, MenuCategory, MenuItem, QrOrdering } from '@/lib/types';
import { translate } from '@/lib/i18n';

// Steg 5 i installationen: menyn och QR-beställning. Helt valfritt.

const MODES: { id: QrOrdering; title: string; text: string }[] = [
  { id: 'off', title: 'Av', text: 'Gästerna beställer som vanligt hos personalen. Menyn används bara när personalen skriver in beställningar.' },
  { id: 'direct', title: 'Direkt till köket', text: 'Gästens beställning hamnar direkt under Nya i köket, och servitören får en notis.' },
  { id: 'approve', title: 'Personalen godkänner först', text: 'Servitören trycker Godkänn innan köket ser beställningen. Säkrast.' },
];
const CURRENCIES = ['SEK', 'NOK', 'DKK', 'EUR', 'USD', 'GBP', 'CHF', 'PLN', 'TRY', 'AED', 'SAR', 'PKR', 'INR', 'BDT', 'CNY', 'JPY', 'KRW', 'IDR', 'BRL', 'RUB'];

async function api<T = unknown>(url: string, method: string, data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Fel (${res.status})`);
  return body as T;
}

const allergenName = (a: string) => translate('sv', `allergen.${a}` as Parameters<typeof translate>[1]);

export default function MenuStep({ onDone }: { onDone: () => void }) {
  const menu = useMenu();
  const features = useFeatures();
  const { categories, items, settings } = menu;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [adding, setAdding] = useState<string | null>(null); // kategori-id (eller 'none') där en rätt läggs till
  const [editing, setEditing] = useState<string | null>(null); // rätt-id som ändras

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel');
      return false;
    }
  }

  async function saveSettings(patch: Partial<{ qr_ordering: QrOrdering; menu_step_done: boolean; currency: string }>) {
    await run(async () => {
      const data = await api<typeof settings>('/api/menu/settings', 'PATCH', patch);
      menu.setSettings(data);
    });
  }

  async function finish(skip: boolean) {
    setBusy(true);
    const ok = await run(() => api('/api/menu/settings', 'PATCH', skip ? { menu_step_done: true, qr_ordering: 'off' } : { menu_step_done: true }));
    setBusy(false);
    if (ok) onDone();
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    if (await run(async () => menu.setCategories([...categories, await api<MenuCategory>('/api/menu/categories', 'POST', { name })]))) {
      setNewCategory('');
    }
  }

  async function renameCategory(c: MenuCategory) {
    const name = window.prompt('Nytt namn på kategorin', c.name)?.trim();
    if (!name || name === c.name) return;
    await run(async () => {
      const saved = await api<MenuCategory>(`/api/menu/categories/${c.id}`, 'PATCH', { name });
      menu.setCategories(categories.map((x) => (x.id === c.id ? saved : x)));
    });
  }

  async function deleteCategory(c: MenuCategory) {
    if (!window.confirm(`Ta bort kategorin "${c.name}"? Rätterna i den flyttas till Övrigt.`)) return;
    await run(async () => {
      await api(`/api/menu/categories/${c.id}`, 'DELETE');
      menu.setCategories(categories.filter((x) => x.id !== c.id));
      menu.setItems(items.map((i) => (i.category_id === c.id ? { ...i, category_id: null } : i)));
    });
  }

  /** Byter plats på två grannar (kategorier eller rätter) och sparar ordningen. */
  async function swap<T extends { id: string; position: number }>(list: T[], index: number, dir: -1 | 1, url: string, set: (next: T[]) => void) {
    const a = list[index];
    const b = list[index + dir];
    if (!a || !b) return;
    const next = list.map((x) => (x.id === a.id ? { ...a, position: b.position } : x.id === b.id ? { ...b, position: a.position } : x));
    const posA = a.position === b.position ? b.position + dir : b.position;
    set(next);
    await run(() => Promise.all([api(`${url}/${a.id}`, 'PATCH', { position: posA }), api(`${url}/${b.id}`, 'PATCH', { position: a.position })]));
    menu.reload();
  }

  async function saveItem(form: ItemFormValue, id?: string) {
    return run(async () => {
      const saved = await api<MenuItem>(id ? `/api/menu/items/${id}` : '/api/menu/items', id ? 'PATCH' : 'POST', form);
      const item = { ...saved, price: Number(saved.price) };
      menu.setItems(id ? items.map((i) => (i.id === id ? item : i)) : [...items, item]);
      setAdding(null);
      setEditing(null);
    });
  }

  async function toggleAvailable(item: MenuItem) {
    menu.setItems(items.map((i) => (i.id === item.id ? { ...i, available: !i.available } : i)));
    if (!(await run(() => api(`/api/menu/items/${item.id}`, 'PATCH', { available: !item.available })))) menu.reload();
  }

  async function deleteItem(item: MenuItem) {
    if (!window.confirm(`Ta bort "${item.name}" från menyn?`)) return;
    await run(async () => {
      await api(`/api/menu/items/${item.id}`, 'DELETE');
      menu.setItems(items.filter((i) => i.id !== item.id));
    });
  }

  if (!menu.loaded) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (menu.missing) {
    return (
      <Banner role="alert" title="Menyn är inte aktiverad">
        Kör <code className="font-semibold">supabase/010_menu.sql</code> i Supabase → SQL Editor och ladda om sidan.
      </Banner>
    );
  }

  const currency = settings?.currency ?? 'SEK';
  const known = new Set(categories.map((c) => c.id));
  const groups = [
    ...categories.map((c) => ({ category: c as MenuCategory | null, id: c.id })),
    ...(items.some((i) => !i.category_id || !known.has(i.category_id)) || categories.length === 0 ? [{ category: null, id: 'none' }] : []),
  ];

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <section className="card flex flex-col gap-2 p-5">
        <SectionLabel>Meny (valfritt)</SectionLabel>
        <p className="text-[15px] text-body">
          Lägg in menyn om gästerna ska kunna beställa själva via en QR-kod på bordet. De betalar som vanligt hos er.
          Vill ni hellre fortsätta som i dag kan ni hoppa över steget. Det går att komma tillbaka hit senare.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => finish(true)} disabled={busy} className="btn btn-secondary">
            Hoppa över – vi tar beställningar som vanligt
          </button>
        </div>
      </section>

      {error && (
        <Banner
          role="alert"
          action={
            <button type="button" onClick={() => setError(null)} className="btn btn-ghost btn-sm">
              Stäng
            </button>
          }
        >
          {error}
        </Banner>
      )}

      <MenuPhotoImport onImported={menu.reload} />

      {/* Rätterna */}
      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Rätter</SectionLabel>
          <label className="flex items-center gap-2 text-sm text-body">
            Valuta
            <select
              value={currency}
              onChange={(e) => saveSettings({ currency: e.target.value })}
              className="h-9 rounded-lg border border-line bg-white px-2 text-sm font-semibold"
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        {groups.map(({ category, id }, gi) => {
          const list = items.filter((i) => (category ? i.category_id === category.id : !i.category_id || !known.has(i.category_id)));
          return (
            <div key={id} className="flex flex-col gap-2 rounded-xl border border-line-soft p-3">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate font-display text-lg font-bold">{category?.name ?? 'Övrigt'}</h3>
                {category && (
                  <>
                    <IconButton label="Flytta upp" disabled={gi === 0} onClick={() => swap(categories, gi, -1, '/api/menu/categories', menu.setCategories)}>
                      <ArrowUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Flytta ned" disabled={gi >= categories.length - 1} onClick={() => swap(categories, gi, 1, '/api/menu/categories', menu.setCategories)}>
                      <ArrowDown className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Byt namn" onClick={() => renameCategory(category)}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Ta bort kategorin" onClick={() => deleteCategory(category)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </>
                )}
              </div>

              {list.length === 0 && adding !== id && <p className="text-sm text-muted">Inga rätter här än.</p>}
              <ul className="flex flex-col divide-y divide-line-soft">
                {list.map((item, i) =>
                  editing === item.id ? (
                    <li key={item.id} className="py-2">
                      <ItemForm
                        initial={item}
                        categories={categories}
                        onCancel={() => setEditing(null)}
                        onSave={(form) => saveItem(form, item.id)}
                      />
                    </li>
                  ) : (
                    <li key={item.id} className={`flex flex-wrap items-center gap-2 py-2 ${item.available ? '' : 'opacity-60'}`}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {item.name} <span className="font-normal tabular-nums text-body">· {formatPrice(item.price, currency)}</span>
                        </p>
                        {item.description && <p className="text-[13px] text-body">{item.description}</p>}
                        {item.allergens.length > 0 && (
                          <p className="text-[12px] text-muted">Innehåller: {item.allergens.map(allergenName).join(', ')}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleAvailable(item)}
                        className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${item.available ? 'bg-teal-light text-[#0F5C55]' : 'bg-red-50 text-red-800'}`}
                        title="Tryck för att ändra"
                      >
                        {item.available ? 'Finns' : 'Slut i dag'}
                      </button>
                      <IconButton label="Flytta upp" disabled={i === 0} onClick={() => swap(list, i, -1, '/api/menu/items', (next) => menu.setItems(items.map((x) => next.find((n) => n.id === x.id) ?? x)))}>
                        <ArrowUp className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Flytta ned" disabled={i >= list.length - 1} onClick={() => swap(list, i, 1, '/api/menu/items', (next) => menu.setItems(items.map((x) => next.find((n) => n.id === x.id) ?? x)))}>
                        <ArrowDown className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Ändra" onClick={() => setEditing(item.id)}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Ta bort" onClick={() => deleteItem(item)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </li>
                  )
                )}
              </ul>

              {adding === id ? (
                <ItemForm
                  initial={{ category_id: category?.id ?? null }}
                  categories={categories}
                  onCancel={() => setAdding(null)}
                  onSave={(form) => saveItem(form)}
                />
              ) : (
                <button type="button" onClick={() => setAdding(id)} className="btn btn-ghost btn-sm self-start">
                  <Plus className="h-4 w-4" /> Lägg till rätt
                </button>
              )}
            </div>
          );
        })}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addCategory();
          }}
        >
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Ny kategori, t.ex. Förrätter, Varmrätter, Dryck"
            maxLength={60}
            aria-label="Ny kategori"
            className="field min-w-0 flex-1"
          />
          <button type="submit" disabled={!newCategory.trim()} className="btn btn-secondary min-h-11">
            <Plus className="h-4 w-4" /> Kategori
          </button>
        </form>
      </section>

      {/* QR-beställning */}
      <section className="card flex flex-col gap-3 p-5">
        <SectionLabel>Beställning via QR-kod</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const active = (settings?.qr_ordering ?? 'off') === m.id;
            const blocked = m.id !== 'off' && items.length === 0;
            return (
              <button
                key={m.id}
                type="button"
                disabled={blocked}
                onClick={() => saveSettings({ qr_ordering: m.id })}
                aria-pressed={active}
                className={`flex flex-col gap-1 rounded-xl border p-3 text-start transition-colors disabled:opacity-50 ${
                  active ? 'border-ink bg-paper ring-2 ring-ink' : 'border-line bg-white hover:border-ink'
                }`}
              >
                <span className="font-semibold">{m.title}</span>
                <span className="text-[13px] text-body">{m.text}</span>
              </button>
            );
          })}
        </div>
        {items.length === 0 && <p className="text-[13px] text-muted">Lägg till minst en rätt för att slå på QR-beställning.</p>}
        {settings && settings.qr_ordering !== 'off' && (
          <>
            <Link href="/setup/qr" target="_blank" className="btn btn-secondary self-start">
              <QrCode className="h-4 w-4" /> Skriv ut QR-koder till borden
            </Link>
            <SupportLink topic="qr">
              QR-koderna ska skrivas ut och sättas upp vid varje bord, och appen måste ligga på internet för att gästernas mobiler ska nå den.
              Vi hjälper er med det.
            </SupportLink>
          </>
        )}
      </section>

      {features.on('loyalty') && <LoyaltySettings categories={categories} items={items} />}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => finish(false)} disabled={busy} className="btn btn-lg btn-primary">
          {busy ? 'Sparar…' : 'Klar med menyn'}
        </button>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="btn btn-ghost btn-icon disabled:opacity-30">
      {children}
    </button>
  );
}

interface ItemFormValue {
  name: string;
  price: string;
  description: string;
  category_id: string | null;
  allergens: string[];
}

function ItemForm({
  initial,
  categories,
  onSave,
  onCancel,
}: {
  initial: Partial<MenuItem>;
  categories: MenuCategory[];
  onSave: (form: ItemFormValue) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ItemFormValue>({
    name: initial.name ?? '',
    price: initial.price !== undefined ? String(initial.price) : '',
    description: initial.description ?? '',
    category_id: initial.category_id ?? null,
    allergens: initial.allergens ?? [],
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ItemFormValue>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-paper p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave(form);
        setSaving(false);
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Rättens namn"
          aria-label="Rättens namn"
          maxLength={80}
          required
          autoFocus
          className="field min-w-0 flex-[2]"
        />
        <input
          value={form.price}
          onChange={(e) => set({ price: e.target.value })}
          placeholder="Pris"
          aria-label="Pris"
          inputMode="decimal"
          required
          className="field w-28"
        />
      </div>
      <input
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Kort beskrivning (valfritt)"
        aria-label="Beskrivning"
        maxLength={300}
        className="field"
      />
      {categories.length > 0 && (
        <select
          value={form.category_id ?? ''}
          onChange={(e) => set({ category_id: e.target.value || null })}
          aria-label="Kategori"
          className="field"
        >
          <option value="">Övrigt</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold text-body">Allergener</legend>
        {ALLERGENS.map((a) => {
          const on = form.allergens.includes(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => set({ allergens: on ? form.allergens.filter((x) => x !== a) : [...form.allergens, a] })}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-body'}`}
            >
              {allergenName(a)}
            </button>
          );
        })}
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Sparar…' : 'Spara'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          <X className="h-4 w-4" /> Avbryt
        </button>
      </div>
    </form>
  );
}
