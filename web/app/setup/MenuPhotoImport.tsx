'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import SectionLabel from '../components/SectionLabel';

interface DraftItem {
  name: string;
  price: number | string;
  description: string;
}
interface DraftCategory {
  name: string;
  items: DraftItem[];
}

/** Fota menyn: AI:n gör ett utkast som ägaren rättar innan det läggs in. */
export default function MenuPhotoImport({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<DraftCategory[] | null>(null);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(files: FileList | null) {
    if (!files?.length) return;
    setBusy('read');
    setError(null);
    const form = new FormData();
    [...files].slice(0, 8).forEach((f) => form.append('photo', f));
    try {
      const res = await fetch('/api/menu/analyze', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte läsa menyn');
      setDraft(body.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte läsa menyn');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    if (!draft) return;
    setBusy('save');
    setError(null);
    try {
      const res = await fetch('/api/menu/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte lägga in menyn');
      setDraft(null);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte lägga in menyn');
    } finally {
      setBusy(null);
    }
  }

  const edit = (ci: number, ii: number, patch: Partial<DraftItem>) =>
    setDraft((d) => d && d.map((c, i) => (i !== ci ? c : { ...c, items: c.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) })));
  const remove = (ci: number, ii: number) =>
    setDraft((d) => d && d.map((c, i) => (i !== ci ? c : { ...c, items: c.items.filter((_, j) => j !== ii) })).filter((c) => c.items.length));
  const count = draft?.reduce((n, c) => n + c.items.length, 0) ?? 0;

  return (
    <section className="card flex flex-col gap-3 p-5">
      <SectionLabel>Fota menyn</SectionLabel>
      <p className="text-[15px] text-body">
        Snabbast för stora menyer: fota den tryckta menyn, en sida per foto, rakt framifrån och i bra ljus. AI:n gör ett utkast
        som du rättar innan det läggs in. Fotona sparas inte.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => read(e.target.files)}
      />
      {!draft && (
        <button type="button" onClick={() => input.current?.click()} disabled={busy !== null} className="btn btn-secondary self-start">
          {busy === 'read' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {busy === 'read' ? 'Läser menyn… (upp till en minut)' : 'Välj foton av menyn'}
        </button>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {draft && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-body">Kontrollera namn och priser. Ta bort det som inte är rätter.</p>
          {draft.map((c, ci) => (
            <div key={ci} className="flex flex-col gap-1.5 rounded-lg border border-line-soft p-3">
              <input
                value={c.name}
                onChange={(e) => setDraft((d) => d && d.map((x, i) => (i === ci ? { ...x, name: e.target.value } : x)))}
                aria-label="Kategori"
                className="field font-semibold"
              />
              {c.items.map((it, ii) => (
                <div key={ii} className="flex flex-wrap items-center gap-2">
                  <input value={it.name} onChange={(e) => edit(ci, ii, { name: e.target.value })} aria-label="Rätt" className="field min-w-0 flex-[2]" />
                  <input
                    value={it.description}
                    onChange={(e) => edit(ci, ii, { description: e.target.value })}
                    aria-label="Beskrivning"
                    placeholder="Beskrivning"
                    className="field min-w-0 flex-[2]"
                  />
                  <input
                    value={String(it.price)}
                    onChange={(e) => edit(ci, ii, { price: e.target.value })}
                    aria-label="Pris"
                    inputMode="decimal"
                    className={`field w-24 ${Number(String(it.price).replace(',', '.')) > 0 ? '' : 'border-red-400'}`}
                  />
                  <button type="button" onClick={() => remove(ci, ii)} aria-label="Ta bort" className="btn btn-ghost btn-icon">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy !== null || count === 0} className="btn btn-primary">
              {busy === 'save' ? 'Lägger in…' : `Lägg in ${count} rätter i menyn`}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn btn-ghost">
              Släng utkastet
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
