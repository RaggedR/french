# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Russian Video & Text — a web app for watching Russian videos (ok.ru) and reading Russian texts (lib.ru) with synced transcripts, click-to-translate, and SRS flashcard review. Users paste URLs; the backend downloads, transcribes (Whisper), punctuates (GPT-4o), and chunks the content. Words highlight in sync with playback. Users build a flashcard deck by clicking words, which persists to Firestore via Google Sign-In auth.

## Commands

```bash
npm run dev           # Start both frontend and backend (kills stale servers first)
npm run dev:frontend  # Start Vite dev server only
npm run dev:backend   # Start Express backend only (uses --watch)
npm run build         # TypeScript check + production build
npm run lint          # Run ESLint
npm run test          # Run ALL tests (frontend typecheck + server unit + integration)
npm run server:install # Install backend dependencies
```

### Testing

```bash
# Run all tests (frontend + backend)
npm test

# Server unit tests only
cd server && npx vitest run

# Server tests in watch mode
cd server && npx vitest

# Run a single test file
cd server && npx vitest run media.test.js
cd server && npx vitest run integration.test.js

# Run tests matching a pattern
cd server && npx vitest run -t "editDistance"

# Integration tests against real APIs (requires network + API keys)
cd server && npm run test:integration
```

```bash
# Regenerate demo content (requires OPENAI_API_KEY, network access)
cd server && node scripts/generate-demo.js              # Both video + text
cd server && node scripts/generate-demo.js --video      # Video only
cd server && node scripts/generate-demo.js --text       # Text only
cd server && node scripts/generate-demo.js --upload-gcs # Also upload media to GCS
```

```bash
# E2E tests (Playwright — frontend only, all APIs mocked)
npm run test:e2e            # Run all E2E tests (headless)
npm run test:e2e:headed     # Run with visible browser
npm run test:e2e:ui         # Run with Playwright UI inspector

# Install Playwright browsers (first time only)
cd e2e && npx playwright install chromium
```

**Test files:**
- `tests/typecheck.test.js` — Runs `tsc -b` to catch TypeScript errors (30s timeout)
- `server/media.test.js` — Unit tests for heartbeat, stripPunctuation, editDistance, isFuzzyMatch
- `server/usage.test.js` — Unit tests for cost tracking, budget middleware, limit constants
- `server/integration.test.js` — Mocks `media.js`, tests all Express endpoints, SSE, session lifecycle
- `e2e/tests/*.spec.ts` — Playwright E2E tests: app loading, video flow, text flow, demo flow, word popup, flashcard review, add-to-deck, settings features, edge cases

## Setup

1. `npm install && npm run server:install`
2. `brew install yt-dlp ffmpeg`
3. Create `.env` in project root:
   ```
   OPENAI_API_KEY=sk-...
   GOOGLE_TRANSLATE_API_KEY=AIza...
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
4. Deploy Firestore security rules: `firebase deploy --only firestore:rules`

## Architecture

### Thin Client Design

The frontend is a **thin client** — the backend owns all session state. The frontend only manages view state (`input` | `analyzing` | `chunk-menu` | `loading-chunk` | `player`), current playback state, and UI errors.

### Core Flow (Video Mode)
```
1. User pastes ok.ru URL
2. POST /api/analyze → scrape metadata (fast) → download audio → transcribe → punctuate → chunk
3. SSE /api/progress/:sessionId → real-time progress updates
4. Backend creates chunks (3-5 min segments at natural pauses)
5. If 1 chunk → auto-download; else → show chunk menu
6. POST /api/download-chunk → yt-dlp extracts video segment
7. GET /api/session/:sessionId/chunk/:chunkId → fetch chunk data
8. Video plays with synced transcript highlighting, click-to-translate
```

### Core Flow (Text Mode)
```
1. User pastes lib.ru URL (detected by url.includes('lib.ru'))
2. POST /api/analyze → fetch text → split into ~3500-char chunks → generate TTS audio (OpenAI)
3. AudioPlayer.tsx for playback, full-width transcript view (no side-by-side video)
4. Word timestamps estimated from character offsets + audio duration
```

### SSE Architecture

SSE for progress updates has a special setup to avoid Vite proxy buffering in dev:
- `api.ts` connects SSE directly to `http://localhost:3001` (not through Vite proxy)
- `vite.config.ts` disables caching on `/progress/` proxy requests as a fallback
- In production, SSE connects to the same origin (frontend served from Cloud Run)
- Frontend has a 60s inactivity timeout: if no SSE events are received, it closes the `EventSource` and falls back to 2-second polling via `GET /api/session/:sessionId`

