# Pace Runner — Project Specification

This document specifies **Pace Runner**, a web 3D running game: what it is, how it plays, the algorithms and constants behind it, its visuals, UI copy, tests and acceptance criteria.

---

## 1. Development setup and definition of done

1. **Toolchain**: Node.js **25.5.0**, pnpm **11.24.0** (`corepack enable && corepack prepare pnpm@11.24.0 --activate`). macOS or Linux.
2. **Dependencies**: pin the exact versions listed in §3 and commit the lockfile.
3. **Static checks**: `pnpm exec tsc --noEmit` prints nothing and exits 0.
4. **Tests**: `pnpm test` passes the suite described in §11 (**31 tests** across `src/route/route.test.ts`, `src/game/sim.test.ts` and `src/game/stats.test.ts`).
5. **Build**: `pnpm build` succeeds. A Vite "chunk larger than 500 kB" warning is expected (three.js) and is not an error.
6. **Behaviour**: `pnpm dev`, open the printed URL and walk through the acceptance checklist in §12.

---

## 2. Product summary

A web 3D running game. A real GPS run (from a phone or a GPX file) becomes the race course:

- the **route shape** comes from the GPS track,
- the **road colour** and the **per-segment top speed** come from the runner's real pace on that stretch,
- you race a **ghost ("past you")** that replays the same pacing; fall too far behind and it is game over.

The game mechanics follow the Montblanc "The Run" web game: auto-forward on a spline road, left/right steering only, turbo pads, slowdown off the road edge, a 3-2-1-GO countdown, time attack with a saved best time. The visual style follows *Summer Afternoon* (vlucendo): pastel colours, toon shading, wind-blown grass, round "lollipop" trees, soft fog. **No assets from either site are used**; everything is procedural.

All UI text is **English only**. There is no Korean anywhere in the app.

---

## 3. Tech stack

| Concern | Choice |
|---|---|
| Build / dev server | Vite 8.3.4 |
| Language | TypeScript 7.0.2, `strict`, `noUnusedLocals`, `noUnusedParameters`, `moduleResolution: bundler`, `noEmit` |
| 3D | three 0.186.1 (+ addons `BufferGeometryUtils.mergeGeometries`, `RoundedBoxGeometry`) |
| UI tweens | gsap 3.15.0 |
| Tests | vitest 5.0.4 (node environment, no DOM) |
| UI framework | **none** — vanilla DOM, one `index.html` with `<section>` screens |
| Backend / storage | none; `localStorage` only (best time, best coins, chosen character) |
| Fonts (Google Fonts) | **Hanalei Fill** for `h1`/`h2` titles (single weight, `font-synthesis: none`); **Lexend** 400–800 for everything else |
| Audio | WebAudio oscillators only (no audio files) |

---

## 4. File map

```
pace-runner/
  index.html              all screens as <section>s, font links, HUD markup
  package.json            exact-pinned deps, scripts (dev/build/preview/test)
  pnpm-lock.yaml
  tsconfig.json
  README.md
  .gitignore              node_modules, dist
  docs/SPEC.md            this file
  src/
    main.ts               screen flow, camera, HUD, results, character switching, boot
    style.css             all styles (CSS custom properties, mobile breakpoint 720px)
    route/                PURE (no DOM, no WebGL) — fully unit-tested
      types.ts            GpsPoint, Run, Vec2, PaceBucket
      geo.ts              haversine, cumulativeDistance, projectLocal, simplifyRdp
      pace.ts             pointPaces, averagePace, fillPaces, paceRange, bucketOf, format*
      gpx.ts              regex GPX parser
      samples.ts          mulberry32 PRNG + 4 deterministic synthetic sample runs
      course.ts           buildCourse, sampleAt, worldAt, ghostDistanceAt; lane separation, turn rounding; coins/pads/gels/fruit placement
      route.test.ts
    game/
      constants.ts        every balance number + pace colours/labels
      sim.ts              deterministic per-frame simulation, carried items (useItem) + prepareCourse (ghost recording)
      sim.test.ts
      stats.ts            computeStats / medalFor for the My Stats screen (pure)
      stats.test.ts
      fixtures/overlap.gpx  out-and-back + 180° turnaround + figure-8 test route
      input.ts            SteerInput (keyboard + touch halves)
      audio.ts            synthesized SFX
    world/                three.js scene building (needs DOM/WebGL)
      scene.ts            renderer, sky dome, lights, fog, toon ramp
      road.ts             ribbon road, shoulders, edge lines, start/finish, turbo pads
      nature.ts           ground, wind grass, flowers, trees, bushes, clouds
      coins.ts            instanced $ coins
      gels.ts             energy gel pouches
      fruits.ts           banana and shine-muscat pickups
      character.ts        5 characters on one rig + thumbnail renderer
    ui/
      minimap.ts          canvas route drawing (HUD, preview, route cards)
```

