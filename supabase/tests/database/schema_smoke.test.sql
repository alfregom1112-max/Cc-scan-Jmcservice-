begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'imports', 'imports table exists');
select has_table('public', 'people', 'master people table exists');
select has_table('public', 'events', 'events table exists');
select has_table('public', 'event_operators', 'event assignment table exists');
select has_table('public', 'scans', 'scan history table exists');
select has_table('public', 'audit_log', 'audit table exists');

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.imports'::regclass), 'imports has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.people'::regclass), 'people has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.events'::regclass), 'events has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.event_operators'::regclass), 'event_operators has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.scans'::regclass), 'scans has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'audit_log has RLS');

select ok(to_regprocedure('public.lookup_person_for_scan(uuid,text,text)') is not null, 'authorized scan lookup RPC exists');
select ok(to_regprocedure('public.record_scan(uuid,text,text,timestamptz,text,uuid)') is not null, 'idempotent scan RPC exists');
select ok(exists (select 1 from pg_indexes where schemaname='public' and indexname='profiles_one_active_admin_idx'), 'single active admin constraint exists');
select ok(exists (select 1 from pg_indexes where schemaname='public' and indexname='scans_one_document_per_event_idx'), 'per-event scan uniqueness exists');
select ok(exists (select 1 from pg_indexes where schemaname='public' and indexname='people_document_lookup_idx'), 'master document lookup index exists');
select ok(not exists (select 1 from pg_policies where schemaname='public' and tablename='people' and policyname ilike '%operator%'), 'no operator read policy exposes the master table');

select * from finish();
rollback;
