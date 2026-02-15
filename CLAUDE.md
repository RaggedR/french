# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Russian Video Transcription - a web app for watching Russian videos (primarily from ok.ru) with synced transcripts and click-to-translate functionality. Users paste video URLs, the backend downloads the video, transcribes it with OpenAI Whisper, adds punctuation/spelling corrections via GPT-4o, then splits long videos into chunks for easier viewing. Words are highlighted as the video plays.

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

**Test files:**
- `tests/typecheck.test.js` — Runs `tsc -b` to catch TypeScript errors (30s timeout)
- `server/media.test.js` — Unit tests for heartbeat, stripPunctuation, editDistance, isFuzzyMatch
- `server/integration.test.js` — Mocks `media.js`, tests all Express endpoints, SSE, session lifecycle

## Setup

1. `npm install && npm run server:install`
2. `brew install yt-dlp ffmpeg`
3. Create `.env` in project root:
   ```
   OPENAI_API_KEY=sk-...
   GOOGLE_TRANSLATE_API_KEY=AIza...
   ```

## Architecture

### Thin Client Design

The frontend is a **thin client** — the backend owns all session state. The frontend only manages view state (`input` | `analyzing` | `chunk-menu` | `loading-chunk` | `player`), current playback state, and UI errors.

### Core Flow
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

### Session Persistence

- **Local dev**: In-memory Maps, videos in `server/temp/`, lost on restart
- **Production (GCS)**: Sessions in `gs://russian-transcription-videos/sessions/`, videos in `videos/`, extraction cache in `cache/`
- `chunkTranscripts` is a Map — serialized as `Array.from(map.entries())` for JSON/GCS storage, restored with `new Map(array)`
- URL session cache (6h TTL), extraction cache (2h TTL), translation cache (in-memory)

### Backend (`server/`)

Express.js on port 3001. Single file `index.js` for routing/session management, `media.js` for external tool integration.

**API Endpoints:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check |
| POST | `/api/analyze` | Start analysis (returns cached if URL seen before) |
| GET | `/api/session/:sessionId` | Get session data + chunk statuses |
| GET | `/api/session/:sessionId/chunk/:chunkId` | Get ready chunk's video URL + transcript |
| POST | `/api/download-chunk` | Download a chunk (waits if prefetch in progress) |
| POST | `/api/load-more-chunks` | Load next batch for long videos |
| DELETE | `/api/session/:sessionId` | Delete session + all videos |
| POST | `/api/translate` | Google Translate proxy with caching |
| GET | `/api/progress/:sessionId` | SSE stream for progress events |

**`server/media.js` — External tool functions:**
- `getOkRuVideoInfo(url)` — Fast HTML scraping of ok.ru OG tags (~4s vs yt-dlp's ~15s)
- `downloadAudioChunk(url, outputPath, startTime, endTime, options)` — yt-dlp audio download with phase-aware progress
- `downloadVideoChunk(url, outputPath, startTime, endTime, options)` — yt-dlp video download
- `transcribeAudioChunk(audioPath, options)` — OpenAI Whisper API
- `addPunctuation(transcript, options)` — GPT-4o punctuation + spelling correction with two-pointer word alignment
- `createHeartbeat(onProgress, type, messageBuilder, intervalMs)` — Progress heartbeat during long operations
- `stripPunctuation(word)`, `editDistance(a, b)`, `isFuzzyMatch(a, b)` — String utilities for word alignment

**`server/chunking.js` — Chunking logic:**
- `createChunks(transcript)` — Splits at natural pauses (>0.5s gaps), targets ~3min chunks, merges final chunk if <2min
- `getChunkTranscript(transcript, startTime, endTime)` — Extract and time-adjust words/segments for a chunk
- `formatTime(seconds)` — Format as "MM:SS"

**`server/index.js` — Key internal state:**
- `analysisSessions` Map — Session data (backed by GCS in production)
- `urlSessionCache` Map — URL → sessionId for instant re-access
- `translationCache` Map — Translation results
- `progressClients` Map — Active SSE connections
- `prefetchNextChunk()` — Background download of next chunk after current completes

### Frontend

- `App.tsx` — State machine managing view transitions, SSE subscriptions
- `src/services/api.ts` — API client with SSE + polling fallback. SSE connects directly to backend (bypasses Vite proxy buffering in dev)
- `src/types/index.ts` — Shared types: `WordTimestamp`, `Transcript`, `VideoChunk`, `SessionResponse`, `ProgressState`

### Deployment

Production uses Google Cloud Run + GCS + Firebase Hosting:
- `./deploy.sh` — Full deploy with secrets, GCS bucket setup, lifecycle policies
- `./quick-deploy.sh` — Fast local Docker build + push

## Tech Stack

- React 19 + TypeScript + Vite 7, Tailwind CSS v4
- Express.js with Server-Sent Events
- OpenAI Whisper API (transcription) + GPT-4o (punctuation/spelling)
- Google Translate API, Google Cloud Storage
- yt-dlp + ffmpeg (video/audio processing)

## Known Limitations

- **ok.ru focus**: Optimized for ok.ru videos (IP-locked URLs require full download)
- **Long videos**: Split into 3-5 min chunks, loaded in batches
- **Local sessions**: In-memory only, lost on restart (production persists to GCS)
- **ok.ru extraction**: Takes 90-120s due to anti-bot JS protection (`ESTIMATED_EXTRACTION_TIME = 100`)
