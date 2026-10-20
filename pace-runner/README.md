# Pace Runner

A web 3D runner MVP that turns a GPS run into a race course. The road's bends come from the real GPS track; its colours and per-segment top speed come from your real pace. You race a ghost ("past you") that replays that pace.

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm test     # route processing + game simulation unit tests
pnpm build
```

## Docs
- [`docs/SPEC.md`](docs/SPEC.md) — full project specification (rules, algorithms, constants, UI, tests, acceptance checklist)
- [`docs/ARGON_BRIEF.md`](docs/ARGON_BRIEF.md) — hackathon product & build specification for Google Antigravity / Gemini 4 Argon (Track 1)
- [`docs/DESIGN.md`](docs/DESIGN.md) — mandatory visual design spec and the inspiration sites
- [`docs/GEMINI_GUIDE.md`](docs/GEMINI_GUIDE.md) — how to drive the Antigravity agent through the build, with prompts

## Flow
Home → **My Routes** grid → course preview → character select → start (Home → **My Stats** for your summary and main runner)

Routes are the runner's reward: every finished run becomes a collectible card with its route art (coloured by pace), real time and pace, and badges for best game time, coins and energy gels.

## Controls & rules
- Steer with ← → / A D, or by touching the left/right half of the screen
- Blue arrow pad = turbo (2 s)
- Items you **carry** (3 slots) and use with `Space` / `1`–`3` or by tapping a slot:
  - **Energy gel** (one at every 5 km of the real run, never within 300 m of the finish): 6 s with no pace speed cap (1.15× top speed) and a lighter grass penalty
  - **Banana**: 4 s of grip — no grass slowdown and much less drift in curves
  - **Shine muscat** (one grape): a 1.5 s sprint at 1.6× top speed
  - A full bag leaves new pickups on the road
- Gold coins = collectibles, laid out in straight, diagonal and arc rows; best coin count is saved per course
- Off the road (grass) = slowdown + camera shake
- Fall too far behind the ghost = game over

## Structure
| Path | Role |
|---|---|
| `src/route/` | GPX parsing, projection, RDP simplification, pace + 4 pace buckets, course building (pure functions) |
| `src/game/sim.ts` | Deterministic game simulation (speed caps, turbo, gels, coins, grass, centrifugal drift, ghost). `prepareCourse` records the ghost from a simulated perfect run |
| `src/game/constants.ts` | All balance values (speeds, turbo, gel, ghost slack, game-over gap) |
| `src/world/` | Three.js scene: toon shading, wind-blown instanced grass, trees, road ribbon, coins, gels, characters |
| `src/ui/minimap.ts` | Route drawing coloured by pace (HUD minimap, preview, route cards) |
| `src/main.ts` | Screen flow, camera, HUD, results |

## Rules of the road
- Pace colours: the run's [min, max] pace split into 4 equal ranges — green (fast) → yellow → orange → red (slow)
- Stretches without timestamps use the average pace
- Speed cap multipliers per colour: 1.0 / 0.85 / 0.7 / 0.55
- Course length scales with distance (1400–3200 units), so a game lasts roughly 1–1.5 minutes
- Overlapping routes: out-and-back stretches become side-by-side lanes, sharp GPS U-turns are rounded, crossings stay crossings, and the road you're on always draws on top

## MVP limits
- Phone sync is stood in for by 4 bundled sample runs (3K–10K); real data comes in via GPX upload
- The 5 characters (Hoodie, Sprout, Dizzy, Bloom, Beanie) are built from primitives and vertex gradients (`src/world/character.ts`). The **main runner** is chosen in My Stats, saved in localStorage, shown on Home and preselected for races
- **My Stats**: running summary, pace mix, and course bests with medals (computed by `src/game/stats.ts`)