---

## 5. Screen flow

```
Home ──My Stats──▶ My Stats (main runner, summary, pace mix, course bests) ──←──▶ Home / My Routes
Home ──My Runs──▶ My Routes (grid) ──card──▶ Course preview ──Run this course──▶ Character select ──Start running──▶ Play
  ▲                         ▲   ▲                         │ ←                              │ ←
  └────────── ← ────────────┘   └───────── ← ─────────────┘                                │
                                ▲                                                          ▼
                                └──── Courses ◀── Result (finish) / Game over ◀────────────┘
                                                   Run again / Try again ──▶ Play (same course & character)
```

| Screen (`Screen` id) | Section id | Camera mode | Notes |
|---|---|---|---|
| `home` | `screen-home` | `portrait` | Viewport-sized logo "Pace Runner" (`min(13vw, 22vh)`; mobile `min(22vw, 16vh)`), the tagline "The route you ran becomes the course.", **My Runs**. On wide screens the camera pans so the character stands on the right (a 700 ms simulated load brings in the 4 sample runs) |
| `select` | `screen-select` | `portrait` | **My Routes** grid — routes are the runner's *rewards* (§9.2). Header has a **My Stats** button |
| `stats` | `screen-stats` | `portrait` | **My Stats** (§9.9): main-runner picker, running summary, pace mix, course bests. Opened from Home (**My Stats** button) or My Routes; ← returns there |
| `preview` | `screen-preview` | `overview` | Route map, Distance/Real time/Avg pace, pace legend with ranges, how-to hint, **Run this course** |
| `character` | `screen-character` | `portrait` | "Who's running?", 5 character cards with rendered 3D thumbnails, **Start running**. The **main runner** is preselected (badge "Main"); picking another runner only changes this race. On wide screens the camera pans 2.3 units sideways so the character stands left of the panel |
| `play` | `hud` | `chase` → `finish` | intro 1.3 s → countdown 3 s → running → ending. The chase camera sits 8.5 units behind the runner along a smoothed heading (±4 units of path, eased), not at the path point behind, so it stays put on hairpins |
| `result` | `screen-result` | `finish` | Time, vs past you, 6 stats, **Courses** / **Run again** |
| `over` | `screen-over` | `chase` | "Past you got away", progress %, **Courses** / **Try again** |

Keyboard: `Esc` quits a run (→ My Routes); during a race `Space` uses the oldest carried item and `1`/`2`/`3` use a slot; `Enter`/`Space` on result/game-over retries. Menus always show the main runner.

---

## 6. Route processing (`src/route/`)

### 6.1 Pace per GPS point
1. `cumulativeDistance` uses haversine with an Earth radius of 6 371 000 m.
2. `pointPaces` uses a sliding window of **±40 m** around each point; pace = Δt / (Δd/1000) s/km.
3. A window gives `null` if any point in it lacks `t`, if Δd < 5 m, or if timestamps go **backwards** (`b <= a`).
4. Pace is clamped to **[150, 1200] s/km**.
5. `averagePace` = (last timed − first timed) / distance between them. If that isn't possible, it falls back to `run.avgPaceSec`, then to 360.
6. `fillPaces` replaces every `null` with the average pace (*"no pace data → use the runner's average pace"*).

### 6.2 Pace buckets (road colour)
`bucketOf(pace, min, max)` splits the run's **[min, max]** pace into **4 equal ranges** with `floor(t*4)` clamped to 0..3. Faster is lower:

| Bucket | Label | Colour | Speed cap × `MAX_V` |
|---|---|---|---|
| 0 | Fast | `#3fc39a` (mint green, distinct from the grass) | 1.0 |
| 1 | Steady | `#f5d04f` | 0.85 |
| 2 | Slow | `#f5a04f` | 0.7 |
| 3 | Very slow | `#ee6767` | 0.55 |

If `max − min < 1e-6`, every point is bucket 1.

