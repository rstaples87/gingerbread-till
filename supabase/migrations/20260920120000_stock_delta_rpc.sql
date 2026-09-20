-- Atomic stock adjustments so two tills can't overwrite each other's counts.
-- Clients send a delta (+/-) instead of an absolute qty. p_op_id makes replays of an
-- offline-queued adjustment idempotent (same op applied at most once).
-- Rollback: drop function public.adjust_till_stock(integer, numeric, uuid);
--           drop function public.adjust_stock_item(text, numeric, uuid);
--           drop table public.stock_ops;

create table if not exists public.stock_ops (
  op_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.stock_ops enable row level security; -- no policies: only the functions below touch it

create or replace function public.adjust_till_stock(p_product_id integer, p_delta numeric, p_op_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_qty numeric;
begin
  insert into public.stock_ops (op_id) values (p_op_id) on conflict (op_id) do nothing;
  if not found then
    select qty into new_qty from public.till_stock where product_id = p_product_id;
    return new_qty; -- already applied
  end if;
  insert into public.till_stock (product_id, qty)
  values (p_product_id, greatest(0, p_delta))
  on conflict (product_id) do update
    set qty = greatest(0, coalesce(public.till_stock.qty, 0) + p_delta)
  returning qty into new_qty;
  return new_qty;
end;
$$;

create or replace function public.adjust_stock_item(p_stock_key text, p_delta numeric, p_op_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_qty numeric;
begin
  insert into public.stock_ops (op_id) values (p_op_id) on conflict (op_id) do nothing;
  if not found then
    select qty into new_qty from public.stock_items where stock_key = p_stock_key;
    return new_qty; -- already applied
  end if;
  insert into public.stock_items (stock_key, qty)
  values (p_stock_key, greatest(0, p_delta))
  on conflict (stock_key) do update
    set qty = greatest(0, coalesce(public.stock_items.qty, 0) + p_delta)
  returning qty into new_qty;
  return new_qty;
end;
$$;

grant execute on function public.adjust_till_stock(integer, numeric, uuid) to anon, authenticated;
grant execute on function public.adjust_stock_item(text, numeric, uuid) to anon, authenticated;
