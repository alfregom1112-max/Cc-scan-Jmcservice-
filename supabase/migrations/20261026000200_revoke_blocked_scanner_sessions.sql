-- Realtime lets the APK stop a blocked operator's active scanner immediately.
-- RLS on profiles continues to limit the row visible to the signed-in user.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

notify pgrst, 'reload schema';
