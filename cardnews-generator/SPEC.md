# Cardnews Generator — Project Specification

**Version:** 1.1.0  
**Created:** 2026-04-22  
**Updated:** 2026-04-22  
**Source:** SEED.yaml (ambiguity score: 0.14)

---

## Overview

A fully automated pipeline that ingests English tech news from RSS feeds, ranks and rewrites articles with LLMs, renders Instagram carousel slides (PNG), and publishes them via the Meta Graph API — targeting English learners who want to follow IT trends.

A lightweight local web dashboard (`localhost`) lets the creator enable/disable the cron schedule and trigger a pipeline run on demand — without touching the terminal.

---

## Goals & Non-Goals

### In Scope (v1)
- RSS ingestion → LLM ranking → LLM rewriting → card rendering → Instagram publish
- Local cron scheduling on the creator's machine
- Cron ON/OFF toggle via web dashboard
- Manual "Run Now" trigger via web dashboard
- Single tenant, single Instagram account
- SQLite + local filesystem storage

### Out of Scope (v1 → deferred to v2+)
- Web publishing channel
- Email publishing channel
- Multi-tenant / creator SaaS
- Cloud infrastructure

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Control Dashboard (FastAPI + HTML)              │
│                    localhost:<DASHBOARD_PORT>                 │
│                                                              │
│  [● Cron ON / OFF]   [▶ Run Now]   [Run history table]      │
└───────────┬──────────────────┬───────────────────────────────┘
            │ toggle           │ manual trigger
            ▼                  │
┌───────────────────┐          │
│   Cron (local)    │          │
│  enabled/disabled │          │
│  via state file   │          │
└────────┬──────────┘          │
         │ triggers            │
         └──────────┬──────────┘
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   Pipeline Orchestrator (Python)            │
│                                                             │
│  1. Ingest      RSS → deduplicate → SQLite (stories)        │
│  2. Rank        Cheap LLM → score 0.0–1.0 → pick top N     │
│  3. Rewrite     Strong LLM → simplified English + key terms │
│  4. Render      Card specs → HTML/CSS template → PNG        │
│  5. Publish     PNGs + caption → Meta Graph API → Instagram │
│  6. Log         Run record persisted to SQLite              │
└─────────────────────────────────────────────────────────────┘
         │ render                          │ publish
         ▼                                 ▼
┌─────────────────┐              ┌──────────────────┐
│  Node.js +      │              │  Meta Graph API  │
│  Playwright     │              │  (IG carousel)   │
│  (card renderer)│              └──────────────────┘
└─────────────────┘
         │
         ▼
  local PNG files
  (dated directory)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Pipeline orchestration | Python |
| Control dashboard | FastAPI + plain HTML (localhost) |
| Card rendering | Node.js + Playwright (HTML/CSS → PNG) |
| Ranking LLM | Cheap model (e.g. Gemini Flash, Claude Haiku) |
| Rewriting LLM | Strong model (e.g. Claude Sonnet, GPT-4o) |
| Storage | SQLite + local filesystem |
| Scheduling | Local cron (enable/disable via dashboard) |
| Publishing | Meta Graph API |

---

## Data Model

### Story
A tech news article being processed through the pipeline.

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-256 hash of `source_url` — stable dedup key |
| `source_url` | string | Original article URL from RSS |
| `raw_title` | string | Headline as it appears in the RSS feed |
| `raw_body` | string | Full text scraped from article (RSS summary fallback) |
| `ranking_score` | float | 0.0–1.0 from cheap ranking LLM |
| `simplified_body` | string | LLM-rewritten plain English version |
| `key_terms` | array | 3–5 items: `{term: string, definition: string}` |
| `cards` | array | Ordered list of Card objects to render |
| `caption` | string | IG caption (headline + hook sentence + hashtags) |
| `status` | string | `fetched \| ranked \| rewritten \| rendered \| published \| failed` |
| `published_at` | string | ISO 8601 timestamp of IG publish |

### Card
A single PNG slide within a story carousel.

| Field | Type | Description |
|---|---|---|
| `type` | string | `hook \| body \| key_terms \| source_cta` |
| `index` | number | 0-based position within carousel |
| `content` | object | Structured payload for the HTML template |
| `image_path` | string | Absolute local path to rendered PNG |

