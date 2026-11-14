-- 021: AI:n lär sig hur länge gästerna sitter efter maten (Väntar på notan).
-- AI-motorn sparar för varje sittning när maten plockades bort och när notan kom
-- (personalen tryckte Klar på notan, eller beställningarna betalades i appen).
-- Kör efter 012_growth.sql. Utan den här filen använder AI:n fasta 7 minuter som förut.

alter table public.table_sessions add column if not exists cleared_at timestamptz;
alter table public.table_sessions add column if not exists bill_at timestamptz;
