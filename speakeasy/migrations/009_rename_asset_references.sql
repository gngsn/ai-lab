-- 009_rename_asset_references.sql — keep deck HTML valid after asset rename.
--
-- Asset URLs include their storage path. The client first copies the object to
-- its new path, calls this RPC, then removes the old object. These database
-- updates run in one transaction, so references cannot be only partly changed.
-- Apply via Supabase SQL editor.

create or replace function rename_asset_references(
  p_old_url text,
  p_new_url text
) returns table(slides_updated integer, frames_updated integer)
language plpgsql
security invoker
set search_path = public
as $$
begin
  update slides
     set content = replace(content, p_old_url, p_new_url)
   where position(p_old_url in content) > 0;
  get diagnostics slides_updated = row_count;

  update decks
     set frame_html = replace(frame_html, p_old_url, p_new_url)
   where position(p_old_url in frame_html) > 0;
  get diagnostics frames_updated = row_count;

  return next;
end $$;

grant execute on function rename_asset_references(text, text) to anon, authenticated;
