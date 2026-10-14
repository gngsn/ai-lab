-- 006_frame_history.sql — snapshots for deck frame_html

create table if not exists frame_history (
  id          bigserial    primary key,
  deck_id     varchar(200) not null,
  section_id  varchar(100) not null default 'frame',
  content     text         not null,
  kind        history_kind not null,
  message     text,
  created_at  timestamptz  not null default now()
);
create index if not exists frame_history_deck_created on frame_history (deck_id, created_at desc);
create index if not exists frame_history_section_created on frame_history (deck_id, section_id, created_at desc);
