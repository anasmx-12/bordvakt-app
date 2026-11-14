-- Bordvakt 009: Väntar på notan.
-- AI:n märker när gästerna har ätit klart och troligen vill betala:
-- 7 minuter efter att maten plockats bort utan ny beställning, eller tidigare
-- om en väska plockas fram eller hälften av gästerna reser sig.
-- Bordet får statusen WANTS_BILL och personalen en uppgift av typen BILL.
-- Kör i Supabase → SQL Editor EFTER 008. Säker att köra flera gånger.

alter table public.tables drop constraint if exists tables_status_check;
alter table public.tables add constraint tables_status_check check (status in (
  'AVAILABLE', 'OCCUPIED', 'AWAITING_FOOD', 'NEEDS_ATTENTION', 'NEEDS_CLEANING',
  'DESSERT_OPPORTUNITY', 'CAMERA_BLIND', 'EMERGENCY', 'WANTS_BILL'
));

alter table public.tasks drop constraint if exists tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'CLEANING', 'SERVICE', 'FOOD_DELIVERY', 'DESSERT', 'EMERGENCY', 'BILL'
));
