-- 010_key_message.sql — one key message per slide, next to its speaker notes.
--
-- Stored on `notes` (same deck_id + section_id key), so deleting a deck or a
-- slide already removes it. Shown in the editor under the notes and imported
-- from a Markdown file in the same format as the script.
--
-- Apply via Supabase SQL editor. Idempotent.

alter table notes add column if not exists key_message text not null default '';
