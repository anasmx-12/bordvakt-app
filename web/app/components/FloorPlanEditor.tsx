'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { ELEMENT_KINDS, ELEMENT_LABELS, ElementKind } from '@/lib/floorPlan';
import FloorPlan from './FloorPlan';
import SectionLabel from './SectionLabel';
import RoomPhotoGuide, { RoomPhotos } from './RoomPhotoGuide';
import { fitUnder } from '@/lib/shrinkImage';
import { supabase } from '@/lib/supabase';
import { FloorPlanDraft, PlanElement, PlanTable, TABLE_SHAPES } from '@/lib/floorPlan';
import { DiningTable, TableShape } from '@/lib/types';

// Borden får ett tillfälligt id i webbläsaren så att de går att flytta och numrera om
type EditableTable = PlanTable & { uid: string };
type EditableElement = PlanElement & { uid: string };
type Draft = Omit<FloorPlanDraft, 'tables' | 'elements'> & { tables: EditableTable[]; elements: EditableElement[] };

// Standardstorlek (bredd, höjd, form) när man lägger till inredning för hand
const ELEMENT_DEFAULTS: Record<ElementKind, { w: number; h: number; shape: 'rect' | 'round' }> = {
  wall: { w: 0.3, h: 0.02, shape: 'rect' },
  window: { w: 0.15, h: 0.015, shape: 'rect' },
  bar: { w: 0.25, h: 0.08, shape: 'rect' },
  counter: { w: 0.15, h: 0.06, shape: 'rect' },
  kitchen: { w: 0.2, h: 0.18, shape: 'rect' },
  entrance: { w: 0.1, h: 0.05, shape: 'rect' },
  plant: { w: 0.045, h: 0.065, shape: 'round' },
  pillar: { w: 0.03, h: 0.045, shape: 'rect' },
  restroom: { w: 0.1, h: 0.1, shape: 'rect' },
  sofa: { w: 0.16, h: 0.06, shape: 'rect' },
  decor: { w: 0.035, h: 0.05, shape: 'round' },
  other: { w: 0.08, h: 0.08, shape: 'rect' },
};

const SHAPE_LABELS: Record<TableShape, string> = { round: 'Runt', square: 'Kvadratiskt', rect: 'Avlångt' };

const withUids = (plan: FloorPlanDraft): Draft => ({
  ...plan,
  tables: plan.tables.map((t) => ({ ...t, uid: crypto.randomUUID() })),
  elements: plan.elements.map((e) => ({ ...e, uid: crypto.randomUUID() })),
});

const clamp01 = (v: number, size: number) => Math.min(1 - size, Math.max(0, v));

interface Props {
  /** Anropas när planritningen har sparats (t.ex. för att gå vidare i installationen) */
  onSaved?: () => void;
}