### Run
A single scheduled pipeline execution.

| Field | Type | Description |
|---|---|---|
| `id` | string | UUID v4 |
| `started_at` | string | ISO 8601 timestamp |
| `items_fetched` | number | Total RSS items ingested |
| `items_selected` | number | Articles chosen after LLM ranking |
| `items_published` | number | Stories successfully published to IG |
| `errors` | array | `{story_id, stage, message}` for each failure |

---

## Pipeline Stages

### Stage 1 — Ingest
- Poll ≥3 configurable RSS feed URLs
- Scrape full article text where possible; fall back to RSS summary
- Deduplicate by `story.id` (SHA-256 of URL)
- Persist new stories with `status = fetched` to SQLite

### Stage 2 — Rank
- Send each fetched story to the **cheap LLM**
- Scoring criteria: interest, IT-trend relevance, English-learnability
- Score range: 0.0–1.0
- Select top N stories per run (N is configurable via env/config)
- Update `status = ranked`

### Stage 3 — Rewrite
- Send each ranked story to the **strong LLM**
- Output: `simplified_body` — short sentences, jargon defined inline, B1–B2 level
- Output: `key_terms` — 3–5 vocabulary items with English-only definitions
- Output: `caption` — headline + 1-sentence hook + hashtags
- Update `status = rewritten`

### Stage 4 — Render
- Build card specs from rewritten story:
  - **Hook card** (`index: 0`) — headline + teaser
  - **Body card(s)** — simplified content segmented across slides
  - **Key-terms card** — vocabulary list
  - **Source/CTA card** (last) — source URL + call to action
- Pass card specs to **Node.js + Playwright** renderer
- Renderer loads HTML/CSS template, injects content, screenshots to PNG
- Dimensions: 1080×1080 px or 1080×1350 px (configurable)
- Save PNGs to `output/<YYYY-MM-DD>/<story_id>/card_<index>.png`
- Update `status = rendered`

### Stage 5 — Publish
- Upload rendered PNGs to Meta Graph API as a carousel
- Attach auto-generated caption
- No human intervention required
- Update `status = published`, set `published_at`

### Stage 6 — Log
- Write/update `Run` record in SQLite with final counts and any errors
- Per-story errors are isolated: one story failure does not block others

---

## Control Dashboard

A minimal local web UI served by FastAPI on `localhost`. No authentication (single-tenant). The dashboard is started separately from the pipeline (e.g. `python dashboard/app.py`) and stays running in the background.

### Pages / Endpoints

| Route | Method | Description |
|---|---|---|
| `GET /` | — | Dashboard home: cron status badge, Run Now button, recent run history table |
| `POST /cron/enable` | — | Write `cron_enabled = true` to state file; arms the cron entry |
| `POST /cron/disable` | — | Write `cron_enabled = false` to state file; disarms the cron entry |
| `POST /run` | — | Trigger a pipeline run immediately (runs orchestrator in subprocess) |
| `GET /runs` | JSON | Last N run records from SQLite (id, started_at, fetched, selected, published, errors) |

### Cron State

- Cron enable/disable state is persisted in `data/cron_state.json` (`{"enabled": true/false}`)
- The cron job itself calls a wrapper script (`pipeline/run_if_enabled.py`) that reads this file and exits early if `enabled = false`
- Toggling does **not** add/remove a crontab entry — the cron entry is always present; the wrapper decides whether to run
- Dashboard reflects live state on page load (no polling required)

### Manual Trigger

- "Run Now" fires a single pipeline execution regardless of cron state
- The run is identical to a scheduled run (same orchestrator, same config)
- The dashboard shows a spinner while the run is in progress, then refreshes the run history table on completion
- Concurrent runs are prevented: if a run is already in progress, the button is disabled

---

## Configuration

All runtime parameters via environment variables or a config file (no hardcoding).

