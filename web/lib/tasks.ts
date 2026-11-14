import 'server-only';
import { SupabaseClient } from '@supabase/supabase-js';
import { currentRestaurantId, UserError } from './server';

/** Uppgiften om den hör till den inloggades restaurang, annars 404. */
export async function ownedTask(supabase: SupabaseClient, id: string) {
  const restaurantId = await currentRestaurantId(supabase);
  const { data: task } = await supabase.from('tasks').select('id,table_id,type').eq('id', id).maybeSingle();
  const { data: table } = task
    ? await supabase.from('tables').select('id').eq('id', task.table_id).eq('restaurant_id', restaurantId).maybeSingle()
    : { data: null };
  if (!task || !table) throw new UserError('Uppgiften finns inte eller är redan klar', 404);
  return { task: task as { id: string; table_id: string; type: string }, restaurantId };
}
