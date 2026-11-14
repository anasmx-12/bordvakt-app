import 'server-only';
import { UserError } from './server';
import { ALLERGENS, QrOrdering } from './types';

/** Databasen saknar menytabellerna: 010 är inte körd. */
export function missingMenu(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  const text = `${error.code} ${error.message}`;
  return error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || /menu_|qr_|menu_step_done/.test(text)
    ? new UserError('Menyn är inte aktiverad. Kör supabase/010_menu.sql i Supabase → SQL Editor.', 500)
    : null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Rensar en kategori från formuläret. */
export function cleanCategory(body: unknown) {
  const b = body as Record<string, unknown> | null;
  const name = text(b?.name, 60);
  if (!name) throw new UserError('Skriv kategorins namn');
  return { name };
}

/** Rensar en rätt. partial = bara fälten som skickats (för PATCH). */
export function cleanItem(body: unknown, partial = false) {
  const b = (body ?? {}) as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  if (!partial || 'name' in b) {
    const name = text(b.name, 80);
    if (!name) throw new UserError('Skriv rättens namn');
    row.name = name;
  }
  if (!partial || 'price' in b) {
    const price = Math.round(Number(String(b.price ?? '').replace(',', '.')) * 100) / 100;
    if (!Number.isFinite(price) || price < 0 || price >= 100000) throw new UserError('Skriv ett pris, t.ex. 149');
    row.price = price;
  }
  if ('description' in b) row.description = text(b.description, 300) || null;
  if ('category_id' in b) row.category_id = typeof b.category_id === 'string' && b.category_id ? b.category_id : null;
  if ('allergens' in b) {
    row.allergens = Array.isArray(b.allergens)
      ? [...new Set(b.allergens.filter((a): a is string => (ALLERGENS as readonly string[]).includes(a as string)))]
      : [];
  }
  if ('available' in b) row.available = b.available !== false;
  if ('position' in b && Number.isFinite(Number(b.position))) row.position = Math.round(Number(b.position));
  return row;
}

export const QR_MODES: QrOrdering[] = ['off', 'direct', 'approve'];

/** Ny hemlig QR-kod (32 tecken, går inte att gissa). */
export const newQrToken = () => crypto.randomUUID().replaceAll('-', '');
