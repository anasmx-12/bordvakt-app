import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { engineStatus } from './engine';

/** Det setup_status() i databasen svarar. */
export interface SetupStatus {
  step: 'restaurant' | 'floor_plan' | 'cameras' | 'calibrate' | 'done';
  complete: boolean;
  restaurant_name: string | null;
  has_floor_plan: boolean;
  plan_tables: number;
  cameras: number;
  unmapped_tables: number[];
  uncalibrated_tables: number[];
}

interface CameraFact {
  id: string;
  name: string;
  brand: string;
  status: string;
}

const STEP_NAMES: Record<SetupStatus['step'], string> = {
  restaurant: 'Restaurang (steg 1 av 4)',
  floor_plan: 'Planritning (steg 2 av 4)',
  cameras: 'Kameror (steg 3 av 4)',
  calibrate: 'Kalibrering (steg 4 av 4)',
  done: 'Klart',
};

/** Installationens läge som text till Vakti. Bara namn, nummer och lägen:
 *  aldrig kameraadresser eller lösenord (de läses inte ens från databasen). */
export function describeSetup(
  status: SetupStatus | null,
  cameras: CameraFact[],
  engine: Awaited<ReturnType<typeof engineStatus>>,
  blind: { table_number: number; camera_issue: string | null }[]
): string {
  if (!status) return 'Installationens läge kunde inte läsas.';
  const lines = [
    `Restaurang: ${status.restaurant_name || 'inget namn än'}`,
    status.complete ? 'Installationen är klar.' : `Nuvarande steg: ${STEP_NAMES[status.step]}`,
    status.has_floor_plan ? `Planritning: klar, ${status.plan_tables} bord.` : 'Planritning: saknas.',
  ];
  if (cameras.length === 0) {
    lines.push('Kameror: ingen upplagd än.');
  } else {
    lines.push(`Kameror: ${cameras.length} upplagda:`);
    for (const c of cameras) {
      const online = engine ? engine.cameras?.[c.id]?.online : c.status === 'ONLINE';
      lines.push(`- "${c.name}" (${c.brand}): ${online ? 'ger bild' : 'ger INGEN bild'}`);
    }
  }
  if (status.unmapped_tables.length) lines.push(`Bord utan kamera eller ruta: ${status.unmapped_tables.join(', ')}`);
  if (status.uncalibrated_tables.length) lines.push(`Bord som inte är kalibrerade: ${status.uncalibrated_tables.join(', ')}`);
  lines.push(
    engine
      ? `AI-motorn: igång${engine.ai_enabled ? '' : ', men bevakningen är avstängd (service-nyckeln saknas i .env)'}.`
      : 'AI-motorn: INTE igång. Då fungerar inga kameror. Kontrollera att AI-datorn är påslagen och har internet. Starta om motorn i Terminal: launchctl kickstart -k gui/$(id -u)/se.bordvakt.engine'
  );
  for (const b of blind.slice(0, 10)) {
    lines.push(`Problem: kameran ser inte bord ${b.table_number}${b.camera_issue ? ` (${b.camera_issue})` : ''}.`);
  }
  return lines.join('\n');
}

/** Läser allt Vakti behöver veta om restaurangens installation. */
export async function setupFacts(supabase: SupabaseClient, restaurantId: string): Promise<string> {
  const [status, cameras, blind, engine] = await Promise.all([
    supabase.rpc('setup_status', { p_restaurant_id: restaurantId }).then(({ data }) => data as SetupStatus | null),
    supabase
      .from('camera_feeds')
      .select('id,name,brand,status') // stream_url ligger i en annan tabell och läses aldrig här
      .eq('restaurant_id', restaurantId)
      .then(({ data }) => (data ?? []) as CameraFact[]),
    supabase
      .from('tables')
      .select('table_number,camera_issue')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'CAMERA_BLIND')
      .then(({ data }) => (data ?? []) as { table_number: number; camera_issue: string | null }[]),
    engineStatus(restaurantId),
  ]);
  const facts = describeSetup(status, cameras, engine, blind);
  // Menyn (steg 5, valfritt). Saknas kolumnerna är 010 inte körd.
  const [{ data: r, error }, { count }] = await Promise.all([
    supabase.from('restaurants').select('qr_ordering, menu_step_done').eq('id', restaurantId).maybeSingle(),
    supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
  ]);
  const qr = { off: 'av', direct: 'direkt till köket', approve: 'personalen godkänner först' } as Record<string, string>;
  const menu = error
    ? 'Meny (valfritt steg 5): inte aktiverad, supabase/010_menu.sql är inte körd.'
    : `Meny (valfritt steg 5): ${count ?? 0} rätter. QR-beställning: ${qr[r?.qr_ordering] ?? 'av'}. ${
        r?.menu_step_done ? 'Steget är klart eller överhoppat.' : 'Steget är inte gjort än.'
      }`;
  return `${facts}\n${menu}`;
}
