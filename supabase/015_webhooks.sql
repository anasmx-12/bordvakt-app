-- 015: Databasen meddelar webbappen om nya larm och beställningar (för mobil-larmen).
-- Behövs först när appen ligger på Vercel. Lokalt lyssnar servern själv (lib/pushWatcher.ts).
--
-- Kör den här filen i Supabase SQL Editor. Kör sedan raden längst ner med er adress
-- och samma hemliga nyckel som DB_WEBHOOK_SECRET i Vercel (minst 24 tecken).

create extension if not exists pg_net;

-- Inställningen ligger i ett schema som inte syns via API:t
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_hook (
  id boolean primary key default true check (id),
  url text not null,      -- t.ex. https://app.bordvakt.se
  secret text not null
);
revoke all on private.app_hook from public, anon, authenticated;

create or replace function private.notify_app() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  hook private.app_hook%rowtype;
begin
  select * into hook from private.app_hook where id;
  if not found then
    return new;
  end if;
  perform net.http_post(
    url := rtrim(hook.url, '/') || '/api/hooks/db',
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bordvakt-secret', hook.secret),
    timeout_milliseconds := 5000
  );
  return new;
end $$;

-- Bara det som ger ett larm skickas
drop trigger if exists notify_app_task on public.tasks;
create trigger notify_app_task after insert on public.tasks
  for each row when (new.status = 'PENDING') execute function private.notify_app();

drop trigger if exists notify_app_order_new on public.orders;
create trigger notify_app_order_new after insert on public.orders
  for each row when (new.source = 'qr') execute function private.notify_app();

drop trigger if exists notify_app_order_ready on public.orders;
create trigger notify_app_order_ready after update of status on public.orders
  for each row when (new.status = 'READY' and old.status is distinct from 'READY') execute function private.notify_app();

-- Fyll i och kör (byt ut båda värdena):
-- insert into private.app_hook (url, secret) values ('https://app.bordvakt.se', 'SAMMA-SOM-DB_WEBHOOK_SECRET')
--   on conflict (id) do update set url = excluded.url, secret = excluded.secret;
