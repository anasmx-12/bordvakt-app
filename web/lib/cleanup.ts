import 'server-only';
import { serverSupabase } from './server';

// Raderar personuppgifter som inte behövs längre (lagringsminimering enligt GDPR).
// Står också i integritetspolicyn (app/integritet). Körs med morgonrapporten.
export const WAITLIST_DAYS = 30;

export async function cleanupOldData() {
  const supabase = serverSupabase();
  const before = new Date(Date.now() - WAITLIST_DAYS * 86400_000).toISOString();
  // Kölistan: namn och telefonnummer behövs bara samma kväll
  const { error } = await supabase.from('waitlist').delete().lt('created_at', before);
  if (error && !/does not exist|schema cache/.test(error.message)) console.error('Rensning av kölistan:', error.message);
}
