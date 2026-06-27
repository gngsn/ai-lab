-- RPCs (SPEC §6.2, §7).

-- reorder_slides: owner-only atomic reorder. Runs as definer (bypasses RLS) but
-- verifies ownership via auth.uid(), and defers the unique(order) constraint so
-- the bulk update never trips mid-statement.
create or replace function reorder_slides(p_deck_id text, p_section_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from decks where deck_id = p_deck_id and owner_id = auth.uid()
  ) then
    raise exception 'not authorized for deck %', p_deck_id using errcode = '42501';
  end if;

  set constraints all deferred;

  update slides s
  set "order" = u.idx - 1
  from unnest(p_section_ids) with ordinality as u(section_id, idx)
  where s.deck_id = p_deck_id and s.section_id = u.section_id;
end;
$$;

revoke all on function reorder_slides(text, text[]) from public, anon;
grant execute on function reorder_slides(text, text[]) to authenticated;

-- Shared read RPCs: anon may call these, and they return rows only when the
-- token matches. No broad anon table grants (SPEC §6.2).
create or replace function public_get_deck(p_deck_id text, p_token text)
returns table (deck_id varchar, title text, frame_html text)
language sql
security definer
set search_path = public
stable
as $$
  select d.deck_id, d.title, d.frame_html
  from decks d
  where d.deck_id = p_deck_id
    and d.share_token is not null
    and d.share_token = p_token
$$;

create or replace function public_get_slides(p_deck_id text, p_token text)
returns table (section_id varchar, "order" smallint, title varchar, content text)
language sql
security definer
set search_path = public
stable
as $$
  select s.section_id, s."order", s.title, s.content
  from slides s
  join decks d on d.deck_id = s.deck_id
  where d.deck_id = p_deck_id
    and d.share_token is not null
    and d.share_token = p_token
  order by s."order" asc
$$;

grant execute on function public_get_deck(text, text) to anon, authenticated;
grant execute on function public_get_slides(text, text) to anon, authenticated;
