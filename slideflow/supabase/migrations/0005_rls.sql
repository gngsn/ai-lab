-- Row Level Security (SPEC §6.1). Owner-managed tables are scoped by auth.uid();
-- child tables authorize through their parent deck.

alter table decks enable row level security;
alter table slides enable row level security;
alter table notes enable row level security;
alter table slide_history enable row level security;
alter table notes_history enable row level security;
alter table frame_history enable row level security;
alter table profiles enable row level security;

-- Helper: re-create a policy idempotently.
-- (Postgres lacks CREATE POLICY IF NOT EXISTS, so drop-then-create.)

-- decks: full owner CRUD.
drop policy if exists "owner decks select" on decks;
create policy "owner decks select" on decks
  for select using (auth.uid() = owner_id);

drop policy if exists "owner decks insert" on decks;
create policy "owner decks insert" on decks
  for insert with check (auth.uid() = owner_id);

drop policy if exists "owner decks update" on decks;
create policy "owner decks update" on decks
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owner decks delete" on decks;
create policy "owner decks delete" on decks
  for delete using (auth.uid() = owner_id);

-- Child tables: authorize via the parent deck's owner.
do $$
declare
  child text;
begin
  foreach child in array array['slides', 'notes', 'slide_history', 'notes_history', 'frame_history']
  loop
    execute format('drop policy if exists "owner %1$s all" on %1$s', child);
    execute format(
      'create policy "owner %1$s all" on %1$s for all
         using (exists (select 1 from decks d where d.deck_id = %1$s.deck_id and d.owner_id = auth.uid()))
         with check (exists (select 1 from decks d where d.deck_id = %1$s.deck_id and d.owner_id = auth.uid()))',
      child
    );
  end loop;
end
$$;

-- profiles: a user sees and edits only their own.
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
