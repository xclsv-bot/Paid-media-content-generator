-- ci/supabase-shim.sql
-- Minimal stand-ins for the Supabase-managed objects the migrations depend on,
-- so the full migration set can be applied to a stock postgres:16 in CI and the
-- RLS policies can be exercised. This is NOT a production substitute for
-- Supabase — it exists only to test the real schema + policies. Run BEFORE the
-- migrations, as the postgres superuser.

-- 1) Roles Supabase provides. The migrations revoke/grant against these by name.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- 2) Let the app roles reach public objects; RLS stays the gate. Default
-- privileges so the tables the migrations create below inherit these grants
-- (mirrors Supabase's default-privilege setup).
grant usage on schema public to anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- 3) auth schema: the FK target for public.users, the new-user trigger source,
-- and auth.uid() (the 'sub' of the request JWT, set per-test via
-- request.jwt.claims; null when unset => anonymous).
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

-- 4) storage schema: only storage.buckets is written (0002 / 0006 / 0008).
create schema if not exists storage;
create table if not exists storage.buckets (
  id               text primary key,
  name             text not null,
  public           boolean not null default false,
  file_size_limit  bigint,
  allowed_mime_types text[],
  created_at       timestamptz not null default now()
);
