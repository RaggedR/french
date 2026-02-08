# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Russian Video Transcription - a web app for watching Russian videos with synced transcripts and click-to-translate functionality. Users paste video URLs, the audio is transcribed with OpenAI Whisper, and words are highlighted as the video plays.

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
3. Ensure yt-dlp is installed: `brew install yt-dlp` or `pip install yt-dlp`
4. Configure API keys in the Settings panel:
   - OpenAI API key (for Whisper transcription)
   - Google Translate API key (for translations)

## Architecture

### Core Flow
```
Video URL → yt-dlp (download) → Whisper API → Word Timestamps
     ↓
Video Player ←→ Transcript Panel (synced highlighting)
     ↓
Click Word → Translation API → Popup
```

### Key Types (`src/types/index.ts`)

- `WordTimestamp` - Word with start/end times in seconds
- `Transcript` - Collection of words, segments, language, duration
- `VideoState` - Video URL, transcript, and title
- `Translation` - Result from translation API
- `TranslatorConfig` - API keys for OpenAI, Google

### Backend (`server/`)

Express.js server running on port 3001:
- **POST /api/transcribe**: Downloads video audio via yt-dlp, sends to Whisper API, returns word-level timestamps
- **POST /api/translate**: Proxies to Google Translate API with server-side caching
- **GET /api/hls/:sessionId/playlist.m3u8**: Proxies HLS streams for ok.ru videos

### Cloud Run Architecture

For ok.ru videos, uses HLS streaming with GCS-backed session storage:
1. Extract HLS URL, download audio, transcribe (synchronous)
2. Session stored in `gs://russian-transcription-videos/sessions/` (contains HLS URL for proxy)
3. Return video URL + transcript together → video starts with transcript ready

GCS bucket auto-deletes objects after 7 days via lifecycle policy.

### Frontend Components

- **`VideoInput.tsx`**: URL input for video transcription
- **`VideoPlayer.tsx`**: HTML5 video with time tracking and keyboard shortcuts (Space = play/pause, arrows = seek)
- **`TranscriptPanel.tsx`**: Displays words with current-word highlighting, auto-scroll, click-to-translate
- **`WordPopup.tsx`**: Shows translation with pronunciation button (Russian `ru-RU`)
- **`SettingsPanel.tsx`**: Configure OpenAI and Google API keys

### State Management

- `App.tsx` manages video state and persists config to localStorage (`translator_settings` key)
- Video time synced between VideoPlayer and TranscriptPanel
- Click on transcript word seeks video and shows translation

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS v4 (via @tailwindcss/vite plugin)
- Express.js backend
- OpenAI Whisper API (transcription)
- Google Translate API (translation)
- yt-dlp (video/audio download)
- Web Speech API for pronunciation

## System Requirements

- Node.js 18+
- yt-dlp installed globally (`brew install yt-dlp` or `pip install yt-dlp`)

## Known Limitations

- Direct video URLs from some platforms may expire after a short time
- Transcription can take 30-60 seconds depending on video length
- Some video platforms may not be supported by yt-dlp
- Pronunciation depends on browser's available Russian speech synthesis voices
