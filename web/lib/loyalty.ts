import 'server-only';
import { createHash, randomInt } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { OrderItem } from './types';
import { isOn } from './features';
import { UserError } from './server';

export const missingLoyalty = (message: string) =>
  /loyalty/.test(message) ? new UserError('Kör supabase/012_growth.sql i Supabase först.', 500) : new UserError(message, 500);

// Stämpelkort: "var 10:e kaffe gratis". Gästen har ett slumpat kort-id som bara finns i
// mobilen (inget namn, ingen e-post). Stämplar ges när beställningen är serverad.

export const CARD_KEY = /^[a-f0-9]{32}$/;

/** Ett kort id per restaurang i gästens mobil (samma på alla bord). */
export const restaurantKey = (restaurantId: string) => createHash('sha256').update(`card:${restaurantId}`).digest('hex').slice(0, 12);

interface Program {
  id: string;
  label: string;
  stamps_needed: number;
  menu_item_id: string | null;
  category_id: string | null;
}

/** Ger stämplar för en serverad beställning. Säker att anropa flera gånger (orders.stamped). */
export async function awardStamps(supabase: SupabaseClient, orderId: string) {
  // Markera först: bara ett anrop får dela ut stämplarna
  const { data: order } = await supabase
    .from('orders')
    .update({ stamped: true })
    .eq('id', orderId)
    .eq('stamped', false)
    .not('loyalty_key', 'is', null)
    .select('restaurant_id, loyalty_key, items')
    .maybeSingle();
  if (!order?.loyalty_key || !CARD_KEY.test(order.loyalty_key)) return;
  const items = (order.items ?? []) as OrderItem[];
  const ids = items.map((i) => i.menu_item_id).filter(Boolean) as string[];
  if (!ids.length) return;

  const { data: r } = await supabase.from('restaurants').select('*').eq('id', order.restaurant_id).maybeSingle();
  if (!isOn(r?.features, 'loyalty')) return;
  const [{ data: programs }, { data: menu }] = await Promise.all([
    supabase.from('loyalty_programs').select('id, label, stamps_needed, menu_item_id, category_id').eq('restaurant_id', order.restaurant_id).eq('active', true),
    supabase.from('menu_items').select('id, category_id').in('id', ids),
  ]);
  const category = new Map((menu ?? []).map((m) => [m.id, m.category_id]));
  for (const p of (programs ?? []) as Program[]) {
    const stamps = items.reduce((n, i) => {
      if (!i.menu_item_id) return n;
      const match = p.menu_item_id ? i.menu_item_id === p.menu_item_id : p.category_id ? category.get(i.menu_item_id) === p.category_id : false;
      return match ? n + (Number(i.qty) || 1) : n;
    }, 0);
    if (stamps > 0) await addStamps(supabase, p, order.loyalty_key, stamps);
  }
}

async function addStamps(supabase: SupabaseClient, program: Program, key: string, add: number) {
  const { data: card } = await supabase
    .from('loyalty_cards')
    .upsert({ program_id: program.id, card_key: key }, { onConflict: 'program_id,card_key', ignoreDuplicates: false })
    .select('id, stamps')
    .single();
  if (!card) return;
  let stamps = card.stamps + add;
  const rewards: { card_id: string; code: string }[] = [];
  while (stamps >= program.stamps_needed && rewards.length < 10) {
    stamps -= program.stamps_needed;
    rewards.push({ card_id: card.id, code: String(randomInt(100000, 1000000)) });
  }
  await supabase.from('loyalty_cards').update({ stamps, updated_at: new Date().toISOString() }).eq('id', card.id);
  if (rewards.length) await supabase.from('loyalty_rewards').insert(rewards);
}

/** Gästens kort: stämplar och oanvända belöningskoder per program. */
export async function cardStatus(supabase: SupabaseClient, restaurantId: string, key: string) {
  const { data: programs } = await supabase
    .from('loyalty_programs')
    .select('id, label, stamps_needed')
    .eq('restaurant_id', restaurantId)
    .eq('active', true);
  if (!programs?.length) return [];
  const { data: cards } = await supabase
    .from('loyalty_cards')
    .select('id, program_id, stamps, loyalty_rewards(code, redeemed_at)')
    .eq('card_key', key)
    .in('program_id', programs.map((p) => p.id));
  return programs.map((p) => {
    const card = cards?.find((c) => c.program_id === p.id);
    const rewards = ((card?.loyalty_rewards ?? []) as { code: string; redeemed_at: string | null }[]).filter((r) => !r.redeemed_at);
    return { id: p.id, label: p.label, stamps_needed: p.stamps_needed, stamps: card?.stamps ?? 0, codes: rewards.map((r) => r.code) };
  });
}