### Session Persistence

- **Local dev** (`IS_LOCAL=true`): In-memory Maps, videos in `server/temp/`, lost on restart. Controlled by absence of `GCS_BUCKET` env var or `NODE_ENV=development`.
- **Production**: Sessions in `gs://russian-transcription-videos/sessions/`, videos in `videos/`, extraction cache in `cache/`
- `chunkTranscripts` is a Map — serialized as `Array.from(map.entries())` for JSON/GCS storage, restored with `new Map(array)`
- URL session cache (6h TTL) is **per-user** — keyed as `${uid}:${normalizedUrl}`, so two users analyzing the same URL get independent sessions
- Extraction cache (2h TTL), translation cache (in-memory, shared)

### Backend (`server/`)

Express.js on port 3001 (local) / `PORT` env var (Cloud Run). Key files:
- `index.js` — Routing, analysis pipeline orchestration, chunk prefetching, demo endpoint, ownership middleware
- `session-store.js` — Session CRUD, LRU cache (50 sessions), URL session cache (6h TTL per-user), GCS persistence, signed URL generation, extraction cache (2h TTL)
- `progress.js` — SSE client management (`progressClients` Map), `sendProgress()`/`createProgressCallback()` helpers, terminal progress rendering
- `media.js` — External tool integration (yt-dlp, Whisper, GPT-4o, Google Translate, TTS)
- `chunking.js` — Splits transcripts at natural pauses (>0.5s gaps), targets ~3min chunks
- `auth.js` — Firebase Admin SDK token verification middleware (`requireAuth`)
- `usage.js` — Per-user API cost tracking with daily/weekly/monthly limits

**Authentication & Authorization:**
- `requireAuth` middleware on all `/api/*` routes (except `/api/health`) — verifies Firebase ID tokens from `Authorization: Bearer` header or `?token=` query param (needed for SSE/EventSource). Sets `req.uid` and `req.userEmail`.
- `requireSessionOwnership` middleware on all session endpoints — verifies `session.uid === req.uid`. Returns 403 for mismatched or missing uid. Attaches `req.analysisSession` and `req.sessionId` so handlers skip redundant lookups.
- Session IDs are `crypto.randomUUID()` (122 bits of entropy, not guessable).

**Rate Limiting & Budget:**
- Per-user rate limiters keyed on `req.uid` (disabled during tests via `process.env.VITEST`)
- OpenAI budget: $1/day, $5/week, $10/month per user (`requireBudget` middleware)
- Google Translate budget: $0.50/day, $2.50/week, $5/month (`requireTranslateBudget`)
- Costs tracked in-memory with Firestore write-behind persistence (5s debounce per user). `flushAllUsage()` writes all pending data on graceful shutdown (SIGTERM/SIGINT). `initUsageStore()` hydrates from Firestore on startup. See `server/usage.js` for per-call estimates.

