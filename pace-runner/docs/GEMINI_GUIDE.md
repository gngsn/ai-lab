# Driving the Build with Google Antigravity + Gemini 4 Argon

A step-by-step playbook for the team: what to give the agent, how to set it up, and the exact prompts to use for each phase of [`ARGON_BRIEF.md`](./ARGON_BRIEF.md), with the look defined by [`DESIGN.md`](./DESIGN.md). The goal is a build that is **written during the hackathon**, **verified at every step**, and **easy to show** in the demo.

---

## 0. Rules of engagement (read first)

| Do | Don't |
|---|---|
| Give the agent `ARGON_BRIEF.md`, `DESIGN.md`, and assets and data the team owns (your GPX runs, your app screenshots, your images) | Give it any pre-existing source code, or `SPEC.md`. Demo code must be written during the event |
| Work **one phase at a time** and require Gate evidence before moving on | Ask for "the whole app" in one prompt |
| Make the agent **show proof**: test output, screenshots, trace logs | Accept "done" or "should work" without evidence |
| Commit after every passing step (small, descriptive commits) | Squash, rewrite history or backdate commits |
| Label anything cached or simulated, everywhere | Fake a verification loop or ship canned AI output as live |
| Keep model names and API calls exactly as the official docs say | Let the agent guess SDK shapes or model IDs |

---

## 1. One-time setup (≈15 min)

1. **Create the public GitHub repo** `pace-runner` with an MIT license and an empty README. Make the first commit at kickoff.
2. **Open it in Antigravity.** Choose **Gemini 4 Argon** (`gemini-4-argon`) as the agent model. Use the `antigravity-preview-09-2026` sandbox for running tests and browsers.
3. **Add the brief and the design:** copy `ARGON_BRIEF.md` into the repo as `docs/BRIEF.md`, and `DESIGN.md` as `docs/DESIGN.md`.
4. **Add team-owned fixtures:** put 3–5 of your own GPX runs and 2 running-app screenshots in `fixtures/`, and 3 images you own for the Character Forge in `fixtures/forge/`.
5. **Add standing rules** for the agent. Paste §2 into the workspace's agent rules / custom instructions, or into an `AGENTS.md` at the repo root if your setup reads one.
6. **Cloud access:** create the Google Cloud project, Firebase Hosting site and Cloud Run service account yourself, and give the agent only the project ID and region (`asia-northeast3`). Keep keys out of chat and out of the repo.

---

## 2. Standing rules (paste once)

```text
You are building "Pace Runner" for the hackathon, Track 1 (Entertainment).
The sources of truth are docs/BRIEF.md (what to build and how) and docs/DESIGN.md (how it must look).
Read both fully before any work and re-read the relevant sections at the start of every phase.
DESIGN.md is mandatory: do not invent your own colours, layouts, characters or fonts.

Working rules:
1. Work one phase at a time (BRIEF §5.4). Never start the next phase until the current Gate passes.
2. For every phase: write a short plan into docs/BUILD_LOG.md (timestamp, goal, files), implement in
   small steps, then VERIFY:
   - run the typecheck and the unit tests in the sandbox and paste the summary;
   - run the app in the browser, drive it with Playwright, and save screenshots at 1280x800 and 390x844;
   - compare the results with every line of the phase Gate, one by one, marked PASS/FAIL with evidence;
   - for anything visible, check your screenshots against the matching DESIGN.md section and the §8 checklist.
   If anything fails, fix it and verify again. Only then commit as "phase N: <what>".
3. Never claim something works without evidence you just produced. If you could not verify
   something, say exactly what and why.
4. Before writing any Gemini / Google Cloud integration, look up the official documentation for the
   exact model ID, SDK call, parameters and quotas. Never guess an API shape. Cite the doc page in BUILD_LOG.md.
5. The client never executes model-written code. Models return JSON that is validated against the
   schemas in packages/schemas before use.
6. Every AI feature has a verification loop and a non-AI fallback (BRIEF §3). Anything cached or
   simulated must be labelled "cached" / "simulated" in the UI and in the README.
7. All UI copy, code comments, docs and commit messages are in English.
8. Only use assets in fixtures/ or ones you generate. No copyrighted or watermarked images,
   no brand logos.
9. Keep the deterministic simulation in packages/sim free of DOM/WebGL so it runs in tests and on the server.
10. If a requirement in BRIEF.md is unclear or impossible, stop and ask instead of improvising.
```