### 6.3 Course geometry (`buildCourse`)
1. Reject routes shorter than 200 m (`"Route is too short (needs at least 200 m)."`).
2. `projectLocal`: equirectangular projection around the first point, x = east, y = north. The world uses **north = −z**.
3. `simplifyRdp` with ε = 3 m, then a **centripetal** `CatmullRomCurve3`, then `getSpacedPoints(N−1)` with **N = 1200** evenly spaced samples.
4. **Game length** = `clamp(km*400 + 400, 1400, 3200)` units (3 km → 1600, 5 km → 2400, ≥7 km → 3200). The geometry is uniformly scaled to that length.
5. Each sample's pace is interpolated by the *fraction of real distance* along the route. Its bucket is then smoothed with a **±8-sample majority filter** to avoid thin flicker stripes.
5a. **Lane separation** (`separateParallelPasses`): where a later stretch runs along an earlier one (|tangent dot| > 0.6, within `LANE_SEPARATION` = 2·ROAD_HALF + 1.5 = 10.5, ignoring the last 25 units), the later stretch is pushed sideways so the two roads sit side by side like a two-lane road. Overlapping stretches are grouped (gaps ≤ 4 samples bridged) and each stretch moves to the side it **exits** toward, so it never has to cross back over. Offsets only ever push apart, are widened over ±12 samples, then smoothed twice with a ±12 box filter. Perpendicular crossings are left as crossings.
5b. **Turn rounding** (`roundTightTurns`): if any turn is tighter than `MIN_TURN_RADIUS` = ROAD_HALF, rebuild the line from every `LANE_SEPARATION·m/ds`-th sample (m = 1, 1.5, 2, 3 until it passes). Control-polygon spikes (turn > 120°) are dropped, then 4 rounds of **Chaikin corner cutting**, then an even arc-length resample. This rounds GPS U-turns that reverse within one sample. Real routes end with no turn tighter than `MIN_TURN_RADIUS`; the tip of an extreme synthetic cusp may still pinch, but the path never folds back.
6. **Signed curvature** `k` = cross(tᵢ, tᵢ₊₁)/ds, averaged over ±5 samples. Positive k means a right turn.
7. **Turbo pads**: their own PRNG `mulberry32(fnv1a(run.id))`. Starting at s = 120 and ending 120 units before the finish, a candidate comes every 70–130 units. Slow/very-slow buckets are skipped 75 % of the time. Lateral offset is within ±(ROAD_HALF − 1.6 − 0.3). After each pad, skip 90 more units.
8. **Coins**: PRNG `mulberry32(fnv1a(run.id) ^ 0x9e3779b9)`, separate so coins never move the pads. Coins come in rows of 5–8, spaced `COIN_SPACING = 5`, in one of three shapes: straight (40 %), diagonal across the road (35 %) or arc (25 %), within lateral ±(ROAD_HALF − 1.1). A coin is skipped if it would sit on a pad (|Δs| < 4 and |Δlat| < 2.4). The gap between rows is 35–90 units.
9. **Energy gels**: one at every **5000 real metres** (`GEL_EVERY_M`), except within **300 m** of the finish. So a 5.00 km run has none and a 10 km run has one, at 5 km. Gels sit at lateral 0, and coins within ±15 units of a gel are removed.
10. **Fruit items** (`course.items`): own PRNG `mulberry32(fnv1a(run.id) ^ 0x51ed27)`. Starting at s = 200 and ending 150 before the finish, one every 260–420 units, 50/50 `banana` / `muscat`, lateral within ±(ROAD_HALF − 1.2). Skipped within 6 of a pad or 20 of a gel. Coins within 6 along and 1.6 across are removed.
11. **Ghost placeholder**: the real pacing profile at an analytic time. `prepareCourse` replaces it (§7.3).

### 6.4 Helpers
- `sampleAt(s)` interpolates between samples.
- `worldAt(s, lateral)`: the right vector is `(−tz, tx)`. Past either end of the course it **extrapolates straight** along the end tangent; the chase camera and the post-finish run-out use this.
- `ghostDistanceAt(t)` binary-searches `ghostTime`.

### 6.5 Sample runs (`samples.ts`)
`synthesize()` builds a fake GPS track:
- parametric shape sampled every 8 m,
- ±1.5 m GPS jitter,
- timestamps integrated from a pace function with ±3 % noise,
- timestamps dropped inside optional `timeGaps`.

Everything is deterministic via `mulberry32(seed)`. The order matters, because the first run is the boot/home course:

| id | name | km | notes |
|---|---|---|---|
| `yeouido-10k` | Yeouido Long Run 10K | ~9.9 | has the one energy gel |
| `riverside-5k` | Han River Side 5K | 5.00 | exactly 5 km → no gel |
| `namsan-hills-4k` | Namsan Hills 4K | ~3.98 | hilly, many slow stretches |
| `olympic-intervals-3k` | Olympic Park Intervals 3K | 3.00 | 400 m fast / 200 m easy; timestamps missing 1900–2350 m (tests the average-pace fill) |

