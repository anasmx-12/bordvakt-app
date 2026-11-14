import { timingSafeEqual } from 'crypto';
import { sendDueReports } from '@/lib/report';
import { cleanupOldData } from '@/lib/cleanup';

// GET /api/cron/daily-report — för en schemaläggare (t.ex. Vercel Cron) när appen ligger på internet.
// Kräver Authorization: Bearer <CRON_SECRET>. Lokalt sköts rapporten av instrumentation.ts.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (secret.length < 16 || given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    return Response.json({ error: 'Nekad' }, { status: 401 });
  }
  await cleanupOldData();
  return Response.json(await sendDueReports());
}
