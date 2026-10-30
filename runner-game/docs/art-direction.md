# Art Direction — GPS Runner Game

## 1. 컨셉

밤하늘 같은 짙은 남색 세계 위에, 양모 펠트·솜털 질감의 파스텔 토이 피규어가 부드럽게 빛나며 달린다.
키워드: `felted wool`, `fuzzy rim`, `soft glow`, `toy-like`, `pastel on deep indigo`

**금지**: 검은 외곽선, 하드 섀도, 날카로운 모서리, 사실적 질감.

## 2. 공통 규칙

- **질감**: 모든 표면은 곱고 짧은 털(벨벳/펠트). 윤곽은 솜털 헤일로로 번진다.
- **형태**: 둥글고 통통한 토이 비율(머리·몸통 크고 팔다리 짧음). 디테일은 뭉툭하게 단순화.
- **빛**: 그림자 거의 없음. ambient 위주 + 안에서 빛나는 듯한 bloom. 오브젝트가 배경보다 밝아 스스로 발광해 보인다.
- **심도**: 원경은 보랏빛 안개로 채도를 낮추고 흐리게(대기 원근).
- **모션**: 느리고 부드럽게. 바운스, 사인파 부유, 느린 파티클 드리프트.

## 3. 팔레트

| 토큰 | HEX | 용도 |
|---|---|---|
| `--bg-deep` | `#0b0b2e` | 하늘 상단, 가장 어두운 배경 |
| `--bg-indigo` | `#4a4fb8` | 배경 중심부 |
| `--bg-lavender` | `#c4a6d4` | 비네트, 하단 가장자리 |
| `--cream` | `#f7f2b8` | 캐릭터 의상, 텍스트 |
| `--pink` | `#f5a6c0` | 캐릭터 포인트(소매 끝, 신발) |
| `--hot-pink` | `#ff5fa2` | 네온 포인트, 장애물 |
| `--coral` | `#f28c4b` | 낙엽, 포인트 |
| `--mint` | `#8ef0a0` | 풀 언덕, 빠른 페이스 |
| `--lime-frame` | `#ddf58a` | UI 프레임/테두리 |
| `--neon-red` | `#ff2d55` | 현재 위치 마커, 원경 달 |

## 4. 게임 요소별 적용

### 캐릭터 (러너)
- 러닝 포즈의 펠트 토이 피규어. 크림 옐로 스웨터(핑크/민트 줄무늬 밴드), 흰 바지, 노란 신발.
- 얼굴은 이목구비 생략(민무늬).
- 구현: 3D는 캡슐/구체 조합 + 털 셰이더(fresnel rim + noise), 2D는 스프라이트 시트 + `drop-shadow` 글로우.

### 길 (페이스 색상)

| 페이스 | 색 | 모티프 |
|---|---|---|
| 빠름 (green) | `--mint` `#8ef0a0` | 털 풀 언덕 |
| 보통 (yellow) | `--cream` `#f7f2b8` | 스웨터 |
| 느림 (orange) | `--coral` `#f28c4b` | 낙엽 |
| 매우 느림 (red) | `--hot-pink` `#ff5fa2` | 털 기둥 |

- 길은 통통한 털 리본. 가장자리에 소프트 글로우, 구간 경계는 그라디언트 블렌딩.

### 배경과 오브젝트
- 하늘: 짙은 남색 방사형 그라디언트 + 느리게 떠다니는 알약/구체 파티클. 원경에 붉은 구체 달.
- 장애물: 분홍→연보라 털 기둥과 쿠션형 덩어리(크기 다양).
- 수집 아이템: 낙엽, 구름 조각.
- 원경: 보랏빛 fog, 멀수록 채도 감소.

### UI
- 어두운 반투명 패널, 둥근 모서리(`28px`) + 라임 외곽 라인.
- 폰트: 둥근 산세리프(Pretendard / Nunito), 크림 화이트 + 약한 글로우.
- 버튼: 파스텔 필(pill) 형태, 눌림 스프링 애니메이션.
- 미니맵: 페이스 색 경로 + 발광하는 현재 위치 점(`--neon-red`).

## 5. 렌더링 설정 (three.js)

- Bloom: strength 0.6~0.9, threshold 낮게
- 소프트 비네트(가장자리 보라), 약한 DoF
- Fog: 남색 `#1a1a5e`, 거리 기반
- 톤매핑: Linear 또는 Reinhard (ACES 금지, 파스텔 보존)
- 조명: `HemisphereLight` + 약한 `DirectionalLight`, 그림자 끔 또는 매우 약하게

## 6. CSS 토큰

```css
:root {
  --bg-deep: #0b0b2e;
  --bg-indigo: #4a4fb8;
  --bg-lavender: #c4a6d4;
  --cream: #f7f2b8;
  --pink: #f5a6c0;
  --hot-pink: #ff5fa2;
  --coral: #f28c4b;
  --mint: #8ef0a0;
  --lime-frame: #ddf58a;
  --neon-red: #ff2d55;

  --pace-fast: var(--mint);
  --pace-normal: var(--cream);
  --pace-slow: var(--coral);
  --pace-very-slow: var(--hot-pink);

  --glow: 0 0 24px rgba(247, 242, 184, 0.45);
  --radius: 28px;
}
body {
  background: radial-gradient(ellipse at 50% 30%, var(--bg-indigo), var(--bg-deep) 75%);
  color: var(--cream);
}
```

## 7. 에셋 생성 프롬프트

**캐릭터**
> a cute felted wool toy figure, running pose, soft fuzzy fiber texture, glowing soft rim light, pastel cream yellow knit sweater with pink and mint striped cuffs, white trousers, rounded chubby proportions, faceless minimal face, deep indigo background with lavender vignette, dreamy soft focus, no hard shadows, no outlines

**환경**
> surreal night landscape, giant fuzzy pink pillar shapes and cushion-like mounds covered in visible fur fibers, mint green fuzzy hill, deep navy night sky, purple atmospheric fog, soft bioluminescent glow, dreamy, cinematic

## 8. 주의

- 레퍼런스 이미지의 워터마크/로고(`@snail.ai` 등)와 이미지 원본은 에셋으로 쓰지 않는다. 스타일 참고용으로만 사용하고 새로 제작한다.
