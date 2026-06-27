-- Auth compatibility shim for the vendor-neutral local stack (PLAN §3.5, §4).
-- Recreates the minimal slice of Supabase that RLS depends on: the `auth` schema,
-- an `auth.users` table, the `anon`/`authenticated` roles, and `auth.uid()` /
-- `auth.role()` reading PostgREST's `request.jwt.claims`.
--
-- Every statement is guarded so this file is a harmless no-op on a real Supabase
-- project, where these objects already exist.

create extension if not exists pgcrypto;

create schema if not exists auth;

-- Minimal users table (Supabase's has more columns; this is FK-compatible).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Roles PostgREST switches into based on the JWT `role` claim.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- auth.uid(): the authenticated user id, or null. Only define if Supabase hasn't.
do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $fn$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(
          current_setting('request.jwt.claims', true)::json ->> 'sub', ''
        )::uuid
      $body$;
    $fn$;
  end if;
  if to_regprocedure('auth.role()') is null then
    execute $fn$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(
          current_setting('request.jwt.claims', true)::json ->> 'role', 'anon'
        )
      $body$;
    $fn$;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
