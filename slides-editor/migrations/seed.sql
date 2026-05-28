-- seed.sql — minimal verification deck.
-- Idempotent: re-running just updates the same rows (incl. frame_html).
-- After M1, also exercises scroll-snap + .fragment.

insert into decks (deck_id, title, frame_html)
values (
  'seed-hello',
  'Hello slides-editor',
  $$<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Hello slides-editor</title>
  <style>
    html { scroll-snap-type: y mandatory; scroll-behavior: smooth; }
    body { margin: 0; background: #0c0c0c; color: #f0f0f0;
           font-family: -apple-system, "IBM Plex Sans KR", sans-serif; }
    main { display: block; }
    .slide { width: 100vw; height: 100vh;
             display: grid; place-items: center;
             padding: 4rem; box-sizing: border-box; text-align: center;
             scroll-snap-align: start; }
    h1 { font-size: clamp(2.5rem, 7vw, 6rem); margin: 0 0 1rem; }
    p  { font-size: clamp(1rem, 1.6vw, 1.4rem); color: #999; margin: 0; }
    ul { list-style: '→ '; padding-left: 1.5em; text-align: left;
         margin-top: 1rem; font-size: 1.2rem; color: #5db8a6; }
    .fragment { opacity: 0; transform: translateY(8px);
                transition: opacity .35s ease, transform .35s ease; }
    .fragment.show { opacity: 1; transform: none; }
  </style>
</head>
<body>
<main>
<!-- slides -->
</main>
</body>
</html>$$
)
on conflict (deck_id) do update
   set title = excluded.title,
       frame_html = excluded.frame_html;

insert into slides (deck_id, section_id, "order", title, content) values
  ('seed-hello', 'intro',  0, 'Intro',
   '<section class="slide" data-title="Intro"><div><h1>Hello, slides-editor.</h1><p>M0 + M1 검증용 시드 덱입니다.</p></div></section>'),
  ('seed-hello', 'second', 1, 'Second',
   '<section class="slide" data-title="Second"><div><h1>Second slide</h1><p>↓ 키로 fragment 하나씩 노출 →</p><ul><li class="fragment">first</li><li class="fragment">second</li><li class="fragment">third</li></ul></div></section>'),
  ('seed-hello', 'third',  2, 'Third',
   '<section class="slide" data-title="Third"><div><h1>M1 complete ✓</h1><p>↑/↓ · PgUp/PgDn · Home/End · 휠 · 스와이프</p></div></section>')
on conflict (deck_id, section_id) do update
   set "order" = excluded."order",
       title   = excluded.title,
       content = excluded.content;

insert into notes (deck_id, section_id, content) values
  ('seed-hello', 'intro',  '인트로 노트 — 30초 자기소개.'),
  ('seed-hello', 'second', '두 번째 노트 — fragment 시연.'),
  ('seed-hello', 'third',  '마지막 노트 — M1 wrap-up.')
on conflict (deck_id, section_id) do update
   set content = excluded.content;