**Security & Production Hardening:**
- `helmet()` middleware: CSP report-only mode (logs violations, doesn't block), COOP `same-origin-allow-popups` (Firebase popup auth), CORP `cross-origin`, COEP disabled, HSTS preload, X-Frame-Options DENY. CSP headers stripped from `/__` Firebase auth proxy responses.
- `/api/health` checks Firestore + GCS connectivity in production (returns 503 `degraded` if either fails)
- Graceful shutdown on SIGTERM/SIGINT: flushes usage data to Firestore, drains connections, force-exits after 10s
- SSE inactivity timeout (60s) on the frontend: if no events received, `EventSource` closes and falls back to polling

**Input Validation & CORS:**
- CORS whitelist: Cloud Run origin pattern, `localhost:5173`, `localhost:3001` (not open `cors()`)
- `/api/analyze` rejects URLs that aren't ok.ru or lib.ru
- `/api/translate` rejects words >200 chars; `/api/extract-sentence` rejects words >200 or text >5000 chars
- SSRF protection on video proxy: blocks private IPs, localhost, GCP metadata endpoint

**Key patterns in `media.js`:**
- `addPunctuation()` uses a two-pointer algorithm to align GPT-4o's punctuated output back to original Whisper word timestamps
- `createHeartbeat()` sends periodic SSE updates during long-running operations (extraction, download, transcription)
- `estimateWordTimestamps()` generates synthetic timestamps for TTS text mode (no Whisper timestamps available)

**API Endpoints:**

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/health` | — | Health check |
| POST | `/api/analyze` | auth + budget | Start analysis (returns cached per-user if URL seen) |
| GET | `/api/session/:sessionId` | auth + owner | Get session data + chunk statuses |
| GET | `/api/session/:sessionId/chunk/:chunkId` | auth + owner | Get ready chunk's video URL + transcript |
| POST | `/api/download-chunk` | auth + owner + budget | Download a chunk (waits if prefetch in progress) |
| POST | `/api/load-more-chunks` | auth + owner | Load next batch for long videos |
| DELETE | `/api/session/:sessionId` | auth + owner | Delete session + all videos |
| POST | `/api/translate` | auth + translate budget | Google Translate proxy with caching |
| POST | `/api/extract-sentence` | auth + budget | GPT-powered sentence extraction + translation |
| GET | `/api/progress/:sessionId` | auth + owner | SSE stream for progress events |
| GET | `/api/usage` | auth | Per-user API cost consumption (OpenAI + Translate) |
| DELETE | `/api/account` | auth | Delete account: Firestore + GCS + in-memory + Auth cleanup |
| POST | `/api/demo` | auth | Load pre-processed demo (no budget — no API calls) |
| GET | `/api/local-video/:filename` | auth | Serve local demo video files (dev only) |
| GET | `/api/local-audio/:filename` | auth | Serve local demo audio files (dev only) |
| GET | `/api/hls/:sessionId/playlist.m3u8` | auth + owner | Proxy and rewrite HLS manifest |
| GET | `/api/hls/:sessionId/segment` | auth + owner | Proxy HLS segments |

### Frontend

- `App.tsx` — State machine managing view transitions, SSE subscriptions. Two content modes: `video` (ok.ru) and `text` (lib.ru)
- `src/services/api.ts` — API client with SSE + polling fallback. Exports `getUsage()`, `deleteAccount()`, `loadDemo()`.
- `src/types/index.ts` — Shared types: `WordTimestamp`, `Transcript`, `VideoChunk`, `SessionResponse`, `ProgressState`, `SRSCard`
- `src/legal.ts` — `TERMS_OF_SERVICE` and `PRIVACY_POLICY` string constants, used in both `SettingsPanel` and `LoginScreen`
- `src/components/SettingsPanel.tsx` — Accepts `cards`, `userId`, `onDeleteAccount` props. Features: frequency range config, deck export (JSON Blob download), usage bars (color-coded: green/yellow/red), collapsible legal docs, account deletion with "DELETE" confirmation.
- `src/components/LoginScreen.tsx` — Google Sign-In button with expandable ToS/Privacy agreement text

### SRS Flashcard System

- `src/hooks/useDeck.ts` — Deck state with Firestore persistence (debounced 500ms writes). Accepts `userId` from `useAuth`. Falls back to localStorage if Firestore is unavailable. Migrates existing localStorage data to Firestore on first load.
- `src/hooks/useAuth.ts` — Google Sign-In via `signInWithPopup` + `GoogleAuthProvider`. Tracks state via `onAuthStateChanged`. Returns `{ userId, user, isLoading, signInWithGoogle, signOut }`. E2E test bypass: build-time `VITE_E2E_TEST` selects stateful `useAuthE2E` (supports sign-out). Tests can set `window.__E2E_NO_AUTH = true` via `addInitScript` to start logged-out.
- `src/firebase.ts` — Firebase app/auth/firestore initialization. Config from `VITE_FIREBASE_*` env vars.
- `src/utils/sm2.ts` — SM-2 spaced repetition algorithm with Anki-like learning steps (1min/5min) and graduated review intervals.
- `src/components/ReviewPanel.tsx` — Flashcard review UI with keyboard shortcuts (1-4 for ratings, Space/Enter for show/good).
- `firestore.rules` — Security rules: `decks/{userId}` read/write by matching `auth.uid` (write requires `cards` is list); `usage/{userId}` read/delete by matching `auth.uid`. Deploy with `firebase deploy --only firestore:rules`.
- Sentence extraction: scans the words array for sentence-ending punctuation (`.!?…`) to extract only the containing sentence as flashcard context, not the full Whisper segment.

### Word Frequency Highlighting

- `public/russian-word-frequencies.json` — 92K Russian words sorted by frequency rank
- `TranscriptPanel` underlines words in a configurable frequency rank range (e.g., rank 500–1000)
- Normalization: ё→е for both frequency lookup and card deduplication (`normalizeCardId` in `sm2.ts`)

### Demo System

Pre-processed demo content lets first-time users instantly experience the app without waiting for transcription.

- **`server/scripts/generate-demo.js`** — One-time script: processes demo URLs through the full pipeline (transcribe, punctuate, lemmatize, TTS), saves JSON to `server/demo/`, media to `server/demo/media/`, optionally uploads to GCS (`--upload-gcs`). Run with `cd server && node scripts/generate-demo.js [--video] [--text] [--upload-gcs]`.
- **`server/demo/demo-video.json`** / **`demo-text.json`** — Pre-baked session data (checked into git). Contains chunks, transcripts, and GCS/local media file references.
- **`server/demo/media/`** — Generated media files (gitignored, ~20MB). Served locally via `/api/local-video/` and `/api/local-audio/`.
- **`POST /api/demo`** — Creates a real session from pre-baked data. No API calls, no budget cost. `demoCache` Map caches parsed JSON in memory. Returns same shape as a cached `/api/analyze` response, so existing frontend handling takes over.
- **Demo URLs** (hardcoded in generate script): video = `ok.ru/video/400776431053` (Chekhov audiobook), text = `az.lib.ru` (Anna Karenina). Max 3 chunks, max 10 min audio.
- **Frontend**: "or try a demo" divider + two buttons (`data-testid="demo-video-btn"`, `data-testid="demo-text-btn"`) below the URL input grid. `handleLoadDemo()` in App.tsx follows the same cached-response pattern as analyze handlers.
- **GCS**: Demo media lives under `demo/` prefix, excluded from 7-day lifecycle auto-deletion via `matchesPrefix` in `deploy.sh`.

### Error Monitoring (Sentry)

- **Backend**: `server/instrument.mjs` initializes `@sentry/node` via `--import` flag (before any other code). `setupExpressErrorHandler(app)` catches unhandled route errors. `captureException` added to 5 critical catch blocks in `index.js` (analyze, download-chunk video/text, load-more-chunks, prefetch) and 2 in `usage.js` (persist, init).
- **Frontend**: `src/sentry.ts` initializes `@sentry/react`. `Sentry.ErrorBoundary` wraps `<App>` in `main.tsx`. `api.ts` captures 500+ API errors.
- **Source maps**: `@sentry/vite-plugin` uploads source maps during CI deploy (requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`). Build uses `sourcemap: 'hidden'` to avoid exposing maps in production.
- **Config**: Enabled only when DSN is set (`SENTRY_DSN` for backend, `VITE_SENTRY_DSN` for frontend). No-op during tests (`VITEST` env / `VITE_E2E_TEST` flag). `tracesSampleRate: 0.2` (20% of transactions traced).
- **GCP secret**: `sentry-dsn` in Secret Manager, mapped to `SENTRY_DSN` env var in Cloud Run.

