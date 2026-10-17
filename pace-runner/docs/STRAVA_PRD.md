# PRD & AI Agent Execution Prompt — Strava Integration for Pace Runner

> **How to use this file with an AI Agent:**
> Copy the prompt below or tell your AI Agent:
> `"Read @docs/STRAVA_PRD.md and @docs/SPEC.md, then implement the Strava integration end-to-end and verify all tests and builds pass."`

---

## 1. Objective

Integrate **Strava OAuth 2.0** and the **Strava Activity Streams API** into **Pace Runner** so players can import their real outdoor GPS runs directly into the **My Routes** grid (`#screen-select`) without manually exporting `.gpx` files.

### Core Constraints (Must Follow `docs/SPEC.md`)
1. **English-only UI**: All UI labels, toasts, and error messages must be in English (`docs/SPEC.md` §2, §10).
2. **Zero new runtime dependencies**: Do not add packages to `package.json`. Use standard Web APIs (`fetch`, `URLSearchParams`, `localStorage`, `history.replaceState`).
3. **Pure route layer**: `src/route/strava.ts` conversion functions must work in Node/Vitest without DOM or WebGL, matching `src/route/` conventions.
4. **Type safety**: `pnpm exec tsc --noEmit` must exit `0` with `strict`, `noUnusedLocals`, and `noUnusedParameters`.

---

## 2. Environment Configuration

1. Update `.gitignore` to ignore `.env` and `.env.local`.
2. Create `.env.example` at the project root:
   ```dotenv
   # Get these from https://www.strava.com/settings/api
   VITE_STRAVA_CLIENT_ID=
   VITE_STRAVA_CLIENT_SECRET=
   # Optional override; defaults to window.location.origin + window.location.pathname
   VITE_STRAVA_REDIRECT_URI=
   ```
3. Add a `src/vite-env.d.ts` (or declare in `src/route/strava.ts`) if needed so `import.meta.env.VITE_STRAVA_*` is typed under strict TypeScript.

---

## 3. Technical Specification

### 3.1 New Module: `src/route/strava.ts`

#### Types
```ts
export interface StravaActivitySummary {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  start_date: string;       // ISO UTC
  start_date_local: string; // ISO local
  distance: number;         // meters
  moving_time: number;      // seconds
}

export interface StravaStreams {
  latlng?: { data: [number, number][] };
  time?: { data: number[] };
}

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athleteName?: string;
}
```

#### Pure Functions (Testable in Node)
1. **`isRunActivity(act: StravaActivitySummary): boolean`**
   - Returns `true` if `(act.sport_type === 'Run' || act.sport_type === 'TrailRun' || act.sport_type === 'VirtualRun' || act.type === 'Run')` AND `act.distance >= 200` (per `SPEC.md` §6.3 minimum 200 m requirement).
2. **`stravaStreamsToRun(act: StravaActivitySummary, streams: StravaStreams): Run`**
   - Validates `streams.latlng?.data`. Filters out any non-finite `[lat, lon]` pairs.
   - If fewer than 2 valid points exist, throws `new Error('The Strava activity needs at least 2 track points.')`.
   - Computes `startSec = Date.parse(act.start_date) / 1000` (fallback to `0` if invalid).
   - Maps each point `i`: if `streams.time?.data?.[i]` is finite, sets `t = startSec + streams.time.data[i]`, otherwise omits `t`.
   - Sets:
     - `id`: `` `strava-${act.id}` ``
     - `name`: `act.name?.trim() || 'Strava Run'`
     - `date`: `(act.start_date_local || act.start_date || new Date().toISOString()).slice(0, 10)`
     - `points`: mapped `GpsPoint[]`
     - `avgPaceSec`: `act.distance > 0 && act.moving_time > 0 ? act.moving_time / (act.distance / 1000) : undefined`
3. **`buildStravaAuthUrl(clientId: string, redirectUri: string): string`**
   - Builds `https://www.strava.com/oauth/authorize` with query params:
     - `client_id`: `clientId`
     - `redirect_uri`: `redirectUri`
     - `response_type`: `'code'`
     - `approval_prompt`: `'auto'`
     - `scope`: `'activity:read_all'`

#### Browser OAuth & Sync Helpers
1. **Storage Keys** (wrap all `localStorage` access in `try / catch` per `SPEC.md` §9.6):
   - `pace-runner:strava-tokens`: stores `StravaTokens` JSON.
   - `pace-runner:custom-runs`: stores imported `Run[]` (both Strava and uploaded GPX runs) so imported courses persist across page reloads and OAuth redirects.
2. **`isStravaConfigured(): boolean`**:
   - Returns `Boolean(import.meta.env.VITE_STRAVA_CLIENT_ID && import.meta.env.VITE_STRAVA_CLIENT_SECRET)`.
3. **`hasStravaTokens(): boolean`**:
   - Returns `true` if stored tokens exist in `localStorage`.
