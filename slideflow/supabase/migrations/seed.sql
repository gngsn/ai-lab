-- Development seed: one dev user + one sample deck (SPEC §2.2).
-- The dev user id matches adapters/local/local-auth.ts so a dev-JWT login owns this deck.

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'dev@slideflow.local')
on conflict (id) do nothing;

insert into decks (deck_id, owner_id, owner_email, title, frame_html)
values (
  'sample',
  '00000000-0000-0000-0000-000000000001',
  'dev@slideflow.local',
  'Sample Deck',
  '<!doctype html><html><head><meta charset="utf-8"><style>section.slide{height:720px;display:grid;place-content:center;font-family:sans-serif}</style></head><body><main><!-- slides --></main></body></html>'
)
on conflict (deck_id) do nothing;

insert into slides (deck_id, section_id, "order", title, content)
values
  ('sample', 's-001', 0, 'Welcome',
   '<section class="slide" data-title="Welcome"><div><h1>Welcome to Slideflow</h1><p>Your first slide.</p></div></section>'),
  ('sample', 's-002', 1, 'Second',
   '<section class="slide" data-title="Second"><div><h1>Second slide</h1><p>Edit me.</p></div></section>')
on conflict (deck_id, section_id) do nothing;

insert into notes (deck_id, section_id, content)
values
  ('sample', 's-001', 'Speaker note for the welcome slide.'),
  ('sample', 's-002', 'Speaker note for the second slide.')
on conflict (deck_id, section_id) do nothing;
