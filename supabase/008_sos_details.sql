-- Bordvakt 008: mer om Akut läge (SOS).
-- - Vad som tappades och varför AI:n larmade (visas för personalen).
-- - Köket får veta när en tallrik med mat tappats och kan laga en ny portion.
-- - Falsklarm-knappen: AI:n blir försiktigare vid bord där den larmat fel,
--   och Inställningar visar hur ofta den har rätt.
-- Kör i Supabase → SQL Editor EFTER 007. Säker att köra flera gånger.

alter table public.tasks add column if not exists detail text;
alter table public.tasks add column if not exists sos_kind text;
alter table public.tasks add column if not exists sos_trigger text;
alter table public.tasks add column if not exists false_alarm boolean not null default false;
alter table public.tasks add column if not exists kitchen_status text;

alter table public.tasks drop constraint if exists tasks_sos_kind_check;
alter table public.tasks add constraint tasks_sos_kind_check
  check (sos_kind is null or sos_kind in ('drink', 'food', 'cutlery', 'spill'));

alter table public.tasks drop constraint if exists tasks_sos_trigger_check;
alter table public.tasks add constraint tasks_sos_trigger_check
  check (sos_trigger is null or sos_trigger in ('floor', 'tipped', 'bend', 'stand'));

-- PENDING = köket har inte svarat, REMAKING = lagar en ny portion, NOT_NEEDED = behövs inte
alter table public.tasks drop constraint if exists tasks_kitchen_status_check;
alter table public.tasks add constraint tasks_kitchen_status_check
  check (kitchen_status is null or kitchen_status in ('PENDING', 'REMAKING', 'NOT_NEEDED'));

-- Köksvyn hämtar tappad mat som köket inte har svarat på
create index if not exists tasks_kitchen_pending_idx on public.tasks (table_id) where kitchen_status = 'PENDING';
