-- Run in a new Supabase project's SQL editor. Existing unrelated projects are untouched.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Runner' check (char_length(display_name) between 1 and 60),
  handle text unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  is_public boolean not null default false,
  constraint public_handle_required check (not is_public or handle is not null)
);
create table if not exists public.medals (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  race_name text not null check (char_length(race_name) between 1 and 100),
  race_date date not null check (race_date <= current_date),
  distance numeric not null check (distance > 0 and distance <= 1000),
  duration text not null default '' check (duration = '' or duration ~ '^\d{1,3}:[0-5]\d:[0-5]\d$'),
  location text not null default '' check (char_length(location) <= 150),
  note text not null default '' check (char_length(note) <= 1000),
  image_path text not null,
  original_path text,
  color text not null default '#ece9e1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  constraint owned_original_path check (original_path is null or (split_part(original_path, '/', 1) = owner_id::text and split_part(original_path, '/', 2) = id::text)),
  constraint owned_image_path check (split_part(image_path, '/', 1) = owner_id::text and split_part(image_path, '/', 2) = id::text)
);
create index if not exists medals_owner_date on public.medals(owner_id, race_date desc);
alter table public.profiles enable row level security;
alter table public.medals enable row level security;
create policy "Own profile" on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Own medals" on public.medals for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Public access only through narrowly scoped functions: private notes are never returned.
create or replace function public.public_shelf(requested_handle text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', p.display_name, 'handle', p.handle, 'medals', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'race_name', m.race_name, 'race_date', m.race_date,
      'distance', m.distance, 'duration', m.duration, 'location', m.location, 'image_path', m.image_path, 'color', m.color)
      order by m.race_date desc)
    from public.medals m where m.owner_id = p.id and m.visibility = 'public'
  ), '[]'::jsonb)) from public.profiles p where p.handle = requested_handle and p.is_public;
$$;
revoke all on function public.public_shelf(text) from public;
grant execute on function public.public_shelf(text) to anon, authenticated;
create or replace function public.is_public_medal_asset(asset_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.medals m join public.profiles p on p.id = m.owner_id
    where m.image_path = asset_path and m.visibility = 'public' and p.is_public);
$$;
revoke all on function public.is_public_medal_asset(text) from public;
grant execute on function public.is_public_medal_asset(text) to anon, authenticated;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('medals', 'medals', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/png','image/jpeg','image/webp'];
create policy "Read owned medal photos" on storage.objects for select to authenticated
using (bucket_id = 'medals' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Upload owned medal photos" on storage.objects for insert to authenticated
with check (bucket_id = 'medals' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Delete owned medal photos" on storage.objects for delete to authenticated
using (bucket_id = 'medals' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- The server proxies public photos using download(), not long-lived signed URLs.
create policy "Read explicitly public photos" on storage.objects for select to anon, authenticated
using (bucket_id = 'medals' and public.is_public_medal_asset(name));

-- Durable per-account AI-processing quota and request deduplication.
create table if not exists public.image_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  input_hash text not null,
  status text not null default 'pending' check (status in ('pending','complete','failed')),
  result_path text,
  provider_cleanup_pending boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists image_jobs_owner_hash on public.image_jobs(owner_id, input_hash, created_at desc);
alter table public.image_jobs enable row level security;
create policy "Read own image jobs" on public.image_jobs for select to authenticated using (owner_id = (select auth.uid()));
create or replace function public.claim_image_job(photo_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  existing public.image_jobs;
  result public.image_jobs;
begin
  if uid is null then raise exception 'Sign in to use AI cleanup'; end if;
  if photo_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid image hash'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select * into existing from public.image_jobs where owner_id = uid and input_hash = photo_hash
    and (status = 'complete' or (status = 'pending' and created_at > now() - interval '2 minutes'))
    order by created_at desc limit 1;
  if found then return jsonb_build_object('id', existing.id, 'status', existing.status, 'result_path', existing.result_path, 'claimed', false); end if;
  if (select count(*) from public.image_jobs where owner_id = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have reached the hourly AI cleanup limit. Try quick cleanup or come back later.';
  end if;
  insert into public.image_jobs(owner_id, input_hash) values (uid, photo_hash) returning * into result;
  return jsonb_build_object('id', result.id, 'status', result.status, 'claimed', true);
end;
$$;
revoke all on function public.claim_image_job(text) from public;
grant execute on function public.claim_image_job(text) to authenticated;

-- Server-only sweep for interrupted uploads and obsolete images. Keep a 24-hour
-- grace period so in-progress saves are never collected.
create or replace function public.orphan_medal_assets() returns table(path text)
language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o where o.bucket_id = 'medals'
    and o.created_at < now() - interval '24 hours'
    and not exists(select 1 from public.medals m where m.image_path = o.name or m.original_path = o.name)
    and not exists(select 1 from public.image_jobs j where j.result_path = o.name)
    limit 100;
$$;
revoke all on function public.orphan_medal_assets() from public;
grant execute on function public.orphan_medal_assets() to service_role;

create or replace function public.enforce_medal_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  if not exists(select 1 from public.medals where id = new.id and owner_id = new.owner_id)
    and (select count(*) from public.medals where owner_id = new.owner_id) >= 200 then
    raise exception 'Your shelf is full (200 medals). Export a backup or remove a medal before adding another.';
  end if;
  return new;
end;
$$;
create trigger medal_limit before insert on public.medals for each row execute function public.enforce_medal_limit();
