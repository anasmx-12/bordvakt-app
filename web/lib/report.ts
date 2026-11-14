import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from './mail';
import { serverSupabase } from './server';
import { addDays, computeStats, localDay, localHour, Stats } from './stats';
import { formatPrice } from './types';
import { isOn } from './features';

// Morgonrapporten: kl. 07 varje dag får ägaren gårdagens siffror på mejlet.

export const REPORT_HOUR = 7;

const WEEKDAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

export function reportText(name: string, s: Stats, site: string) {
  const money = (n: number) => formatPrice(n, s.currency);
  const lines = [
    `God morgon! Så här gick det för ${name} igår (${s.from}):`,
    '',
    `Gäster: ${s.guests} (${s.sittings} sittningar${s.avgSittingMin ? `, i snitt ${Math.round(s.avgSittingMin)} min` : ''})`,
    `Beställningar: ${s.orders}${s.qrOrders ? ` (varav ${s.qrOrders} via QR)` : ''}`,
    s.revenue > 0 ? `Beställt för: ${money(s.revenue)}` : '',
    s.avgFoodWaitMin !== null ? `Väntan på maten: ${Math.round(s.avgFoodWaitMin)} min i snitt` : '',
    s.avgResponseMin !== null ? `Personalens svarstid: ${s.avgResponseMin} min i snitt` : '',
    s.sos ? `SOS: ${s.sos}${s.falseAlarms ? ` (plus ${s.falseAlarms} falsklarm)` : ''}` : '',
    s.reviews.count ? `Betyg från gästerna: ${s.reviews.avg} av 5 (${s.reviews.count} st)` : '',
    s.waste.count ? `Svinn: ${s.waste.count} portioner${s.waste.value ? ` (${money(s.waste.value)})` : ''}` : '',
  ].filter((l, i) => l || i === 1);
  if (s.topItems.length) {
    lines.push('', 'Mest beställt:', ...s.topItems.slice(0, 5).map((i) => `  ${i.qty}× ${i.name}`));
  }
  const low = s.reviews.low.filter((r) => r.comment);
  if (low.length) {
    lines.push('', 'Synpunkter från gäster som inte var nöjda:', ...low.slice(0, 5).map((r) => `  ${r.rating}/5: "${r.comment}"`));
  }
  // Bemanning för idag
  const today = (new Date(`${addDays(s.from, 1)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const plan = s.staffing.filter((x) => x.weekday === today && x.waiters > 0);
  if (plan.length) {
    const peak = plan.reduce((a, b) => (b.waiters > a.waiters ? b : a));
    lines.push('', `Idag (${WEEKDAYS[today]}): mest folk brukar det vara kl. ${peak.hour}–${peak.hour + 1}, då behövs runt ${peak.waiters} servitör(er).`);
  }
  lines.push('', `Mer statistik: ${site}/statistik`, '', 'Vill du inte ha mejlet? Stäng av det under Statistik → Inställningar.');
  return lines.join('\n');
}

async function recipient(supabase: SupabaseClient, restaurantId: string, reportEmail: string | null) {
  if (reportEmail) return reportEmail;
  const { data } = await supabase.from('restaurant_members').select('user_id').eq('restaurant_id', restaurantId).eq('role', 'owner').limit(1).maybeSingle();
  if (!data) return null;
  const { data: user } = await supabase.auth.admin.getUserById(data.user_id);
  return user.user?.email ?? null;
}

let running = false;

/** Skickar rapporten till alla restauranger som inte fått dagens rapport än. Säker att anropa ofta. */
export async function sendDueReports(force = false) {
  if (running || (!force && localHour() < REPORT_HOUR)) return { sent: 0 };
  running = true;
  try {
    const supabase = serverSupabase();
    const today = localDay();
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name, report_email, last_report_day, features')
      .eq('daily_report', true)
      .or(`last_report_day.is.null,last_report_day.lt.${today}`);
    if (error) return { sent: 0, error: error.message }; // t.ex. 012 är inte körd
    let sent = 0;
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';
    for (const r of data ?? []) {
      if (!isOn(r.features, 'stats')) continue; // statistiken är avstängd
      // Markera först, så att rapporten aldrig skickas två gånger
      await supabase.from('restaurants').update({ last_report_day: today }).eq('id', r.id);
      const to = await recipient(supabase, r.id, r.report_email);
      if (!to) continue;
      const yesterday = addDays(today, -1);
      const stats = await computeStats(supabase, r.id, yesterday, yesterday);
      if (stats.sittings === 0 && stats.orders === 0) continue; // stängt igår: inget att rapportera
      await sendMail({ to, subject: `Bordvakt: gårdagen på ${r.name}`, text: reportText(r.name, stats, site) });
      sent += 1;
    }
    return { sent };
  } finally {
    running = false;
  }
}
