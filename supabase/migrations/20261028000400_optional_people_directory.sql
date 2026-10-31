begin;

-- Directory lookup is optional and returns only basic identity metadata.
drop function if exists public.lookup_person_for_scan(uuid, text, text);
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
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active') then
    raise exception 'Cuenta no autorizada';
  end if;
  if not (public.is_active_admin() or public.is_active_event_operator(p_event_id)) then
    raise exception 'No tienes acceso a esta jornada';
  end if;
  select exists(select 1 from public.people) into v_available;
  if not v_available then
    return query select false, false, null::uuid, ''::text, ''::text, ''::text, ''::text;
    return;
  end if;
  select * into v_person from public.people p
  where p.document_type = upper(trim(p_document_type))
    and regexp_replace(p.document_number, '\s+', '', 'g') = regexp_replace(trim(p_document_number), '\s+', '', 'g')
  limit 1;
  if not found then
    return query select true, false, null::uuid, ''::text, ''::text, ''::text, ''::text;
    return;
  end if;
  return query select true, true, v_person.id, v_person.display_name, v_person.work_site, v_person.municipality, v_person.position;
end;
$$;

create or replace function public.import_people_directory(p_file_name text, p_rows jsonb)
returns table(import_id uuid, imported_count integer)
language plpgsql security definer
set search_path = '' as $$
declare
  v_import_id uuid;
  v_count integer;
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
     or not public.is_active_admin() then
    raise exception 'Solo un administrador activo puede cargar la base';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100000 then
    raise exception 'El archivo no contiene filas válidas o supera el límite';
  end if;
  insert into public.imports(file_name, source_format, imported_by, row_count, status)
  values (left(coalesce(p_file_name, 'base.csv'), 255), 'csv', (select auth.uid()), 0, 'processing')
  returning id into v_import_id;
  insert into public.people(document_type, document_number, display_name, work_site, municipality, position, import_id, updated_at)
  select upper(coalesce(nullif(trim(x.document_type), ''), 'CC')),
         regexp_replace(trim(x.document_number), '[^0-9]', '', 'g'),
         left(coalesce(x.display_name, ''), 200), left(coalesce(x.work_site, ''), 200),
         left(coalesce(x.municipality, ''), 200), left(coalesce(x.position, ''), 200), v_import_id, now()
  from jsonb_to_recordset(p_rows) as x(document_type text, document_number text, display_name text, work_site text, municipality text, position text)
  where regexp_replace(coalesce(x.document_number, ''), '[^0-9]', '', 'g') <> ''
  on conflict (document_type, document_number) do update set
    display_name = excluded.display_name, work_site = excluded.work_site,
    municipality = excluded.municipality, position = excluded.position,
    import_id = excluded.import_id, updated_at = now();
  get diagnostics v_count = row_count;
  update public.imports set row_count = v_count, status = 'completed' where id = v_import_id;
  return query select v_import_id, v_count;
end;
$$;

revoke all on function public.lookup_person_for_scan(uuid,text,text) from public, anon, authenticated;
grant execute on function public.lookup_person_for_scan(uuid,text,text) to authenticated;
revoke all on function public.import_people_directory(text,jsonb) from public, anon, authenticated;
grant execute on function public.import_people_directory(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
