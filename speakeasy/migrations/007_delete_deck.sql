-- 007_delete_deck.sql — delete a deck and every row that hangs off it.
--
-- delete_deck(p_deck_id): the schema has no foreign keys, so slides, notes and
-- the history tables are removed explicitly inside one transaction. Storage
-- objects (slides-images / slides-audio) are cleaned up by the client.
--
-- Apply via Supabase SQL editor.

create or replace function delete_deck(p_deck_id text) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from slides        where deck_id = p_deck_id;
  delete from notes         where deck_id = p_deck_id;
  delete from slide_history where deck_id = p_deck_id;
  delete from notes_history where deck_id = p_deck_id;
  delete from frame_history where deck_id = p_deck_id;
  delete from decks         where deck_id = p_deck_id;
end $$;

grant execute on function delete_deck(text) to anon, authenticated;
