-- CedulaScan V2 — esquema inicial para un proyecto Supabase de PRUEBAS.
-- Ejecutar una sola vez en un proyecto nuevo (SQL Editor). No importa docentes.
-- La clave service_role nunca debe incluirse en la APK.

begin;

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('admin', 'operator');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.app_role not null default 'operator',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_one_active_admin_idx
  on public.profiles ((role)) where role = 'admin' and status = 'active';

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '',
  source_format text not null default '',
  imported_by uuid references public.profiles(id) on delete set null,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  document_type text not null default 'CC',
  document_number text not null,
  display_name text not null default '',
  work_site text not null default '',
  municipality text not null default '',
  position text not null default '',
  dues_up_to_date boolean,
  dues_status text not null default '',
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_type, document_number)
);
create index if not exists people_document_lookup_idx
  on public.people (document_type, document_number);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null default now(),
  place text not null default '',
  description text not null default '',
  status text not null default 'active' check (status in ('active','inactive','closed')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_operators (
  event_id uuid not null references public.events(id) on delete cascade,
  operator_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  primary key (event_id, operator_id)
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  document_type text not null default 'CC',
  document_number text not null,
  result text not null check (result in ('found','not_found')),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_id text not null default '',
  operator_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null unique,
  unique (event_id, document_type, document_number)
);
create unique index if not exists scans_one_document_per_event_idx
  on public.scans (event_id, document_type, document_number);
create index if not exists scans_event_received_idx
  on public.scans (event_id, received_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_active_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.is_active_event_operator(p_event_id uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.event_operators eo on eo.operator_id = p.id
    where p.id = (select auth.uid()) and p.status = 'active'
      and eo.event_id = p_event_id and eo.status = 'active'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          'operator', 'active')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.lookup_person_for_scan(
  p_event_id uuid, p_document_type text, p_document_number text
)
returns table (
  found boolean, person_id uuid, display_name text, work_site text,
  municipality text, "position" text, dues_up_to_date boolean, dues_status text
)
language plpgsql stable security definer
set search_path = '' as $$
declare v_person public.people%rowtype;
begin
  if not exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'
  ) then raise exception 'Cuenta no autorizada'; end if;
  if not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  select * into v_person from public.people p
    where p.document_type = upper(trim(p_document_type))
      and p.document_number = regexp_replace(trim(p_document_number), '\s+', '', 'g');
  if not found then
    return query select false, null::uuid, ''::text, ''::text, ''::text,
      ''::text, null::boolean, ''::text;
    return;
  end if;
  return query select true, v_person.id, v_person.display_name, v_person.work_site,
    v_person.municipality, v_person.position, v_person.dues_up_to_date, v_person.dues_status;
end;
$$;

create or replace function public.record_scan(
  p_event_id uuid, p_document_type text, p_document_number text,
  p_captured_at timestamptz, p_device_id text, p_idempotency_key uuid
)
returns table (scan_id uuid, duplicate boolean, result text, first_received_at timestamptz)
language plpgsql security definer
set search_path = '' as $$
declare
  v_scan public.scans%rowtype;
  v_doc text := regexp_replace(trim(p_document_number), '\s+', '', 'g');
  v_result text;
begin
  if not exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active') then
    raise exception 'Cuenta no autorizada';
  end if;
  if not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.status = 'active') then
    raise exception 'La jornada no existe o está inactiva';
  end if;
  if v_doc = '' or p_idempotency_key is null then raise exception 'Datos del escaneo inválidos'; end if;

  select case when exists (select 1 from public.people p
    where p.document_type = upper(trim(p_document_type)) and p.document_number = v_doc)
    then 'found' else 'not_found' end into v_result;

  begin
    insert into public.scans(event_id, document_type, document_number, result,
      captured_at, device_id, operator_id, idempotency_key)
    values (p_event_id, upper(trim(p_document_type)), v_doc, v_result,
      coalesce(p_captured_at, now()), coalesce(p_device_id, ''), (select auth.uid()), p_idempotency_key)
    returning * into v_scan;
    return query select v_scan.id, false, v_scan.result, v_scan.received_at;
  exception when unique_violation then
    select * into v_scan from public.scans s where s.idempotency_key = p_idempotency_key
      or (s.event_id = p_event_id and s.document_type = upper(trim(p_document_type)) and s.document_number = v_doc)
      order by (s.idempotency_key = p_idempotency_key) desc limit 1;
    if v_scan.id is null then raise; end if;
    return query select v_scan.id, true, v_scan.result, v_scan.received_at;
  end;
end;
$$;

alter table public.profiles enable row level security;
alter table public.imports enable row level security;
alter table public.people enable row level security;
alter table public.events enable row level security;
alter table public.event_operators enable row level security;
alter table public.scans enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_active_admin());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists imports_admin_only on public.imports;
create policy imports_admin_only on public.imports for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());
drop policy if exists people_admin_only on public.people;
create policy people_admin_only on public.people for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists events_read_authorized on public.events;
create policy events_read_authorized on public.events for select to authenticated
  using (public.is_active_admin() or public.is_active_event_operator(id));
drop policy if exists events_admin_manage on public.events;
create policy events_admin_manage on public.events for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists event_operators_admin_manage on public.event_operators;
create policy event_operators_admin_manage on public.event_operators for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());
drop policy if exists event_operators_read_self on public.event_operators;
create policy event_operators_read_self on public.event_operators for select to authenticated
  using (operator_id = (select auth.uid()));

drop policy if exists scans_read_authorized on public.scans;
create policy scans_read_authorized on public.scans for select to authenticated
  using (public.is_active_admin() or public.is_active_event_operator(event_id));
drop policy if exists scans_admin_delete on public.scans;
create policy scans_admin_delete on public.scans for delete to authenticated
  using (public.is_active_admin());

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated
  using (public.is_active_admin());

revoke all on function public.is_active_admin() from public, anon;
revoke all on function public.is_active_event_operator(uuid) from public, anon;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.lookup_person_for_scan(uuid,text,text) from public, anon;
revoke all on function public.record_scan(uuid,text,text,timestamptz,text,uuid) from public, anon;
grant execute on function public.is_active_admin() to authenticated;
grant execute on function public.is_active_event_operator(uuid) to authenticated;
grant execute on function public.lookup_person_for_scan(uuid,text,text) to authenticated;
grant execute on function public.record_scan(uuid,text,text,timestamptz,text,uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object then null;
  when undefined_object then raise notice 'Publicación supabase_realtime no encontrada; Realtime queda pendiente de activar.';
end $$;

notify pgrst, 'reload schema';
commit;
