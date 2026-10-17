# Pace Runner — Hackathon Product & Build Specification

**Track:** Track 1 — *Gemini 4 Argon in entertainment* (gaming)
**Build tool:** Google Antigravity with Gemini 4 Argon (`gemini-4-argon`)
**Language of all deliverables:** English

> **Clean-slate statement.** This document is the **only** input for the build. It describes *what* to build and *how to build it*. It contains no source code. Everything is designed, written, tested and committed by the team and Antigravity during the hackathon. Open-source libraries and starter templates are allowed by the rules.

---

## 1. Track fit

### 1.1 Why Track 1
Track 1's first suggested 1-day build is *"a playable 3D browser game or procedural world built in Three.js or WebGPU where Gemini 4 Argon generates the mechanics and level geometry, gemini-3.8-live runs unscripted voice characters that trigger in-game function calls, and lyria-3.5 shifts the soundtrack dynamically."* Pace Runner is exactly that, with one twist: **the level is generated from the player's own real-world run.**

| Track 1 capability | How Pace Runner uses it |
|---|---|
| 3D scenes, physics, procedural worlds | Argon turns a GPS run into a Three.js level: road geometry, pace zones, pickups, set dressing. It then **playtests** the level in a headless simulation and revises it until it passes. |
| Multimodal orchestration, Argon as game master / showrunner | Argon directs a live race: **gemini-3.8-live** voices "Past You", an unscripted rival who calls in-game functions. **lyria-3.5** scores the race adaptively. **gemini-nano-banana-2.1** draws consistent character turnaround sheets. |
| Agentic video understanding (stretch goal) | Argon watches the recorded race and cuts a highlight reel that matches music beats and voice lines. |

### 1.2 Why not the other tracks
- **Track 2 (hard tech):** there's no hardware or physical-systems engineering target.
- **Track 3 (social good):** running is health-adjacent, but the product is entertainment and gives no health guidance. Positioning it as health would also require medical-grade human-in-the-loop safeguards for no benefit.
- **Track 4 (developer tools):** the product is for players, not developers.

### 1.3 Rubric mapping
| Criterion | Evidence we will show |
|---|---|
| Working demo on real input | The team's own real runs (GPX exports and running-app screenshots) become playable levels live, with no console errors |
| Argon / Managed Agents with verification loops | Four visible loops: level playtest, character render-and-critique, import reconciliation, grounded recap. Each one appears in an on-screen agent trace |
| Problem & impact | Tracked runs are "dead data". Turning them into replayable, shareable games gives recreational runners a reason to come back. It can grow into a product with sync, friends' ghosts and club leagues |
| Originality / only-with-Argon | Levels generated from your own body's history; a live voiced rival with game-function tools; 1M-context reasoning over a full running history; image → 3D character with self-critique |
| Clarity | Two-minute video and README built around one sentence: *"Your run, replayed as a game."* |

---

## 2. Product definition

### 2.1 One-liner and users
- **One-liner:** *Pace Runner turns the run you just finished into a 3D race against past you, directed live by Gemini 4 Argon.*
- **Primary users:** recreational runners (5–15 km) who track runs on a phone or watch but rarely revisit the data.
- **Secondary users:** running crews who want something fun to share after a group run.

### 2.2 Core loop
1. **Import a run:** a GPX file, or a screenshot of any running app's workout screen.
2. **Argon builds the level** from the route and pace, then playtests it until it is fair and fun.
3. **Pick or forge a runner:** five built-in characters, or forge one from any image.
4. **Race:** the course follows your real route, and a ghost of past you replays your real pacing. "Past You" talks to you live and the music reacts to the race.
5. **Result:** time vs past you, coins, and a recap grounded in your whole history. The level joins your **My Routes** trophy grid.

### 2.3 Game rules (requirements, not implementation)
- **Course shape:**
  - The route's shape and bends come from the GPS track, after projection, smoothing and simplification.
  - Course length scales with the real distance so that a race lasts about **60–120 seconds**.
  - **Overlapping routes must stay readable:**
    - Out-and-back stretches (the same street run twice) become **side-by-side lanes**, each moving to the side it leaves toward so it never crosses back over.
    - GPS U-turns that reverse within a sample or two are **rounded** so the road never folds back on itself.
    - Real crossings stay crossings.
    - The stretch the runner is on always draws on top.
    - Pickups from the other pass never appear on your road.
