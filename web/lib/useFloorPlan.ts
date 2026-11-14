'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { PlanElement } from './floorPlan';

export interface ActiveFloorPlan {
  id: string;
  name: string;
  aspect_ratio: number;
  elements: PlanElement[];
}

/** Restaurangens aktiva planritning. Laddas om automatiskt när admin sparar en ny.
 *  plan = undefined medan den laddas, null om det inte finns någon. */
export function useFloorPlan() {
  const [plan, setPlan] = useState<ActiveFloorPlan | null | undefined>(undefined);
  // true om databasen inte har uppdaterats med 002-filen än
  const [missingTables, setMissingTables] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from('floor_plans')
        .select('id, name, aspect_ratio')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setMissingTables(error.code === 'PGRST205');
        setPlan(null);
        return;
      }
      if (!data) {
        setPlan(null);
        return;
      }
      const { data: elements } = await supabase
        .from('floor_plan_elements')
        .select('kind, label, shape, x, y, w, h, rotation')
        .eq('floor_plan_id', data.id);
      if (!cancelled) setPlan({ ...data, elements: (elements ?? []) as PlanElement[] });
    }

    load();
    const channel = supabase
      .channel('floor-plans')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_plans' }, () => load())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return { plan, missingTables };
}
