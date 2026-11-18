# 표현 카드 (wordiary)

친구에게 쓴 영어 문장을 고쳐 주고, 고친 표현을 카드 한 장으로 만들어 카드뉴스로 묶는 claude.ai 아티팩트입니다.
빌드 과정이 없고, `window.claude`의 `sample`(Claude 호출), `db`(저장), `downloads`(PNG 저장)를 씁니다.

## 흐름

1. **입력**: 영어 문장, 또는 영어로 하고 싶은 한국어. 입력은 "대화"에 속하고, 같은 대화의 앞 문장 최대 6개가 문맥으로 함께 갑니다.
2. **교정**: 하려던 말을 빼지 않은 가장 가까운 교정 → 더 자연스러운 버전 → 한국어 뜻 → 담긴 내용 → (끊긴 문장이면) 어떻게 이해했는지 → 표현 포인트 → 다른 표현 → 덤 → 추천과 이유.
3. **그림**: 교정이 끝나면 Claude가 문장 전체를 표지판으로, 표현 포인트를 작은 아이콘으로 그립니다.
4. **다듬기**: 빠른 요청 버튼이나 직접 입력. 모든 버전이 남고 다시 고를 수 있습니다. 이해한 뜻이 틀렸으면 "아니야, 이런 뜻이야"로 바로잡습니다.
5. **카드**: 체크한 항목만 카드 한 장에 들어갑니다. 넘치면 미리보기가 알려 주고, 원하는 항목에서 두 장으로 나눌 수 있습니다.
6. **카드뉴스**: 내 카드에서 최대 7개 표현을 골라 표지 + 카드 PNG 세트로 묶습니다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html`, `styles.css` | 화면 |
| `js/app.js` | 상태, 화면 그리기, `db` 읽기/쓰기, Claude 호출 순서 |
| `js/correct.js` | 교정·다듬기 프롬프트와 응답 검증 |
| `js/examples.js` | 프롬프트 예시로 쓰는 실제 교정 대화 4개 |
| `js/ai.js` | 그림 프롬프트와 응답 검증 |
| `js/draw.js` | 그림 검증(`cleanShape`), 손그림 흔들림 렌더러, 표지판 |
| `js/icons.js` | 기본 아이콘(그림이 실패했을 때, 섹션 표시) |
| `js/cardmodel.js` | 카드 데이터: 예전 카드 변환, 체크 → 카드, 두 장 나누기 |
| `js/card.js`, `js/text.js` | 1080×1350 캔버스 렌더러와 줄바꿈 |
| `js/sample.js` | 저장이나 Claude를 쓸 수 없을 때 보여 주는 예시 |

## 데이터 (`db`)

- `threads/{id}`: `{ title, createdAt, updatedAt }`
- `entries/{id}` (v2): `{ schema: 2, status: "draft" | "card", threadId, input, versions: [교정 응답 + instruction], vi, which, picks, breakAt, drawing: { signage, label, icons }, card, usedIn }`
- `entries/{id}` (예전): `{ input, reply, card: { ko, en, icon, alt, tip, sign? }, usedIn }`. 저장된 데이터는 그대로 두고 `normalizeCard`가 읽을 때 v2로 바꿉니다.
- `batches/{id}`: `{ createdAt, pages: [card], entryIds }`

## 그림 규칙

Claude는 200×200 상자 안의 도형만 돌려줍니다: 절대 좌표 `M L Q C Z` path, 원 `{c}`, 타원 `{e}`. 칠 방식은 `s`(선), `sf`(민트 칠 + 선), `d`(진한 칠)입니다.
`cleanShape`가 명령어, 좌표 범위, 개수를 검사하고, 통과한 도형만 기본 아이콘과 같은 흔들림 렌더러로 그립니다. 하나도 통과하지 못하면 한 번 다시 요청하고, 그래도 안 되면 기본 아이콘을 씁니다.

## 개발

```sh
pnpm test        # node --test: 그림 검증, 교정 응답 검증, 카드 모델
pnpm serve       # http://localhost:4173 (Claude와 저장 없이 예시 화면이 뜹니다)
```

아티팩트로 올릴 때는 `index.html`을 페이지로, `styles.css`, `js/*.js`, `fonts/*.woff2`를 `files`로 함께 publish하고 `sample`, `db`, `downloads` 기능을 선언합니다.
