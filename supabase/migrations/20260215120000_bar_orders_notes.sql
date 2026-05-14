-- Optional note shown on Bar Display System cards
alter table public.bar_orders add column if not exists notes text;
