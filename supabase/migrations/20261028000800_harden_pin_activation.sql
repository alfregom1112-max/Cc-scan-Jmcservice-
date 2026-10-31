begin;

alter table public.account_pin_invites
  add column if not exists reservation_id uuid,
  add column if not exists reserved_at timestamptz,
  add column if not exists claim_expires_at timestamptz;

create table if not exists public.account_pin_activation_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  bucket_kind text not null check (bucket_kind in ('ip','email')),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists account_pin_activation_limits_updated_idx
  on public.account_pin_activation_limits(updated_at);
alter table public.account_pin_activation_limits enable row level security;
revoke all privileges on public.account_pin_activation_limits from anon, authenticated;
drop policy if exists account_pin_activation_limits_deny_client on public.account_pin_activation_limits;
create policy account_pin_activation_limits_deny_client on public.account_pin_activation_limits
  for all to anon, authenticated using (false) with check (false);

create or replace function public.check_pin_activation_rate_limit(p_ip_hash text, p_email_hash text)
returns boolean language plpgsql security definer
set search_path = '' as $$
declare
  v_bucket record;
  v_entry public.account_pin_activation_limits%rowtype;
  v_now timestamptz := now();
  v_window interval;
  v_limit integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'No autorizado'; end if;
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_email_hash !~ '^[0-9a-f]{64}$' then raise exception 'Solicitud inválida'; end if;
  delete from public.account_pin_activation_limits where updated_at < v_now - interval '48 hours';
  for v_bucket in
    select * from (values (p_ip_hash, 'ip'::text, 20, 15), (p_email_hash, 'email'::text, 5, 30))
      as buckets(bucket_hash, bucket_kind, max_attempts, window_minutes)
  loop
    v_window := make_interval(mins => v_bucket.window_minutes);
    v_limit := v_bucket.max_attempts;
    perform pg_advisory_xact_lock(hashtextextended(v_bucket.bucket_hash, 0));
    select * into v_entry from public.account_pin_activation_limits l where l.bucket_hash = v_bucket.bucket_hash for update;
    if not found then
      insert into public.account_pin_activation_limits(bucket_hash,bucket_kind,window_started_at,attempts,updated_at)
        values (v_bucket.bucket_hash,v_bucket.bucket_kind,v_now,1,v_now);
    elsif v_entry.blocked_until is not null and v_entry.blocked_until > v_now then
      return false;
    elsif v_entry.window_started_at <= v_now - v_window then
      update public.account_pin_activation_limits set bucket_kind=v_bucket.bucket_kind,
        window_started_at=v_now,attempts=1,blocked_until=null,updated_at=v_now
        where bucket_hash=v_bucket.bucket_hash;
    elsif v_entry.attempts >= v_limit then
      update public.account_pin_activation_limits set blocked_until=v_entry.window_started_at+v_window,updated_at=v_now
        where bucket_hash=v_bucket.bucket_hash;
      return false;
    else
      update public.account_pin_activation_limits set attempts=attempts+1,updated_at=v_now
        where bucket_hash=v_bucket.bucket_hash;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.claim_account_pin(p_pin_hash text, p_reservation_id uuid)
returns table(invite_id uuid, assigned_role public.app_role)
language plpgsql security definer
set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'No autorizado'; end if;
  return query
  update public.account_pin_invites i
    set reservation_id=p_reservation_id,reserved_at=now(),claim_expires_at=now()+interval '3 minutes'
  where i.pin_hash=p_pin_hash and i.used_at is null and i.expires_at>now()
    and (i.reservation_id is null or i.claim_expires_at<=now())
  returning i.id,i.role;
end;
$$;

create or replace function public.release_account_pin_claim(p_reservation_id uuid)
returns boolean language plpgsql security definer
set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'No autorizado'; end if;
  update public.account_pin_invites set reservation_id=null,reserved_at=null,claim_expires_at=null
  where reservation_id=p_reservation_id and used_at is null;
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

create or replace function public.finalize_account_pin_claim(p_reservation_id uuid)
returns boolean language plpgsql security definer
set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'No autorizado'; end if;
  update public.account_pin_invites set used_at=now(),reservation_id=null,reserved_at=null,claim_expires_at=null
  where reservation_id=p_reservation_id and used_at is null and expires_at>now();
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

revoke all privileges on function public.check_pin_activation_rate_limit(text,text) from public,anon,authenticated;
revoke all privileges on function public.claim_account_pin(text,uuid) from public,anon,authenticated;
revoke all privileges on function public.release_account_pin_claim(uuid) from public,anon,authenticated;
revoke all privileges on function public.finalize_account_pin_claim(uuid) from public,anon,authenticated;
grant execute on function public.check_pin_activation_rate_limit(text,text) to service_role;
grant execute on function public.claim_account_pin(text,uuid) to service_role;
grant execute on function public.release_account_pin_claim(uuid) to service_role;
grant execute on function public.finalize_account_pin_claim(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
