begin;

-- Multitenant foundation for the isolated JM ServiceTec v3 project.
-- Existing pilot accounts and records are assigned to JM ServiceTec's internal tenant.
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  brand_name text not null default 'JM ServiceTec',
  created_by uuid references public.profiles(id) on delete set null,
  billing_period text not null default 'monthly' check (billing_period in ('monthly','annual')),
  subscription_status text not null default 'pending_payment'
    check (subscription_status in ('internal','trial','pending_payment','active','past_due','suspended','cancelled')),
  price_cop integer check (price_cop is null or price_cop >= 0),
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict,
  add column if not exists is_platform_admin boolean not null default false;

insert into public.tenants(name,slug,brand_name,billing_period,subscription_status)
values ('JM ServiceTec','jm-servicetec','JM ServiceTec','annual','internal')
on conflict (slug) do nothing;

update public.profiles
set tenant_id=(select id from public.tenants where slug='jm-servicetec'),
    is_platform_admin=(role='admin')
where tenant_id is null;

alter table public.events add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.imports add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.people add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.event_operators add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.scans add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.devices add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.scan_metrics add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.audit_log add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.account_pin_invites add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

update public.events e set tenant_id=p.tenant_id from public.profiles p where p.id=e.created_by and e.tenant_id is null;
update public.imports i set tenant_id=p.tenant_id from public.profiles p where p.id=i.imported_by and i.tenant_id is null;
update public.imports set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.people set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.event_operators eo set tenant_id=e.tenant_id from public.events e where e.id=eo.event_id and eo.tenant_id is null;
update public.scans s set tenant_id=e.tenant_id from public.events e where e.id=s.event_id and s.tenant_id is null;
update public.devices d set tenant_id=p.tenant_id from public.profiles p where p.id=d.operator_id and d.tenant_id is null;
update public.scan_metrics m set tenant_id=p.tenant_id from public.profiles p where p.id=m.operator_id and m.tenant_id is null;
update public.account_pin_invites i set tenant_id=p.tenant_id from public.profiles p where p.id=i.created_by and i.tenant_id is null;
update public.audit_log a set tenant_id=e.tenant_id from public.events e
where a.tenant_id is null and a.entity_type='events' and a.entity_id=e.id::text;
update public.audit_log a set tenant_id=s.tenant_id from public.scans s
where a.tenant_id is null and a.entity_type='scans' and a.entity_id=s.id::text;

-- Preserve legacy rows that had no resolvable owner by placing them in the
-- original internal tenant. They remain available for review and are never lost.
update public.events set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.event_operators set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.scans set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.devices set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.scan_metrics set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;
update public.account_pin_invites set tenant_id=(select id from public.tenants where slug='jm-servicetec') where tenant_id is null;

-- Any legacy orphan row that cannot be associated unambiguously remains unassigned;
-- it is retained for recovery but not exposed to customer tenants.
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer
set search_path = '' as $$
  select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.status='active'
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active' and p.is_platform_admin)
$$;

create or replace function public.tenant_subscription_active(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select (p_tenant_id=public.current_tenant_id() or public.is_platform_admin()) and exists(select 1 from public.tenants t where t.id=p_tenant_id and (
    t.subscription_status='internal' or
    (t.subscription_status in ('active','trial') and t.current_period_ends_at > now())
  ))
$$;

create or replace function public.is_active_admin()
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.role='admin' and p.status='active'
      and public.tenant_subscription_active(p.tenant_id)
  )
$$;

create or replace function public.is_active_event_operator(p_event_id uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.event_operators eo on eo.operator_id=p.id
    join public.events e on e.id=eo.event_id
    where p.id=(select auth.uid()) and p.status='active'
      and p.tenant_id=e.tenant_id and eo.tenant_id=e.tenant_id
      and eo.event_id=p_event_id and eo.status='active' and e.status='active'
      and public.tenant_subscription_active(e.tenant_id)
  )
$$;

alter table public.events alter column tenant_id set default public.current_tenant_id();
alter table public.imports alter column tenant_id set default public.current_tenant_id();
alter table public.people alter column tenant_id set default public.current_tenant_id();
alter table public.event_operators alter column tenant_id set default public.current_tenant_id();
alter table public.scans alter column tenant_id set default public.current_tenant_id();
alter table public.devices alter column tenant_id set default public.current_tenant_id();
alter table public.scan_metrics alter column tenant_id set default public.current_tenant_id();
alter table public.audit_log alter column tenant_id set default public.current_tenant_id();

