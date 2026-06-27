-- Core tables: decks, slides, notes (SPEC §5.2–5.4).

create table if not exists decks (
  deck_id varchar(200) primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text,
  title text not null default 'Untitled',
  frame_html text not null,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decks_owner_id_idx on decks (owner_id);

create table if not exists slides (
  deck_id varchar(200) not null references decks (deck_id) on delete cascade,
  section_id varchar(100) not null,
  "order" smallint not null check ("order" between 0 and 200),
  title varchar(200) not null default 'Untitled',
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (deck_id, section_id),
  constraint slides_deck_order_unique
    unique (deck_id, "order") deferrable initially immediate
);

create table if not exists notes (
  deck_id varchar(200) not null references decks (deck_id) on delete cascade,
  section_id varchar(100) not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (deck_id, section_id)
);

-- Owner-session roles need table privileges; row visibility is then narrowed by RLS (0005).
grant select, insert, update, delete on decks, slides, notes to authenticated;