### CI/CD & Monitoring

- **GitHub Actions** (`.github/workflows/ci.yml`): lint → build → vitest (frontend + server) → Playwright E2E on every PR. Auto-deploys to Cloud Run on merge to main via Workload Identity Federation.
- Skips CI for docs-only changes (`.md`, `.txt`, `LICENSE`).
- **GCP Monitoring**: `scripts/setup-monitoring.sh <email>` — idempotent setup of uptime check on `/api/health` (5min interval) + email alert policy.

### Deployment

GCP project: `russian-transcription`, Cloud Run service: `russian-transcription`, region: `us-central1`.

- **Primary**: Merge to `main` → GitHub Actions builds Docker image, pushes to GCR, deploys to Cloud Run
- `./deploy.sh` — Manual full deploy with secrets, GCS bucket setup, lifecycle policies
- `./quick-deploy.sh` — Manual fast local Docker build + push
- `server/Dockerfile` — Extends `russian-base:latest` (node:20-slim + ffmpeg + yt-dlp, built by `build-base.sh`)
- Frontend hosted from Cloud Run (dist copied into Docker image), not Firebase Hosting

## Tech Stack

- React 19 + TypeScript + Vite 7, Tailwind CSS v4
- Express.js with Server-Sent Events
- Firebase Google Sign-In + Firestore (flashcard persistence)
- OpenAI Whisper API (transcription) + GPT-4o (punctuation/spelling) + TTS (text mode audio)
- Google Translate API, Google Cloud Storage
- yt-dlp + ffmpeg (video/audio processing)