### 6.6 GPX import (`gpx.ts`)
- Regex-based so it also runs in node.
- Reads `trkpt` lat/lon, an optional `<time>`, and the first `<name>`. The date comes from the first timestamp.
- Fewer than 2 points throws `"The GPX file needs at least 2 track points."`.

---

## 7. Game simulation (`src/game/sim.ts`) — deterministic, no DOM

### 7.1 Constants (`constants.ts`)
`ROAD_HALF 4.5`, `LATERAL_LIMIT 7.0`, `RUNNER_HALF 0.35`, `MAX_V 32`, `SPEED_CAP [1, .85, .7, .55]`, `TURBO_V 46.4`, `TURBO_TIME 2.0`, `TURBO_PAD_HALF_WIDTH 1.6`, `ACCEL 14`, `OFFROAD_FACTOR 0.45`, `STEER_SPEED 9`, `DRIFT_K 0.2`, `DRIFT_MAX 8`, `GHOST_SLACK 1.03`, `GAP_LIMIT 70`, `COUNTDOWN 3`, `COIN_SPACING 5`, `COIN_RADIUS 0.8`, `GEL_EVERY_M 5000`, `GEL_FINISH_MARGIN_M 300`, `GEL_RADIUS 1.3`, `ENERGY_TIME 6`, `ENERGY_V 36.8`, `ENERGY_OFFROAD_FACTOR 0.75`, `ITEM_SLOTS 3`, `ITEM_RADIUS 1.2`, `BANANA_TIME 4`, `GRIP_DRIFT 0.35`, `MUSCAT_TIME 1.5`, `SPRINT_V 51.2`. Course: `LANE_SEPARATION 10.5`, `MIN_TURN_RADIUS 4.5`.

### 7.2 `stepSim(state, course, steer∈[−1,1], dt)` per frame
1. **Target speed**:
   - turbo → `TURBO_V`
   - else muscat sprint active → `SPRINT_V`
   - else energy gel active → `ENERGY_V`
   - else `MAX_V × SPEED_CAP[bucket]`
   - when off road (and not turbo, and no banana grip): ×`OFFROAD_FACTOR`, or ×`ENERGY_OFFROAD_FACTOR` while energized.
2. **Speed change**: below target, accelerate by `ACCEL` (×2 in turbo, ×3 in sprint). Above target, ease down with `v += (target−v)·min(1, 2.5·dt)`.
3. **Lateral motion**: `lateral += (steer·STEER_SPEED + drift)·dt`, with `drift = clamp(−k·v²·DRIFT_K, ±DRIFT_MAX)` (the centrifugal push in turns), ×`GRIP_DRIFT` during banana grip. Clamped to ±`LATERAL_LIMIT`.
4. **Off road** when `|lateral| > ROAD_HALF − RUNNER_HALF + 0.5`. Entering off road emits `offroad`.
5. **Pickups** are checked between the previous and the new distance:
   - **Pads**: |Δlat| < 1.6 + 0.35 gives turbo for 2 s (`turbo`).
   - **Coins**: |Δlat| < 0.8 + 0.35 (`coin`).
   - **Gels** (|Δlat| < 1.3 + 0.35) and **fruit** (|Δlat| < 1.2 + 0.35) go into the **inventory** (max 3, oldest first) and emit `pickup`. With a full inventory the item stays on the road and `full` is emitted.
   - `useItem(state, slot = 0)` removes and applies an item: **gel** → energy for 6 s; **banana** → grip for 4 s (no grass slowdown, curve drift × 0.35); **shine muscat** → sprint for 1.5 s (`SPRINT_V`). Carrying an item does nothing until it is used.
6. **Finish**: `dist ≥ length`, with the finish time interpolated inside the frame (`finish`). **Game over**: `ghostDist − dist > GAP_LIMIT` (`gameover`).

### 7.3 Ghost (`prepareCourse`)
1. Build the course.
2. Simulate a **perfect run** at dt = 1/120 with no pads, gels or fruit, steering exactly against the drift and re-centring.
3. Record the time at which each sample is crossed, and multiply by `GHOST_SLACK` (1.03). Samples never reached because the finish distance is clamped (floating-point rounding) get the finish time.

The result: a clean line beats the ghost by about 2–3 s, chasing turbos gains about 12 s, and sloppy grass running gets caught. The ghost is drawn at lateral −1.6.

### 7.4 Expected balance (sanity numbers)
On the 5K course:
- **Ghost** ≈ 87.8 s.
- **Clean centred run with no pads** ≈ 85 s, finished.
- **Holding right the whole time**: game over within about 6–26 s.

The 10K course has about 206 coins and the 5K course about 156.

---

## 8. 3D world (`src/world/`)

