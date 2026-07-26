-- 001_vocab_lookups.sql — persisted vocabulary lookups (vocabulary.html)
-- Reuses the same Supabase project as slides-editor; just a new table here.
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists vocab_lookups (
  word_lower  text        not null,
  engine      text        not null,       -- "claude" | "openai" | "ollama"
  model       text,                       -- e.g. "claude-opus-4-8", "qwen3.6"
  markdown    text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (word_lower, engine)
);

create index if not exists vocab_lookups_word_idx on vocab_lookups (word_lower);

-- Dev RLS posture (matches slides-editor's 003_dev_rls.sql): RLS enabled as
-- defense in depth, permissive anon policy for single-user personal use.
alter table vocab_lookups enable row level security;

drop policy if exists dev_anon_all on public.vocab_lookups;
create policy dev_anon_all on public.vocab_lookups
  for all to anon using (true) with check (true);