alter table public.profiles alter column tenant_id set not null;
alter table public.events alter column tenant_id set not null;
alter table public.imports alter column tenant_id set not null;
alter table public.people alter column tenant_id set not null;
alter table public.event_operators alter column tenant_id set not null;
alter table public.scans alter column tenant_id set not null;
alter table public.devices alter column tenant_id set not null;
alter table public.scan_metrics alter column tenant_id set not null;
alter table public.account_pin_invites alter column tenant_id set not null;

-- A user/email can belong to one tenant. Each tenant may have its own admin.
drop index if exists public.profiles_one_active_admin_idx;
alter table public.people drop constraint if exists people_document_type_document_number_key;
drop index if exists public.people_document_lookup_idx;
create unique index if not exists people_tenant_document_uq on public.people(tenant_id,document_type,document_number);
create index if not exists people_tenant_document_lookup_idx on public.people(tenant_id,document_type,document_number);
create index if not exists events_tenant_status_idx on public.events(tenant_id,status,starts_at desc);
create index if not exists scans_tenant_event_received_idx on public.scans(tenant_id,event_id,received_at desc);
create index if not exists profiles_tenant_role_idx on public.profiles(tenant_id,role,status);
create index if not exists tenant_subscription_expiry_idx on public.tenants(subscription_status,current_period_ends_at);

