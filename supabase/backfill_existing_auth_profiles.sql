-- Run this in the Supabase SQL Editor AFTER applying
-- migrations/20261016000100_cedulascan_core.sql.
-- Creates operator profiles only for existing Auth users that do not yet have
-- a profile. Existing profile roles/statuses are never overwritten.
insert into public.profiles (id, email, full_name, role, status)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  'operator'::public.app_role,
  'active'::public.account_status
from auth.users as u
where u.email is not null
  and not exists (
    select 1 from public.profiles as p where p.id = u.id
  )
on conflict (id) do nothing;

-- Ensure PostgREST sees the newly created table/columns immediately.
notify pgrst, 'reload schema';
