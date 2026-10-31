begin;

-- The mobile attendance app no longer checks the optional people directory.
-- Keep its schema/data for a future customer-specific feature, but deny client RPC access.
revoke all on function public.lookup_person_for_scan(uuid, text, text)
  from public, anon, authenticated;

commit;
