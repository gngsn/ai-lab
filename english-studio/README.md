# English Studio

혼자 영어 공부하는 로컬 웹앱. 빌드 없이 정적 HTML + ES 모듈로 동작한다
(slides-editor의 pronunciation 트레이닝을 독립 서비스로 확장한 것).

## 세 가지 모드

| 모드 | 페이지 | 설명 |
|---|---|---|
| 🎧 리스닝 | `listening.html` | 아티클을 붙여넣으면 문장 단위 TTS로 읽어줌. 문장 클릭 재생, 전체 재생(다음 문장 프리페치), 문장 반복, 속도 조절. 아티클은 localStorage, 오디오는 IndexedDB에 캐시. |
| 🎙 스피킹 | `speaking.html` | 원어민 TTS를 듣고 따라 말하면 STT로 인식해 단어 단위 발음 채점 + WPM(말하기 속도) 표시. 내 녹음은 take별로 저장·재생 가능. |
| ✍️ 라이팅 | `writing.html` | LanguageTool로 문법 검사(기본 로컬 서버, 언제든 Public API로 전환 가능), Claude/GPT로 자연스러움 첨삭(한국어 설명 + 전체 리라이트 + 점수). |

## 실행

정적 페이지(HTML + ES 모듈) + 로컬 백엔드 두 컨테이너(LanguageTool,
Kokoro TTS)로 구성된다. 백엔드는 `docker-compose.yml` 하나로 관리한다 —
둘 다 이미지를 그대로 쓰므로 커스텀 Dockerfile은 없다.

```sh
npm run stack:up    # docker compose up -d --wait (languagetool + kokoro-tts)
npm start           # python3 -m http.server 8899
# → http://localhost:8899

npm run dev          # 위 두 개를 한 번에 (stack:up && start)
npm run stack:down   # 컨테이너 정지
npm run stack:logs   # 로그 확인
```

## 설정

`js/config.local.js.example`을 `js/config.local.js`로 복사해 채운다
(기본값 파일이 이미 있으므로 필요한 키만 추가해도 됨).

- **TTS** — 기본은 로컬 Kokoro-82M (`docker-compose.yml`의 `kokoro-tts`,
  `npm run stack:up`으로 기동). OpenAI(`OPENAI_API_KEY`) /
  ElevenLabs(`ELEVENLABS_API_KEY`)로 전환 가능.
- **STT** — 기본은 로컬 MLX VibeVoice(`http://localhost:8000`). Apple
  Silicon + MLX 네이티브 실행이 필요해 컨테이너에는 포함하지 않았다 —
  서버가 없으면 자동으로 브라우저 WebSpeech로 폴백. `whisper` 선택 시
  OpenAI 키 필요.
- **문법 검사(LanguageTool)** — 기본은 로컬 서버(`docker-compose.yml`의
  `languagetool`). 로컬 서버 없이 쓰려면 `writing.html` 상단 드롭다운에서
  **Public API**로 바꾸면 된다 (무료 공개 엔드포인트, 요청 빈도 제한 있음,
  텍스트가 languagetool.org로 전송됨). 기본 선택값은 `config.local.js`의
  `LANGUAGETOOL_SOURCE`로 설정.
- **AI 첨삭** — `ANTHROPIC_API_KEY`(Claude, 우선) 또는 `OPENAI_API_KEY`(GPT 폴백).

## 구조

```
docker-compose.yml     로컬 백엔드 (languagetool, kokoro-tts)
index.html            랜딩 (모드 선택)
listening.html/.js    리스닝
speaking.html/.js     스피킹
writing.html/.js      라이팅
js/common.js          공용 헬퍼 (문장 분리 등)
js/tts.js             TTS 엔진 3종 + IndexedDB 캐시 (1.0x로 합성, 재생속도는 playbackRate)
js/stt.js             STT 엔진 (vibevoice→webspeech 폴백, whisper)
js/diff.js            단어 정렬/채점 (LCS + levenshtein)
js/audio-cache.js     IndexedDB (audio / recordings)
css/style.css         다크 테마 공용 스타일
```
