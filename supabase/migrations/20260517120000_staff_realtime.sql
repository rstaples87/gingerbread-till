-- Realtime for staff list (add/remove/PIN sync across devices)

do $$
declare
  t text := 'staff';
begin
  if to_regclass('public.staff') is null then
    raise notice 'public.staff missing — skip realtime publication';
    return;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = t
  ) then
    return;
  end if;
  execute format('alter publication supabase_realtime add table public.%I', t);
end $$;
