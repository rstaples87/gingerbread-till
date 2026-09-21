-- Gingerbread POS: full database schema for a NEW Supabase project (the Haywain POS).
-- Rebuilt from the live Gingerbread Till database on 2026-09-21, including its signed-in-only rules.
-- Run once in the SQL editor of the new project. Safe to re-run.
-- Signed-in-only rule: every table allows only signed-in (authenticated) devices; the public key alone gets nothing.

create table if not exists public.attendance_log (
  id uuid not null default gen_random_uuid() primary key,
  staff_name text not null,
  action text not null,
  time timestamptz not null,
  created_at timestamptz default now(),
  saved boolean default false
);

create table if not exists public.bar_orders (
  id uuid not null default gen_random_uuid() primary key,
  tab_name text,
  items jsonb,
  total numeric,
  staff_name text,
  sent_at timestamptz default now(),
  status text default 'pending',
  session_date date default current_date,
  archived boolean default false,
  notes text
);
create index if not exists bar_orders_session_archived_sent_idx on public.bar_orders (session_date, archived, sent_at desc);

create table if not exists public.eod_reports (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  session_date date not null,
  report_data jsonb not null
);

create table if not exists public.menu_categories (
  kind text not null check (kind in ('till', 'stock')),
  name text not null,
  primary key (kind, name)
);

create table if not exists public.menu_products (
  id integer not null primary key,
  name text not null,
  price numeric(10, 2) not null default 0,
  category text,
  data jsonb not null default '{}'::jsonb,
  variant jsonb
);

