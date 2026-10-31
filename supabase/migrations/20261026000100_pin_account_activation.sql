begin;

create table if not exists public.account_pin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'operator',
  pin_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists account_pin_invites_email_idx on public.account_pin_invites (lower(email));
create index if not exists account_pin_invites_active_idx on public.account_pin_invites (expires_at) where used_at is null;
alter table public.account_pin_invites enable row level security;

commit;
