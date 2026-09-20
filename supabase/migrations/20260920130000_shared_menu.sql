-- Shared menu: products, variants (stock links), stock item definitions and categories now live in
-- Supabase so every till/PC sees the same menu. Run in the Supabase SQL editor for the gingerbread-till project.
-- Rollback: drop table public.menu_products; drop table public.menu_categories;
--           alter table public.stock_items drop column name, drop column category, drop column unit,
--             drop column display_unit, drop column data;

-- One row per till product. `variant` is that product's stock-link config (null if none);
-- `data` holds any other product fields (portionSize, bottleYield, ...).
create table if not exists public.menu_products (
  id integer primary key,
  name text not null,
  price numeric(10, 2) not null default 0,
  category text,
  data jsonb not null default '{}'::jsonb,
  variant jsonb
);

create table if not exists public.menu_categories (
  kind text not null check (kind in ('till', 'stock')),
  name text not null,
  primary key (kind, name)
);

-- Stock item definitions extend the existing stock_items table (qty stays as is).
alter table public.stock_items add column if not exists name text;
alter table public.stock_items add column if not exists category text;
alter table public.stock_items add column if not exists unit text;
alter table public.stock_items add column if not exists display_unit text;
alter table public.stock_items add column if not exists data jsonb not null default '{}'::jsonb;

alter table public.menu_products enable row level security;
alter table public.menu_categories enable row level security;
-- Fast-start "allow all" (same as the other tables) — needs scoping before this app is sold to outside customers.
drop policy if exists "Allow all" on public.menu_products;
create policy "Allow all" on public.menu_products for all using (true) with check (true);
drop policy if exists "Allow all" on public.menu_categories;
create policy "Allow all" on public.menu_categories for all using (true) with check (true);

alter table public.menu_products replica identity full;
alter table public.menu_categories replica identity full;
alter table public.stock_items replica identity full;

alter publication supabase_realtime add table public.menu_products;
alter publication supabase_realtime add table public.menu_categories;