- **Pace zones:**
  - Split the run's pace range (fastest → slowest) into **four equal bands**: fast, steady, slow, very slow.
  - Colour the road by band: mint green, yellow, orange, red. The mint must be clearly distinct from the grass.
  - Each band caps top speed, so slower real stretches play slower.
  - Points with no timestamps use the run's average pace.
- **Controls:**
  - The runner moves forward automatically and the player only steers left/right: keyboard arrows or A/D, or touching the left/right half of the screen.
  - Curves push the runner outward in proportion to speed² × curvature.
- **Hazards:** leaving the road onto grass slows you down hard, with a camera shake.
- **Pickups:**
  - Turbo pads give a short burst above the speed cap.
  - Coins come in rows (straight, diagonal or arc) and only count toward the score.
- **Carried items** (picked up into **3 slots**, used when the player chooses: `Space` uses the oldest, `1`–`3` a slot, or tap the slot):
  - **Energy gel:** one at every **5 km of the real run**, never within 300 m of the finish. Lifts the pace cap for about 6 s.
  - **Banana:** about 4 s of grip: no grass slowdown and much less curve drift.
  - **Shine muscat** (a single grape): a 1.5 s sprint well above the pace cap.
  - Bananas and muscats lie on the road every few hundred metres, away from pads and gels.
  - Carrying an item does nothing until it is used. A full bag leaves new pickups on the road and says so.
- **Ghost ("Past You"):**
  - The ghost's timing comes from a simulated clean run of the level, made a few percent slower.
  - A clean line beats it narrowly, turbos win time, and sloppy driving loses.
  - Falling more than a set gap behind is **game over**.
- **Start and scoring:**
  - A 3-2-1-GO countdown.
  - Best time and best coin count are saved per level.
  - The result screen shows the time difference to past you and an "equivalent real pace".
- **Feel and style:** **follow [`DESIGN.md`](./DESIGN.md) exactly.** It is mandatory and part of every Gate. It covers colour tokens, typography, components, every screen layout (desktop and mobile), the 3D art direction, the five characters part by part, pickups, the route-map style, motion and sound, plus the inspiration sites.
  - In short: a pastel, toy-like, toon-shaded meadow at golden hour, with wind-blown grass, round trees and soft fog.
  - All UI copy is in English.
  - Titles use **Hanalei Fill** and body text uses **Lexend** (Google Fonts).

### 2.4 Screens
**Home → My Routes grid → Level preview → Character select → Race → Result / Game over**, plus **My Stats** (from Home and My Routes) and an always-available **Agent trace** drawer.

- **My Routes:** a grid of reward cards. Each card shows the route art coloured by pace, the distance, the real time and pace, and badges (new / best time, coins, gels). The last card is "+ Add a run".
- **Level preview:** the route map, stats, the pace legend with real pace ranges, and Argon's level notes ("Coach picks").
- **Character select:** five built-in runners plus **+ Forge from image**. The player's **main runner** is preselected; picking another changes only this race.
- **My Stats:**
  - a **main-runner** picker (saved; shown on Home and preselected for races);
  - a **running summary**: total distance, total time, runs, average pace, longest run, fastest run;
  - a **pace mix**: the share of all distance in each pace zone;
  - **course bests**: best time, best coins and a medal per route (gold: beat past you by ≥ 5 %, silver: beat past you, bronze: finished).
- **Race HUD:**
  - time and coins;
  - the gap to past you;
  - a minimap of the whole route with your position and the ghost's;
  - the current pace zone and its real pace;
  - **3 item slots** and an active-effect bar (energy / grip / sprint);
  - live "Past You" subtitles.

---

## 3. Gemini features

Each feature is an agent with a verification loop. The **Managed Agents** orchestrator runs them, and every step is streamed to the Agent trace drawer: input summary, output summary, verdict, iteration count and duration.

### A1 — Level Director (Argon) ★ the Track 1 centrepiece
- **Input:** run data (route, per-point pace, splits) plus a theme request (e.g. "Seoul riverside at sunset").
- **Output (`LevelSpec` JSON):**
  - road segments with pace zones;
  - turbo pad and coin-row placements, with a "reason" for each;
  - gel stations;
  - set-dressing themes per section (trees, flowers, river, city props);
  - sky and lighting mood;
  - music cue points for A4;
  - short "Coach picks" notes.
