// Körs en gång när servern startar (på en egen server eller lokalt):
// - kollar var 10:e minut om det är dags för morgonrapporten
// - lyssnar på nya larm och skickar dem till personalens mobiler
// På Vercel somnar servern mellan anropen. Där sköts rapporten av Vercel Cron (vercel.json)
// och larmen av databasens webhook (supabase/015_webhooks.sql), så inget startas här.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.VERCEL || process.env.BACKGROUND_JOBS === 'external') return;
  const { sendDueReports } = await import('./lib/report');
  const { startPushWatcher } = await import('./lib/pushWatcher');
  const { cleanupOldData } = await import('./lib/cleanup');
  startPushWatcher();
  const tick = () => {
    sendDueReports().catch((err) => console.error('Morgonrapporten:', err));
    cleanupOldData().catch((err) => console.error('Rensningen:', err));
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 10 * 60_000);
}
