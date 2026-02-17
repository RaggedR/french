# Russian Video Transcription - Implementation Guide

## Architecture Overview

### Frontend (React + Vite)
- **Location**: `src/`
- **Hosted**: Firebase Hosting (`https://book-friend-finder.web.app`)
- **Key components**:
  - `VideoPlayer.tsx` - Plays videos (YouTube, Vimeo, direct MP4, HLS via hls.js)
  - `TranscriptPanel.tsx` - Shows synced transcript, click-to-translate
  - `VideoInput.tsx` - URL input form

### Backend (Express.js)
- **Location**: `server/`
- **Hosted**: Google Cloud Run (`https://russian-transcription-770103525576.us-central1.run.app`)
- **Endpoints**:
  - `POST /api/analyze` - Main endpoint: downloads video, transcribes audio, chunks
  - `POST /api/translate` - Translates Russian words to English
  - `GET /api/hls/:sessionId/*` - HLS proxy (not currently used - IP-locked)

## External Services

| Service | Purpose | Cost |
|---------|---------|------|
| **OpenAI Whisper API** | Audio transcription | ~$0.006/min of audio |
| **Google Translate API** | Word translation | ~$20/million chars |
| **Google Cloud Storage** | Store downloaded videos | ~$0.02/GB/month + egress |
| **Google Cloud Run** | Run backend | ~$0.00002/request + CPU time |

## Docker / Container

```
server/Dockerfile
      |
      v
gcr.io/book-friend-finder/russian-base:latest  (base image with yt-dlp, ffmpeg, aria2)
      |
      v
gcr.io/book-friend-finder/russian-transcription:latest  (app image)
      |
      v
Cloud Run (serves the container)
```

## GCS Bucket: `russian-transcription-videos`
- **Purpose**: Store downloaded ok.ru videos (their URLs are IP-locked/expire)
- **Structure**: `videos/{timestamp}.mp4`
- **CORS**: Configured to allow browser playback
- **Why needed**: ok.ru video URLs expire and are IP-locked, so we download and re-host

## yt-dlp
- **Purpose**: Download videos from ok.ru (and other sites)
- **Features used**:
  - `--dump-json` - Get video metadata
  - `--extract-audio` - Download audio only (for Whisper)
  - `--concurrent-fragments 8` - Parallel HLS segment download

## Data Flow (ok.ru video)

```
User pastes URL
       |
       v
Cloud Run receives request
       |
       v
+--------------------------------------+
|  PARALLEL:                           |
|  - Video download (yt-dlp, 360p)     |
|  - Audio download -> Whisper API     |
+--------------------------------------+
       |
       v
Upload video to GCS bucket
       |
       v
Return { videoUrl: GCS URL, transcript: {...} }
       |
       v
Frontend plays video from GCS, shows synced transcript
```

## HLS Streaming (attempted but disabled)
- **Idea**: Proxy ok.ru's HLS stream directly for instant playback
- **Problem**: ok.ru HLS URLs are IP-locked - they only work from the IP that requested them
- **Status**: Code exists but not used; we download full video instead

## Local vs Production

| Aspect | Local | Production |
|--------|-------|------------|
| Storage | In-memory Map | GCS bucket |
| Video serving | `/api/local-video/` | GCS signed URLs |
| Port | 3001 | 8080 |
| GCS | Skipped | Required |

## Deploy Scripts

| Script | Purpose |
|--------|---------|
| `deploy.sh` | Full deploy (secrets, Cloud Run, Firebase) |
| `quick-deploy.sh` | Fast deploy (just rebuild + push container) |
| `build-base.sh` | Rebuild base Docker image (yt-dlp, ffmpeg) |

## Environment Variables

### Required in `.env`:
```
OPENAI_API_KEY=sk-...
GOOGLE_TRANSLATE_API_KEY=AIza...
```

### Production (set via Cloud Run secrets):
```
OPENAI_API_KEY - from Secret Manager
GOOGLE_TRANSLATE_API_KEY - from Secret Manager
GCS_BUCKET=russian-transcription-videos
```

## Performance Optimizations

1. **Parallel downloads**: Video and audio download simultaneously
2. **360p video**: Lower quality = faster download, still watchable
3. **Concurrent fragments**: yt-dlp downloads 8 HLS segments at once
4. **Skip dumpJson for ok.ru**: Removed slow metadata fetch
5. **In-memory caching**: Translation results cached locally

## Known Limitations

1. **ok.ru HLS is IP-locked**: Can't proxy streams, must download full video
2. **Cloud Run cold starts**: First request may be slow (~5s)
3. **Video size limits**: Large videos take longer to download/upload
4. **GCS egress costs**: Streaming from GCS incurs bandwidth charges