- **Verification loop — headless playtest** (at most 4 iterations):
  1. **Schema and bounds:** the spec validates, every object is on or beside the road, and nothing overlaps.
  2. **Bot playtests:** run 3 bots through the deterministic simulation: a perfect line, an average player and a sloppy player.
  3. **Fairness targets:** the perfect bot beats the ghost; the sloppy bot loses; race duration is within 60–120 s; at least one turbo opportunity per 400 m; no unwinnable stretch.
  4. On failure, Argon receives the measured numbers and revises the spec.
- **Fallback:** a deterministic procedural layout, labelled "procedural (no AI)".

### A2 — Character Forge (Argon + gemini-nano-banana-2.1)
1. The user uploads any image they own: a mascot, pet or selfie.
2. **nano-banana-2.1** produces a consistent **turnaround sheet** (front, side, back) in the toy art style.
3. **Argon** writes a `CharacterSpec` JSON made of primitive parts and colours on a fixed rig. The client never runs model-written code.
4. **Verification loop** (at most 5 iterations; passes when the critique score is ≥ 85 and every deterministic check passes):
   - **Validate:** the spec matches the schema (≤ 40 parts, bounded numbers, `#rrggbb` colours).
   - **Render:** front, ¾ and side views plus a run-pose frame in a headless browser.
   - **Deterministic checks:**
     - height within the allowed range;
     - feet on the ground and nothing below it;
     - **every face part is in front of the head surface**, checked by raycast;
     - left/right symmetry;
     - the thumbnail is not cropped.
   - **Critique:** Argon compares the renders with the turnaround sheet and returns `{score, pass, issues:[{part, problem, fix}]}`.
   - **Patch:** Argon revises the spec. The diff is logged.
5. **Human in the loop:** the user must **Approve** before the character appears in the picker.
6. The five built-in characters are themselves authored as `CharacterSpec`s during the build. That proves the format works and gives Argon few-shot examples.

### A3 — "Past You" live voice rival (gemini-3.8-live)
- **What it is:** a voiced, unscripted rival character speaking in the player's own competitive voice persona. It reacts to the race in real time.
- **Live state it receives:** gap to the ghost, pace zone, pickups, off-road events, distance left.
- **Tools it may call (function calling):**
  - `taunt(text)` — subtitle plus voice
  - `cheer(text)`
  - `requestCoinTrail(pattern)` — spawns a coin row at least 80 m ahead
  - `requestMusicIntensity(level)`
  - `announceSplit(km)`
- **Verification and guardrails:** a rules engine validates every tool call before it runs:
  - argument ranges and placement legality (it may never place objects behind the player or on top of hazards);
  - rate limits (at most one spawn per 15 s);
  - a content filter (friendly competitive tone; no health or medical claims).
  - Rejected calls are returned to the model with the reason.
- **Controls:** a mute toggle, and subtitles always on.

### A4 — Adaptive soundtrack (lyria-3.5)
- **Generation:** Argon, as showrunner, writes a short music brief per level, based on its theme and the section cue points from A1. Lyria generates layered stems.
- **Mixing:** the client crossfades layers by game state:
  - pace zone sets energy;
  - a growing gap to the ghost sets tension;
  - turbo and gel trigger a lift;
  - the finish plays an outro.
- **Verification:** generated audio must exist, decode, loop cleanly and match the requested duration. Otherwise retry once, then use a silent fallback with synthesized UI sounds.

### A5 — Run-from-anything import (Argon, multimodal)
- **Input:** GPX (parsed locally, no model call) **or** a screenshot of a running app's workout screen showing the map, splits and summary.
- **Extraction:** Argon returns the summary (distance, duration, average pace, date), per-km splits, and a normalised route polyline traced from the map, each with a confidence value.
- **Verification — numeric reconciliation** (at most 3 retries, with the exact mismatch fed back):
  - the split times sum to the duration within ±3 %;
  - the number of splits matches the distance;
  - the average pace equals duration ÷ distance within ±3 %;
  - the route is continuous, with no segment longer than 15 % of the total.
- **Human in the loop:** an overlay of the traced route on the screenshot plus the extracted numbers. The user picks **Looks right** or edits a value.

