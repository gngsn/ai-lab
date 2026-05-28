-- 003_dev_rls.sql — RLS posture for M0–M5.
-- Keeps RLS ENABLED (defense in depth) and adds a permissive `dev_anon_all`
-- policy so the unauthenticated client can read/write during single-user dev.
-- M6 replaces `dev_anon_all` with owner + share_token scoped policies.
--
-- Symptom this fixes: `✓ connected — 0 deck(s)` while rows exist in the
-- Table Editor. (RLS ON + no policy = anon SELECT returns zero rows.)
-- Idempotent: re-running drops and recreates the policies.

alter table decks          enable row level security;
alter table slides         enable row level security;
alter table notes          enable row level security;
alter table slide_history  enable row level security;
alter table notes_history  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['decks','slides','notes','slide_history','notes_history'] loop
    execute format('drop policy if exists dev_anon_all on public.%I', t);
    execute format(
      'create policy dev_anon_all on public.%I for all to anon using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Sanity — non-zero counts confirm `anon` can SELECT through the new policy.
select 'decks'  as table_name, count(*) from decks
union all select 'slides', count(*) from slides
union all select 'notes',  count(*) from notes;
