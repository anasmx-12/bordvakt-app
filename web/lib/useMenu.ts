'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MenuCategory, MenuItem, QrOrdering } from './types';

export interface MenuSettings {
  qr_ordering: QrOrdering;
  menu_step_done: boolean;
  currency: string;
}

/** Restaurangens meny och QR-inställningar.
 *  missing = true betyder att databasen saknar menyn (010 inte körd). */
export function useMenu() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState<MenuSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [c, i, r] = await Promise.all([
      supabase.from('menu_categories').select('*').order('position'),
      supabase.from('menu_items').select('*').order('position'),
      supabase.from('restaurants').select('qr_ordering, menu_step_done, currency').maybeSingle(),
    ]);
    const error = c.error ?? i.error ?? r.error;
    setMissing(Boolean(error));
    if (!error) {
      setCategories(c.data as MenuCategory[]);
      setItems((i.data as MenuItem[]).map((x) => ({ ...x, price: Number(x.price) })));
      setSettings(r.data as MenuSettings | null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    return () => clearTimeout(first);
  }, [reload]);

  return { categories, items, settings, missing, loaded, reload, setCategories, setItems, setSettings };
}