create table if not exists public.staff (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  pin text not null default '0000',
  role text not null default 'staff',
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.stock_items (
  stock_key text not null primary key,
  qty numeric default 0,
  name text,
  category text,
  unit text,
  display_unit text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.stock_ops (
  op_id uuid not null primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.tabs (
  id text not null primary key,
  name text not null,
  items jsonb default '[]'::jsonb,
  opened_at timestamptz not null,
  staff_name text,
  tab_limit numeric default 500,
  settled boolean default false,
  created_at timestamptz default now(),
  staff text
);

create table if not exists public.till_stock (
  product_id integer not null primary key,
  qty numeric default 0
);

create table if not exists public.transactions (
  id bigint not null primary key,
  time timestamptz not null,
  total numeric not null,
  items jsonb not null,
  payment text not null,
  staff_name text,
  type text default 'sale',
  tab_name text,
  voided boolean default false,
  voided_at timestamptz,
  tendered_amount numeric,
  change_given numeric,
  created_at timestamptz default now(),
  session_date date
);
create index if not exists transactions_session_date_idx on public.transactions (session_date);

-- Atomic stock changes (two tills can't overwrite each other); op_id makes replays idempotent.
create or replace function public.adjust_till_stock(p_product_id integer, p_delta numeric, p_op_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare new_qty numeric;
begin
  insert into public.stock_ops (op_id) values (p_op_id) on conflict (op_id) do nothing;
  if not found then
    select qty into new_qty from public.till_stock where product_id = p_product_id;
    return new_qty;
  end if;
  insert into public.till_stock (product_id, qty) values (p_product_id, greatest(0, p_delta))
  on conflict (product_id) do update
    set qty = greatest(0, coalesce(public.till_stock.qty, 0) + p_delta)
  returning qty into new_qty;
  return new_qty;
end; $$;

create or replace function public.adjust_stock_item(p_stock_key text, p_delta numeric, p_op_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare new_qty numeric;
begin
  insert into public.stock_ops (op_id) values (p_op_id) on conflict (op_id) do nothing;
  if not found then
    select qty into new_qty from public.stock_items where stock_key = p_stock_key;
    return new_qty;
  end if;
  insert into public.stock_items (stock_key, qty) values (p_stock_key, greatest(0, p_delta))
  on conflict (stock_key) do update
    set qty = greatest(0, coalesce(public.stock_items.qty, 0) + p_delta)
  returning qty into new_qty;
  return new_qty;
end; $$;

revoke execute on function public.adjust_till_stock(integer, numeric, uuid) from public, anon;
revoke execute on function public.adjust_stock_item(text, numeric, uuid) from public, anon;
grant execute on function public.adjust_till_stock(integer, numeric, uuid) to authenticated;
grant execute on function public.adjust_stock_item(text, numeric, uuid) to authenticated;

-- Signed-in-only access, replica identity and realtime for every app table.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['staff','stock_items','till_stock','transactions','tabs',
    'attendance_log','bar_orders','eod_reports','menu_products','menu_categories']
  loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy "venue_signed_in" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('alter table public.%I replica identity full', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- stock_ops is only touched by the two functions above (no policy = no direct access).
alter table public.stock_ops enable row level security;

-- Food options (added 2026-09-21): shared option groups such as "Steak cooking" that dishes can use.
create table if not exists public.menu_option_groups (
  id text not null primary key,
  name text not null,
  required boolean not null default true,
  choices jsonb not null default '[]'::jsonb
);
alter table public.menu_option_groups enable row level security;
drop policy if exists "venue_signed_in" on public.menu_option_groups;
create policy "venue_signed_in" on public.menu_option_groups for all to authenticated using (true) with check (true);
alter table public.menu_option_groups replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_option_groups') then
    alter publication supabase_realtime add table public.menu_option_groups;
  end if;
end $$;

-- Table plan and covers (added 2026-09-21).
create table if not exists public.floor_areas (
  id text not null primary key,
  name text not null,
  sort integer not null default 0
);
create table if not exists public.floor_tables (
  id text not null primary key,
  area_id text not null,
  name text not null,
  seats integer,
  sort integer not null default 0
);
alter table public.tabs add column if not exists table_id text;
alter table public.tabs add column if not exists covers integer;
alter table public.transactions add column if not exists covers integer;
do $$
declare
  t text;
begin
  foreach t in array array['floor_areas','floor_tables']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "venue_signed_in" on public.%I', t);
    execute format('create policy "venue_signed_in" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('alter table public.%I replica identity full', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- Haywain layout seed: areas The Haywain (1-14), The Hop Room (15-39), The Milling Room (2 tables), Garden (empty).
insert into public.floor_areas (id, name, sort) values
  ('area_haywain', 'The Haywain', 1), ('area_hop', 'The Hop Room', 2),
  ('area_milling', 'The Milling Room', 3), ('area_garden', 'Garden', 4)
on conflict (id) do nothing;
insert into public.floor_tables (id, area_id, name, seats, sort)
select 't_' || n, 'area_haywain', n::text, null, n from generate_series(1, 14) as n on conflict (id) do nothing;
insert into public.floor_tables (id, area_id, name, seats, sort)
select 't_' || n, 'area_hop', n::text, null, n from generate_series(15, 39) as n on conflict (id) do nothing;
insert into public.floor_tables (id, area_id, name, seats, sort) values
  ('t_milling_1', 'area_milling', 'Milling Room 1', 12, 1), ('t_milling_2', 'area_milling', 'Milling Room 2', 6, 2)
on conflict (id) do nothing;

-- Kitchen / bar display stations (added 2026-09-21): food tickets go to 'kitchen', drinks to 'bar'.
alter table public.bar_orders add column if not exists station text not null default 'bar';
alter table public.bar_orders add column if not exists covers integer;
create index if not exists bar_orders_station_idx on public.bar_orders (station, session_date, archived);

-- Floor plan layout (added 2026-09-21): position/size in a 100 x 75 unit canvas, and shape.
alter table public.floor_tables add column if not exists x numeric;
alter table public.floor_tables add column if not exists y numeric;
alter table public.floor_tables add column if not exists w numeric;
alter table public.floor_tables add column if not exists h numeric;
alter table public.floor_tables add column if not exists shape text;

-- Floor plan walls and structures (added 2026-09-21).
create table if not exists public.floor_shapes (
  id text not null primary key,
  area_id text not null,
  x numeric not null default 0,
  y numeric not null default 0,
  w numeric not null default 10,
  h numeric not null default 3,
  label text,
  style text not null default 'wall'
);
alter table public.floor_shapes enable row level security;
drop policy if exists "venue_signed_in" on public.floor_shapes;
create policy "venue_signed_in" on public.floor_shapes for all to authenticated using (true) with check (true);
alter table public.floor_shapes replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'floor_shapes') then
    alter publication supabase_realtime add table public.floor_shapes;
  end if;
end $$;

-- Rotation (degrees clockwise) for tables and walls (added 2026-09-21).
alter table public.floor_tables add column if not exists rot numeric not null default 0;
alter table public.floor_shapes add column if not exists rot numeric not null default 0;
