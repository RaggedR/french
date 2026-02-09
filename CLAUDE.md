# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Russian Video Transcription - a web app for watching Russian videos (primarily from ok.ru) with synced transcripts and click-to-translate functionality. Users paste video URLs, the backend downloads the video and transcribes it with OpenAI Whisper, then splits long videos into chunks for easier viewing. Words are highlighted as the video plays.

## Commands

```bash
npm run dev           # Start both frontend and backend servers
npm run dev:frontend  # Start Vite dev server only
npm run dev:backend   # Start Express backend only
npm run build         # TypeScript check + production build
npm run lint          # Run ESLint
npm run preview       # Preview production build
npm run server:install # Install backend dependencies
```

## Setup

1. Install frontend dependencies: `npm install`
2. Install backend dependencies: `npm run server:install`
3. Ensure yt-dlp and ffmpeg are installed: `brew install yt-dlp ffmpeg`
4. Create `.env` file in project root with:
   ```
   OPENAI_API_KEY=sk-...
   GOOGLE_TRANSLATE_API_KEY=AIza...
   ```
5. (Optional) Configure Google API key in Settings panel for translations

## Architecture

### Thin Client Design

The frontend is a **thin client** - the backend owns all session state. The frontend only manages:
- View state (`input`, `analyzing`, `chunk-menu`, `loading-chunk`, `player`)
- Current playback state (videoUrl, transcript, currentTime)
- UI state (errors)

The backend stores:
- Session data (title, transcript, video path)
- Chunk status (`pending` | `downloading` | `ready`)
- Chunk video URLs and transcripts

### Core Flow
```
1. User pastes ok.ru URL
2. POST /api/analyze → backend downloads video + transcribes
3. SSE /api/progress/:sessionId → real-time progress updates
4. Backend creates chunks (5-10 min segments)
5. If 1 chunk → auto-download; else → show chunk menu
6. POST /api/download-chunk → ffmpeg extracts segment
7. GET /api/session/:sessionId/chunk/:chunkId → fetch chunk data
8. Video plays with synced transcript highlighting
```

### Key Types (`src/types/index.ts`)

- `WordTimestamp` - Word with start/end times in seconds
- `Transcript` - Collection of words, segments, language, duration
- `VideoChunk` - Chunk with id, startTime, endTime, status, videoUrl
- `SessionResponse` - Response from GET /api/session/:sessionId
- `ChunkResponse` - Response from GET /api/session/:sessionId/chunk/:chunkId
- `AppView` - View state machine

### Backend (`server/`)

Express.js server running on port 3001:

**Media Functions (`server/media.js`):**
- **`downloadAudioChunk(url, outputPath, startTime, endTime, options)`**: Downloads audio segment using yt-dlp
- **`downloadVideoChunk(url, outputPath, startTime, endTime, options)`**: Downloads video segment using yt-dlp
- **`transcribeAudioChunk(audioPath, options)`**: Transcribes audio using OpenAI Whisper API

**Session Management:**
- **POST /api/analyze**: Downloads video, transcribes with Whisper, creates chunks
- **GET /api/session/:sessionId**: Get session data including chunk status
- **GET /api/session/:sessionId/chunk/:chunkId**: Get chunk video URL and transcript
- **POST /api/download-chunk**: Extract chunk from source video using yt-dlp

**Translation:**
- **POST /api/translate**: Proxies to Google Translate API with caching

**Progress Updates:**
- **GET /api/progress/:sessionId**: Server-Sent Events for real-time progress

### Testing

**Test video:** https://ok.ru/video/400776431053 (Russian, clear speech, >30 min)

Run media function tests:
```bash
cd server && node test-media.js
```

Test procedure:
1. Download audio for third batch (40:00 - 60:00) - tests `downloadAudioChunk`
2. Transcribe that audio - tests `transcribeAudioChunk`
3. Download video for third part of third batch (~46:00 - 49:00) - tests `downloadVideoChunk`

### Frontend Components

- **`App.tsx`**: Thin client state machine, manages view transitions
- **`VideoInput.tsx`**: URL input for video transcription
- **`VideoPlayer.tsx`**: HTML5 video with 100ms time polling for smooth word sync
- **`TranscriptPanel.tsx`**: Words with current-word highlighting, auto-scroll, click-to-translate
- **`ChunkMenu.tsx`**: Shows video chunks with status indicators
- **`WordPopup.tsx`**: Shows translation with pronunciation button
- **`SettingsPanel.tsx`**: Configure Google API key for translations

### Deployment

Production uses Google Cloud Run with GCS storage:
- Videos: `gs://russian-transcription-videos/videos/`
- API keys from Secret Manager

Deploy scripts:
- `./quick-deploy.sh` - Fast deploy (rebuild + push)
- `./deploy.sh` - Full deploy with secrets

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS v4
- Express.js backend with Server-Sent Events
- OpenAI Whisper API (transcription)
- Google Translate API (translation)
- yt-dlp (video download)
- ffmpeg (audio extraction, video chunking)
- Google Cloud Storage (production)

## System Requirements

- Node.js 18+
- yt-dlp (`brew install yt-dlp`)
- ffmpeg (`brew install ffmpeg`)

## Known Limitations

- **ok.ru focus**: Optimized for ok.ru videos
- **IP-locked URLs**: ok.ru URLs are IP-locked, so we download full videos
- **Long videos**: Split into 5-10 min chunks
- **Cold starts**: Cloud Run cold starts add ~5s to first request
- **Local sessions**: Sessions stored in memory locally, not persisted across restarts
