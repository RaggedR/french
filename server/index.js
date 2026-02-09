import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import ytdlpBase from 'yt-dlp-exec';
import dotenv from 'dotenv';
import { Storage } from '@google-cloud/storage';
import { spawn } from 'child_process';
import { createChunks, getChunkTranscript, formatTime } from './chunking.js';
import { downloadAudioChunk, downloadVideoChunk, transcribeAudioChunk } from './media.js';

// Use system yt-dlp binary instead of bundled one (bundled version may be outdated)
const ytdlp = ytdlpBase.create('yt-dlp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (parent directory)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Check if running locally (no GCS needed)
const IS_LOCAL = !process.env.GCS_BUCKET || process.env.NODE_ENV === 'development';

// Google Cloud Storage for video persistence (production only)
let bucket = null;
if (!IS_LOCAL) {
  const GCS_BUCKET = process.env.GCS_BUCKET;
  const storage = new Storage();
  bucket = storage.bucket(GCS_BUCKET);
  console.log(`[GCS] Using bucket: ${GCS_BUCKET}`);
} else {
  console.log('[Storage] Using in-memory storage (local mode)');
}

// In-memory session storage for local development
const localSessions = new Map();

// SSE clients for progress updates
const progressClients = new Map();

// Analysis sessions (for chunking workflow)
const analysisSessions = new Map();

/**
 * Session storage - uses GCS in production, in-memory locally
 */
async function saveSession(sessionId, data) {
  if (IS_LOCAL) {
    localSessions.set(sessionId, data);
    return;
  }
  const file = bucket.file(`sessions/${sessionId}.json`);
  await file.save(JSON.stringify(data), {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-cache' },
  });
  console.log(`[GCS] Session ${sessionId} saved`);
}

async function getSession(sessionId) {
  if (IS_LOCAL) {
    return localSessions.get(sessionId) || null;
  }
  try {
    const file = bucket.file(`sessions/${sessionId}.json`);
    const [contents] = await file.download();
    return JSON.parse(contents.toString());
  } catch (err) {
    if (err.code === 404) return null;
    console.error(`[GCS] Error getting session ${sessionId}:`, err.message);
    return null;
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Translation cache (in-memory for simplicity, could use Redis in production)
const translationCache = new Map();

/**
 * POST /api/transcribe
 * Accepts: { url: string, openaiApiKey: string }
 * Returns: { videoUrl: string, transcript: { words: [], segments: [], language: string, duration: number } }
 */
app.post('/api/transcribe', async (req, res) => {
  const { url, openaiApiKey } = req.body;
  const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'OpenAI API key is required (set in .env or pass in request)' });
  }

  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const audioPath = path.join(tempDir, `audio_${timestamp}.mp3`);

  try {
    console.log(`[Transcribe] Processing URL: ${url}`);

    // Check if this site needs local video download (CORS issues)
    const needsLocalVideo = /ok\.ru/.test(url);
    let playbackUrl;

    if (needsLocalVideo) {
      // For ok.ru: Download video to GCS (HLS URLs are IP-locked)
      // Optimized: video download runs in parallel with audio+transcription
      const sessionId = timestamp.toString();
      const videoPath = path.join(tempDir, `video_${timestamp}.mp4`);
      const openai = new OpenAI({ apiKey });

      // Step 1: Start video download immediately (don't wait - runs in parallel)
      console.log('[Transcribe] Starting video download...');
      const videoPromise = ytdlp(url, {
        format: 'best[height<=360]/best',  // 360p for faster download
        output: videoPath,
        noWarnings: true,
        concurrentFragments: 8,
      });

      // Step 2: Download audio (smaller, faster)
      console.log('[Transcribe] Downloading audio...');
      await ytdlp(url, {
        extractAudio: true,
        audioFormat: 'mp3',
        output: audioPath,
        noWarnings: true,
      });

      // Step 3: Transcribe with Whisper (video still downloading in background)
      console.log('[Transcribe] Sending to Whisper API...');
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: 'ru',
      });

      console.log('[Transcribe] Transcription complete');
      fs.unlinkSync(audioPath);

      const transcript = {
        words: transcription.words || [],
        segments: transcription.segments || [],
        language: transcription.language || 'ru',
        duration: transcription.duration || 0,
      };

      // Step 4: Wait for video download to complete
      console.log('[Transcribe] Waiting for video download...');
      await videoPromise;

      let videoUrl;
      if (!IS_LOCAL && bucket) {
        // Upload to GCS
        console.log('[Transcribe] Uploading video to GCS...');
        const gcsFileName = `videos/${sessionId}.mp4`;
        await bucket.upload(videoPath, {
          destination: gcsFileName,
          metadata: {
            contentType: 'video/mp4',
            cacheControl: 'public, max-age=86400',
          },
        });

        // Make the file publicly accessible
        await bucket.file(gcsFileName).makePublic();
        videoUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFileName}`;
        console.log(`[Transcribe] Video uploaded to GCS: ${videoUrl}`);
      } else {
        // Local dev: serve from temp directory (won't persist but works for testing)
        videoUrl = `/api/local-video/${sessionId}.mp4`;
        // Keep video file for local serving
        localSessions.set(`video_${sessionId}`, videoPath);
      }

      // Clean up temp video file (for GCS mode)
      if (!IS_LOCAL && fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }

      return res.json({
        videoUrl,
        transcript,
        title: 'OK.ru Video',
      });
    }

    // For other sites (YouTube, etc.): Need dumpJson for direct URL extraction
    console.log('[Transcribe] Getting video info...');
    const info = await ytdlp(url, {
      dumpJson: true,
      noWarnings: true,
    });

    // Use direct URL for YouTube, Vimeo, etc.
    let videoUrl = info.url;
    if (!videoUrl && info.formats) {
      const formats = info.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
      if (formats.length > 0) {
        formats.sort((a, b) => (b.height || 0) - (a.height || 0));
        videoUrl = formats[0].url;
      }
    }
    if (!videoUrl) {
      throw new Error('Could not extract video URL');
    }
    playbackUrl = videoUrl;
    console.log('[Transcribe] Video URL extracted');

    // Step 2: Download audio for Whisper
    console.log('[Transcribe] Downloading audio...');
    await ytdlp(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: audioPath,
      noWarnings: true,
    });

    console.log('[Transcribe] Audio downloaded');

    // Step 3: Transcribe with OpenAI Whisper
    console.log('[Transcribe] Sending to Whisper API...');
    const openai = new OpenAI({ apiKey });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      language: 'ru',
    });

    console.log('[Transcribe] Transcription complete');

    // Clean up temp file
    fs.unlinkSync(audioPath);

    // Format response
    const transcript = {
      words: transcription.words || [],
      segments: transcription.segments || [],
      language: transcription.language || 'ru',
      duration: transcription.duration || 0,
    };

    res.json({
      videoUrl: playbackUrl,
      transcript,
      title: info.title || 'Untitled Video',
    });
  } catch (error) {
    console.error('[Transcribe] Error:', error);

    // Clean up temp file if it exists
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    res.status(500).json({
      error: error.message || 'Transcription failed',
    });
  }
});

/**
 * POST /api/translate
 * Accepts: { word: string, googleApiKey: string }
 * Returns: { word: string, translation: string, sourceLanguage: string }
 */
app.post('/api/translate', async (req, res) => {
  const { word, googleApiKey } = req.body;
  const apiKey = googleApiKey || process.env.GOOGLE_TRANSLATE_API_KEY;

  if (!word) {
    return res.status(400).json({ error: 'Word is required' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'Google API key is required (set in .env or pass in request)' });
  }

  const cacheKey = `ru:${word.toLowerCase()}`;

  // Check cache
  if (translationCache.has(cacheKey)) {
    return res.json(translationCache.get(cacheKey));
  }

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: word,
          source: 'ru',
          target: 'en',
          format: 'text',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Translation failed');
    }

    const data = await response.json();
    const result = {
      word,
      translation: data.data.translations[0].translatedText,
      sourceLanguage: 'ru',
    };

    // Cache result
    translationCache.set(cacheKey, result);

    res.json(result);
  } catch (error) {
    console.error('[Translate] Error:', error);
    res.status(500).json({
      error: error.message || 'Translation failed',
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * GET /api/local-video/:filename
 * Serve locally stored videos (development only)
 */
app.get('/api/local-video/:filename', (req, res) => {
  if (!IS_LOCAL) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  const sessionId = req.params.filename.replace('.mp4', '');
  const videoPath = localSessions.get(`video_${sessionId}`);

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

/**
 * GET /api/hls/:sessionId/playlist.m3u8
 * Proxy and rewrite HLS manifest
 */
app.get('/api/hls/:sessionId/playlist.m3u8', async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session || !session.hlsUrl) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const response = await fetch(session.hlsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ok.ru/',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch m3u8: ${response.status}`);
    }

    let manifest = await response.text();

    // Rewrite segment URLs to go through our proxy
    const baseUrl = new URL(session.hlsUrl);
    const lines = manifest.split('\n').map(line => {
      // Skip comments and empty lines
      if (line.startsWith('#') || !line.trim()) {
        return line;
      }
      // Convert relative URLs to proxied URLs
      let segmentUrl;
      if (line.startsWith('http')) {
        segmentUrl = line;
      } else {
        segmentUrl = new URL(line, baseUrl).href;
      }
      return `/api/hls/${req.params.sessionId}/segment?url=${encodeURIComponent(segmentUrl)}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(lines.join('\n'));
  } catch (error) {
    console.error('[HLS Proxy] Manifest error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/hls/:sessionId/segment
 * Proxy HLS segments
 */
app.get('/api/hls/:sessionId/segment', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ok.ru/',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch segment: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'max-age=3600');

    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    pump().catch(err => {
      console.error('[HLS Proxy] Segment error:', err);
      res.end();
    });
  } catch (error) {
    console.error('[HLS Proxy] Segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/video-proxy
 * Proxies video content to bypass CORS restrictions
 * Query params: url (required) - the video URL to proxy
 */
app.get('/api/video-proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': new URL(url).origin,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    // Forward relevant headers
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');

    // Handle range requests for seeking
    const range = req.headers.range;
    if (range && contentLength) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : parseInt(contentLength) - 1;

      // Re-fetch with range header
      const rangeResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': new URL(url).origin,
          'Range': `bytes=${start}-${end}`,
        },
      });

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${contentLength}`);
      res.setHeader('Content-Length', end - start + 1);

      const reader = rangeResponse.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      pump().catch(err => {
        console.error('[Video Proxy] Stream error:', err);
        res.end();
      });
    } else {
      // Stream the full response
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      };
      pump().catch(err => {
        console.error('[Video Proxy] Stream error:', err);
        res.end();
      });
    }
  } catch (error) {
    console.error('[Video Proxy] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to proxy video' });
  }
});

