### 발표 슬라이드 HTML 구조

- 두 개의 개별 모드: 슬라이드 수정 모드 / 스크립트 수정 모드
- 모바일에서는 스크립트 수정만 가능
- 슬라이드와 스크립트는 수정 내용은 히스토리 저장됨
- 각 section은 slides.md (marp) 파일을 기반으로 하고, AI가 각 페이지를 section 하위 내용에 적용시킬 예정
- export 기능:
  - Slides: 모든 slides 내용을 포함한 전체 html을 `.html`, `.pdf`로 export 
  - Notes: Notes Table 에서 notes.md (marp) 를 조회성으로 볼 수 있도록 '---' 로 구분한 형식을 단순히 출력만 하는 기능

```html
<html>
<head>
    <style>...</style>
    ...
</head>
<body>
    <section id="">
    </section>

    <section id="">
    </section>

</body>
    <script>...</script>
    ...
</html>
```

### Deck Table
- deck_id varchar(200)
- content
  - html frame. will be filled from slides data

PK: deck_id

### Slides Table
- deck_id varchar(200)
- section_id varchar(100)
- order small int (0~200)
- title varchar(200)
- content text
  - Each HTML section tag

PK: (deck_id, section_id)
Unique: (deck_id, order)

-> slide_history table

### Notes Table
- deck_id varchar(200)
- section_id varchar(100)
- content text

-> slide_history table

PK: (deck_id, section_id)