### 8.1 Scene, camera and lighting
- **Renderer**: antialias, DPR capped at 2, `PCFShadowMap`, sRGB output, no tone mapping.
- **Background and fog**: the background is `#ffe6cc`. A gradient **sky dome** (radius 900, BackSide, follows the camera) runs from `#ffe6cc` at the horizon to `#8ecbf0` at the top. Fog is linear 70–320, retargeted per camera mode.
- **Lights**:
  - `HemisphereLight('#cfe9ff', '#8dbf6a', 1.6)`.
  - `DirectionalLight('#fff1d6', 2.2)` with 2048² shadows over a ±45 frustum. It follows the runner, positioned at (+40, 70, +25).
- **Materials**: everything uses `MeshToonMaterial` with a 3-step ramp (150/210/255, nearest filtering).

### 8.2 Road (`road.ts`)
- **Road surface**: a ribbon mesh over all N samples, ±4.5 wide. Vertex colours are the pace colours lerped 10 % toward `#fff8ec`.
- **Winding**: ribbons must wind **counter-clockwise seen from above** (front face up), and `from < to` is normalised. Otherwise the normals point down and the road renders dark.
- **Overlapping routes** (out-and-back, turnarounds, crossings): the road is split into chunks of 48 samples. Road layers don't write depth. Every frame the chunks are re-ordered by distance from the runner, so the stretch you're on always draws on top. Inside a chunk, the shoulders draw first, then the surface, then the lines. On overview cameras, later stretches draw on top.
- **Pickup window:** turbo pads, coins and gels are only shown from 30 units behind to 450 units ahead of the runner. That way the other pass of an overlapping route never shows its pickups on your road.
- **Edges**: a shoulder `#efdfc0` from 4.5 to 5.4 on each side, and white edge lines between 4.05 and 4.3.
- **Start/finish**: a white start stripe, and a finish arch made of two white capsule pillars and a checkered banner.
- **Turbo pads**: 3.2 × 4.5 planes with a scrolling cyan chevron canvas texture. They fade to 0.15 opacity once used.

### 8.3 Nature (`nature.ts`)
A road-distance grid (8-unit cells) keeps everything off the road.

| Element | Count | Placement | Look |
|---|---|---|---|
| Ground | 1 | — | `#9fd47a` |
| Grass | ≈ `length × 13` (instanced) | lateral 5.4–20.5 | tapered 3-segment blades, vertex gradient `#5f9f45` → `#d8f0a0`, all normals up, wind sway in the vertex shader via `onBeforeCompile` using `instanceMatrix[3].xz` |
| Flowers | `length × 1.2` | — | white/pink/yellow/lilac |
| Lollipop trees | `length / 5` | lateral 9.5–74.5 | crown colours mostly greens, some pink `#f6b8c8` / amber `#ffd38a` |
| Bushes | `length / 8` | — | — |
| Clouds | 26 puffy groups | 85–135 high | no fog |

### 8.4 Coins (`coins.ts`)
- **Look**: soft matte toy coin. The coin sits upright with radius 0.7 and thickness 0.24.
- **Three instanced parts**:
  - edge band `#f39a3d` (open cylinder),
  - face `#fdbd4e` (two circles),
  - gold `#ffd668`: a rim torus plus a raised **$** on both sides. The $ is an S-curve `TubeGeometry` plus two short capsule stubs.
- **Motion**: the coin floats at y 1.1, bobs, spins and tilts −0.18 rad. When picked up it pops up and shrinks away over 0.28 s.

### 8.5 Energy gels (`gels.ts`)
- **Pouch**: built from rounded boxes. The body is red `#e8414f`, with a pink band and shoulder `#f4899a` and a light cap `#f8a9b4`.
- **Label**: a canvas texture on both faces reading "ENERGY / **GEL** / ⚡ / 5K" in Lexend. The design is generic, **with no brand logo**.
- **Size and motion**: scale 1.6, floating at y 1.8 with a gentle sway, and a pulsing pink ground halo. When picked up it rises and vanishes over 0.4 s.

### 8.5b Fruit (`fruits.ts`)
- **Banana**: a curved yellow `TubeGeometry` (`#ffd84d`) with brown and green tips. **Shine muscat**: one glossy green grape (`#b8e86a`) with a white glint and a stem.
- Both float at y ≈ 1.3, spin and bob, sit on a pulsing coloured ring, and pop up and vanish over 0.35 s when picked up. They follow the same pickup window as coins.

### 8.6 Characters (`character.ts`)
All five share **one rig** (body / head / two arm pivots / two leg pivots) and the same animations:
- **run**: stride frequency scales with speed and saturates; arms swing opposite the legs; body bob; lean into steering; forward pitch, stronger in turbo.
- **idle**: a small bounce and a head turn.
- **celebrate**: jumping with arms up.

