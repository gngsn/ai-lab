-- 004_rpc.sql — Postgres RPCs called by the edit page.
--
-- reorder_slides(p_deck_id, p_section_ids[]): atomically rewrite the `order`
-- column so that slides[i] gets order = i (0-based). Uses DEFERRED unique
-- constraint so intermediate duplicate orders inside the transaction are
-- tolerated.
--
-- Apply via Supabase SQL editor.

create or replace function reorder_slides(
  p_deck_id     text,
  p_section_ids text[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  i int;
  n int := coalesce(array_length(p_section_ids, 1), 0);
begin
  set constraints all deferred;
  for i in 1..n loop
    update slides
       set "order" = i - 1
     where deck_id   = p_deck_id
       and section_id = p_section_ids[i];
  end loop;
end $$;

grant execute on function reorder_slides(text, text[]) to anon, authenticated;
