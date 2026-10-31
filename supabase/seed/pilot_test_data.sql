-- CedulaScan V2 — fixture for an isolated TEST Supabase project only.
-- 1) Create/invite these two test users in Supabase Auth first.
-- 2) Replace both example.test emails below with those exact test emails.
-- 3) Change the guard to true only after verifying the Dashboard project ref.
-- Never run this against production or use real people/documents.

do $$
declare
  v_confirm_test_environment boolean := false; -- explicit safety gate
  v_admin_email text := 'admin-pruebas@example.test';
  v_operator_email text := 'operador-pruebas@example.test';
  v_admin_id uuid;
  v_operator_id uuid;
  v_event_id uuid;
  v_tenant_id uuid;
begin
  if not v_confirm_test_environment then
    raise exception 'Detenido: confirma que es un proyecto de PRUEBAS y cambia v_confirm_test_environment a true.';
  end if;
  if v_admin_email like '%example.test' or v_operator_email like '%example.test' then
    raise exception 'Reemplaza los correos de ejemplo por los dos usuarios de prueba creados en Auth.';
  end if;

  select id into v_admin_id from public.profiles where lower(email) = lower(v_admin_email);
  select id into v_operator_id from public.profiles where lower(email) = lower(v_operator_email);
  if v_admin_id is null or v_operator_id is null then
    raise exception 'No se encontraron ambos perfiles; crea/invita las cuentas primero y verifica el trigger de profiles.';
  end if;
  if v_admin_id = v_operator_id then
    raise exception 'Admin y operador deben ser cuentas de prueba distintas.';
  end if;
  select tenant_id into v_tenant_id from public.profiles where id = v_admin_id;
  if v_tenant_id is null or (select tenant_id from public.profiles where id = v_operator_id) <> v_tenant_id then
    raise exception 'Los dos usuarios de prueba deben pertenecer al mismo tenant de pruebas.';
  end if;
  if exists (select 1 from public.profiles where role = 'admin' and status = 'active' and id <> v_admin_id) then
    raise exception 'Ya existe otro administrador activo; no se cambió ningún rol.';
  end if;

  update public.profiles set role = 'admin', status = 'active', is_platform_admin = true
    where id = v_admin_id;
  update public.profiles set role = 'operator', status = 'active', is_platform_admin = false
    where id = v_operator_id;

  select id into v_event_id from public.events
    where name = 'Jornada piloto ficticia' and created_by = v_admin_id
    order by created_at desc limit 1;
  if v_event_id is null then
    insert into public.events (name, starts_at, status, place, description, created_by, tenant_id)
    values ('Jornada piloto ficticia', now(), 'active', 'Lugar de prueba',
            'Fixture sintético; no usar para asistencia real.', v_admin_id, v_tenant_id)
    returning id into v_event_id;
  else
    update public.events set status = 'active', tenant_id = v_tenant_id where id = v_event_id;
  end if;

  insert into public.event_operators (event_id, operator_id, assigned_by, tenant_id)
  values (v_event_id, v_operator_id, v_admin_id, v_tenant_id)
  on conflict (event_id, operator_id) do update set status = 'active', assigned_by = excluded.assigned_by, tenant_id = excluded.tenant_id;

  insert into public.people
    (tenant_id, document_type, document_number, display_name, work_site, municipality,
     position, dues_up_to_date, dues_status)
  values (v_tenant_id, 'CC', '990000001', 'DOCENTE DE PRUEBA', 'SEDE FICTICIA',
          'MUNICIPIO DE PRUEBA', 'DOCENTE', true, 'Al día'),
         (v_tenant_id, 'CC', '990000002', 'DOCENTE DE PRUEBA DOS', 'SEDE FICTICIA',
          'MUNICIPIO DE PRUEBA', 'DOCENTE', false, 'No al día')
  on conflict (tenant_id, document_type, document_number) do update set
    display_name = excluded.display_name,
    work_site = excluded.work_site,
    municipality = excluded.municipality,
    position = excluded.position,
    dues_up_to_date = excluded.dues_up_to_date,
    dues_status = excluded.dues_status,
    updated_at = now();

  raise notice 'Fixture creada: evento %, admin %, operador %', v_event_id, v_admin_id, v_operator_id;
end;
$$;
