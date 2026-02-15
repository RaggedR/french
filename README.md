# Russian Video Transcription

A web app for watching Russian videos with synced transcripts and click-to-translate functionality. Paste a video URL, get a word-by-word transcript, and click any word to see its English translation.

## Features

- **Synced Transcripts**: Words highlight in real-time as the video plays
- **Click-to-Translate**: Click any word to see its English translation
- **Video Chunking**: Long videos are automatically split into 3-5 minute segments at natural pauses
- **Punctuation & Spelling**: GPT-4o adds punctuation and fixes Whisper transcription errors
- **Progress Tracking**: Real-time progress updates during download and transcription
- **Session Caching**: Re-analyzing the same URL returns results instantly
- **Chunk Prefetching**: Next chunk downloads in the background while you watch

## AI Services & Costs

This app uses three AI APIs. All are pay-per-use with no subscriptions required.

### OpenAI Whisper — Speech-to-Text

Transcribes Russian audio to text with word-level timestamps. Each word gets an exact start/end time, enabling the synced highlighting during playback.

- **Model:** `whisper-1`
- **Cost:** $0.006/minute of audio
- **Get a key:** [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

### OpenAI GPT-4o — Punctuation & Spelling Correction

Whisper outputs raw text with no punctuation and occasional spelling errors. GPT-4o adds periods, commas, question marks, dashes, and quotation marks, and fixes misspelled words (e.g. "пограмма" → "программа"). The corrected words are mapped back to the original timestamps using fuzzy matching (Levenshtein distance).

- **Model:** `gpt-4o` (temperature 0)
- **Cost:** $2.50/million input tokens, $10.00/million output tokens
- **Get a key:** Same OpenAI key as Whisper — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

### Google Cloud Translation — Click-to-Translate

When you click a word in the transcript, it's translated Russian → English via the Google Translate API. Translations are cached in memory so repeated lookups are free.

- **API:** Cloud Translation Basic (v2)
- **Cost:** $20/million characters (first 500,000 characters/month free)
- **Get a key:** [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) — enable the "Cloud Translation API" in your project, then create an API key

### Cost Estimates

For a typical 30-minute Russian video:

| Service | Usage | Estimated Cost |
|---------|-------|----------------|
| Whisper | 30 min audio | ~$0.18 |
| GPT-4o | ~3,000 words punctuation (~2 batches) | ~$0.01 |
| Google Translate | ~200 word clicks (~1,000 chars) | free tier |
| **Total** | | **~$0.19** |

For a 1-hour video: ~$0.37. Whisper transcription dominates the cost. GPT-4o punctuation is negligible. Translation stays within the free tier for normal usage.

## Quick Start

### Prerequisites

- Node.js 18+
- yt-dlp: `brew install yt-dlp`
- ffmpeg: `brew install ffmpeg`

### Setup

```bash
# Install dependencies
npm install
npm run server:install

# Create .env file
cat > .env << EOF
OPENAI_API_KEY=sk-your-key-here
GOOGLE_TRANSLATE_API_KEY=AIza-your-key-here
EOF

# Start development servers
npm run dev
```

Open http://localhost:5173 in your browser.

### Usage

1. Paste an ok.ru video URL
2. Wait for download, transcription, and punctuation (progress shown in real-time)
3. For long videos, select a chunk to watch
4. Click any word to see its English translation

## Architecture

```
+-------------+     +-------------+     +-------------------+
|   Browser   |---->|   Express   |---->| OpenAI Whisper    |
|  (React)    |<----|   Server    |---->| OpenAI GPT-4o     |
+-------------+     +-------------+     | Google Translate  |
       SSE               |             +-------------------+
                    +-----+-----+
                    v           v
              +---------+ +---------+
              |  yt-dlp | | ffmpeg  |
              |(download| |(extract)|
              +---------+ +---------+
```

**Thin Client Design**: The frontend is stateless. The backend owns all session state including downloaded source videos, transcript data, and chunk status.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analyze` | Start video analysis (returns cached if URL seen before) |
| GET | `/api/progress/:sessionId` | SSE stream for real-time progress |
| GET | `/api/session/:sessionId` | Get session data and chunk status |
| GET | `/api/session/:sessionId/chunk/:chunkId` | Get chunk video URL and transcript |
| POST | `/api/download-chunk` | Download a chunk video segment |
| POST | `/api/load-more-chunks` | Load next batch of chunks for long videos |
| POST | `/api/translate` | Translate a word to English |
| DELETE | `/api/session/:sessionId` | Delete session and all videos |

## Deployment

Production runs on Google Cloud Run with GCS storage.

```bash
# Quick deploy (rebuild container only)
./quick-deploy.sh

# Full deploy (including secrets)
./deploy.sh
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS v4
- **Backend**: Express.js, Server-Sent Events
- **AI**: OpenAI Whisper (transcription), GPT-4o (punctuation/spelling), Google Translate
- **Tools**: yt-dlp, ffmpeg
- **Hosting**: Firebase Hosting (frontend), Cloud Run (backend), Cloud Storage (videos)

## License

MIT