-- Tenant-aware RPC guards. Platform admins can administer globally; tenant admins and
-- operators are always constrained to their own tenant.
create or replace function public.lookup_person_for_scan(
  p_event_id uuid, p_document_type text, p_document_number text
)
returns table (
  base_available boolean, found boolean, person_id uuid, display_name text,
  work_site text, municipality text, "position" text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_tenant uuid;
  v_available boolean;
  v_doc text := regexp_replace(trim(p_document_number), '[^0-9]', '', 'g');
  v_doc_type text := upper(trim(p_document_type));
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active') then
    raise exception 'Cuenta no autorizada';
  end if;
  select e.tenant_id into v_tenant from public.events e where e.id=p_event_id and e.status='active';
  if v_tenant is null or v_tenant<>public.current_tenant_id()
     or not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  if not public.is_active_admin() and not exists (
    select 1 from public.scans s where s.event_id=p_event_id and s.operator_id=(select auth.uid())
      and s.tenant_id=v_tenant and s.document_type=v_doc_type
      and regexp_replace(s.document_number,'[^0-9]','','g')=v_doc
  ) then raise exception 'No existe un registro propio para consultar'; end if;
  select exists(select 1 from public.people p where p.tenant_id=v_tenant) into v_available;
  if not v_available then return query select false,false,null::uuid,''::text,''::text,''::text,''::text; return; end if;
  select * into v_person from public.people p where p.tenant_id=v_tenant
    and p.document_type=v_doc_type and regexp_replace(p.document_number,'[^0-9]','','g')=v_doc limit 1;
  if not found then return query select true,false,null::uuid,''::text,''::text,''::text,''::text; return; end if;
  return query select true,true,v_person.id,v_person.display_name,v_person.work_site,v_person.municipality,v_person.position;
end;
$$;

create or replace function public.record_scan(
  p_event_id uuid, p_document_type text, p_document_number text, p_display_name text,
  p_captured_at timestamptz, p_device_id text, p_idempotency_key uuid
)
returns table(scan_id uuid,duplicate boolean,result text,first_received_at timestamptz,display_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_scan public.scans%rowtype;
  v_event public.events%rowtype;
  v_result text;
  v_doc text := regexp_replace(trim(p_document_number),'\s+','','g');
  v_type text := upper(trim(p_document_type));
  v_name text := left(regexp_replace(coalesce(trim(p_display_name),''),'\s+',' ','g'),160);
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active') then raise exception 'Cuenta no autorizada'; end if;
  select * into v_event from public.events e where e.id=p_event_id and e.status='active';
  if v_event.id is null or v_event.tenant_id<>public.current_tenant_id()
     or not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  if not public.tenant_subscription_active(v_event.tenant_id) then raise exception 'La membresía está vencida o inactiva'; end if;
  if v_doc='' or p_idempotency_key is null or v_type not in ('CC','TI','CE','PPT','PEP','NUIP') then raise exception 'Datos del escaneo inválidos'; end if;
  select case when exists(select 1 from public.people p where p.tenant_id=v_event.tenant_id
    and p.document_type=v_type and p.document_number=v_doc) then 'found' else 'not_found' end into v_result;
  begin
    insert into public.scans(tenant_id,event_id,document_type,document_number,display_name,result,captured_at,device_id,operator_id,idempotency_key)
    values(v_event.tenant_id,p_event_id,v_type,v_doc,v_name,v_result,coalesce(p_captured_at,now()),coalesce(p_device_id,''),(select auth.uid()),p_idempotency_key)
    returning * into v_scan;
    return query select v_scan.id,false,v_scan.result,v_scan.received_at,v_scan.display_name;
  exception when unique_violation then
    select * into v_scan from public.scans s where s.tenant_id=v_event.tenant_id and (
      s.idempotency_key=p_idempotency_key
      or (s.event_id=p_event_id and s.document_type=v_type and s.document_number=v_doc))
    order by (s.idempotency_key=p_idempotency_key) desc limit 1;
    if v_scan.id is null then raise; end if;
    return query select v_scan.id,true,v_scan.result,v_scan.received_at,v_scan.display_name;
  end;
end;
$$;

create or replace function public.audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_event_id uuid;
  v_tenant_id uuid;
begin
  v_row := case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_tenant_id := nullif(v_row->>'tenant_id','')::uuid;
  if v_tenant_id is null then
    v_event_id := nullif(v_row->>'event_id','')::uuid;
    if v_event_id is not null then select e.tenant_id into v_tenant_id from public.events e where e.id=v_event_id; end if;
  end if;
  insert into public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,details)
  values(v_tenant_id,(select auth.uid()),TG_OP,TG_TABLE_NAME,coalesce(v_row->>'id',''),jsonb_build_object('source','supabase','table',TG_TABLE_NAME));
  return case when TG_OP='DELETE' then OLD else NEW end;
end;
$$;


create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tenant_id uuid;
begin
  select t.id into v_tenant_id from public.tenants t where t.slug='jm-servicetec';
  insert into public.profiles(id,email,full_name,role,status,tenant_id)
  values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name',''),'operator','active',v_tenant_id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.import_people_directory(p_file_name text,p_rows jsonb)
returns table(import_id uuid,imported_count integer)
language plpgsql security definer set search_path = '' as $$
declare v_import_id uuid; v_count integer; v_tenant uuid := public.current_tenant_id();
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active')
     or not public.is_active_admin() or not public.tenant_subscription_active(v_tenant) then
    raise exception 'Solo un administrador con membresía activa puede cargar la base';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100000 then raise exception 'El archivo no contiene filas válidas o supera el límite'; end if;
  insert into public.imports(tenant_id,file_name,source_format,imported_by,row_count,status)
    values(v_tenant,left(coalesce(p_file_name,'base.csv'),255),'csv',(select auth.uid()),0,'processing') returning id into v_import_id;
  insert into public.people(tenant_id,document_type,document_number,display_name,work_site,municipality,position,import_id,updated_at)
  select v_tenant,upper(coalesce(nullif(trim(x.document_type),''),'CC')),regexp_replace(trim(x.document_number),'[^0-9]','','g'),
    left(coalesce(x.display_name,''),200),left(coalesce(x.work_site,''),200),left(coalesce(x.municipality,''),200),left(coalesce(x.position,''),200),v_import_id,now()
  from jsonb_to_recordset(p_rows) as x(document_type text,document_number text,display_name text,work_site text,municipality text,position text)
  where regexp_replace(coalesce(x.document_number,''),'[^0-9]','','g')<>''
  on conflict (tenant_id,document_type,document_number) do update set display_name=excluded.display_name,
    work_site=excluded.work_site,municipality=excluded.municipality,position=excluded.position,import_id=excluded.import_id,updated_at=now();
  get diagnostics v_count=row_count;
  update public.imports set row_count=v_count,status='completed' where id=v_import_id and tenant_id=v_tenant;
  return query select v_import_id,v_count;
end;
$$;
revoke all privileges on function public.import_people_directory(text,jsonb) from public,anon,authenticated;
grant execute on function public.import_people_directory(text,jsonb) to authenticated;

create or replace function public.register_device(p_device_key text,p_label text default '')
returns public.devices language plpgsql security definer set search_path = '' as $$
declare v public.devices%rowtype; v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.tenant_subscription_active(v_tenant)
     or not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active') then
    raise exception 'Cuenta no autorizada o membresía inactiva';
  end if;
  insert into public.devices(tenant_id,device_key,label,operator_id,last_seen_at)
  values(v_tenant,left(trim(p_device_key),160),left(coalesce(trim(p_label),''),80),(select auth.uid()),now())
  on conflict (device_key) do update set operator_id=excluded.operator_id,last_seen_at=now(),status='active'
    where public.devices.tenant_id=v_tenant
  returning * into v;
  if v.id is null then raise exception 'El dispositivo pertenece a otra empresa'; end if;
  return v;
end;
$$;
revoke all on function public.register_device(text,text) from public,anon;
grant execute on function public.register_device(text,text) to authenticated;

-- Replace broad legacy policies with tenant predicates.
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated
  using (id=(select auth.uid()) or (tenant_id=public.current_tenant_id() and public.is_active_admin()));
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin());
revoke update on public.profiles from authenticated;

