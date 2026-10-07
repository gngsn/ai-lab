-- 008_frame_history_rls.sql — give frame_history the same RLS posture as the
-- other tables in 003_dev_rls.sql.
--
-- 006 created frame_history after 003 ran, so it never got the permissive
-- `dev_anon_all` policy. With RLS enabled on it (the Supabase dashboard
-- default) and no policy, every insert fails with:
--   new row violates row-level security policy for table "frame_history"
-- which breaks "Save version", re-import's history snapshot, and the
-- automatic frame history.
--
-- Apply via Supabase SQL editor. Idempotent.

alter table frame_history enable row level security;

drop policy if exists dev_anon_all on public.frame_history;
create policy dev_anon_all on public.frame_history
  for all to anon using (true) with check (true);

-- Sanity — should list dev_anon_all for frame_history.
select policyname, cmd from pg_policies
  where schemaname = 'public' and tablename = 'frame_history';
