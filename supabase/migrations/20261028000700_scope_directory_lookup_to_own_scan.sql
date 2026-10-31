begin;

create or replace function public.lookup_person_for_scan(
  p_event_id uuid, p_document_type text, p_document_number text
)
returns table (
  base_available boolean, found boolean, person_id uuid, display_name text,
  work_site text, municipality text, "position" text
)
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_available boolean;
  v_doc text := regexp_replace(trim(p_document_number), '[^0-9]', '', 'g');
  v_doc_type text := upper(trim(p_document_type));
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active') then
    raise exception 'Cuenta no autorizada';
  end if;
  if not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  -- Operators may only resolve a directory match after their own scan exists.
  -- This prevents using the RPC as a directory-enumeration endpoint.
  if not public.is_active_admin() and not exists (
    select 1 from public.scans s
    where s.event_id = p_event_id
      and s.operator_id = (select auth.uid())
      and s.document_type = v_doc_type
      and regexp_replace(s.document_number, '[^0-9]', '', 'g') = v_doc
  ) then
    raise exception 'No existe un registro propio para consultar';
  end if;
  select exists(select 1 from public.people) into v_available;
  if not v_available then
    return query select false, false, null::uuid, ''::text, ''::text, ''::text, ''::text;
    return;
  end if;
  select * into v_person from public.people p
  where p.document_type = v_doc_type
    and regexp_replace(p.document_number, '[^0-9]', '', 'g') = v_doc
  limit 1;
  if not found then
    return query select true, false, null::uuid, ''::text, ''::text, ''::text, ''::text;
    return;
  end if;
  return query select true, true, v_person.id, v_person.display_name, v_person.work_site, v_person.municipality, v_person.position;
end;
$$;

revoke all privileges on function public.lookup_person_for_scan(uuid,text,text) from public, anon, authenticated;
grant execute on function public.lookup_person_for_scan(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
