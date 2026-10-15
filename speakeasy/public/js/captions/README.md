# Live captions (ko → en)

English subtitles on the audience page (`share.html`) while the speaker talks
in Korean. Free and light: speech recognition and the off-script fallback run
in the presenter's desktop Chrome; the audience only receives short English
lines over a Supabase realtime channel.

## How it works

1. Before the talk, write a **bilingual script**: the speaker script (same
   `---`-separated, slide-ordered markdown as the notes import) with each
   Korean line followed by its reviewed English on a `> ` line:

   ```md
   ## Introduction

   몇 달 전, 저는 해커톤에서 하루 만에 하나의 서비스를 만들었습니다.
   > A few months ago, I built a service in a single day at a hackathon.
   ```

2. During the talk, press **CC** in the presenter panel of `present.html`
   (desktop Chrome): the first click loads the script (kept in that
   browser), the next ones start / stop listening. `captions.html?deck=<id>`
   is the same thing as a full console (heard text, log, click a line to
   send it).
3. The console follows the current slide over the deck's sync room, listens
   (Korean), finds the script line being said on that slide and broadcasts
   its **reviewed** English. Speech that matches no line is translated by
   Chrome's on-device Translator API (shown in italics as machine
   translation). Clicking a line sends it by hand.
4. `share.html` shows the line at the bottom of the screen; viewers can turn
   it off with the **CC** button (shown once captions arrive).

## Files

| File | Role |
|---|---|
| `captions.html` | React caption console page |
| `src/features/captions/CaptionConsole.tsx` | Console UI |
| `js/captions/engine.js` | Mic → match → send (no UI) |
| `js/captions/matcher.js` | Finds the script line for a heard phrase |
| `js/captions/bilingual.js` | Parses the bilingual script |
| `js/captions/channel.js` | Realtime channel `speakeasy-captions-<room>` |
| `js/captions/audience.js` | Subtitles + CC toggle on `share.html` |

## Removing the feature

Delete `captions.html` and `js/captions/`, then remove the two lines in
`js/view-bootstrap.js` that mention `CAPTIONS_URL` and `mountCaptions` in
`js/presenter-panel.js`. Both pages already work without the folder (the
imports fail quietly and the CC controls stay hidden).
