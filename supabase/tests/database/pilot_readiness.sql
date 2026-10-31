-- Read-only checklist. Run after core migration and pilot_test_data.sql.
-- If you changed the fixture account emails, replace them below as well.
-- Returns one row per check; any false result blocks pilot testing.
with checks as (
  select 'RLS activado en people'::text as check_name,
    (select relrowsecurity from pg_class where oid = 'public.people'::regclass) as passed
  union all select 'RLS activado en events',
    (select relrowsecurity from pg_class where oid = 'public.events'::regclass)
  union all select 'RLS activado en scans',
    (select relrowsecurity from pg_class where oid = 'public.scans'::regclass)
  union all select 'RPC lookup instalada',
    to_regprocedure('public.lookup_person_for_scan(uuid,text,text)') is not null
  union all select 'RPC record_scan instalada',
    to_regprocedure('public.record_scan(uuid,text,text,text,timestamptz,text,uuid)') is not null
  union all select 'Clave única por evento/documento',
    exists (select 1 from pg_indexes where schemaname='public' and indexname='scans_one_document_per_event_idx')
  union all select 'Admin de prueba activo',
    exists (select 1 from public.profiles where lower(email)='admin-pruebas@example.test' and role='admin' and status='active')
  union all select 'Operador de prueba activo',
    exists (select 1 from public.profiles where lower(email)='operador-pruebas@example.test' and role='operator' and status='active')
  union all select 'Jornada ficticia activa',
    exists (select 1 from public.events where name='Jornada piloto ficticia' and status='active')
  union all select 'Operador asignado a jornada',
    exists (select 1 from public.event_operators eo join public.events e on e.id=eo.event_id
      join public.profiles p on p.id=eo.operator_id
      where e.name='Jornada piloto ficticia' and lower(p.email)='operador-pruebas@example.test' and eo.status='active')
  union all select 'Fixture de aportes al día',
    exists (select 1 from public.people where document_type='CC' and document_number='990000001' and dues_up_to_date is true)
  union all select 'Fixture de aportes no al día',
    exists (select 1 from public.people where document_type='CC' and document_number='990000002' and dues_up_to_date is false)
  union all select 'Operadores sin lectura directa de people',
    not exists (select 1 from pg_policies where schemaname='public' and tablename='people'
      and cmd in ('SELECT','ALL') and roles @> array['authenticated']::name[]
      and (qual ilike '%operator%' or qual is null or qual = 'true'))
)
select check_name, coalesce(passed, false) as passed from checks order by check_name;