/** Fotografera matsalen, låt AI:n rita upp den, justera och spara. */
export default function FloorPlanEditor({ onSaved }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'analyzing' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Hämta den sparade planritningen
  useEffect(() => {
    async function load() {
      const { data: plan, error: planError } = await supabase
        .from('floor_plans')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planError) {
        setError(
          planError.code === 'PGRST205'
            ? 'Databasen saknar tabellerna för planritningar. Kör supabase/002_floor_plan_and_statuses.sql i Supabase → SQL Editor.'
            : `Kunde inte hämta planritningen: ${planError.message}`
        );
      } else if (plan) {
        const [elementsRes, tablesRes] = await Promise.all([
          supabase.from('floor_plan_elements').select('*').eq('floor_plan_id', plan.id),
          supabase.from('tables').select('*').eq('floor_plan_id', plan.id).order('table_number'),
        ]);
        const tables = (tablesRes.data ?? []) as DiningTable[];
        setDraft({
          name: plan.name,
          aspect_ratio: plan.aspect_ratio,
          elements: ((elementsRes.data ?? []) as (PlanElement & { id: string })[]).map((e) => ({
            kind: e.kind,
            label: e.label ?? ELEMENT_LABELS[e.kind] ?? '',
            shape: e.shape,
            x: e.x,
            y: e.y,
            w: e.w,
            h: e.h,
            rotation: e.rotation ?? 0,
            uid: e.id,
          })),
          tables: tables.map((t) => ({
            uid: t.id,
            table_number: t.table_number,
            shape: t.shape,
            seats: t.seats ?? 4,
            x: t.floor_x ?? 0,
            y: t.floor_y ?? 0,
            w: t.floor_w ?? 0.08,
            h: t.floor_h ?? 0.08,
            rotation: t.rotation ?? 0,
          })),
        });
      }
      setLoading(false);
    }
    load();
  }, []);


  async function analyze(photos: RoomPhotos) {
    setBusy('analyzing');
    setError(null);
    setNotice(null);
    try {
      // Alla foton analyseras tillsammans, så de måste rymmas i ett anrop
      const entries = Object.entries(photos) as [string, Blob][];
      const blobs = await fitUnder(entries.map(([, b]) => b));
      const form = new FormData();
      entries.forEach(([view], i) => form.append(`photo:${view}`, blobs[i], `${view}.jpg`));
      const res = await fetch('/api/floor-plan/analyze', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (res.status === 413) throw new Error('Fotona är för stora. Ta färre foton och försök igen.');
      if (!res.ok) throw new Error(body.error ?? 'Analysen misslyckades');
      setDraft(withUids(body as FloorPlanDraft));
      setDirty(true);
      setSelected(null);
      setNotice(
        `AI:n hittade ${body.tables.length} bord och ${body.elements.length} inredningsdetaljer på ${body.photos_used} ${
          body.photos_used === 1 ? 'foto' : 'foton'
        }. Granska kartan och spara.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy('saving');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/floor-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Servern plockar bara ut kända fält (uid följer inte med till databasen)
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Kunde inte spara');
      setDirty(false);
      setNotice('Planritningen är sparad.');
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function updateTable(uid: string, patch: Partial<PlanTable>) {
    setDraft((d) => d && { ...d, tables: d.tables.map((t) => (t.uid === uid ? { ...t, ...patch } : t)) });
    setDirty(true);
  }

  function moveTable(uid: string, x: number, y: number) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        tables: d.tables.map((t) =>
          t.uid === uid
            ? { ...t, x: Math.min(1 - t.w, Math.max(0, x)), y: Math.min(1 - t.h, Math.max(0, y)) }
            : t
        ),
      };
    });
    setDirty(true);
  }

  function removeTable(uid: string) {
    setDraft((d) => d && { ...d, tables: d.tables.filter((t) => t.uid !== uid) });
    setSelected(null);
    setDirty(true);
  }

  function addTable() {
    const base: Draft = draft ?? { name: 'Matsal', aspect_ratio: 1.5, tables: [], elements: [] };
    const number = Math.max(0, ...base.tables.map((t) => t.table_number)) + 1;
    const w = 0.08;
    const h = Math.min(0.3, w * base.aspect_ratio); // ser kvadratiskt ut på kartan
    const table: EditableTable = {
      uid: crypto.randomUUID(),
      table_number: number,
      shape: 'square',
      seats: 4,
      x: 0.5 - w / 2,
      y: 0.5 - h / 2,
      w,
      h,
      rotation: 0,
    };
    setDraft({ ...base, tables: [...base.tables, table] });
    setSelected(table.uid);
    setDirty(true);
  }

  function updateElement(uid: string, patch: Partial<PlanElement>) {
    setDraft(
      (d) =>
        d && {
          ...d,
          elements: d.elements.map((e) => {
            if (e.uid !== uid) return e;
            const next = { ...e, ...patch };
            return { ...next, x: clamp01(next.x, next.w), y: clamp01(next.y, next.h) };
          }),
        }
    );
    setDirty(true);
  }

  function removeElement(uid: string) {
    setDraft((d) => d && { ...d, elements: d.elements.filter((e) => e.uid !== uid) });
    setSelected(null);
    setDirty(true);
  }

  function addElement(kind: ElementKind) {
    if (!draft) return;
    const { w, h, shape } = ELEMENT_DEFAULTS[kind];
    const element: EditableElement = {
      uid: crypto.randomUUID(),
      kind,
      label: ELEMENT_LABELS[kind],
      shape,
      x: 0.5 - w / 2,
      y: 0.5 - h / 2,
      w,
      h,
      rotation: 0,
    };
    setDraft({ ...draft, elements: [...draft.elements, element] });
    setSelected(element.uid);
    setDirty(true);
  }

  const numbers = draft?.tables.map((t) => t.table_number) ?? [];
  const duplicates = new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i));
  const canSave = Boolean(draft && draft.tables.length > 0 && duplicates.size === 0 && dirty && !busy);

  return (
    <div className="flex w-full flex-col">
        {error && (
          <div role="alert" className="mb-5 rounded-lg border border-[#F3C9B0] bg-[#FDF1EA] px-4 py-3 text-sm text-[#7C2D12]">
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#B9DAD4] bg-teal-light px-4 py-3 text-sm text-[#0F5C55]"
          >
            <span className="flex items-center gap-2">
              <Check className="h-5 w-5" /> {notice}
            </span>
            {!dirty && !onSaved && (
              <Link href="/matsal" className="font-semibold underline">
                Till matsalen
              </Link>
            )}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          {/* Steg 1: foto */}
          <section className="flex flex-col gap-4 self-start card p-5">
            <div className="flex items-center justify-between">
              <SectionLabel>1 · Fotografera matsalen</SectionLabel>
            </div>

            <RoomPhotoGuide busy={busy === 'analyzing'} onAnalyze={analyze} onError={setError} />
          </section>

          {/* Steg 2: granska och spara */}
          <section className="flex flex-col gap-4 card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>2 · Granska och spara</SectionLabel>
              {draft && (
                <span className="text-xs text-muted">Dra bord och inredning för att flytta dem · klicka för att välja</span>
              )}
            </div>

            {loading ? (
              <div className="flex aspect-[3/2] items-center justify-center rounded-[14px] border border-line bg-paper-soft text-muted">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !draft ? (
              <div className="flex aspect-[3/2] flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-line bg-paper-soft p-6 text-center">
                <p className="font-display text-lg font-bold">Ingen planritning än</p>
                <p className="max-w-sm text-sm text-muted">
                  Ta foton av matsalen till vänster, eller börja med en tom karta och lägg till borden själv.
                </p>
                <button
                  type="button"
                  onClick={addTable}
                  className="btn btn-secondary min-h-11"
                >
                  <Plus className="h-4 w-4" /> Lägg till bord
                </button>
              </div>
            ) : (
              <>
                <FloorPlan
                  aspectRatio={draft.aspect_ratio}
                  elements={draft.elements.map((e) => ({ ...e, key: e.uid }))}
                  tables={draft.tables.map((t) => ({ ...t, key: t.uid }))}
                  selectedKey={selected}
                  onSelect={setSelected}
                  onMove={moveTable}
                  onMoveElement={(uid, x, y) => updateElement(uid, { x, y })}
                />

                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[64px_1fr_72px_44px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    <span>Bord</span>
                    <span>Form</span>
                    <span>Platser</span>
                    <span />
                  </div>
                  {[...draft.tables]
                    .sort((a, b) => a.table_number - b.table_number)
                    .map((t) => (
                      <div
                        key={t.uid}
                        onClick={() => setSelected(t.uid)}
                        className={`grid grid-cols-[64px_1fr_72px_44px] items-center gap-2 rounded-xl border p-1.5 ${
                          t.uid === selected ? 'border-ink bg-paper' : 'border-line'
                        }`}
                      >
                        <input
                          type="number"
                          min={1}
                          aria-label="Bordsnummer"
                          value={t.table_number}
                          onChange={(e) => updateTable(t.uid, { table_number: Number(e.target.value) || 1 })}
                          className={`min-h-10 rounded-lg border-[1.5px] px-2 font-display font-bold ${
                            duplicates.has(t.table_number) ? 'border-red-500 text-red-700' : 'border-gray-300'
                          }`}
                        />
                        <select
                          aria-label="Form"
                          value={t.shape}
                          onChange={(e) => updateTable(t.uid, { shape: e.target.value as TableShape })}
                          className="field min-h-10 px-2"
                        >
                          {TABLE_SHAPES.map((shape) => (
                            <option key={shape} value={shape}>
                              {SHAPE_LABELS[shape]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          aria-label="Antal platser"
                          value={t.seats}
                          onChange={(e) =>
                            updateTable(t.uid, { seats: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })
                          }
                          className="field min-h-10 px-2"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTable(t.uid);
                          }}
                          aria-label={`Ta bort bord ${t.table_number}`}
                          className="flex min-h-10 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  {duplicates.size > 0 && (
                    <p className="text-sm text-red-700">Två bord har samma nummer. Ändra så att alla nummer är unika.</p>
                  )}
                </div>

                <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Inredning och dekorationer ({draft.elements.length})
                    </span>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="sr-only">Lägg till inredning</span>
                      <select
                        value=""
                        onChange={(e) => e.target.value && addElement(e.target.value as ElementKind)}
                        className="field min-h-10 w-auto px-2 font-semibold"
                      >
                        <option value="">+ Lägg till…</option>
                        {ELEMENT_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {ELEMENT_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {draft.elements.length === 0 && (
                    <p className="text-sm text-muted">Ingen inredning. Lägg till t.ex. bar, kök, entré, växter och soffor.</p>
                  )}
                  {draft.elements.map((el) => (
                    <div
                      key={el.uid}
                      onClick={() => setSelected(el.uid)}
                      className={`grid grid-cols-[1fr_1fr_88px_44px] items-center gap-2 rounded-xl border p-1.5 ${
                        el.uid === selected ? 'border-ink bg-paper' : 'border-line'
                      }`}
                    >
                      <select
                        aria-label="Typ"
                        value={el.kind}
                        onChange={(e) => updateElement(el.uid, { kind: e.target.value as ElementKind })}
                        className="field min-h-10 min-w-0 px-2"
                      >
                        {ELEMENT_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {ELEMENT_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Namn på kartan"
                        value={el.label}
                        maxLength={60}
                        onChange={(e) => updateElement(el.uid, { label: e.target.value })}
                        className="field min-h-10 min-w-0 px-2"
                      />
                      <input
                        type="range"
                        min={0.01}
                        max={0.5}
                        step={0.005}
                        aria-label="Storlek"
                        title="Storlek"
                        value={el.w}
                        onChange={(e) => {
                          // Behåller formen: höjden ändras lika mycket som bredden
                          const w = Number(e.target.value);
                          updateElement(el.uid, { w, h: Math.min(1, Math.max(0.01, el.h * (w / el.w))) });
                        }}
                        className="w-full"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeElement(el.uid);
                        }}
                        aria-label={`Ta bort ${el.label || ELEMENT_LABELS[el.kind]}`}
                        className="flex min-h-10 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
                  <button
                    type="button"
                    onClick={addTable}
                    className="btn btn-secondary min-h-11"
                  >
                    <Plus className="h-4 w-4" /> Lägg till bord
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!canSave}
                    className="btn btn-lg btn-primary"
                  >
                    {busy === 'saving' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                    {dirty ? 'Spara planritning' : 'Sparad'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
    </div>
  );
}
