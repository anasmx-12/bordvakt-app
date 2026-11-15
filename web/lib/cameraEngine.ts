import 'server-only';
import { enginePost } from './engine';
import { currentRestaurantId, serverSupabase, UserError } from './server';

// Kameraguiden: allt som rör kamerorna görs av AI-datorn i restaurangens nät (camera_discovery.py).
// Kropparna kan innehålla kamerans lösenord: de loggas aldrig.

const OLD_ENGINE = 'AI-motorn är en äldre version. Uppdatera den med: bash install/install-mac.sh, och försök igen.';

/** Skickar till AI-datorn. 422 (kameran gick inte att koppla) skickas vidare som det är. */
export async function cameraEngine(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const restaurantId = await currentRestaurantId(serverSupabase());
  const { ok, status, data } = await enginePost(restaurantId, path, JSON.stringify(body), 'application/json', timeoutMs);
  if (status === 404) throw new UserError(OLD_ENGINE, 502);
  if (status === 422) return Response.json(data, { status: 422 });
  if (!ok) throw new UserError(data.error ?? `AI-motorn svarade med fel (${status})`, 502);
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