### A6 — Long-context recap and rival pick (Argon, 1M context)
- **Input:** the player's whole history in one request: every run, every point and split.
- **Output:** a recap of at most 120 words, a headline, and the **best rival run** to race next, with a reason.
- **Tools:** deterministic stats functions (per-run stats, run comparison, pace by km).
- **Verification:** every number in the text must equal a tool result, and the rival must exist. Unsupported claims are sent back for regeneration (at most 3 tries).

### A7 — Highlight reel (stretch goal)
- **Generation:** record the race canvas. Argon (agentic video understanding) picks the best 15 s around the overtakes, gel pickups and finish, aligned to music beats and "Past You" lines.
- **Optional:** gemini-omni-1.1-flash renders a stylised intro card.
- **Verification:** every cut timestamp lies within the recording, and every event it claims appears in the event log.

> **Model access.** Model names follow the hackathon's track description: `gemini-4-argon`, `gemini-3.8-live`, `gemini-nano-banana-2.1`, `lyria-3.5`, `gemini-omni-1.1-flash`, and the `antigravity-preview-09-2026` sandbox. Before writing integration code, confirm each model's availability, SDK calls, parameters (e.g. `thinking_level="high"` for Level Director planning) and quotas in the official Google AI Studio / Agent Platform documentation. Do not guess API shapes.

---

## 4. Architecture

```
Browser — Vite + TypeScript + three.js + gsap   (Firebase Hosting)
  ├─ game: deterministic simulation, renderer, HUD, input, audio mixer
  ├─ live voice session (gemini-3.8-live, via short-lived token from the server)
  └─ /api/** (fetch + Server-Sent Events for live agent progress)
        │
Cloud Run "pace-runner-api" — Node + TypeScript
  ├─ Managed Agents orchestrator: LevelDirector · CharacterForge · Importer · Recap · Showrunner(music)
  ├─ Gemini 4 Argon + companion models via the official SDK (service account; no keys in the browser)
  ├─ Verifiers: JSON-schema validation, headless playtest (shared simulation module),
  │            headless renderer (Chromium + three.js) for Forge views, numeric reconcilers
  ├─ Tool-call rules engine for the live rival
  └─ Storage: Firestore (runs, levels, characters, traces) + Cloud Storage (images, audio, renders)
```

- **One shared simulation module** is used by both the browser and the server playtests, so the bots experience exactly what players do.
- **Offline fallback:** GPX import, procedural levels and built-in characters work with **zero** API calls.
- **Security and cost:**
  - per-IP rate limits;
  - upload size limits;
  - images and audio stored privately;
  - a daily budget guard that switches AI features to "cached demo" mode, clearly labelled.

### 4.1 Data contracts (JSON Schema files in `/shared/schemas`)
- **`RunData`:** id, name, date, points[{lat, lon, t?}], splits[{km, paceSec}], source ("gpx" | "screenshot").
- **`LevelSpec`:**
  - id, runId, theme;
  - segments[{fromM, toM, zone}];
  - pads[{s, lateral, reason}];
  - coinRows[{s, pattern, lateral, count}];
  - gels[{s, km}];
  - dressing[{fromM, toM, set}];
  - sky, lighting;
  - musicCues[{s, mood}];
  - notes[].
- **`CharacterSpec`:**
  - name, blurb, scale, hipY, armRest;
  - body.parts[], head{y, parts[], face};
  - arm{pivot, length, radius, paint, tip[]}, leg{pivot, length, radius, paint, tip[]}.
  - A **part** has: shape ∈ {sphere, capsule, torus, cylinder, box, halfSphere, lathe, tube}, params, position, rotation, scale, and paint (a hex colour, or a bottom→top gradient of ≤ 4 colours).
  - A **face** has: eyes ∈ {googly, happy, beads, x, dots}, mouth ∈ {smile, lips, open}, plus optional cheeks and nose.
  - At most 40 parts; every number bounded.
- **`ToolCall`:** name, args, issuedAt, verdict ("accepted" | "rejected"), reason.
- **`Trace`:** agent, step, iteration, inputSummary, outputSummary, verdict, ms, cached:boolean.

---

## 5. Build specification

