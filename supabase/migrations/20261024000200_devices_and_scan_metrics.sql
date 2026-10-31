-- Supabase-only device control and privacy-safe scan metrics.
begin;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  label text not null default '',
  operator_id uuid not null references public.profiles(id) on delete cascade,
  status public.account_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists devices_operator_idx on public.devices(operator_id, status);
alter table public.devices enable row level security;
drop policy if exists devices_admin_manage on public.devices;
create policy devices_admin_manage on public.devices for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());
drop policy if exists devices_operator_read_own on public.devices;
create policy devices_operator_read_own on public.devices for select to authenticated
  using (operator_id = (select auth.uid()));

create table if not exists public.scan_metrics (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null default '',
  format text not null default '',
  result text not null default '',
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists scan_metrics_operator_created_idx on public.scan_metrics(operator_id, created_at desc);
alter table public.scan_metrics enable row level security;
drop policy if exists metrics_insert_self on public.scan_metrics;
create policy metrics_insert_self on public.scan_metrics for insert to authenticated
  with check (operator_id = (select auth.uid()));
drop policy if exists metrics_admin_read on public.scan_metrics;
create policy metrics_admin_read on public.scan_metrics for select to authenticated
  using (public.is_active_admin() or operator_id = (select auth.uid()));

create or replace function public.register_device(p_device_key text, p_label text default '')
returns public.devices language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Cuenta no autorizada'; end if;
  insert into public.devices(device_key, label, operator_id, last_seen_at)
  values (left(trim(p_device_key), 160), left(coalesce(trim(p_label), ''), 80), (select auth.uid()), now())
  on conflict (device_key) do update set operator_id = excluded.operator_id, last_seen_at = now(), status = 'active'
  returning * into v;
  return v;
end;
$$;
revoke all on function public.register_device(text,text) from public, anon;
grant execute on function public.register_device(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
