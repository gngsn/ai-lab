-- 005_storage.sql — image hosting via Supabase Storage.
-- Creates a public bucket `slides-images` and dev policies that mirror the
-- M3 `dev_anon_all` posture: anon can upload/read/delete. Tier 2 should
-- scope writes by owner via Supabase Auth.
--
-- Path convention: `{deck_id}/{timestamp36}-{safe-filename}`.
-- Public URLs: `${SUPABASE_URL}/storage/v1/object/public/slides-images/{path}`.

insert into storage.buckets (id, name, public)
values ('slides-images', 'slides-images', true)
on conflict (id) do nothing;

-- Permissive dev policies. Re-run safely.
do $$ begin
  drop policy if exists "slides-images public read"   on storage.objects;
  drop policy if exists "slides-images anon insert"   on storage.objects;
  drop policy if exists "slides-images anon delete"   on storage.objects;
  drop policy if exists "slides-images anon update"   on storage.objects;
end $$;

create policy "slides-images public read"
  on storage.objects for select
  using (bucket_id = 'slides-images');

create policy "slides-images anon insert"
  on storage.objects for insert to anon
  with check (bucket_id = 'slides-images');

create policy "slides-images anon delete"
  on storage.objects for delete to anon
  using (bucket_id = 'slides-images');

create policy "slides-images anon update"
  on storage.objects for update to anon
  using (bucket_id = 'slides-images');

-- Sanity: list bucket policies
select policyname, cmd from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
  order by policyname;
