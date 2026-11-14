import 'server-only';
import { sendMail } from './mail';
import { serverSupabase } from './server';
import { isOn } from './features';

/** Mejlar ägaren direkt när en gäst ger 1–2 stjärnor och skriver vad som var fel,
 *  så att det kan rättas medan gästen är kvar. */
export async function notifyLowReview(restaurantId: string, name: string, table: number, rating: number, comment: string) {
  try {
    const supabase = serverSupabase();
    const { data: r } = await supabase.from('restaurants').select('report_email, features').eq('id', restaurantId).maybeSingle();
    if (!isOn(r?.features, 'reviews')) return;
    let to: string | null = r?.report_email ?? null;
    if (!to) {
      const { data: m } = await supabase.from('restaurant_members').select('user_id').eq('restaurant_id', restaurantId).eq('role', 'owner').limit(1).maybeSingle();
      if (m) to = (await supabase.auth.admin.getUserById(m.user_id)).data.user?.email ?? null;
    }
    if (!to) return;
    await sendMail({
      to,
      subject: `Missnöjd gäst vid bord ${table} (${rating}/5)`,
      text: `En gäst vid bord ${table} på ${name} gav ${rating} av 5 stjärnor och skrev:\n\n"${comment}"\n\nSitter gästen kvar kan ni kanske rätta till det nu.\n\nAlla betyg finns under Statistik i Bordvakt.`,
    });
  } catch (err) {
    console.error('Kunde inte mejla om betyget:', err);
  }
}
