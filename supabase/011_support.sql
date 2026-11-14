-- Bordvakt 011: Kontakta Bordvakt support.
-- Restaurangen skickar ett ärende från Installation → Support (t.ex. hjälp att sätta upp
-- QR-koder eller kameror på plats). Bordvakts support får ett mejl med en AI-sammanfattning.
-- Hela konversationen och bokade supportdagar sparas här tills ärendet är klart.
-- Kör i Supabase → SQL Editor EFTER 010. Säker att köra flera gånger.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,          -- ärendenummer som visas för kunden, t.ex. #1042
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  topic text not null default 'other' check (topic in ('qr', 'cameras', 'calibrate', 'floor_plan', 'menu', 'billing', 'other')),
  message text not null check (char_length(message) between 1 and 4000),
  contact_name text not null check (char_length(contact_name) between 1 and 100),
  contact_email text not null check (char_length(contact_email) between 3 and 200),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  preferred_times text check (preferred_times is null or char_length(preferred_times) <= 500),
  -- NEW = nytt, OPEN = supporten jobbar med det, WAITING_CUSTOMER = väntar på kunden,
  -- DATE_PROPOSED = supporten har föreslagit dagar, SCHEDULED = dag bokad, DONE = klart, CLOSED = stängt
  status text not null default 'NEW' check (status in ('NEW', 'OPEN', 'WAITING_CUSTOMER', 'DATE_PROPOSED', 'SCHEDULED', 'DONE', 'CLOSED')),
  scheduled_at timestamptz,
  ai_summary text,
  reply_token text not null default replace(gen_random_uuid()::text, '-', ''),  -- hemlig länk i mejlen
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists support_tickets_reply_token_idx on public.support_tickets (reply_token);
create index if not exists support_tickets_restaurant_idx on public.support_tickets (restaurant_id, created_at desc);
create index if not exists support_tickets_open_idx on public.support_tickets (status) where status not in ('DONE', 'CLOSED');

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author text not null check (author in ('customer', 'support', 'system')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- Dagar som supporten föreslår (kunden väljer en)
create table if not exists public.support_slots (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  starts_at timestamptz not null,
  chosen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists support_slots_ticket_idx on public.support_slots (ticket_id);

-- Restaurangen läser sina egna ärenden. Skrivningar görs bara av servern.
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_slots enable row level security;
drop policy if exists "read support_tickets" on public.support_tickets;
create policy "read support_tickets" on public.support_tickets
  for select to authenticated using (restaurant_id = public.my_restaurant_id());
drop policy if exists "read support_messages" on public.support_messages;
create policy "read support_messages" on public.support_messages
  for select to authenticated using (exists (
    select 1 from public.support_tickets t where t.id = support_messages.ticket_id and t.restaurant_id = public.my_restaurant_id()
  ));
drop policy if exists "read support_slots" on public.support_slots;
create policy "read support_slots" on public.support_slots
  for select to authenticated using (exists (
    select 1 from public.support_tickets t where t.id = support_slots.ticket_id and t.restaurant_id = public.my_restaurant_id()
  ));
