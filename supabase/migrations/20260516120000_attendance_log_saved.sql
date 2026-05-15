-- Mark ended shifts + realtime for attendance_log

alter table public.attendance_log
  add column if not exists saved boolean not null default false;

do $$
declare
  t text := 'attendance_log';
begin
  if to_regclass('public.attendance_log') is null then
    raise notice 'public.attendance_log missing — skip realtime publication';
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
