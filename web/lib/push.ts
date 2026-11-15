import 'server-only';
import webpush from 'web-push';
import { serverSupabase } from './server';
import { loadLanguage, translate } from './i18n/core';
import type { Key } from './i18n/sv';
import type { Language } from './settings';
import { isOn } from './features';

// Mobil-larm (Web Push): servitörens mobil plingar även när appen är stängd.
// Gratis, inget konto behövs: nycklarna (VAPID) ligger i web/.env.local.

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
export const pushReady = Boolean(PUBLIC && PRIVATE);
if (pushReady) webpush.setVapidDetails('mailto:support@bordvakt.se', PUBLIC!, PRIVATE!);

export interface PushMessage {
  /** Texten som nyckel + värden, så att varje mobil får sitt eget språk */
  key: Key;
  vars?: Record<string, string | number>;
  detailKey?: Key;
  detail?: string;
  tableNumber?: number;
  url?: string;
  /** Samma tag ersätter tidigare larm om samma sak */
  tag: string;
  urgent?: boolean;
}

interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tables: number[] | null;
  lang: string;
}

/** Skickar larmet till restaurangens mobiler (bara de som bevakar bordet, eller alla bord). */
export async function sendPush(restaurantId: string, msg: PushMessage, onlyEndpoint?: string) {
  if (!pushReady) return;
  const supabase = serverSupabase();
  const { data: r } = await supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
  if (!isOn(r?.features, 'push') && !onlyEndpoint) return;
  let query = supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth, tables, lang').eq('restaurant_id', restaurantId);
  if (onlyEndpoint) query = query.eq('endpoint', onlyEndpoint);
  const { data } = await query;
  const subs = ((data ?? []) as Sub[]).filter((s) => !s.tables?.length || msg.tableNumber === undefined || s.tables.includes(msg.tableNumber));
  await Promise.all(
    subs.map(async (s) => {
      const lang = s.lang as Language;
      await loadLanguage(lang);
      const body = JSON.stringify({
        title: translate(lang, msg.key, msg.vars),
        body: msg.detail ?? (msg.detailKey ? translate(lang, msg.detailKey, msg.vars) : ''),
        url: msg.url ?? '/matsal',
        tag: msg.tag,
        urgent: msg.urgent ?? false,
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: msg.urgent ? 300 : 900,
          urgency: msg.urgent ? 'high' : 'normal',
          topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        });
        await supabase.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // Mobilen har slutat ta emot (appen avinstallerad eller larm avstängt): ta bort den
        if (code === 404 || code === 410) await supabase.from('push_subscriptions').delete().eq('id', s.id);
        else console.error('Mobil-larm misslyckades:', code ?? err);
      }
    })
  );
}