// Batch settings for audio downloads
const DOWNLOAD_BUFFER = 20 * 60;  // Download 20 min of audio (5 chunks × 3 min = 15 min + 5 min buffer)
const CHUNKS_PER_BATCH = 5;       // Show 5 chunks at a time (~15 min)
const MIN_FINAL_CHUNK = 120;      // Minimum final chunk duration in seconds (merge if shorter)

/**
 * Create progress callback for a session
 */
function createProgressCallback(sessionId) {
  return (type, percent, status, message) => {
    sendProgress(sessionId, type, percent, status, message);
  };
}

/**
 * POST /api/analyze
 * Downloads first batch of audio (~25 min), transcribes, creates chunks
 * Returns: { sessionId, status: 'started' }
 * Progress sent via SSE, completion includes hasMoreChunks flag
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'OpenAI API key not configured on server' });
  }

  const sessionId = Date.now().toString();
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Initialize session
  analysisSessions.set(sessionId, {
    status: 'downloading',
    url,
    progress: { audio: 0, transcription: 0 },
  });

  // Send initial response with session ID
  res.json({ sessionId, status: 'started' });

  // Process in background - small delay to allow SSE connection
  setTimeout(async () => {
    try {
      console.log(`[Analyze] Session ${sessionId}: Starting audio download`);

      // Send immediate progress
      sendProgress(sessionId, 'audio', 1, 'active', 'Connecting to ok.ru...');

    // Animate progress during the slow dumpJson phase
    let connectProgress = 1;
    const connectInterval = setInterval(() => {
      connectProgress = Math.min(connectProgress + 1, 10);
      sendProgress(sessionId, 'audio', connectProgress, 'active', 'Fetching video info...');
    }, 2000);

    // Get video info first
    const info = await ytdlp(url, {
      dumpJson: true,
      noWarnings: true,
    });

    clearInterval(connectInterval);
    const title = info.title || 'Untitled Video';
    const totalDuration = info.duration || 0;
    const totalDurationMin = Math.round(totalDuration / 60);

    // Download up to 30 min of audio (buffer for smart chunking)
    const downloadEndTime = Math.min(DOWNLOAD_BUFFER, totalDuration);
    const downloadDurationMin = Math.round(downloadEndTime / 60);

    console.log(`[Analyze] Session ${sessionId}: Total ${totalDurationMin}min, downloading first ${downloadDurationMin}min`);

    // Download first batch of audio
    const audioPath = path.join(tempDir, `audio_${sessionId}_batch0.mp3`);
    const onProgress = createProgressCallback(sessionId);
    const { size: audioSize } = await downloadAudioChunk(url, audioPath, 0, downloadEndTime, { onProgress });
    console.log(`[Analyze] Session ${sessionId}: First batch downloaded (${(audioSize / 1024 / 1024).toFixed(1)} MB)`);

    // Transcribe audio
    const fullBatchTranscript = await transcribeAudioChunk(audioPath, { onProgress });

    // Clean up audio file
    fs.unlinkSync(audioPath);

    // Smart chunk the entire downloaded portion
    const allChunks = createChunks(fullBatchTranscript);
    console.log(`[Analyze] Session ${sessionId}: Smart chunking created ${allChunks.length} chunks from ${downloadDurationMin}min`);

    // Take first N chunks for this batch
    const chunksToShow = allChunks.slice(0, CHUNKS_PER_BATCH);
    const lastShownChunk = chunksToShow[chunksToShow.length - 1];
    const batchEndTime = lastShownChunk ? lastShownChunk.endTime : downloadEndTime;

    // Determine if there's more content after these chunks
    const hasMoreChunks = batchEndTime < totalDuration;

    // Build transcript containing only the words/segments for shown chunks
    const transcript = {
      words: fullBatchTranscript.words.filter(w => w.end <= batchEndTime),
      segments: fullBatchTranscript.segments.filter(s => s.end <= batchEndTime),
      language: fullBatchTranscript.language,
      duration: batchEndTime,
    };

    // Add status to chunks
    const chunks = chunksToShow.map(chunk => ({
      ...chunk,
      status: 'pending',
      videoUrl: null,
    }));

    console.log(`[Analyze] Session ${sessionId}: Showing ${chunks.length} chunks (ends at ${formatTime(batchEndTime)}), hasMore: ${hasMoreChunks}`);

    // Store session data
    analysisSessions.set(sessionId, {
      status: 'ready',
      url,
      title,
      transcript,
      chunks,
      totalDuration,
      nextBatchStartTime: hasMoreChunks ? batchEndTime : null,  // Start next batch from end of last shown chunk
      hasMoreChunks,
      chunkTranscripts: new Map(),
    });

    // Send completion event
    sendProgress(sessionId, 'complete', 100, 'complete', 'Analysis complete', {
      title,
      totalDuration,
      chunks,
      hasMoreChunks,
    });

    } catch (error) {
      console.error(`[Analyze] Session ${sessionId} error:`, error);

      analysisSessions.set(sessionId, {
        status: 'error',
        error: error.message,
      });

      sendProgress(sessionId, 'error', 0, 'error', error.message);
    }
  }, 500); // 500ms delay to allow SSE connection
});

/**
 * POST /api/load-more-chunks
 * Downloads next batch of audio, transcribes, appends chunks
 * Request: { sessionId }
 * Returns: { chunks: [...new chunks...], hasMoreChunks }
 */