Shapes are built from primitives. Gradients are baked into vertex colours by height.


| id | name / blurb | Key features |
|---|---|---|
| `hoodie` (default, first) | Hoodie / Mint hood kid | yellow→mint hood + body, pink face disc, two teal bangs, googly eyes, cheeks, smile, drawstrings, puffy sleeves, thin pink legs, mint rain boots; group scale 0.85 |
| `sprout` | Sprout / Leafy smiler | mint→cream→yellow bulb head, two pink rings + three leaf capsules, closed ∩ eyes, orange nose, torus lips, peach→purple belly, mint arms/legs, yellow cuffs, pink boots; scale 0.82 |
| `dizzy` | Dizzy / Giggly sprout | peach→yellow bulb head, two teal rings + four pale-yellow leaves, **✕ eyes** (crossed capsules), **open laughing mouth** (red lower-half bowl + pink tongue + dark lip line, bulging out of the curved head), teal round body + teal shorts + shoulder caps, long pink arms/legs, yellow cuffs, coral boots; scale 0.82 |
| `bloom` | Bloom / Walking flower pot | the head **is** the body: an open-topped sphere (top cap removed, double-sided) with a pink→lilac→mint→mint gradient, mint rim, soil disc, a crown of 7 mint leaves, a curved stem (TubeGeometry) with a 6-petal pink flower and yellow centre; **glossy black bead eyes** with a white glint, **yellow lips**; long thin pink arms and legs; pink→mint boots with mint cuffs; scale 0.82 |
| `beanie` | Beanie / Cozy beanie walker | teal head, pale-yellow beanie (half-sphere dome + rolled torus brim), googly eyes, pink cheeks, smile; **bell-shaped body** from a `LatheGeometry` profile with a coral→peach→yellow gradient; peach short sleeves, teal arms/hands/legs, yellow cuffs, peach boots; scale 0.85 |

A saved `pace-runner:character` value that isn't a known id falls back to the first character, Hoodie.

Face parts are shared: eyes `googly` | `happy` (∩) | `beads` | `x`; mouth `smile` | `lips` (with a colour) | `open`; optional cheeks and nose.

- **Ghost**: the selected character drawn with translucent `#bfe6ff` MeshBasic material (opacity 0.42, no depth write). When it is 0.5–4 units behind the runner (between the runner and the chase camera) its opacity fades linearly to 0, so it never blocks the view.
- **Thumbnails**: `renderThumbnails()` renders the real 3D models once on an offscreen 192 px renderer, so the picker shows exactly what you play.

---

## 9. UI (`index.html`, `style.css`, `main.ts`, `ui/minimap.ts`)

### 9.1 Design tokens
- **Colours**: ink `#2b2233`, soft ink `#6b6275`, paper `#fffaf2`, paper-2 `#fff3e3`, coral `#ff8a7a`, coral-dark `#f06a5a`.
- **Shapes**: panels have 28 px radius and a two-layer soft shadow. Buttons are pills with a 5 px bottom "lip" shadow.
- **Mobile**: the breakpoint is ≤ 720 px. Panels dock to the bottom, and the portrait camera pulls back and aims low (distance 9, look y −0.9) so the character shows above the panel.

### 9.2 My Routes grid (the runner's rewards — important)
The full-screen screen sits over a blurred backdrop (`backdrop-filter: blur(14px)`, lilac→peach wash).

- **Header**: a back arrow, the eyebrow "Every run you finish becomes a course", the title **My Routes** (`clamp(48px, 8vw, 84px)`), and the summary "`N` routes · `X` km · `M` raced".
- **Grid**: `repeat(auto-fill, minmax(min(100%, 250px), 1fr))`, max width 1120, gap 18. On mobile it is a fixed 2 columns.
- **Card**:
  - 4:3 route art drawn by `Minimap` (`line 6, pad 18, glow`), with a lilac drop shadow under the white casing. It sits on one of 4 pastel tints that cycle per card.
  - A "`x.x km`" tag.
  - The name (Lexend 700), the date, then `⏱ time` and `↗ pace/km`.
  - Badges: **New** or **★ best game time**, **$ coins/total**, and **n gel(s)** if the course has any.
  - Hovering or focusing a card lifts it 4 px and tilts it −0.4°. Cards stagger in with gsap.
- **Last card**: a dashed "**+ Add a run** / Upload a GPX file". It is a `<label for="gpx-input">`, and an upload adds the run to the front of the list.

