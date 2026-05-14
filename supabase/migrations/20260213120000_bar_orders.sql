-- Bar orders: live view for bar prep. Run in Supabase SQL editor or via CLI migrate.
-- If `alter publication` fails, enable the table manually: Database → Replication → bar_orders

create table if not exists public.bar_orders (
  id uuid primary key default gen_random_uuid(),
  tab_name text not null,
  items jsonb not null default '[]'::jsonb,
  total numeric(12, 2) not null default 0,
  staff_name text,
  sent_at timestamptz not null default now(),
  status text not null default 'pending',
  session_date date not null default (current_date),
  archived boolean not null default false,
  constraint bar_orders_status_check check (status in ('pending', 'underway', 'complete'))
);

create index if not exists bar_orders_session_archived_sent_idx
  on public.bar_orders (session_date, archived, sent_at desc);

alter table public.bar_orders enable row level security;

drop policy if exists "bar_orders_anon_all" on public.bar_orders;
create policy "bar_orders_anon_all" on public.bar_orders
  for all using (true) with check (true);

alter publication supabase_realtime add table bar_orders;
