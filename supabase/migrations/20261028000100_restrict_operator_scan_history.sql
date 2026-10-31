begin;

-- Operators may read only their own scans; active administrators retain full access.
drop policy if exists scans_read_authorized on public.scans;
drop policy if exists scans_operator_read_own on public.scans;
create policy scans_read_own_or_admin on public.scans
  for select to authenticated
  using (
    public.is_active_admin()
    or (
      operator_id = (select auth.uid())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.status = 'active'
      )
    )
  );

-- PIN invitations are read and written only by server-side Edge Functions.
revoke all privileges on table public.account_pin_invites from public, anon, authenticated;

-- These functions must run only as PostgreSQL trigger entrypoints, never as RPC.
revoke execute on function public.audit_change() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

commit;