4. **`startStravaAuth(): void`**:
   - Redirects `window.location.href` to `buildStravaAuthUrl(...)`.
5. **`exchangeStravaCode(code: string): Promise<StravaTokens>`**:
   - `POST https://www.strava.com/oauth/token` with `{ client_id, client_secret, code, grant_type: 'authorization_code' }`.
   - Saves tokens to `localStorage` and returns them.
6. **`getValidAccessToken(): Promise<string>`**:
   - Reads stored `StravaTokens`. If `Date.now() / 1000 >= tokens.expires_at - 60`, refreshes via `POST https://www.strava.com/oauth/token` with `{ client_id, client_secret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }` and updates `localStorage`.
7. **`syncStravaRuns(existingIds: ReadonlySet<string>, maxNew = 8): Promise<Run[]>`**:
   - Obtains a valid access token via `getValidAccessToken()`.
   - Fetches `GET https://www.strava.com/api/v3/athlete/activities?per_page=30` with `Authorization: Bearer <token>`.
   - Filters with `isRunActivity(act)` and skips any activity where `existingIds.has('strava-' + act.id)` (critical to avoid redundant stream calls and respect Strava's 100 req / 15 min rate limit).
   - Takes up to `maxNew` new activities and fetches `GET https://www.strava.com/api/v3/activities/${act.id}/streams?keys=latlng,time&key_by_type=true`.
   - Converts each via `stravaStreamsToRun(act, streams)`. If an activity has no GPS stream (e.g. indoor treadmill run), catch and skip it gracefully.
   - Returns the array of newly converted `Run[]`.

---

### 3.2 UI & Integration (`src/main.ts`, `src/style.css`)

1. **Custom Runs Persistence (`src/main.ts`)**:
   - Load saved custom runs from `localStorage` (`pace-runner:custom-runs`) inside `ensureRuns()` and prepend them before `SAMPLE_RUNS` (deduplicating by `run.id`).
   - Whenever a GPX file is uploaded or Strava runs are synced, save the custom runs list to `pace-runner:custom-runs`.
2. **My Routes Screen (`openSelect()` in `src/main.ts` & `src/style.css`)**:
   - Next to the dashed `+ Add a run (Upload a GPX file)` card, render a Strava action card:
     - Class: `route-card add strava-card`
     - Content:
       - Icon/badge: `STRAVA`
       - Title: **`Sync Strava`** (if `hasStravaTokens()` is true) or **`Connect Strava`** (if not connected yet)
       - Subtitle: `Import recent GPS runs`
   - Clicking the Strava card:
     - If `!isStravaConfigured()`: show toast `"Set VITE_STRAVA_CLIENT_ID & SECRET in .env.local"`.
     - Else if `hasStravaTokens()`: show toast `"Syncing with Strava…"`, call `syncStravaRuns(...)`, prepend new runs, save custom runs, re-render `openSelect()`, and toast `"Added N run(s) from Strava"` (or `"Strava is up to date"` if 0 new). If token refresh fails, fall back to `startStravaAuth()`.
     - Else: call `startStravaAuth()`.
3. **OAuth Callback Handling on Boot (`src/main.ts`)**:
   - In `boot()`, check `new URLSearchParams(window.location.search)` for `code` or `error` from Strava:
     - Immediately clean the URL with `window.history.replaceState({}, '', window.location.pathname)` so reloading does not re-use a one-time OAuth code.
     - If `error` is present, show toast `"Strava connection was cancelled"`.
     - If `code` is present:
       1. Ensure runs are initialized (`ensureRuns()`).
       2. Open the **My Routes** screen (`openSelect()`) and show toast `"Connecting to Strava…"`.
       3. Call `exchangeStravaCode(code)` followed by `syncStravaRuns(...)`.
       4. Prepend valid courses (`courseFor(r)`), persist to `pace-runner:custom-runs`, re-render `openSelect()`, and show toast `"Synced N run(s) from Strava"`.

---

## 4. Unit Tests (`src/route/strava.test.ts`)

Create `src/route/strava.test.ts` using `vitest` to test:
1. `isRunActivity`: accepts `Run` / `TrailRun` ≥ 200 m; rejects rides, swims, or runs < 200 m.
2. `stravaStreamsToRun`:
   - converts `latlng` and relative `time` offsets into Unix timestamps `t = startSec + offset`;
   - falls back to `avgPaceSec` when `time` stream is missing;
   - throws when fewer than 2 valid coordinates are present;
   - produces a `Run` that `buildCourse()` and `prepareCourse()` can process without error.
3. `buildStravaAuthUrl`: includes `client_id`, `redirect_uri`, `response_type=code`, and `scope=activity:read_all`.

---

## 5. Acceptance Criteria (Definition of Done)

Run all of the following commands and ensure they pass cleanly:
```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```
