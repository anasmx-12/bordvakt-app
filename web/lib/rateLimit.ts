// Enkel gräns för hur många anrop en adress får göra per minut (skydd mot gissning av
// koder, spam och överbelastning). Räknas i minnet per server.

const buckets = new Map<string, { count: number; reset: number }>();
let lastSweep = 0;

/** true = anropet får göras. */
export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Besökarens adress (Vercel och de flesta värdar sätter x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'okänd';
}

// ------------------------------------------------------------ Gemensam gräns (018)
// Räknas i databasen, så att gränsen gäller för alla servrar tillsammans (Vercel kör många).
// Används bara för känsliga anrop. Svarar databasen inte gäller gränsen i minnet ovan.

let sharedMissing = false;

/** true = anropet får göras. */
export async function sharedRateLimit(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sharedMissing || !url || !serviceKey) return true;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/hit_rate_limit`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 404) {
      sharedMissing = true; // 018 är inte körd än
      return true;
    }
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch {
    return true;
  }
}
