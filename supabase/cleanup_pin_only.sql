-- LIMPIEZA DEL FLUJO ANTIGUO DE INVITACIONES POR CORREO
-- CedulaScan V2 - flujo actual: código/PIN generado desde la APK.
--
-- Este script NO borra usuarios, perfiles, eventos, escaneos, auditoría ni personas.
-- Ejecutar en Supabase SQL Editor después de desplegar las funciones PIN.

begin;

-- 1) Eliminar únicamente invitaciones PIN vencidas o ya consumidas.
-- Las invitaciones vigentes se conservan para que puedan probarse.
delete from public.account_pin_invites
where used_at is not null
   or expires_at <= now();

-- 2) Eliminar índices duplicados si quedaron de una ejecución anterior.
drop index if exists public.account_pin_invites_email_idx;
drop index if exists public.account_pin_invites_active_idx;

-- 3) Volver a crear los índices necesarios para el flujo PIN.
create index if not exists account_pin_invites_active_idx
  on public.account_pin_invites (expires_at)
  where used_at is null;

create index if not exists account_pin_invites_creator_idx
  on public.account_pin_invites (created_by, created_at desc);

-- 4) Confirmar RLS en la tabla de PIN.
alter table public.account_pin_invites enable row level security;

-- La APK no consulta directamente esta tabla.
-- Solo las Edge Functions usan la service role key.
-- Por eso no se crean políticas públicas para evitar exponer hashes de PIN.
drop policy if exists account_pin_invites_public_read on public.account_pin_invites;
drop policy if exists account_pin_invites_public_insert on public.account_pin_invites;
drop policy if exists account_pin_invites_public_update on public.account_pin_invites;
drop policy if exists account_pin_invites_authenticated_read on public.account_pin_invites;

commit;

-- VERIFICACIÓN. Debe devolver solamente la cantidad de códigos vigentes.
select
  count(*) as codigos_pin_vigentes
from public.account_pin_invites
where used_at is null
  and expires_at > now();

-- OBJETOS QUE NO SE DEBEN BORRAR CON ESTE SQL:
-- public.profiles
-- public.events
-- public.event_operators
-- public.scans
-- public.audit_log
-- public.people
-- public.devices
-- public.scan_metrics
-- auth.users
