-- Preserve the name read from the physical ID alongside every scan.
alter table public.scans add column if not exists display_name text not null default '';

create or replace function public.record_scan(
  p_event_id uuid, p_document_type text, p_document_number text,
  p_display_name text, p_captured_at timestamptz, p_device_id text, p_idempotency_key uuid
)
returns table (scan_id uuid, duplicate boolean, result text, first_received_at timestamptz, display_name text)
language plpgsql security definer
set search_path = '' as $$
declare
  v_scan public.scans%rowtype;
  v_doc text := regexp_replace(trim(p_document_number), '\\s+', '', 'g');
  v_name text := left(regexp_replace(coalesce(trim(p_display_name), ''), '\\s+', ' ', 'g'), 160);
  v_result text;
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active') then
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
    insert into public.scans(event_id, document_type, document_number, display_name, result,
      captured_at, device_id, operator_id, idempotency_key)
    values (p_event_id, upper(trim(p_document_type)), v_doc, v_name, v_result,
      coalesce(p_captured_at, now()), coalesce(p_device_id, ''), (select auth.uid()), p_idempotency_key)
    returning * into v_scan;
    return query select v_scan.id, false, v_scan.result, v_scan.received_at, v_scan.display_name;
  exception when unique_violation then
    select * into v_scan from public.scans s where s.idempotency_key = p_idempotency_key
      or (s.event_id = p_event_id and s.document_type = upper(trim(p_document_type)) and s.document_number = v_doc)
      order by (s.idempotency_key = p_idempotency_key) desc limit 1;
    if v_scan.id is null then raise; end if;
    return query select v_scan.id, true, v_scan.result, v_scan.received_at, v_scan.display_name;
  end;
end;
$$;

revoke all on function public.record_scan(uuid,text,text,text,timestamptz,text,uuid) from public, anon;
grant execute on function public.record_scan(uuid,text,text,text,timestamptz,text,uuid) to authenticated;
notify pgrst, 'reload schema';