### 9.3 Minimap (`Minimap`) — "track on a street map" style
- North-up. Everything static is cached on an offscreen canvas.
- **Street network:** procedural, seeded by the run id, so it is stable per route. It is drawn in canvas space as two near-perpendicular families of broken, slightly bent streets plus short alleys. Each street has three strokes: a wide faint lilac edge, a blurred white body and a thin bright white core. A radial mask fades the network toward the edges.
- **Route:**
  - an optional coral glow under a white casing;
  - pace-coloured runs on top;
  - red rounded-rect gel markers.
- **Ends:** round coral start and finish dots (coral → deep-pink gradient, white rim, soft shadow). The finish dot has a white centre.
- **Pin:** an optional decorative teardrop map pin (yellow → deep pink) in the top-left corner.
- **Options per use:**

  | Use | line | pad | glow | streets | pin |
  |---|---|---|---|---|---|
  | Route cards | 5 | 20 (top 44) | ✓ | 1 | ✓ |
  | Preview | 5 | 26 | ✓ | 1 | ✓ |
  | HUD | 3.5 | 12 | – | 0.6 | – |

  On route cards the km tag sits top-right so it doesn't cover the pin.
- `draw(player, ghost)` adds a coral player dot and a light-blue ghost dot.

### 9.4 HUD
- **Top-left**:
  - time `m:ss.cc` and a coin chip (CSS coin icon with `$`, `n / total`),
  - an **effect bar** while an item is active: "Sprint" (green), "Grip" (yellow) or "Energy boost" (red), with the remaining time,
  - the gap box: "Side by side with past you" / "`N`m ahead of past you" / "`N`m behind past you", with a bar that is green when ahead, orange, then red as it nears `GAP_LIMIT`.
