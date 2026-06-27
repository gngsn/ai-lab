-- Runs once at Postgres first-init (before PostgREST connects).
-- Ensures the JWT-switch roles exist; migration 0001 is idempotent over this.
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

-- Let the connecting superuser switch into these roles (PostgREST does this per request).
grant anon, authenticated to postgres;
