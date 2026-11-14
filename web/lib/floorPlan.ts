import { TableShape } from './types';

// Alla koordinater är andelar 0–1 av planritningens bredd/höjd.
// x,y = övre vänstra hörnet. aspect_ratio = bredd / höjd.

export const ELEMENT_KINDS = [
  'wall', 'bar', 'kitchen', 'entrance', 'window', 'plant', 'pillar', 'counter', 'restroom', 'sofa', 'decor', 'other',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const TABLE_SHAPES: TableShape[] = ['round', 'square', 'rect'];

export interface PlanTable {
  table_number: number;
  shape: TableShape;
  seats: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface PlanElement {
  kind: ElementKind;
  label: string;
  shape: 'rect' | 'round';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface FloorPlanDraft {
  name: string;
  aspect_ratio: number;
  tables: PlanTable[];
  elements: PlanElement[];
}

export const ELEMENT_LABELS: Record<ElementKind, string> = {
  wall: 'Vägg',
  bar: 'Bar',
  kitchen: 'Kök',
  entrance: 'Entré',
  window: 'Fönster',
  plant: 'Växt',
  pillar: 'Pelare',
  counter: 'Disk',
  restroom: 'Toalett',
  sofa: 'Soffa',
  decor: 'Dekoration',
  other: 'Övrigt',
};

// ------------------------------------------------------------- Städa upp svaret

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Ser till att en box ligger helt inom kartan och har en minsta storlek. */
function fitBox(raw: Record<string, unknown>, minSize: number) {
  const w = clamp(raw.w, minSize, 1, 0.08);
  const h = clamp(raw.h, minSize, 1, 0.08);
  return {
    x: clamp(raw.x, 0, 1 - w, 0),
    y: clamp(raw.y, 0, 1 - h, 0),
    w,
    h,
    rotation: clamp(raw.rotation, -180, 180, 0),
  };
}

/** Gör AI:ns (eller adminens) planritning säker att spara: rimliga värden,
 *  unika bordsnummer och kända typer. Kastar fel om något grundläggande saknas. */
export function sanitizePlan(input: unknown): FloorPlanDraft {
  if (!input || typeof input !== 'object') throw new Error('Planritningen saknas');
  const raw = input as Record<string, unknown>;
  const rawTables = Array.isArray(raw.tables) ? raw.tables.slice(0, 200) : [];
  const rawElements = Array.isArray(raw.elements) ? raw.elements.slice(0, 200) : [];

  const used = new Set<number>();
  const tables: PlanTable[] = rawTables.map((value) => {
    const t = (value ?? {}) as Record<string, unknown>;
    let number = Math.round(clamp(t.table_number, 1, 9999, 1));
    while (used.has(number)) number++; // dubbletter får nästa lediga nummer
    used.add(number);
    return {
      table_number: number,
      shape: TABLE_SHAPES.includes(t.shape as TableShape) ? (t.shape as TableShape) : 'square',
      seats: Math.round(clamp(t.seats, 1, 30, 4)),
      ...fitBox(t, 0.02),
    };
  });

  const elements: PlanElement[] = rawElements.map((value) => {
    const e = (value ?? {}) as Record<string, unknown>;
    const kind = ELEMENT_KINDS.includes(e.kind as ElementKind) ? (e.kind as ElementKind) : 'other';
    return {
      kind,
      label: typeof e.label === 'string' ? e.label.slice(0, 60) : ELEMENT_LABELS[kind],
      shape: e.shape === 'round' ? 'round' : 'rect',
      ...fitBox(e, 0.005),
    };
  });

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Matsal',
    aspect_ratio: clamp(raw.aspect_ratio, 0.4, 3, 1.5),
    tables,
    elements,
  };
}
