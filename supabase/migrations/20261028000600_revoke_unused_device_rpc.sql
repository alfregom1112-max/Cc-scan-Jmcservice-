begin;

-- The current APK does not call register_device; device rows stay server-owned.
revoke all privileges on function public.register_device(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
