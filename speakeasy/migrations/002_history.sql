-- 002_history.sql — auto/manual snapshots for slides and notes

do $$ begin
  create type history_kind as enum ('auto', 'manual');
exception when duplicate_object then null;
end $$;

create table if not exists slide_history (
  id          bigserial    primary key,
  deck_id     varchar(200) not null,
  section_id  varchar(100) not null,
  content     text         not null,
  kind        history_kind not null,
  message     text,
  created_at  timestamptz  not null default now()
);
create index if not exists slide_history_deck_created    on slide_history (deck_id, created_at desc);
create index if not exists slide_history_section_created on slide_history (deck_id, section_id, created_at desc);

create table if not exists notes_history (
  id          bigserial    primary key,
  deck_id     varchar(200) not null,
  section_id  varchar(100) not null,
  content     text         not null,
  kind        history_kind not null,
  message     text,
  created_at  timestamptz  not null default now()
);
create index if not exists notes_history_deck_created    on notes_history (deck_id, created_at desc);
create index if not exists notes_history_section_created on notes_history (deck_id, section_id, created_at desc);