## Important Behavioral Rules

- **Word click = translate only, NOT seek.** Clicking a word in the transcript shows a translation popup. It must NOT seek/jump the video to that word's timestamp. The video continues playing normally.

## Known Limitations

- **ok.ru focus**: Optimized for ok.ru videos (IP-locked URLs require full download)
- **Long videos**: Split into 3-5 min chunks, loaded in batches
- **Local sessions**: In-memory only, lost on restart (production persists to GCS)
- **ok.ru extraction**: Takes 90-120s due to anti-bot JS protection (`ESTIMATED_EXTRACTION_TIME = 100`)

## Production Roadmap

### Completed
- ~~Migrate from Firebase Anonymous Auth to Google OAuth~~ (PR #8)
- ~~Per-user rate limiting + cost tracking~~ (PR #8)
- ~~CI/CD: GitHub Actions for lint, test, deploy~~ (PR #15)
- ~~Session security: crypto.randomUUID(), session ownership, access validation~~
- ~~Sentry error monitoring~~ (PR #16)
- ~~Production hardening: SSRF, CORS, input validation, concurrency limits~~ (PR #18)
- ~~Legal docs, usage UI, deck export, account deletion, GCP monitoring~~ (PR #19)
- ~~Pre-processed demo content, health check, graceful shutdown, SSE timeout~~ (PR #20)

### In Progress
- **Google Sign-In broken on production** — debugging. Use `./quick-deploy.sh` to push directly to main while iterating on this fix. Auth errors now displayed on login screen.
- **Helmet.js re-enabled (report-only CSP)** — helmet active with COOP `same-origin-allow-popups`, CORP `cross-origin`, CSP in report-only mode. CSP stripped from `/__` Firebase auth proxy responses. After verifying no violations in production, switch CSP to enforcing mode.

### Payment (Priority: HIGH — Next)
- Add Stripe subscription: $10/month, first month free
- Enforce usage quotas per tier (free trial vs paid)

### Future
- Switch CSP from report-only to enforcing mode (after production verification)
- Import deck functionality (export already implemented)
- Android app (React Native or PWA wrapper)
