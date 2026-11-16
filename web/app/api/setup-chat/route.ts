import { currentRestaurantId, errorResponse, serverSupabase, UserError } from '@/lib/server';
import { engineStream } from '@/lib/engine';
import { setupFacts } from '@/lib/setupFacts';

// POST /api/setup-chat { messages: [{role, content}], language } — Vakti svarar.
// Frågan går till AI-motorn på restaurangens dator, som kör en lokal språkmodell.
// Svaret strömmas som vanlig text. 503 + { fallback: true } = AI:n är inte igång: visa tips i stället.

const DAILY_LIMIT = 200; // skyddar datorn mot att någon skickar tusentals frågor
const usage = new Map<string, { day: string; count: number }>();

function countMessage(restaurantId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(restaurantId);
  const count = u && u.day === day ? u.count + 1 : 1;
  if (count > DAILY_LIMIT) throw new UserError('Vakti har svarat på många frågor i dag. Försök igen i morgon.', 429);
  usage.set(restaurantId, { day, count });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const messages = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
    // Språkkoden kontrolleras igen i AI-motorn (okänd kod = svenska)
    const language = typeof body?.language === 'string' && /^[a-z]{2}$/.test(body.language) ? body.language : 'sv';
    if (messages.length === 0) throw new UserError('Skriv en fråga.');

    const supabase = serverSupabase();
    const restaurantId = await currentRestaurantId(supabase);
    countMessage(restaurantId);
    const facts = await setupFacts(supabase, restaurantId);

    const res = await engineStream(restaurantId, '/chat', { messages, facts, language });
    if (!res) return Response.json({ error: 'AI-motorn är inte igång.', fallback: true }, { status: 503 });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) throw new UserError(data.error ?? 'AI-motorn nekade anropet.', 502);
      return Response.json(
        {
          error: data.error ?? 'Vakti kunde inte svara.',
          fallback: res.status === 503 || res.status === 404,
          // Ollama eller språkmodellen saknas på datorn: Vakti säger hur chatten installeras
          notInstalled: data.code === 'not_installed',
        },
        { status: res.status === 400 ? 400 : 503 }
      );
    }
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