---

## 3. Kickoff prompt

```text
Read docs/BRIEF.md and docs/DESIGN.md end to end. Then:
1. Summarise the product in 5 bullet points and list the 7 build phases with their Gates.
1b. Describe the visual style in 5 bullet points and the five characters in one line each, from
    DESIGN.md §4, so I can check you read the design correctly.
2. List every external API/model you will need and, for each, the official doc you will check.
3. List the questions or risks you see (missing info, quota, timing).
Do not write code yet.
```

Check the answer against the brief before going on. If the summary is off, correct it now: this is the cheapest moment to fix misunderstandings.

---

## 4. Phase prompts

Use these one at a time. Each ends with the same verification demand.

**Verification suffix:** add this to every phase prompt.

```text
When you think the phase is done: run typecheck + unit tests, run the app and capture screenshots at
1280x800 and 390x844, then give me a table with every Gate item from BRIEF §5.4 for this phase:
item | PASS/FAIL | evidence (test name, screenshot path, log line). Fix all FAILs before reporting.
Then append the evidence to docs/BUILD_LOG.md and commit.
```

### P0 — Setup
```text
Phase P0 (BRIEF §5.1–5.2, §5.4 row P0): create the monorepo layout (apps/web, apps/api,
packages/sim, packages/schemas, prompts, fixtures, docs), TypeScript strict, Vite client, Vitest,
Playwright, GitHub Actions CI (typecheck, tests, schema tests, build). Deploy a hello-world: Firebase
Hosting for apps/web, Cloud Run "pace-runner-api" with GET /api/health, and the /api/** rewrite.
```

### P1 — Core game (no AI yet)
```text
Phase P1 (BRIEF §2.3–2.4 and §5.4 row P1). Build the playable game without any model calls:
GPX import, course builder in packages/sim (pace bands, lanes for overlapping passes, U-turn rounding,
pads, coin rows, gels every 5 km, bananas and shine muscats), deterministic simulation with the ghost,
carried items (3 slots), controls, HUD, toon meadow, all screens incl. My Routes, My Stats and the main
runner, fonts. Write the unit tests listed in the P1 Gate first, then make them pass. Use the GPX files
in fixtures/ as real inputs, including the out-and-back + U-turn + figure-8 fixture.
```
Then check yourself: play one of your own runs on a phone. It must feel fair: a clean line beats the ghost narrowly.

### P2 — Level Director (A1) ★
```text
Phase P2 (BRIEF §3 A1, §4.1 LevelSpec, §5.4 row P2). Implement the Level Director agent: Argon gets
RunData + theme and returns a LevelSpec (JSON only, validated). Verification loop: schema/bounds check,
then headless playtests with the perfect/average/sloppy bots from packages/sim against the fairness
targets; on failure send Argon the measured numbers and iterate (max 4). Stream every iteration to the
Agent trace drawer. Add the "procedural (no AI)" fallback. Show me one full trace for each of 3 real runs.
```

### P3 — Character Forge (A2) ★
```text
Phase P3 (BRIEF §3 A2, §4.1 CharacterSpec, §5.4 row P3). First author the 5 built-in characters as
CharacterSpecs and render them, so the format is proven. Then build the Forge: nano-banana turnaround
sheet → Argon CharacterSpec → validate → headless renders (front, 3/4, side, run pose) → deterministic
checks (height, feet on ground, face parts in front of the head by raycast, symmetry, not cropped) →
Argon critique {score, pass, issues} → patch, max 5 iterations, pass at score ≥ 85 + all checks.
Approve/Discard UI. Prove the face-in-front check rejects a deliberately broken spec.
```