drop policy if exists imports_admin_only on public.imports;
create policy imports_tenant_admin on public.imports for all to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin());
drop policy if exists people_admin_only on public.people;
create policy people_tenant_admin on public.people for all to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin());

drop policy if exists events_read_authorized on public.events;
create policy events_tenant_read on public.events for select to authenticated
  using (tenant_id=public.current_tenant_id() and (public.is_active_admin() or public.is_active_event_operator(id)));
drop policy if exists events_admin_manage on public.events;
create policy events_tenant_admin_manage on public.events for all to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin());

drop policy if exists event_operators_admin_manage on public.event_operators;
create policy event_operators_tenant_admin_manage on public.event_operators for all to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin()
    and exists(select 1 from public.events e join public.profiles p on p.id=event_operators.operator_id
      where e.id=event_operators.event_id and e.tenant_id=event_operators.tenant_id
        and p.tenant_id=event_operators.tenant_id));
drop policy if exists event_operators_read_self on public.event_operators;
create policy event_operators_read_self on public.event_operators for select to authenticated
  using (operator_id=(select auth.uid()) and tenant_id=public.current_tenant_id());

drop policy if exists scans_read_authorized on public.scans;
drop policy if exists scans_operator_read_own on public.scans;
drop policy if exists scans_read_own_or_admin on public.scans;
create policy scans_tenant_read on public.scans for select to authenticated
  using (tenant_id=public.current_tenant_id()
    and (public.is_active_admin() or operator_id=(select auth.uid())));
drop policy if exists scans_admin_delete on public.scans;
create policy scans_tenant_admin_delete on public.scans for delete to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin());

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_tenant_admin_read on public.audit_log for select to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin());

drop policy if exists devices_admin_manage on public.devices;
create policy devices_tenant_admin_manage on public.devices for all to authenticated
  using (tenant_id=public.current_tenant_id() and public.is_active_admin())
  with check (tenant_id=public.current_tenant_id() and public.is_active_admin());
drop policy if exists devices_operator_read_own on public.devices;
create policy devices_operator_read_own on public.devices for select to authenticated
  using (operator_id=(select auth.uid()) and tenant_id=public.current_tenant_id());
drop policy if exists metrics_insert_self on public.scan_metrics;
create policy metrics_insert_self on public.scan_metrics for insert to authenticated
  with check (operator_id=(select auth.uid()) and tenant_id=public.current_tenant_id());
drop policy if exists metrics_admin_read on public.scan_metrics;
create policy metrics_tenant_read on public.scan_metrics for select to authenticated
  using (tenant_id=public.current_tenant_id() and (public.is_active_admin() or operator_id=(select auth.uid())));

alter table public.tenants enable row level security;
drop policy if exists tenants_platform_read on public.tenants;
create policy tenants_platform_read on public.tenants for select to authenticated
  using (public.is_platform_admin() or id=public.current_tenant_id());
drop policy if exists tenants_platform_update on public.tenants;
create policy tenants_platform_update on public.tenants for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.tenants from anon, authenticated;
grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;

revoke all on function public.current_tenant_id() from public,anon;
revoke all on function public.is_platform_admin() from public,anon;
revoke all on function public.tenant_subscription_active(uuid) from public,anon;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.tenant_subscription_active(uuid) to authenticated;

revoke all on function public.import_people_directory(text,jsonb) from public,anon;
notify pgrst,'reload schema';
commit;
