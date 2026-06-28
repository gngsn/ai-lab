-- DEV ONLY. Applied only to the local stack (never to a Supabase project), because
-- migrate.mjs skips this folder when BACKEND=supabase. On cloud, real Supabase Auth
-- provisions users instead.
--
-- dev_login upserts an auth.users row for an email and returns its id, so the
-- dev-JWT local-auth adapter can sign a token for any email without a real auth server.

create or replace function public.dev_login(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then
    insert into auth.users (email) values (p_email) returning id into uid;
  end if;
  return uid;
end;
$$;

grant execute on function public.dev_login(text) to anon, authenticated;
