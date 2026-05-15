-- Open tabs synced across devices + realtime publication for core till tables.
-- Skips ADD TABLE if the relation is already in supabase_realtime (safe re-run).

create table if not exists public.tabs (
  id text primary key,
  name text not null default '',
  items jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  staff text,
  tab_limit numeric(12, 2)
);

alter table public.tabs enable row level security;

drop policy if exists "tabs_anon_all" on public.tabs;
create policy "tabs_anon_all" on public.tabs
  for all using (true) with check (true);

do $$
declare
  t text;
begin
  foreach t in array['tabs', 'transactions', 'till_stock', 'stock_items']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      continue;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;
