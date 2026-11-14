-- Bordvakt 007: Akut läge (SOS).
-- AI:n larmar när en gäst har tappat ett glas eller en tallrik.
-- Bordet får statusen EMERGENCY och personalen en uppgift av typen EMERGENCY,
-- som ligger kvar tills någon trycker Klar.
-- Kör i Supabase → SQL Editor EFTER 006. Säker att köra flera gånger.

alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check check (status in (
  'AVAILABLE', 'OCCUPIED', 'AWAITING_FOOD', 'NEEDS_ATTENTION', 'NEEDS_CLEANING',
  'DESSERT_OPPORTUNITY', 'CAMERA_BLIND', 'EMERGENCY'
));

alter table public.tasks drop constraint if exists tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'CLEANING', 'SERVICE', 'FOOD_DELIVERY', 'DESSERT', 'EMERGENCY'
));
