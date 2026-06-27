-- History tables for slide / notes / frame edits (SPEC §5.5).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'history_kind') then
    create type history_kind as enum ('auto', 'manual');
  end if;
end
$$;

create table if not exists slide_history (
  id bigserial primary key,
  deck_id varchar(200) not null references decks (deck_id) on delete cascade,
  section_id varchar(100) not null,
  content text not null,
  kind history_kind not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists notes_history (
  id bigserial primary key,
  deck_id varchar(200) not null references decks (deck_id) on delete cascade,
  section_id varchar(100) not null,
  content text not null,
  kind history_kind not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists frame_history (
  id bigserial primary key,
  deck_id varchar(200) not null references decks (deck_id) on delete cascade,
  section_id varchar(100) not null default 'frame',
  content text not null,
  kind history_kind not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists slide_history_deck_idx on slide_history (deck_id, section_id, created_at desc);
create index if not exists notes_history_deck_idx on notes_history (deck_id, section_id, created_at desc);
create index if not exists frame_history_deck_idx on frame_history (deck_id, created_at desc);

grant select, insert on slide_history, notes_history, frame_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;
