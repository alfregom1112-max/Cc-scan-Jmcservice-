-- CedulaScan Supabase-only hardening.
-- No service key belongs in the APK. Run this migration in the project used by the app.
begin;

alter table public.scans add column if not exists display_name text not null default '';
create index if not exists scans_operator_received_idx on public.scans (operator_id, received_at desc);
create index if not exists audit_log_entity_created_idx on public.audit_log (entity_type, entity_id, created_at desc);

create or replace function public.audit_change()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), TG_OP, TG_TABLE_NAME,
          case when TG_OP = 'DELETE' then coalesce((to_jsonb(OLD)->>'id'), '') else coalesce((to_jsonb(NEW)->>'id'), '') end,
          jsonb_build_object('source', 'supabase', 'table', TG_TABLE_NAME));
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists audit_events_changes on public.events;
create trigger audit_events_changes after insert or update or delete on public.events
for each row execute function public.audit_change();
drop trigger if exists audit_scans_changes on public.scans;
create trigger audit_scans_changes after insert or update or delete on public.scans
for each row execute function public.audit_change();

-- Operators can only write scans through the validated RPC, never directly.
drop policy if exists scans_direct_insert on public.scans;
drop policy if exists scans_direct_update on public.scans;
drop policy if exists scans_operator_read_own on public.scans;
create policy scans_operator_read_own on public.scans for select to authenticated
  using (public.is_active_admin() or operator_id = (select auth.uid()));
revoke insert, update on public.scans from authenticated;
grant select on public.scans to authenticated;

-- Only administrators can read the audit trail.
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated
  using (public.is_active_admin());
revoke insert, update, delete on public.audit_log from public, anon, authenticated;

-- Prevent direct profile privilege escalation.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

notify pgrst, 'reload schema';
commit;