| Parameter | Description |
|---|---|
| `RSS_FEEDS` | Comma-separated list of RSS feed URLs (≥3) |
| `TOP_N` | Number of stories to process per run |
| `RANKING_MODEL` | LLM model ID for ranking |
| `REWRITE_MODEL` | LLM model ID for rewriting |
| `CARD_WIDTH` | PNG width in px (default: 1080) |
| `CARD_HEIGHT` | PNG height in px (default: 1080 or 1350) |
| `OUTPUT_DIR` | Root directory for rendered assets |
| `IG_ACCESS_TOKEN` | Meta Graph API access token |
| `IG_USER_ID` | Instagram user ID for publishing |
| `DB_PATH` | SQLite database file path |
| `DASHBOARD_PORT` | Port for the local control dashboard (default: 8000) |

---

## Storage Layout

```
cardnews-generator/
├── pipeline/               # Python pipeline code
│   ├── ingest.py
│   ├── rank.py
│   ├── rewrite.py
│   ├── publish.py
│   ├── orchestrator.py
│   └── run_if_enabled.py   # Cron wrapper — exits early if cron disabled
├── dashboard/              # Control dashboard
│   ├── app.py              # FastAPI app (cron toggle + manual trigger)
│   └── templates/
│       └── index.html      # Single-page dashboard UI
├── renderer/               # Node.js + Playwright renderer
│   ├── templates/          # HTML/CSS card templates
│   └── render.js
├── output/                 # Generated assets (gitignored)
│   └── YYYY-MM-DD/
│       └── <story_id>/
│           ├── card_0.png
│           ├── card_1.png
│           └── caption.txt
├── data/
│   ├── cardnews.db         # SQLite database (gitignored)
│   └── cron_state.json     # {"enabled": true/false} (gitignored)
├── SEED.yaml
├── SPEC.md
└── .env                    # Runtime config (gitignored)
```

---

## Error Handling

- All stage errors (LLM API, render, IG API) are caught per story
- Failures are logged to `run.errors` with `{story_id, stage, message}`
- A failed story does not crash or block other stories in the same run
- Fatal upstream failures (all LLMs unreachable, IG auth expired) are surfaced clearly and the run is marked as failure

---

## Acceptance Criteria

1. RSS feeds from ≥3 configurable tech sources are polled, deduplicated, and stored on each cron run
2. Cheap LLM scores each candidate article; top N (configurable) are selected per run
3. Strong LLM rewrites each selected article into simplified English (short sentences, jargon defined inline)
4. Strong LLM extracts 3–5 key vocabulary items with English-only definitions per story
5. Story content is rendered into a PNG carousel at correct dimensions via Playwright; cards include hook, body segment(s), key-terms card, and source/CTA card
6. Completed carousel + auto-generated caption is published to Instagram via Meta Graph API without human intervention
7. Each pipeline run persists a log entry in SQLite (items fetched, selected, published, errors)
8. Rendered PNGs and captions are saved to a local dated directory for archival/debugging
9. Pipeline runs end-to-end without human intervention when triggered by cron
10. Failures are caught, logged, and do not crash subsequent stories in the same run
11. Dashboard ON toggle enables the cron schedule; OFF toggle disables it — state persists across dashboard restarts
12. "Run Now" button triggers a full pipeline run immediately, regardless of cron state
13. Dashboard prevents concurrent runs: the "Run Now" button is disabled while a run is in progress
14. Dashboard displays the last N run records (started_at, fetched, selected, published, error count)

---

## Evaluation Principles

| Principle | Weight | Description |
|---|---|---|
| Content quality | 35% | Simplified prose accurately reflects source; accessible to B1–B2 learners; jargon defined inline |
| Vocab relevance | 25% | Key terms are genuinely important words; definitions concise, English-only, correct |
| Visual fidelity | 20% | Correct px dimensions; legible typography at mobile size; no layout overflow |
| Pipeline reliability | 15% | End-to-end run completes; per-story failures isolated and logged |
| IG publish success | 5% | Carousel accepted by Meta Graph API; API errors surfaced clearly |

---

## Exit Conditions

| State | Condition |
|---|---|
| **Success** | `items_published == items_selected AND items_selected > 0` |
| **Partial success** | `items_published >= 1 AND items_published < items_selected` — remaining failures logged |
| **Failure** | `items_published == 0 AND items_selected > 0` — operator intervention required |
