create table if not exists public.splitledger_state (
  room_id text primary key,
  users jsonb not null default '[]'::jsonb,
  transactions jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  reminders jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.splitledger_state enable row level security;
create policy "Anyone with the app link can read" on public.splitledger_state for select using (true);
create policy "Anyone with the app link can create" on public.splitledger_state for insert with check (true);
create policy "Anyone with the app link can update" on public.splitledger_state for update using (true) with check (true);

alter table public.splitledger_state replica identity full;
-- In Supabase Dashboard: Database > Replication, enable this table for realtime.
