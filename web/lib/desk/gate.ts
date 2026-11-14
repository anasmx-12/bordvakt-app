import 'server-only';
import { timingSafeEqual } from 'crypto';
import { serverSupabase, UserError } from '@/lib/server';
import { rateLimit } from '@/lib/rateLimit';

// Supportsajtens enda väg in (/api/desk/...). Supportsajten har ingen egen nyckel till databasen,
// Stripe eller mejlen: allt den gör går hit, och webbappen bestämmer vad som är tillåtet.
//
// Varje anrop måste ha:
// 1. X-Desk-Key = SUPPORT_API_SECRET (bara supportsajtens server känner till den)
// 2. Authorization: Bearer <personalens inloggning>, utom för inloggning och inbjudningar.
//    Webbappen kontrollerar själv att det är ett personalkonto, aktivt, och (för allt utom
//    inloggningen) inloggat med kod från autentiseringsappen (aal2).

export type Level = 'key' | 'password' | 'staff' | 'admin';

export interface Staff {
  user_id: string;
  name: string;
  email: string;
  role: 'agent' | 'admin';
}

export interface DeskContext {
  staff: Staff | null;
  /** Personalens inloggning (för 'password': kontot, även om det inte är aktiv personal). */
  userId: string | null;
  /** Personalens adress, som supportsajten skickar vidare. Bara betrodd efter nyckeln. */
  ip: string | null;
}

const MIN_SECRET = 32;

function keyOk(given: string | null) {
  const secret = process.env.SUPPORT_API_SECRET ?? '';
  if (secret.length < MIN_SECRET || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Inloggningens innehåll. Läses först när Supabase har godkänt den (getUser). */
function claims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export async function deskGate(req: Request, level: Level): Promise<DeskContext> {
  if (!keyOk(req.headers.get('x-desk-key'))) throw new UserError('Nekad.', 401);
  const ip = req.headers.get('x-desk-client-ip')?.slice(0, 64) || null;
  if (level === 'key') return { staff: null, userId: null, ip };

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const out = new UserError('Du är inte inloggad. Ladda om sidan.', 401);
  if (!token) throw out;
  const db = serverSupabase();
  const { data, error } = await db.auth.getUser(token);
  const user = data?.user;
  if (error || !user || user.app_metadata?.bordvakt_staff !== true) throw out;
  if (!rateLimit(`desk:${user.id}`, 240)) throw new UserError('För många anrop. Vänta en minut.', 429);

  const { data: row } = await db.from('support_staff').select('user_id, name, email, role, active').eq('user_id', user.id).maybeSingle();
  const staff: Staff | null = row?.active ? { user_id: row.user_id, name: row.name, email: row.email, role: row.role } : null;
  if (level === 'password') return { staff, userId: user.id, ip };

  if (!staff) throw out;
  if (claims(token).aal !== 'aal2') throw new UserError('Ange koden från autentiseringsappen först.', 401);
  if (level === 'admin' && staff.role !== 'admin') throw new UserError('Bara administratörer får göra det här.', 403);
  return { staff, userId: user.id, ip };
}

/** Skriver i loggen över vad personalen gör. Loggen går inte att ändra (se 019). */
export async function audit(
  ctx: Pick<DeskContext, 'ip'>,
  staff: Pick<Staff, 'user_id' | 'name'> | null,
  action: string,
  target?: { type: string; id: string },
  detail: Record<string, unknown> = {}
) {
  const { error } = await serverSupabase().from('support_audit').insert({
    staff_id: staff?.user_id ?? null,
    staff_name: staff?.name ?? null,
    action,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    detail,
    ip: ctx.ip,
  });
  if (error) {
    const missing = error.code === 'PGRST205' || error.code === '42P01';
    throw new UserError(missing ? 'Databasen saknar supporttabellerna. Kör supabase/019_support_staff.sql i Supabase → SQL Editor.' : `Kunde inte skriva i loggen: ${error.message}`, 500);
  }
}

export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Webbappens egen adress (länkar i mejlen till kunden). */
export const customerSite = () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
/** Supportsajtens adress (länkar i mejlen till personalen). */
export const supportSite = () => (process.env.SUPPORT_SITE_URL || 'http://localhost:3001').replace(/\/$/, '');
