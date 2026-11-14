import { errorResponse, serverSupabase, UserError } from '@/lib/server';
import { ownedTask } from '@/lib/tasks';

const MISSING_008 = 'Falsklarm kräver en uppdaterad databas. Kör supabase/008_sos_details.sql i Supabase.';

// PATCH /api/tasks/[id] — personalen klarmarkerar en uppgift.
// { false_alarm: true } = SOS eller Vill ha hjälp var ett falsklarm (AI:n lär sig av det).
// Körs på servern med service-nyckeln, så webbläsaren behöver aldrig skrivrätt.
export async function PATCH(req: Request, ctx: RouteContext<'/api/tasks/[id]'>) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const falseAlarm = body?.false_alarm === true;
    const supabase = serverSupabase();
    const { task } = await ownedTask(supabase, id);
    if (falseAlarm && task.type !== 'EMERGENCY' && task.type !== 'SERVICE') throw new UserError('Bara SOS och Vill ha hjälp kan vara falsklarm');

    const update: Record<string, unknown> = { status: 'COMPLETED', resolved_at: new Date().toISOString() };
    if (falseAlarm) {
      update.false_alarm = true;
      update.kitchen_status = null; // köket behöver inte laga något
    }
    const { data, error } = await supabase
      .from('tasks')
      .update(update)
      .eq('id', id)
      .eq('status', 'PENDING')
      .select()
      .maybeSingle();

    if (error) throw new UserError(error.code === 'PGRST204' ? MISSING_008 : error.message, 500);
    if (!data) throw new UserError('Uppgiften finns inte eller är redan klar', 404);
    return Response.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