- **Top-right**: minimap, progress bar, ✕ quit.
- **Bottom**: the pace chip "`Label` · real `m'ss"`" and the speed in km/h. The km/h figure is the game speed converted to real-run equivalents, so the ghost runs at the real average speed.
- **Bottom-left**: **3 item slots** (icons for gel / banana / shine muscat, key hints `Space`, `2`, `3`). Tapping a slot uses it. When the bag is full, "Bag full — use an item!" fades in above the slots. On mobile the pace chip and speed move to the bottom-right.
- **Centre**: the 3/2/1/GO countdown. Using an item shows its banner: "ENERGY GEL!", "BANANA GRIP!", "SHINE MUSCAT SPRINT!".
- **Edge flashes**: cyan for turbo, red for off road, pink when an item is used.

### 9.5 Result and game over
- **Result**:
  - title "Finished!", or "New record!" when beating a previous best,
  - the time,
  - "`x.xx`s faster than past you!" or "… slower than past you".
  - Stats: Equiv. time, Equiv. pace (real time × your/ghost ratio), Coins (★ when it beats the best coin count), Turbo · Items, Off road, Best.
- **Game over**: "Past you got away", then "Caught at `p`% of the course. Hit the blue turbo pads and stay off the grass to win time back!"

### 9.6 Persistence keys (`localStorage`, every access wrapped in try/catch)
`pace-runner:best:<runId>`, `pace-runner:coins:<runId>`, `pace-runner:character` (the **main runner**).

### 9.7 Boot
1. Wait for fonts: `document.fonts.load` for Lexend 700/800 and Hanalei Fill, racing a 1.5 s timeout.
2. Load the first sample course behind the home screen.
3. Start the render loop. `dt` is capped at 0.05.

In dev builds only, `window.__game` exposes `sim`, `course` and `screen` for automated play-testing.

### 9.9 My Stats (`computeStats` in `game/stats.ts`)
Full-screen like My Routes, cards in a 2-column grid (1 column on mobile):
- **Main runner**: the 5 character cards (`.main-picker`); the chosen one has a "Main" badge. It is shown on Home and preselected for every race.
- **Running summary**: total distance, total time, runs, distance-weighted average pace, longest run (with name), fastest run by average pace (with name).
- **Pace mix**: a stacked bar plus legend: the share of all distance in each pace zone (fast / steady / slow / very slow), from course samples.
- **Course bests**: one row per course with a medal, name, km, best game time ("Not raced") and best coins. Medals: 🥇 best ≤ 95 % of the ghost time, 🥈 ≤ ghost time, 🥉 finished.

### 9.8 Audio (WebAudio, unlocked on the first click)
- countdown tick: 660 Hz
- GO: 990 Hz
- coin / item pickup: 988 → 1319 Hz square
- item used: rising arpeggio
- turbo: saw sweep 300 → 1200 Hz
- bump: triangle 140 → 70 Hz
- finish: arpeggio
- game over: descending

---

## 10. Things that are intentionally *not* there
- No real phone sync (it is simulated with samples), no backend, no accounts, no leaderboard.
- No image/model/audio asset files; everything is procedural.
- No title text effects. Titles are plain Hanalei Fill.
- No Korean text.

---

## 11. Tests (31)
- **`route.test.ts`**:
  - haversine and projection;
  - RDP keeps corners;
  - backwards timestamps become null;
  - bucket edges;
  - pace from timestamps, with gaps filled by the average;
  - GPX parse and reject;
  - per sample run: length bounds, all 4 buckets present, monotonic ghost, 50 < ghost < 150 s, more than 5 pads, more than 40 coins on the road in sorted order and never on a pad;
  - gels every 5 km and none at a 5 km finish;
  - `ghostDistanceAt` inverts `ghostTime`;
  - `worldAt` offsets to the right;
  - the overlap fixture: the out-and-back becomes side-by-side lanes (longest overlapping run < 60 units), the figure-8 still crosses, and the path never folds back;
  - real sample routes have no turn tighter than `MIN_TURN_RADIUS`.
- **`sim.test.ts`**:
  - speed stays ≤ `MAX_V` without turbo and settles to the red cap;
  - a clean run beats the ghost and is never game over;
  - turbo pads make the run faster;
  - steering into coin rows collects more than 60 %, while hugging the grass collects 0;
  - a gel goes into the inventory, does nothing until used, then lifts speed above `MAX_V` and wears off;
  - banana: no grass slowdown while it lasts; shine muscat: a sprint above 1.3 × `MAX_V` that eases back;
  - at most 3 carried items, a full inventory leaves pickups on the road, and slots are used oldest-first or by index;
  - ghost timing is complete and strictly increasing on every course;
  - an overlapping route (fixture `src/game/fixtures/overlap.gpx`: out-and-back, 180° turnaround, figure-8) is playable to the finish;
  - running in the grass leads to game over.
- **`stats.test.ts`**: whole-history summary (totals, weighted pace, longest, fastest, pace mix sums to 1), per-course bests with medals, empty history.

---

## 12. Acceptance checklist (manual, `pnpm dev`)

1. **Home**: the coral "PACE RUNNER" logo is in Hanalei Fill and the body text is Lexend; buttons **My Runs** and **My Stats**. The main runner (Hoodie by default) idles in front of the camera on a pastel meadow with swaying grass.
2. **My Runs** shows "Loading your runs…" and then the **My Routes** grid: 4 cards (10K first) plus the dashed "Add a run" card, with the summary "4 routes · 21.9 km · 0 raced". The 10K card shows a "1 gel" badge.
3. **Clicking a card** opens the preview: an overview camera above the course, the route map with a red gel marker on the 10K, stats, the legend with pace ranges, and **Run this course**.
4. **Character select** shows 5 cards (Hoodie, Sprout, Dizzy, Bloom, Beanie) with 3D thumbnails: 5 in a row on desktop, 3 + 2 on mobile. The main runner is preselected with a "Main" badge. Picking another one swaps the 3D character with an elastic pop for this race only.
4a. **My Stats**: choosing a main runner persists across reloads and shows on Home; the summary, pace mix and course bests (with medals once raced) are filled in.
4b. **Items**: in a race, run over a banana / shine muscat / gel: it fills a slot. `Space` (or a tap) uses it with a banner and an effect bar. A 4th pickup shows "Bag full".
4c. **Overlapping routes**: uploading `src/game/fixtures/overlap.gpx` shows the out-and-back as two parallel lanes with a rounded U-turn; the figure-8 crosses cleanly, and the road you're on always draws on top.
5. **Start running**: the camera swoops to the chase view, then 3-2-1-GO with beeps.
   - The road is coloured by pace: mint, yellow, orange, red.
   - The translucent ghost runs on the left.
   - Coins with "$" spin in rows.
   - Blue chevron pads give a turbo with a FOV kick.
   - Leaving the road slows you down and shakes the camera.
   - On the 10K, a red "ENERGY GEL" pouch appears at the halfway point and shows the "5K ENERGY GEL!" banner and the Energy boost bar.
6. **Finishing** gives a celebration orbit and then the result screen. **Run again** restarts; **Courses** returns to the grid, where the card now shows "★ time" and the coin count.
7. **Holding one direction** leads to game over, "Past you got away".
8. **Mobile (390×844)**: the grid is 2 columns, the back arrow doesn't overlap the header, touching the left/right half steers, and the character shows above the bottom panel.
9. There are **no console errors**. A warning that PCFSoftShadowMap is deprecated must *not* appear, because the code uses PCFShadowMap.