### 5.1 Environment
| Item | Choice |
|---|---|
| Agentic IDE | Google Antigravity, agent model `gemini-4-argon`; sandbox `antigravity-preview-09-2026` for test harnesses |
| Prompt prototyping | Google AI Studio (system prompts for each agent, saved to `/prompts/*.md` in the repo) |
| Runtime | Node 22+, pnpm |
| Client | Vite, TypeScript (strict), three.js, gsap |
| Server | Cloud Run (Node/TS), Firestore, Cloud Storage |
| Hosting | Firebase Hosting with `/api/**` rewritten to Cloud Run (region `asia-northeast3`) |
| Tests | Vitest (unit and simulation), Playwright (end-to-end and visual checks in Antigravity's browser) |
| CI | GitHub Actions: typecheck, unit tests, schema tests, build on every push |

### 5.2 Repository layout (new public repo, created at kickoff)
```
pace-runner/
  apps/web/          game client (scenes, sim adapter, HUD, screens, audio mixer, live-voice client)
  apps/api/          Cloud Run service (agents, verifiers, rules engine, renderer, SSE)
  packages/sim/      deterministic course builder + simulation + bots (shared by web and api)
  packages/schemas/  JSON Schemas + generated TypeScript types
  prompts/           system prompts per agent (versioned)
  fixtures/          the team's own sample runs (GPX + screenshots) and test images the team owns
  docs/              BUILD_LOG.md (timestamped), ARCHITECTURE.md, DEMO.md
  .github/workflows/ci.yml
  LICENSE (MIT) · README.md
```

### 5.3 How each phase is executed in Antigravity
Every phase follows the same agent loop:
1. **Plan:** Argon writes a short plan into `docs/BUILD_LOG.md` (time, goal, files).
2. **Implement** in small commits.
3. **Verify:** typecheck and unit tests in the sandbox, then a Playwright run in Antigravity's browser with screenshots.
4. **Compare** the results with the phase's **Gate** list below. If anything fails, fix and repeat.
5. **Record:** add the evidence to the build log (test output summary, screenshot paths) and commit as `phase N: <what>`.

**A phase is never marked done without its Gate evidence.**

### 5.4 Phases and time boxes (one-day sprint, ~14 working hours)
| Phase | Time | Work | Gate (must pass) |
|---|---|---|---|
| **P0 Setup** | H0–H1 | Public repo, monorepo skeleton, CI, Firebase + Cloud Run hello-world, schema package | CI green; hosted page loads; `/api/health` returns 200 |
| **P1 Core game** | H1–H4 | GPX import, course builder (incl. lanes for overlapping passes and U-turn rounding), pace zones, simulation, ghost, pickups, carried items, controls, HUD, toon meadow, screens, My Stats + main runner, fonts | Unit tests for pace bands, gel placement, simulation outcomes (clean beats ghost, grass → game over, turbo faster), items (inventory cap, each effect), stats, and an out-and-back + U-turn + figure-8 GPX fixture (lanes separate, crossings kept, never folds back, playable to the finish); a team member's real GPX plays end to end on desktop and phone; every item in the DESIGN.md §8 checklist passes |
| **P2 Level Director (A1)** | H4–H6.5 | `LevelSpec`, Argon prompt, bot playtest verifier, trace streaming, procedural fallback | 3 real runs produce levels that pass the playtest within 4 iterations; the trace shows each iteration |
| **P3 Character Forge (A2)** | H6.5–H9 | `CharacterSpec` interpreter, 5 built-in specs, nano-banana turnaround, headless renderer, checks + critique loop, Approve UI | 3 owned images forge approved characters within 5 iterations; the face-in-front check catches a seeded bad spec |
| **P4 Live rival + music (A3, A4)** | H9–H11 | Live session, tool schema, rules engine, subtitles, mute; Lyria stems + adaptive mixer | During a race, ≥ 3 accepted tool calls change the game, and an illegal call is visibly rejected; music layers respond to zone, gap and turbo |
| **P5 Import + recap (A5, A6)** | H11–H12.5 | Screenshot extraction + reconciliation + confirm overlay; long-context recap with grounded numbers | Screenshots from 2 different apps import within ±3 %; 0 unsupported numbers across 5 recaps |
| **P6 Deploy + demo data** | H12.5–H13.5 | Production deploy, budget guard, cached-demo labels, seed the team's real runs | Public URL: no console errors on Chrome/Safari/iOS/Android; the game still works with the API blocked |
| **P7 Submission** | H13.5–H14 | README, Project Description, 2-minute video | Checklist in §6.4 complete |

**Stretch goal if time remains:** A7 highlight reel.

**Cut order if behind:** A7 → A6 → music falls back to synthesized layers → screenshot import falls back to GPX only. **Never cut** A1, A2 or the trace drawer: they carry the verification-loop score.

### 5.5 Test harness details
- **Simulation bots** (in `packages/sim`), all deterministic with a fixed timestep:
  - **perfect:** cancels curve drift exactly and stays centred;
  - **average:** steers with reaction noise and grabs about 50 % of pads;
  - **sloppy:** misses pads and drifts onto the grass periodically.
- **Fixtures:** real GPX runs (3–10 km), a run with missing timestamps, a run whose timestamps go backwards, a very short run, an **out-and-back run with a sharp U-turn and a figure-8**, and app screenshots.
- **Visual checks:** Playwright screenshots of every screen at 1280×800 and 390×844, attached to the build log.
- **Contract tests:**
  - every agent output must validate against its schema;
  - each verifier has a "known bad" fixture it must reject.

### 5.6 Content and licensing
- Use only images, audio and characters the team **owns or has licensed**. Do not ship watermarked stock images in the public repo or the video.
- Credit the fonts (Hanalei Fill, Lexend: SIL OFL) and libraries in the README.
- Don't use third-party brand logos (running apps, gel makers) in game assets.

---

## 6. Submission package

### 6.1 Project Description (draft)
> **Pace Runner — your run, replayed as a game.**
> Recreational runners track every run, but the data dies the moment they stop their watch. Pace Runner turns any run, whether a GPX file or just a screenshot from your running app, into a 3D race on your real route against a ghost of *past you*.
>
> **Gemini 4 Argon is the game master:**
> - it **builds the level** from your route and pace, then playtests it with simulated bots until it's fair;
> - it **forges your runner** from any image (with gemini-nano-banana-2.1 turnarounds), critiquing its own 3D renders until they match;
> - it directs **"Past You"**, a live gemini-3.8-live rival who talks trash and calls in-game functions through a verified rules engine;
> - it scores the race with adaptive **lyria-3.5** stems;
> - it reads your entire history in one 1M-token context to pick your next rival.
>
> Every AI step runs in a verification loop you can watch in the agent trace, and you approve every character and imported run.
>
> **Built during the hackathon with Google Antigravity + Gemini 4 Argon.** Track 1: Entertainment.

### 6.2 README outline
1. Pitch + GIF
2. Demo link + video
3. How to play
4. How Gemini 4 Argon is used: each agent, its verification loop and its fallback
5. Architecture diagram
6. What's live / cached / simulated
7. Setup (local + deploy)
8. Build log summary
9. Credits and license

### 6.3 Demo video (~2:00)
| Time | Shot |
|---|---|
| 0:00–0:10 | A runner stops their watch: "Your run is dead data." |
| 0:10–0:30 | Drop a running-app screenshot → reconciliation ✓ → Looks right |
| 0:30–0:50 | Level Director: the trace shows playtest iterations (perfect / average / sloppy bots) until PASS |
| 0:50–1:10 | Character Forge: turnaround sheet → renders → score climbing → Approve |
| 1:10–1:40 | The race: pace-coloured real route, the ghost, "Past You" speaking live and spawning a coin trail, the music lifting on the gel |
| 1:40–1:52 | Result + grounded recap + "Race your rival" + the My Routes trophy grid |
| 1:52–2:00 | "Built with Gemini 4 Argon in Antigravity during the hackathon." Track 1. |

### 6.4 Final checklist
- [ ] All demo code written during the event; the public repo's history shows steady progress and `docs/BUILD_LOG.md` is timestamped.
- [ ] Real inputs (the team's own runs) work end to end on the public URL with no console errors.
- [ ] A1–A6 loops are visible in the trace; anything cached is labelled; fallbacks work with the API blocked.
- [ ] Human-in-the-loop: character approval, import confirmation, and a mute/subtitle option for the live voice.
- [ ] Only owned or licensed assets; credits and an MIT license included.
- [ ] Project Description, README and video in English; Track 1 stated.

---

## 7. Future development (NOT in the hackathon scope)

> Everything in this section is **out of scope for the hackathon build**. Do not schedule it in §5.4, do not add it to the Gates, and do not show it as a live feature in the description or video. It may be mentioned once as "What's next".

### 7.1 X1 — World Director: GPX → the world of *that* run
**Idea:** from a single GPX file, Argon recreates the run's place, time, weather and mood as the game world, and directs the music to match. The same route run at dawn in spring and at night in the rain becomes two different worlds.

**Inputs derived from the GPX:**
- **Environment:** per-section surroundings (riverside, bridge, city blocks, park, hill) and nearby landmarks, from Google Maps grounding along the route.
- **Time:** local time of day and season, from the timestamps and the route's time zone.
- **Weather:** the actual conditions at that time and place (clear, rain, fog, temperature), from a historical weather source.
- **Mood:** the race's emotional arc, from the pace profile (easy start → struggle on the hill → final kick).

**Output (`WorldSpec` JSON), applied on top of the base level:**
- biome sections chosen from a **fixed, pre-built prop library** of 8–10 biomes (Argon picks combinations, placement, colour and mood; it never invents geometry);
- landmarks shown as simplified toy props;
- sky, lighting, fog and weather effects;
- palette and mood keywords;
- music cues per section, handed to lyria-3.5.

Every field also records where its value came from: `source: "data" | "default" | "user"`.

**Verification loop:**
1. **Grounded places:** every place or landmark in the spec must appear in the map grounding results; invented places are rejected and regenerated.
2. **Time and weather consistency:** the sky and lighting must match the local time of day at the timestamps and the recorded weather (e.g. a 21:00 run must not have a midday sky).
3. **Route alignment:** biome boundaries must line up with real route positions (e.g. the bridge section actually crosses the water).
4. **Visual critique:** headless screenshots of each section are compared by Argon with the spec's intent; Argon scores and patches.
5. **Fairness:** the base level's bot playtest still passes. A pretty world that plays unfairly fails.

**Safety and control:**
- **Privacy zones, on by default:** start and finish points are usually near home. Hide or blur a radius around both on every shared surface (cards, minimap, screenshots, video).
- **Human in the loop:** the user sees a world preview and picks **Build this world** or **Regenerate**, and can override any value.

### 7.2 Default settings when information is missing
When an input is missing, invalid or its lookup fails, X1 falls back to the defaults below **without asking**.
- The world preview marks each defaulted value with a **"Default"** badge so the user can see and change it.
- The `WorldSpec` records `source: "default"` for that field.
- A run with *no* usable information at all gets exactly the base game's standard look: the pastel meadow at golden hour.

| Input | Missing when | Default |
|---|---|---|
| Environment / biome | no map grounding results, or the lookup fails | **Pastel meadow** for the whole route: grass, round trees, flowers |
| Landmarks | none found, or not verified by grounding | **None.** No landmark props are placed |
| Time of day | the GPX has no timestamps | **Golden hour:** late afternoon, low warm sun, peach horizon |
| Time zone | it can't be derived from coordinates | The **device's time zone** |
| Season | the GPX has no date | **Late spring:** fresh greens, a few blossoms |
| Weather | no timestamp or location, or the weather lookup fails | **Clear and mild:** about 18 °C, light breeze, no rain or fog |
| Mood arc | no pace data (only the route) | **Steady build:** calm start, rising energy at about 70 % of the course, big finish |
| Pace zones | no timestamps at all | Every point uses the run's **average pace**, or a 6:00 /km assumption if no average is known, so the whole road is one zone |
| Music brief | no mood or theme, or the brief generation fails | **Upbeat lo-fi pop, ~105 BPM**, four layered stems (base, drums, lead, finale) |
| Music audio | lyria-3.5 unavailable, or the output fails verification | **Synthesized layers** in the browser, with the same adaptive mixing rules |
| Run name | the GPX has no `<name>` | `"Run on <date>"`, or `"My run"` if there's no date |
| Run date | no timestamps | The **import date** |
| Privacy zone | (always applied unless the user turns it off) | **On, 200 m** around the start and finish |

### 7.3 Other later ideas
- Automatic sync from running platforms (subject to their API terms; check AI-use restrictions before sending their data to any model).
- Friends' ghosts and crew leagues.
- A native phone companion that reads workout routes directly from the phone's health store.