app.post('/api/load-more-chunks', async (req, res) => {
  const { sessionId } = req.body;

  console.log(`[LoadMore] Request for session ${sessionId}`);

  const session = analysisSessions.get(sessionId);
  if (!session) {
    console.log(`[LoadMore] Session ${sessionId} not found`);
    return res.status(404).json({ error: 'Session not found' });
  }
  if (session.status !== 'ready') {
    console.log(`[LoadMore] Session ${sessionId} not ready, status: ${session.status}`);
    return res.status(404).json({ error: 'Session not ready' });
  }

  console.log(`[LoadMore] Session state - hasMoreChunks: ${session.hasMoreChunks}, nextBatchStartTime: ${session.nextBatchStartTime}`);

  if (!session.hasMoreChunks || session.nextBatchStartTime === null) {
    console.log(`[LoadMore] No more chunks to load`);
    return res.status(400).json({ error: 'No more chunks to load' });
  }

  const tempDir = path.join(__dirname, 'temp');
  const batchIndex = session.chunks.length;
  const audioPath = path.join(tempDir, `audio_${sessionId}_batch${batchIndex}.mp3`);

  try {
    const startTime = session.nextBatchStartTime;
    // Download 30 min buffer (or rest of video if less)
    const downloadEndTime = Math.min(startTime + DOWNLOAD_BUFFER, session.totalDuration);

    console.log(`[LoadMore] Session ${sessionId}: Downloading ${formatTime(startTime)} - ${formatTime(downloadEndTime)}`);

    // Download this batch of audio
    const onProgress = createProgressCallback(sessionId);
    await downloadAudioChunk(session.url, audioPath, startTime, downloadEndTime, { onProgress });

    // Transcribe audio
    const rawTranscript = await transcribeAudioChunk(audioPath, { onProgress });

    // Clean up audio
    fs.unlinkSync(audioPath);

    // Smart chunk the downloaded portion
    const allChunks = createChunks(rawTranscript);
    console.log(`[LoadMore] Session ${sessionId}: Smart chunking created ${allChunks.length} chunks`);

    // Take first N chunks
    const chunksToShow = allChunks.slice(0, CHUNKS_PER_BATCH);
    const lastShownChunk = chunksToShow[chunksToShow.length - 1];
    const batchEndTime = lastShownChunk
      ? startTime + lastShownChunk.endTime  // Offset by startTime
      : downloadEndTime;

    // Check if there's more content
    const hasMoreAfterThis = batchEndTime < session.totalDuration;

    // Adjust chunk IDs, indices, and timestamps (offset by startTime)
    const existingChunkCount = session.chunks.length;
    const newChunks = chunksToShow.map((chunk, i) => ({
      ...chunk,
      id: `chunk-${existingChunkCount + i}`,
      index: existingChunkCount + i,
      startTime: chunk.startTime + startTime,
      endTime: chunk.endTime + startTime,
      status: 'pending',
      videoUrl: null,
    }));

    // Build transcript with adjusted timestamps for the shown chunks only
    const newWords = rawTranscript.words
      .filter(w => w.end <= (lastShownChunk?.endTime || rawTranscript.duration))
      .map(w => ({ ...w, start: w.start + startTime, end: w.end + startTime }));
    const newSegments = rawTranscript.segments
      .filter(s => s.end <= (lastShownChunk?.endTime || rawTranscript.duration))
      .map(s => ({ ...s, start: s.start + startTime, end: s.end + startTime }));

    // Extend session
    session.transcript.words.push(...newWords);
    session.transcript.segments.push(...newSegments);
    session.chunks.push(...newChunks);
    session.nextBatchStartTime = hasMoreAfterThis ? batchEndTime : null;
    session.hasMoreChunks = hasMoreAfterThis;

    console.log(`[LoadMore] Session ${sessionId}: Added ${newChunks.length} chunks (ends at ${formatTime(batchEndTime)}), hasMore: ${hasMoreAfterThis}`);

    sendProgress(sessionId, 'complete', 100, 'complete', 'More chunks loaded', {
      newChunks,
      hasMoreChunks: hasMoreAfterThis,
    });

    res.json({
      chunks: newChunks,
      hasMoreChunks: hasMoreAfterThis,
    });

  } catch (error) {
    console.error(`[LoadMore] Session ${sessionId} error:`, error);

    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    sendProgress(sessionId, 'error', 0, 'error', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/progress/:sessionId
 * Server-Sent Events for real-time progress updates
 */
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if present
  res.flushHeaders(); // Flush headers immediately

  // Store the client connection
  if (!progressClients.has(sessionId)) {
    progressClients.set(sessionId, []);
  }
  progressClients.get(sessionId).push(res);

  console.log(`[SSE] Client connected for session ${sessionId}`);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Send heartbeat every 15 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  // Only send cached results if explicitly requested (for page refresh recovery)
  // Don't auto-send 'complete' as it breaks chunk download progress subscriptions
  const session = analysisSessions.get(sessionId);
  if (session?.status === 'error') {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      progress: 0,
      status: 'error',
      message: session.error,
    })}\n\n`);
  }

  // Clean up on client disconnect
  req.on('close', () => {
    console.log(`[SSE] Client disconnected for session ${sessionId}`);
    clearInterval(heartbeat);
    const clients = progressClients.get(sessionId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index > -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        progressClients.delete(sessionId);
      }
    }
  });
});

/**
 * Send progress update to all connected clients for a session
 */
function sendProgress(sessionId, type, progress, status, message, extra = {}) {
  const clients = progressClients.get(sessionId);
  if (clients && clients.length > 0) {
    const data = JSON.stringify({ type, progress, status, message, ...extra });
    console.log(`[SSE] Sending to ${clients.length} clients: ${type} ${progress}% - ${message}`);
    clients.forEach(client => {
      client.write(`data: ${data}\n\n`);
    });
  } else {
    console.log(`[SSE] No clients for session ${sessionId}, cannot send: ${type} - ${message}`);
  }
}

/**
 * GET /api/session/:sessionId
 * Get session data including chunk status
 */
app.get('/api/session/:sessionId', (req, res) => {
  const session = analysisSessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status === 'ready') {
    // Return chunks with their current status (pending/downloading/ready)
    res.json({
      status: 'ready',
      title: session.title,
      totalDuration: session.totalDuration,
      originalUrl: session.url,
      hasMoreChunks: session.hasMoreChunks || false,
      chunks: session.chunks.map(chunk => ({
        id: chunk.id,
        index: chunk.index,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        duration: chunk.duration,
        previewText: chunk.previewText,
        wordCount: chunk.wordCount,
        status: chunk.status,
        videoUrl: chunk.videoUrl,
      })),
    });
  } else if (session.status === 'error') {
    res.json({
      status: 'error',
      error: session.error,
    });
  } else {
    res.json({
      status: session.status,
      progress: session.progress,
    });
  }
});

/**
 * GET /api/session/:sessionId/chunk/:chunkId
 * Get chunk video URL and transcript (if ready)
 * Returns: { videoUrl, transcript, title }
 */
app.get('/api/session/:sessionId/chunk/:chunkId', (req, res) => {
  const { sessionId, chunkId } = req.params;

  const session = analysisSessions.get(sessionId);
  if (!session || session.status !== 'ready') {
    return res.status(404).json({ error: 'Session not found or not ready' });
  }

  const chunk = session.chunks.find(c => c.id === chunkId);
  if (!chunk) {
    return res.status(404).json({ error: 'Chunk not found' });
  }

  if (chunk.status !== 'ready') {
    return res.status(400).json({
      error: 'Chunk not ready',
      status: chunk.status,
    });
  }

  const transcript = session.chunkTranscripts.get(chunkId);
  if (!transcript) {
    return res.status(500).json({ error: 'Transcript not found for chunk' });
  }

  const partNum = parseInt(chunkId.split('-')[1]) + 1;
  res.json({
    videoUrl: chunk.videoUrl,
    transcript,
    title: `${session.title} - Part ${partNum}`,
  });
});

/**
 * POST /api/download-chunk
 * Phase 2: Download video for a specific chunk
 * Request: { sessionId, chunkId, startTime, endTime }
 * Returns: { videoUrl, transcript }
 */
app.post('/api/download-chunk', async (req, res) => {
  const { sessionId, chunkId } = req.body;

  const session = analysisSessions.get(sessionId);
  if (!session || session.status !== 'ready') {
    return res.status(404).json({ error: 'Session not found or not ready' });
  }

  // Find the chunk in session
  const chunk = session.chunks.find(c => c.id === chunkId);
  if (!chunk) {
    return res.status(404).json({ error: 'Chunk not found' });
  }

  // If already ready, return cached data
  if (chunk.status === 'ready' && chunk.videoUrl) {
    const transcript = session.chunkTranscripts.get(chunkId);
    const partNum = parseInt(chunkId.split('-')[1]) + 1;
    return res.json({
      videoUrl: chunk.videoUrl,
      transcript,
      title: `${session.title} - Part ${partNum}`,
    });
  }

  // Get startTime/endTime from the chunk (not from request body)
  const { startTime, endTime } = chunk;

  // Mark chunk as downloading
  chunk.status = 'downloading';

  const tempDir = path.join(__dirname, 'temp');
  const chunkPath = path.join(tempDir, `chunk_${sessionId}_${chunkId}.mp4`);

  try {
    const partNum = parseInt(chunkId.split('-')[1]) + 1;
    console.log(`[Download-Chunk] Session ${sessionId}, Chunk ${chunkId}: ${formatTime(startTime)} - ${formatTime(endTime)}`);

    // Download video chunk
    const onProgress = createProgressCallback(sessionId);
    const { size: videoSize } = await downloadVideoChunk(session.url, chunkPath, startTime, endTime, { onProgress, partNum });
    console.log(`[Download-Chunk] Session ${sessionId}: Chunk downloaded (${(videoSize / 1024 / 1024).toFixed(1)} MB)`);

    // Get chunk transcript with adjusted timestamps
    const chunkTranscript = getChunkTranscript(session.transcript, startTime, endTime);
    console.log(`[Download-Chunk] Chunk ${chunkId}: startTime=${startTime}, endTime=${endTime}`);
    console.log(`[Download-Chunk] Full transcript has ${session.transcript.words?.length} words`);
    console.log(`[Download-Chunk] Chunk transcript has ${chunkTranscript.words?.length} words`);
    console.log(`[Download-Chunk] First chunk word:`, chunkTranscript.words?.[0]);
    console.log(`[Download-Chunk] Last chunk word:`, chunkTranscript.words?.[chunkTranscript.words?.length - 1]);

    let videoUrl;
    if (!IS_LOCAL && bucket) {
      // Upload to GCS
      sendProgress(sessionId, 'video', 90, 'active', 'Uploading...');
      const gcsFileName = `videos/${sessionId}_${chunkId}.mp4`;
      await bucket.upload(chunkPath, {
        destination: gcsFileName,
        metadata: {
          contentType: 'video/mp4',
          cacheControl: 'public, max-age=86400',
        },
      });
      await bucket.file(gcsFileName).makePublic();
      videoUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFileName}`;

      // Clean up local chunk file
      if (fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath);
      }
    } else {
      // Local dev: serve from temp directory
      videoUrl = `/api/local-video/${sessionId}_${chunkId}.mp4`;
      localSessions.set(`video_${sessionId}_${chunkId}`, chunkPath);
    }

    // Persist chunk state in session
    chunk.status = 'ready';
    chunk.videoUrl = videoUrl;
    session.chunkTranscripts.set(chunkId, chunkTranscript);

    sendProgress(sessionId, 'video', 100, 'complete', 'Ready');
    console.log(`[Download-Chunk] Session ${sessionId}: Chunk ready at ${videoUrl}`);

    res.json({
      videoUrl,
      transcript: chunkTranscript,
      title: `${session.title} - Part ${parseInt(chunkId.split('-')[1]) + 1}`,
    });

  } catch (error) {
    console.error(`[Download-Chunk] Error:`, error);

    // Mark chunk as pending again on error
    chunk.status = 'pending';

    // Clean up chunk file if it exists
    if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);

    sendProgress(sessionId, 'video', 0, 'error', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve static frontend files in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`OpenAI API key: ${process.env.OPENAI_API_KEY ? 'loaded from .env' : 'not set'}`);
  console.log(`Google API key: ${process.env.GOOGLE_TRANSLATE_API_KEY ? 'loaded from .env' : 'not set'}`);
});