### P4 — Live rival + music (A3, A4)
```text
Phase P4 (BRIEF §3 A3–A4, §5.4 row P4). "Past You" on gemini-3.8-live with the tools listed in A3,
every call validated by the rules engine (ranges, placement legality, rate limit, tone filter) and
rejected calls returned with a reason; subtitles always on, mute toggle. Lyria stems from an Argon music
brief, mixed by pace zone / gap / turbo / gel. Record a race where ≥ 3 tool calls are accepted and one
illegal call is visibly rejected.
```

### P5 — Import + recap (A5, A6)
```text
Phase P5 (BRIEF §3 A5–A6, §5.4 row P5). Screenshot import with the numeric reconciliation loop and
the confirm overlay (Looks right / edit), tested on screenshots from 2 different apps in fixtures/.
Long-context recap over the whole history with stats tools; reject any number that isn't a tool result.
Show 5 recaps with 0 unsupported numbers.
```

### P6 — Deploy + demo data
```text
Phase P6 (BRIEF §5.4 row P6). Production deploy, per-IP rate limits, upload limits, daily budget guard
switching to clearly labelled cached mode. Seed the team's real runs. Verify on Chrome, Safari and a
real phone; verify the game still works with /api blocked.
```

### P7 — Submission
```text
Phase P7 (BRIEF §6). Write README.md (outline §6.2, incl. "What's live / cached / simulated" and
credits), the Project Description (§6.1, English) and a shot list for the 2-minute video (§6.3) with the
exact app states to prepare for each shot. Run the §6.4 checklist and report each item with evidence.
```

---

## 4b. Design check (after P1, and after any visual change)

```text
Design check against docs/DESIGN.md. For every screen in §2 (desktop 1280x800 and mobile 390x844), every
character in §4.2 and every pickup in §6, put the app in that state and capture a screenshot. Compare
each one with its DESIGN.md section and list every difference in colour (hex), layout, size, typography,
character shape or motion, citing the section. Fix the differences, recapture, and repeat until none are
left except intentional ones (list those with a reason). Then run the §8 checklist item by item.
```

Tip: the characters (DESIGN.md §4.2) are the most likely place for drift. Check eyes, mouths and colour gradients carefully.

## 5. Independent review pass (after P1, P3 and P6)

Open a **fresh agent session** so the reviewer isn't the author, and ask:

```text
You are reviewing, not building. Read docs/BRIEF.md and the current repository. Without changing code:
1. Run typecheck, tests and the app. 2. For the latest phase Gate, re-verify every item yourself.
3. List bugs, unverified claims, missing fallbacks, unlabelled cached/simulated content, any place a
model's output is used without validation, and any visual difference from docs/DESIGN.md. Rank by severity with file:line and a reproduction.
```

Send the findings back to the building session as a fix list.

---

## 6. When things go wrong

| Symptom | Prompt |
|---|---|
| The agent says "done" without proof | `Show the evidence table for every Gate item. If any item has no evidence, it is not done.` |
| It is looping on the same failure | `Stop. Write down the failing check, the 3 most likely causes and a test that distinguishes them. Run that test first.` |
| An API call fails or the shape is unclear | `Open the official documentation page for this model/SDK, quote the relevant signature, and fix the call to match it.` |
| Scope is creeping | `Re-read BRIEF §5.4. What is the next Gate? Do only what it requires.` |
| A visual looks wrong | `Take a screenshot, describe exactly what is wrong in it, fix it, and take the same screenshot again for comparison.` |
| Running out of time | Apply the cut order in BRIEF §5.4: A7 → A6 → synthesized music → GPX-only import. **Never cut A1, A2 or the trace drawer.** |

---

## 7. What to collect for the video and the description

As you go, save these to `docs/media/`:
- the Level Director trace with bot playtests passing;
- the Forge iteration strip with the score rising and the critique text;
- a rejected tool call from "Past You";
- the screenshot import reconciliation passing;
- a race on a real route with items and the ghost.

They are the evidence judges look for under "verification loop", and they make the 2-minute video easy to cut.
