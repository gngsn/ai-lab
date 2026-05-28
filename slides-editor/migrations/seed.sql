-- seed.sql — minimal verification deck used by M0 setup check.
-- Idempotent: re-running just updates the same rows.

insert into decks (deck_id, title, frame_html)
values (
  'seed-hello',
  'Hello slides-editor',
  $$<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>Hello slides-editor</title>
  <style>
    body { margin: 0; background: #0c0c0c; color: #f0f0f0;
           font-family: -apple-system, "IBM Plex Sans KR", sans-serif; }
    main { display: block; }
    .slide { width: 100vw; height: 100vh; display: grid;
             place-items: center; padding: 4rem; box-sizing: border-box;
             text-align: center; }
    h1 { font-size: clamp(2.5rem, 7vw, 6rem); margin: 0 0 1rem; }
    p  { font-size: clamp(1rem, 1.6vw, 1.4rem); color: #999; margin: 0; }
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
   '<section class="slide" data-title="Intro"><div><h1>Hello, slides-editor.</h1><p>M0 셋업 검증용 시드 덱입니다.</p></div></section>'),
  ('seed-hello', 'second', 1, 'Second',
   '<section class="slide" data-title="Second"><div><h1>Second slide</h1><p>키보드 ↓로 이동 (M1 이후).</p></div></section>')
on conflict (deck_id, section_id) do update
   set "order" = excluded."order",
       title   = excluded.title,
       content = excluded.content;

insert into notes (deck_id, section_id, content) values
  ('seed-hello', 'intro',  '인트로 노트 — 30초 자기소개.'),
  ('seed-hello', 'second', '두 번째 노트 — 1분 분량.')
on conflict (deck_id, section_id) do update
   set content = excluded.content;
