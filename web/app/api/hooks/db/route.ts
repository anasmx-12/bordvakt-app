import { timingSafeEqual } from 'crypto';
import { onOrderInsert, onOrderUpdate, onTaskInsert } from '@/lib/pushWatcher';

// POST /api/hooks/db: databasen meddelar nya uppgifter och beställningar (supabase/015_webhooks.sql).
// Skickar mobil-larmen när appen ligger på Vercel. Kräver x-bordvakt-secret = DB_WEBHOOK_SECRET.

function authorized(req: Request) {
  const secret = process.env.DB_WEBHOOK_SECRET ?? '';
  const given = req.headers.get('x-bordvakt-secret') ?? '';
  if (secret.length < 24 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'Nekad' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const record = body?.record;
  if (!record || typeof record !== 'object') return Response.json({ error: 'Saknar rad' }, { status: 400 });
  try {
    if (body.table === 'tasks' && body.type === 'INSERT') await onTaskInsert(record);
    else if (body.table === 'orders' && body.type === 'INSERT') await onOrderInsert(record);
    else if (body.table === 'orders' && body.type === 'UPDATE') await onOrderUpdate(record, body.old_record ?? null);
  } catch (err) {
    console.error('Webhook:', err);
    return Response.json({ error: 'Kunde inte skicka larmet' }, { status: 500 });
  }
  return Response.json({ ok: true });
}
