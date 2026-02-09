# Russian Video Transcription

A web app for watching Russian videos with synced transcripts and click-to-translate functionality. Paste a video URL, get a word-by-word transcript, and click any word to see its English translation.

## Features

- **Synced Transcripts**: Words highlight in real-time as the video plays
- **Click-to-Translate**: Click any word to see its English translation
- **Video Chunking**: Long videos are automatically split into 5-10 minute segments
- **Progress Tracking**: Real-time progress updates during download and transcription
- **Pronunciation**: Hear words spoken aloud using browser speech synthesis

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
2. Wait for download and transcription (progress shown)
3. For long videos, select a chunk to watch
4. Click any word to see translation and seek to that point

## Architecture

```
+-------------+     +-------------+     +-------------+
|   Browser   |---->|   Express   |---->|  Whisper    |
|  (React)    |<----|   Server    |<----|    API      |
+-------------+     +-------------+     +-------------+
                          |
                    +-----+-----+
                    v           v
              +---------+ +---------+
              |  yt-dlp | | ffmpeg  |
              |(download| |(extract)|
              +---------+ +---------+
```

**Thin Client Design**: The frontend is stateless. The backend owns all session state including:
- Downloaded source videos
- Transcript data
- Chunk status and video URLs

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Start video analysis (returns sessionId) |
| `/api/progress/:sessionId` | GET | SSE stream for progress updates |
| `/api/session/:sessionId` | GET | Get session data and chunk status |
| `/api/session/:sessionId/chunk/:chunkId` | GET | Get chunk video URL and transcript |
| `/api/download-chunk` | POST | Extract chunk from source video |
| `/api/translate` | POST | Translate a word to English |

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
- **APIs**: OpenAI Whisper, Google Translate
- **Tools**: yt-dlp, ffmpeg
- **Hosting**: Firebase Hosting (frontend), Cloud Run (backend)

## License

MIT
