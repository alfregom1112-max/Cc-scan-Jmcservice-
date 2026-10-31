begin;

-- RLS remains the row filter; these grants also remove unnecessary API verbs.
revoke all privileges on all tables in schema public from anon, authenticated;

-- Keep only the direct reads/writes used by the mobile client. RLS policies
-- continue to restrict each operation to the active user's permitted rows.
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.event_operators to authenticated;
grant select, delete on public.scans to authenticated;
grant select on public.audit_log to authenticated;

-- The app's directory screen needs these basic fields only. Legacy dues fields
-- are deliberately not selectable through PostgREST by any signed-in client.
grant select (id, document_type, document_number, display_name, work_site, municipality, "position")
  on public.people to authenticated;

-- Imports, PINs, device records and scan metrics are accessed only by guarded
-- server-side functions/service role, never through the public client API.
revoke all privileges on public.imports, public.account_pin_invites,
  public.devices, public.scan_metrics from anon, authenticated;

-- Explicit default-deny policy documents the intended client isolation for PINs.
drop policy if exists account_pin_invites_deny_client on public.account_pin_invites;
create policy account_pin_invites_deny_client on public.account_pin_invites
  for all to anon, authenticated using (false) with check (false);

notify pgrst, 'reload schema';
commit;
