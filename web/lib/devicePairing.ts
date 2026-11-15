import 'server-only';
import { createHash, randomBytes, randomInt } from 'crypto';
import { createPairingCode } from './engineAccount';
import { serverSupabase, UserError } from './server';

// Koppla AI-datorn med en kort kod (supabase/022_engine_pairing.sql).
// AI-datorn ber om en kod och visar den. Ägaren skriver in den i webbappen och godkänner.
// Sedan hämtar datorn sin kopplingskod själv, en gång. Koden gäller i 10 minuter.

export const PAIR_MINUTES = 10;
export const POLL_SECONDS = 4;
// Inga tecken som är lätta att blanda ihop (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;

const sha = (kind: string, value: string) => createHash('sha256').update(`engine-pair:${kind}:${value}`).digest('hex');

/** "k7p 4qx" → "K7P4QX…" (bara giltiga tecken, versaler). */
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : '';
}

const pretty = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

function missingTable(error: { code?: string; message?: string } | null) {
  return error && (error.code === 'PGRST205' || error.code === '42P01' || /engine_pairings/.test(error.message ?? ''));
}
const MISSING = 'Kör supabase/022_engine_pairing.sql i Supabase först.';

/** AI-datorn ber om en kod. Returnerar koden som visas och datorns hemliga nyckel (bara till datorn). */
export async function startPairing(deviceName: unknown) {
  const db = serverSupabase();
  await db.from('engine_pairings').delete().lt('expires_at', new Date(Date.now() - 3600_000).toISOString());
  const name = typeof deviceName === 'string' ? deviceName.replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 60) : '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const device = randomBytes(32).toString('base64url');
    const { error } = await db.from('engine_pairings').insert({
      code_hash: sha('code', code),
      device_hash: sha('device', device),
      device_name: name || null,
      expires_at: new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString(),
    });
    if (!error) return { code: pretty(code), device, expires_in: PAIR_MINUTES * 60, interval: POLL_SECONDS };
    if (missingTable(error)) throw new UserError(MISSING, 500);
    if (error.code !== '23505') throw new UserError(error.message, 500); // 23505 = samma kod finns redan: försök igen
  }
  throw new UserError('Kunde inte skapa en kod. Försök igen.', 500);
}

async function findByCode(code: string) {
  if (code.length !== CODE_LENGTH) return null;
  const { data, error } = await serverSupabase()
    .from('engine_pairings')
    .select('id, device_name, restaurant_id, approved_at, expires_at, created_at')
    .eq('code_hash', sha('code', code))
    .maybeSingle();
  if (missingTable(error)) throw new UserError(MISSING, 500);
  if (!data || data.approved_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

const NOT_FOUND = 'Koden stämmer inte eller har gått ut. Kontrollera koden på AI-datorn (den byts var 10:e minut).';

/** Ägaren kontrollerar koden innan hen godkänner: vilken dator gäller det? */
export async function previewPairing(rawCode: unknown) {
  const row = await findByCode(normalizeCode(rawCode));
  if (!row) throw new UserError(NOT_FOUND, 404);
  return { device_name: row.device_name, created_at: row.created_at };
}

/** Ägaren godkänner: datorn kopplas till restaurangen. */
export async function approvePairing(rawCode: unknown, restaurantId: string, userId: string) {
  const row = await findByCode(normalizeCode(rawCode));
  if (!row) throw new UserError(NOT_FOUND, 404);
  const { data, error } = await serverSupabase()
    .from('engine_pairings')
    .update({ restaurant_id: restaurantId, approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('approved_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw new UserError(error.message, 500);
  if (!data) throw new UserError(NOT_FOUND, 404);
  return { device_name: row.device_name };
}

/** AI-datorn frågar om koden är godkänd. Första gången efter godkännandet får den sin
 *  kopplingskod (och den gamla datorns kod slutar gälla). */
export async function pollPairing(rawDevice: unknown): Promise<{ status: 'pending' | 'expired' } | { status: 'approved'; code: string; restaurant: string }> {
  if (typeof rawDevice !== 'string' || rawDevice.length < 20 || rawDevice.length > 100) return { status: 'expired' };
  const db = serverSupabase();
  const { data: row, error } = await db
    .from('engine_pairings')
    .select('id, restaurant_id, approved_at, claimed_at, expires_at, restaurants(name)')
    .eq('device_hash', sha('device', rawDevice))
    .maybeSingle();
  if (missingTable(error)) throw new UserError(MISSING, 500);
  if (!row || row.claimed_at) return { status: 'expired' };
  if (!row.approved_at || !row.restaurant_id) {
    return new Date(row.expires_at).getTime() < Date.now() ? { status: 'expired' } : { status: 'pending' };
  }
  // Hämtas bara en gång: markera först, skapa sedan inloggningen
  const { data: claimed } = await db
    .from('engine_pairings')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('claimed_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return { status: 'expired' };
  const code = await createPairingCode(row.restaurant_id);
  const restaurant = (row.restaurants as unknown as { name: string } | null)?.name ?? '';
  return { status: 'approved', code, restaurant };
}
