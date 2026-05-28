-- 001_init.sql — decks / slides / notes
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists decks (
  deck_id      varchar(200) primary key,
  title        text         not null default 'Untitled',
  frame_html   text         not null,
  share_token  text         unique,
  owner_email  text,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

create table if not exists slides (
  deck_id     varchar(200) not null references decks(deck_id) on delete cascade,
  section_id  varchar(100) not null,
  "order"     smallint     not null check ("order" between 0 and 200),
  title       varchar(200) not null default 'Untitled',
  content     text         not null,
  updated_at  timestamptz  not null default now(),
  primary key (deck_id, section_id),
  -- deferrable so reorder can swap values inside a transaction
  constraint slides_deck_order_unique
    unique (deck_id, "order") deferrable initially immediate
);

create index if not exists slides_deck_order_idx on slides (deck_id, "order");

create table if not exists notes (
  deck_id     varchar(200) not null,
  section_id  varchar(100) not null,
  content     text         not null default '',
  updated_at  timestamptz  not null default now(),
  primary key (deck_id, section_id),
  foreign key (deck_id, section_id)
    references slides (deck_id, section_id) on delete cascade
);

-- shared updated_at trigger
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists decks_touch  on decks;
drop trigger if exists slides_touch on slides;
drop trigger if exists notes_touch  on notes;

create trigger decks_touch  before update on decks  for each row execute procedure touch_updated_at();
create trigger slides_touch before update on slides for each row execute procedure touch_updated_at();
create trigger notes_touch  before update on notes  for each row execute procedure touch_updated_at();
