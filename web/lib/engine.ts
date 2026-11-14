import 'server-only';
import { createHash, createHmac } from 'crypto';
import { serverSupabase, UserError } from './server';

// Webbappen pratar med AI-motorn (AI.py) på restaurangens egen dator.
// - Adressen: AI.py öppnar en krypterad tunnel (Cloudflare) och sparar dess https-adress i
//   restaurants.engine_url. Saknas den används AI_ENGINE_URL (t.ex. localhost under utveckling).
// - Nyckeln: varje restaurang har en egen nyckel, räknad ur service-nyckeln och restaurangens id.
//   Bara servern och restaurangens AI-dator känner till den.
// - Webbläsaren får aldrig nyckeln, bara en biljett som gäller en stund (viewTicket).

const FALLBACK_URL = process.env.AI_ENGINE_URL ?? process.env.NEXT_PUBLIC_STREAM_URL ?? 'http://localhost:8080';
const TICKET_SECONDS = 2 * 60 * 60;

function baseKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.includes('DIN_')) throw new UserError('SUPABASE_SERVICE_ROLE_KEY saknas i web/.env.local', 500);
  return createHash('sha256').update(`bordvakt-engine:${key}`).digest('hex');
}

/** Restaurangens egen nyckel till AI-motorn (samma som AI.py räknar fram). */
export function engineKey(restaurantId: string): string {
  return createHmac('sha256', baseKey()).update(`restaurant:${restaurantId}`).digest('hex');
}

const DEV = process.env.NODE_ENV !== 'production';
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\]|.*\.local|.*\.internal)$/i;

/** Godkända adresser: https till en publik adress. Under utveckling även den egna datorn
 *  och det lokala nätet. På internet får servern aldrig styras mot interna adresser. */
export function safeEngineUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    const local = PRIVATE_HOST.test(url.hostname);
    if (DEV && local && (url.protocol === 'http:' || url.protocol === 'https:')) return url.origin;
    if (url.protocol === 'https:' && !local) return url.origin;
  } catch {
    // ogiltig adress
  }
  return null;
}

const urlCache = new Map<string, { at: number; url: string }>();

/** Adressen till restaurangens AI-motor. */
export async function engineUrl(restaurantId: string): Promise<string> {
  const hit = urlCache.get(restaurantId);
  if (hit && Date.now() - hit.at < 15_000) return hit.url;
  const { data } = await serverSupabase().from('restaurants').select('engine_url').eq('id', restaurantId).maybeSingle();
  const url = safeEngineUrl(data?.engine_url) ?? FALLBACK_URL;
  urlCache.set(restaurantId, { at: Date.now(), url });
  return url;
}

/** Biljett som låter webbläsaren se video och status från AI-motorn en stund. */
export function viewTicket(restaurantId: string) {
  const exp = Math.floor(Date.now() / 1000) + TICKET_SECONDS;
  const sig = createHmac('sha256', engineKey(restaurantId)).update(`view:${restaurantId}:${exp}`).digest('hex');
  return { token: `${exp}.${sig}`, expires: exp };
}

async function engineFetch(restaurantId: string, path: string, init: RequestInit & { timeoutMs: number }) {
  const { timeoutMs, ...rest } = init;
  const base = await engineUrl(restaurantId);
  return fetch(`${base}${path}`, {
    ...rest,
    headers: { ...(rest.headers as Record<string, string>), 'X-Bordvakt-Key': engineKey(restaurantId) },
    cache: 'no-store',
    redirect: 'error', // följ aldrig en omdirigering med nyckeln
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** POST till AI-motorn. Returnerar svaret som JSON eller kastar ett begripligt fel. */
export async function enginePost<T = Record<string, unknown>>(
  restaurantId: string,
  path: string,
  body: BodyInit,
  contentType: string,
  timeoutMs = 30_000
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  let res: Response;
  try {
    res = await engineFetch(restaurantId, path, { method: 'POST', headers: { 'Content-Type': contentType }, body, timeoutMs });
  } catch (err) {
    if (err instanceof UserError) throw err;
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new UserError('AI-motorn svarade inte i tid. Försök igen.', 504);
    }
    throw new UserError('AI-motorn svarar inte. Kontrollera att AI-datorn är påslagen och har internet.', 503);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw new UserError(data.error ?? 'AI-motorn nekade anropet.', 502);
  return { ok: res.ok, status: res.status, data };
}

/** Säger åt AI-motorn att läsa in installationen direkt (annars sker det inom en minut). */
export async function engineReload(restaurantId: string) {
  try {
    await enginePost(restaurantId, '/reload', '{}', 'application/json', 3000);
  } catch {
    // Motorn är inte igång: den läser in allt när den startar
  }
}

/** GET /status från AI-motorn, eller null om den inte svarar. */
export async function engineStatus(restaurantId: string): Promise<{
  ai_enabled?: boolean;
  setup_complete?: boolean;
  cameras?: Record<string, { online: boolean }>;
} | null> {
  try {
    const res = await engineFetch(restaurantId, '/status', { timeoutMs: 2500 });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** POST till AI-motorn där svaret läses som en ström (Vakti). null = motorn är inte igång. */
export async function engineStream(restaurantId: string, path: string, body: unknown): Promise<Response | null> {
  try {
    return await engineFetch(restaurantId, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });
  } catch (err) {
    if (err instanceof UserError) throw err;
    return null;
  }
}
