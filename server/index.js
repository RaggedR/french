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
import { createChunks, createTextChunks, getChunkTranscript, formatTime } from './chunking.js';
import { downloadAudioChunk, downloadVideoChunk, transcribeAudioChunk, addPunctuation, lemmatizeWords, getOkRuVideoInfo, isLibRuUrl, fetchLibRuText, generateTtsAudio, getAudioDuration, estimateWordTimestamps } from './media.js';

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

// URL to session ID cache (for reusing existing analysis)
// Maps normalized URL -> { sessionId, timestamp }
const urlSessionCache = new Map();
const URL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Extraction cache TTL (stream URLs expire after ~2-4 hours on ok.ru)
const EXTRACTION_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Get cached yt-dlp extraction info from GCS
 * Returns the info.json content if cached and not expired
 */
async function getCachedExtraction(url) {
  const videoId = extractVideoId(url);
  if (!videoId || IS_LOCAL) return null;

  try {
    const file = bucket.file(`cache/extraction_${videoId}.json`);
    const [exists] = await file.exists();
    if (!exists) return null;

    const [metadata] = await file.getMetadata();
    const created = new Date(metadata.timeCreated);
    if (Date.now() - created.getTime() > EXTRACTION_CACHE_TTL) {
      // Expired, delete it
      await file.delete().catch(() => {});
      return null;
    }

    const [contents] = await file.download();
    console.log(`[Cache] Using cached extraction for ${videoId}`);
    return JSON.parse(contents.toString());
  } catch (err) {
    console.log(`[Cache] Extraction cache miss for ${videoId}:`, err.message);
    return null;
  }
}

/**
 * Save yt-dlp extraction info to GCS cache (minimal version)
 */
async function cacheExtraction(url, infoJson) {
  const videoId = extractVideoId(url);
  if (!videoId || IS_LOCAL || !infoJson) return;

  try {
    // Only cache essential fields that yt-dlp needs for --load-info-json
    const minimalInfo = {
      id: infoJson.id,
      title: infoJson.title,
      duration: infoJson.duration,
      extractor: infoJson.extractor,
      extractor_key: infoJson.extractor_key,
      webpage_url: infoJson.webpage_url,
      original_url: infoJson.original_url,
      formats: infoJson.formats,  // Required for stream selection
      requested_formats: infoJson.requested_formats,
      // Skip: thumbnails, description, comments, subtitles, etc.
    };

    const file = bucket.file(`cache/extraction_${videoId}.json`);
    await file.save(JSON.stringify(minimalInfo), {
      contentType: 'application/json',
      metadata: { cacheControl: 'no-cache' },
    });

    const originalSize = JSON.stringify(infoJson).length;
    const minimalSize = JSON.stringify(minimalInfo).length;
    console.log(`[Cache] Saved extraction cache for ${videoId} (${Math.round(minimalSize/1024)}KB, was ${Math.round(originalSize/1024)}KB)`);
  } catch (err) {
    console.error(`[Cache] Failed to cache extraction:`, err.message);
  }
}

/**
 * Extract video ID from URL
 */
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('ok.ru')) {
      const match = u.pathname.match(/\/video\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize URL for cache lookup (strip tracking params, etc.)
 */
function normalizeUrl(url) {
  const videoId = extractVideoId(url);
  if (videoId) return `ok.ru/video/${videoId}`;
  try {
    const u = new URL(url);
    // For lib.ru, normalize to hostname + path
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

/**
 * Check if we have a cached session for this URL
 */
async function getCachedSession(url) {
  const normalizedUrl = normalizeUrl(url);
  const cached = urlSessionCache.get(normalizedUrl);

  if (!cached) return null;

  // Check if cache entry is expired
  if (Date.now() - cached.timestamp > URL_CACHE_TTL) {
    urlSessionCache.delete(normalizedUrl);
    return null;
  }

  // Verify session still exists
  const session = await getAnalysisSession(cached.sessionId);
  if (!session || session.status !== 'ready') {
    urlSessionCache.delete(normalizedUrl);
    return null;
  }

  console.log(`[Cache] Found cached session ${cached.sessionId} for ${normalizedUrl}`);
  return { sessionId: cached.sessionId, session };
}

/**
 * Cache a session for a URL
 */
function cacheSessionUrl(url, sessionId) {
  const normalizedUrl = normalizeUrl(url);
  urlSessionCache.set(normalizedUrl, {
    sessionId,
    timestamp: Date.now(),
  });
  console.log(`[Cache] Cached session ${sessionId} for ${normalizedUrl}`);
}

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

/**
 * Delete a file from GCS
 */
async function deleteGcsFile(filePath) {
  if (IS_LOCAL) return;
  try {
    await bucket.file(filePath).delete();
    console.log(`[GCS] Deleted: ${filePath}`);
  } catch (err) {
    if (err.code !== 404) {
      console.error(`[GCS] Error deleting ${filePath}:`, err.message);
    }
  }
}

/**
 * Delete a session and all its associated videos from GCS
 */
async function deleteSessionAndVideos(sessionId) {
  const session = await getAnalysisSession(sessionId);

  if (!IS_LOCAL && bucket && session) {
    // Delete all chunk videos
    if (session.chunks) {
      for (const chunk of session.chunks) {
        if (chunk.status === 'ready') {
          await deleteGcsFile(`videos/${sessionId}_${chunk.id}.mp4`);
        }
      }
    }
    // Delete session JSON
    await deleteGcsFile(`sessions/${sessionId}.json`);
  }

  // Clean up memory cache
  analysisSessions.delete(sessionId);

  if (IS_LOCAL) {
    // Clean up local files
    if (session?.chunks) {
      for (const chunk of session.chunks) {
        const videoKey = `video_${sessionId}_${chunk.id}`;
        const videoPath = localSessions.get(videoKey);
        if (videoPath && fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
        localSessions.delete(videoKey);
      }
    }
    localSessions.delete(sessionId);
  }

  console.log(`[Session] Deleted session ${sessionId} and all associated videos`);
}

/**
 * Get session from memory cache first, then GCS
 * Also populates memory cache from GCS for faster subsequent access
 */
async function getAnalysisSession(sessionId) {
  // Check memory cache first
  if (analysisSessions.has(sessionId)) {
    return analysisSessions.get(sessionId);
  }

  // Try loading from GCS
  const session = await getSession(sessionId);
  if (session) {
    // Restore Map objects that were serialized as arrays
    if (session.chunkTranscripts && Array.isArray(session.chunkTranscripts)) {
      session.chunkTranscripts = new Map(session.chunkTranscripts);
    } else if (!session.chunkTranscripts) {
      session.chunkTranscripts = new Map();
    }
    if (session.chunkTexts && Array.isArray(session.chunkTexts)) {
      session.chunkTexts = new Map(session.chunkTexts);
    }
    // Cache in memory for faster access
    analysisSessions.set(sessionId, session);
    console.log(`[Session] Restored session ${sessionId} from GCS`);
  }
  return session;
}

/**
 * Save session to both memory and GCS
 */
async function setAnalysisSession(sessionId, session) {
  // Save to memory
  analysisSessions.set(sessionId, session);

  // Save to GCS (serialize Map to array for JSON)
  const sessionToSave = {
    ...session,
    chunkTranscripts: session.chunkTranscripts instanceof Map
      ? Array.from(session.chunkTranscripts.entries())
      : session.chunkTranscripts,
    chunkTexts: session.chunkTexts instanceof Map
      ? Array.from(session.chunkTexts.entries())
      : session.chunkTexts,
  };
  await saveSession(sessionId, sessionToSave);
}

/**
 * Clean up old sessions and videos from GCS (older than 7 days)
 * GCS lifecycle policy handles most cleanup, but this runs on startup as a backup
 */
async function cleanupOldSessions() {
  if (IS_LOCAL || !bucket) {
    console.log('[Cleanup] Skipping cleanup in local mode');
    return;
  }

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - SEVEN_DAYS_MS);

  try {
    console.log(`[Cleanup] Looking for sessions older than ${cutoffDate.toISOString()}`);

    // List all session files
    const [sessionFiles] = await bucket.getFiles({ prefix: 'sessions/' });
    let deletedCount = 0;

    for (const file of sessionFiles) {
      const [metadata] = await file.getMetadata();
      const created = new Date(metadata.timeCreated);

      if (created < cutoffDate) {
        // Extract sessionId from filename (sessions/1234567890.json -> 1234567890)
        const sessionId = file.name.replace('sessions/', '').replace('.json', '');

        // Delete associated videos
        const [videoFiles] = await bucket.getFiles({ prefix: `videos/${sessionId}_` });
        for (const videoFile of videoFiles) {
          await videoFile.delete().catch(() => {});
        }

        // Delete session file
        await file.delete().catch(() => {});
        deletedCount++;
        console.log(`[Cleanup] Deleted old session: ${sessionId}`);
      }
    }

    console.log(`[Cleanup] Complete. Deleted ${deletedCount} old sessions.`);
  } catch (err) {
    console.error('[Cleanup] Error during cleanup:', err.message);
  }
}

/**
 * Rebuild the in-memory URL → sessionId cache from GCS sessions.
 * Called on startup so that cached sessions survive cold starts and deploys.
 */
async function rebuildUrlCache() {
  if (IS_LOCAL || !bucket) return;

  try {
    const [sessionFiles] = await bucket.getFiles({ prefix: 'sessions/' });
    let cached = 0;

    for (const file of sessionFiles) {
      try {
        const [contents] = await file.download();
        const session = JSON.parse(contents.toString());
        if (session.status === 'ready' && session.url) {
          const sessionId = file.name.replace('sessions/', '').replace('.json', '');
          cacheSessionUrl(session.url, sessionId);
          cached++;
        }
      } catch {
        // Skip unreadable sessions
      }
    }

    console.log(`[Startup] Rebuilt URL cache: ${cached} sessions`);
  } catch (err) {
    console.error('[Startup] Failed to rebuild URL cache:', err.message);
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

/**
 * POST /api/extract-sentence
 * Uses GPT to extract the single sentence containing a word from surrounding text,
 * and translates it to English.
 * Accepts: { text: string, word: string }
 * Returns: { sentence: string, translation: string }
 */
app.post('/api/extract-sentence', async (req, res) => {
  const { text, word } = req.body;

  if (!text || !word) {
    return res.status(400).json({ error: 'text and word are required' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'From the given Russian text, extract the single complete sentence that contains the specified word. Return JSON with two fields: "sentence" (the Russian sentence) and "translation" (its English translation). The sentence should be exactly one grammatical sentence, not a fragment and not multiple sentences.',
        }, {
          role: 'user',
          content: `Word: ${word}\nText: ${text}`,
        }],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Sentence extraction failed');
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    res.json({ sentence: result.sentence, translation: result.translation });
  } catch (error) {
    console.error('[ExtractSentence] Error:', error);
    res.status(500).json({ error: error.message || 'Sentence extraction failed' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * DELETE /api/session/:sessionId
 * Delete a session and all its associated videos from storage
 */
app.delete('/api/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    await deleteSessionAndVideos(sessionId);
    res.json({ success: true, message: `Session ${sessionId} deleted` });
  } catch (error) {
    console.error(`[Delete Session] Error:`, error);
    res.status(500).json({ error: error.message || 'Failed to delete session' });
  }
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
 * GET /api/local-audio/:filename
 * Serve locally stored TTS audio files (development only)
 */
app.get('/api/local-audio/:filename', (req, res) => {
  if (!IS_LOCAL) {
    return res.status(404).json({ error: 'Not available in production' });
  }

  const key = req.params.filename.replace('.mp3', '');
  const audioPath = localSessions.get(`audio_${key}`);

  if (!audioPath || !fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Audio not found' });
  }

  const stat = fs.statSync(audioPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(audioPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
    });
    fs.createReadStream(audioPath).pipe(res);
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

  // Check if we have a cached session for this URL
  const cached = await getCachedSession(url);
  if (cached) {
    console.log(`[Analyze] Returning cached session ${cached.sessionId} for URL`);
    return res.json({
      sessionId: cached.sessionId,
      status: 'cached',
      title: cached.session.title,
      contentType: cached.session.contentType || 'video',
      totalDuration: cached.session.totalDuration,
      chunks: cached.session.chunks,
      hasMoreChunks: cached.session.hasMoreChunks,
    });
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
      console.log(`[Analyze] Session ${sessionId}: Starting analysis`);

      // ── Text mode (lib.ru) ──
      if (isLibRuUrl(url)) {
        sendProgress(sessionId, 'audio', 10, 'active', 'Fetching text from lib.ru...');

        const { title, author, text } = await fetchLibRuText(url);
        const displayTitle = author ? `${author} — ${title}` : title;

        sendProgress(sessionId, 'audio', 50, 'active', 'Chunking text...');
        const textChunks = createTextChunks(text);
        console.log(`[Analyze] Session ${sessionId}: Text mode - "${displayTitle}" (${text.length} chars, ${textChunks.length} chunks)`);

        // Build chunk texts map for TTS generation later
        const chunkTexts = new Map();
        const chunks = textChunks.map(chunk => {
          chunkTexts.set(chunk.id, chunk.text);
          return {
            id: chunk.id,
            index: chunk.index,
            startTime: 0,
            endTime: 0,
            duration: 0,
            previewText: chunk.previewText,
            wordCount: chunk.wordCount,
            status: 'pending',
            videoUrl: null,
          };
        });

        await setAnalysisSession(sessionId, {
          status: 'ready',
          url,
          title: displayTitle,
          contentType: 'text',
          chunks,
          chunkTexts,
          totalDuration: 0,
          hasMoreChunks: false,
          chunkTranscripts: new Map(),
        });

        cacheSessionUrl(url, sessionId);

        sendProgress(sessionId, 'complete', 100, 'complete', 'Text ready', {
          title: displayTitle,
          totalDuration: 0,
          chunks,
          hasMoreChunks: false,
          contentType: 'text',
        });
        return;
      }

      // ── Video mode (ok.ru) ──
      // Fast info fetch via HTML scraping (~4-5s vs yt-dlp's ~15s)
      // audio progress is managed by downloadAudioChunk via onProgress callback

      let title, totalDuration;
      try {
        const info = await getOkRuVideoInfo(url);
        title = info.title;
        totalDuration = info.duration;
        console.log(`[Analyze] Session ${sessionId}: Got info - "${title}" (${Math.round(totalDuration / 60)}min)`);
      } catch (e) {
        console.log(`[Analyze] Session ${sessionId}: Fast info fetch failed, will get from download`);
        title = 'Untitled Video';
        totalDuration = 0;
      }

      const totalDurationMin = Math.round(totalDuration / 60);

      // Check for cached extraction info (speeds up by ~2 min)
      let cachedInfoPath = null;
      const cachedExtraction = await getCachedExtraction(url);
      if (cachedExtraction) {
        // Write cached info to temp file for yt-dlp to use
        cachedInfoPath = path.join(tempDir, `cached_info_${sessionId}.json`);
        fs.writeFileSync(cachedInfoPath, JSON.stringify(cachedExtraction));
        console.log(`[Analyze] Session ${sessionId}: Using cached extraction`);
      }

      // Now download audio (yt-dlp will get duration if we didn't)
      // audio progress is managed by downloadAudioChunk via onProgress callback
      const audioPath = path.join(tempDir, `audio_${sessionId}_batch0.mp3`);
      const infoJsonPath = path.join(tempDir, `audio_${sessionId}_batch0.mp3.info.json`);
      const onProgress = createProgressCallback(sessionId);
      const { size: audioSize, info: downloadInfo } = await downloadAudioChunk(
        url, audioPath, 0, DOWNLOAD_BUFFER,
        {
          onProgress,
          fetchInfo: !cachedExtraction && totalDuration === 0,  // Only fetch if no cache and scrape failed
          cachedInfoPath,
        }
      );

      // Cache the extraction info for future requests (if we did a fresh extraction)
      if (!cachedExtraction && fs.existsSync(infoJsonPath)) {
        try {
          const freshInfo = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
          await cacheExtraction(url, freshInfo);
        } catch (e) {
          console.log(`[Analyze] Failed to cache extraction:`, e.message);
        }
      }

      // Clean up temp cached info file
      if (cachedInfoPath && fs.existsSync(cachedInfoPath)) {
        fs.unlinkSync(cachedInfoPath);
      }

      // Use download info as fallback
      if (totalDuration === 0 && downloadInfo) {
        title = downloadInfo.title || title;
        totalDuration = downloadInfo.duration || 0;
      }

      // Actual download may be shorter than requested if video is short
      const downloadEndTime = Math.min(DOWNLOAD_BUFFER, totalDuration);
      const downloadDurationMin = Math.round(downloadEndTime / 60);

      console.log(`[Analyze] Session ${sessionId}: Total ${Math.round(totalDuration / 60)}min, downloaded ${downloadDurationMin}min (${(audioSize / 1024 / 1024).toFixed(1)} MB)`);

      // Transcribe audio
      const rawTranscript = await transcribeAudioChunk(audioPath, { onProgress });

      // Add punctuation via LLM
      const fullBatchTranscript = await addPunctuation(rawTranscript, { onProgress });

      // Lemmatization deferred to per-chunk download (faster on ~3min chunks vs full 15min)

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

      // Store session data (persisted to GCS)
      await setAnalysisSession(sessionId, {
        status: 'ready',
        url,
        title,
        contentType: 'video',
        transcript,
        chunks,
        totalDuration,
        nextBatchStartTime: hasMoreChunks ? batchEndTime : null,  // Start next batch from end of last shown chunk
        hasMoreChunks,
        chunkTranscripts: new Map(),
      });

      // Cache the URL -> session mapping for fast re-access
      cacheSessionUrl(url, sessionId);

      // Send completion event
      sendProgress(sessionId, 'complete', 100, 'complete', 'Analysis complete', {
        title,
        totalDuration,
        chunks,
        hasMoreChunks,
      });

    } catch (error) {
      console.error(`[Analyze] Session ${sessionId} error:`, error);

      await setAnalysisSession(sessionId, {
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

  const session = await getAnalysisSession(sessionId);
  if (!session) {
    console.log(`[LoadMore] Session ${sessionId} not found`);
    return res.status(404).json({ error: 'Session not found. Please re-analyze the video.' });
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

    // Check for cached extraction info
    let cachedInfoPath = null;
    const cachedExtraction = await getCachedExtraction(session.url);
    if (cachedExtraction) {
      cachedInfoPath = path.join(tempDir, `cached_info_${sessionId}_batch${batchIndex}.json`);
      fs.writeFileSync(cachedInfoPath, JSON.stringify(cachedExtraction));
      console.log(`[LoadMore] Session ${sessionId}: Using cached extraction`);
    }

    // Download this batch of audio
    const onProgress = createProgressCallback(sessionId);
    await downloadAudioChunk(session.url, audioPath, startTime, downloadEndTime, { onProgress, cachedInfoPath });

    // Clean up temp cached info file
    if (cachedInfoPath && fs.existsSync(cachedInfoPath)) {
      fs.unlinkSync(cachedInfoPath);
    }

    // Transcribe audio
    const rawTranscriptUnpunctuated = await transcribeAudioChunk(audioPath, { onProgress });

    // Add punctuation via LLM
    const rawTranscript = await addPunctuation(rawTranscriptUnpunctuated, { onProgress });

    // Lemmatization deferred to per-chunk download

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

    // Save session to GCS for persistence across restarts
    await setAnalysisSession(sessionId, session);

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
    res.status(500).json({ error: friendlyErrorMessage(error.message) });
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
 * Terminal progress bar rendering
 */
const TERM_COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgMagenta: '\x1b[45m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  white: '\x1b[37m',
};

const TYPE_STYLES = {
  audio:         { color: TERM_COLORS.blue,    label: 'AUDIO' },
  transcription: { color: TERM_COLORS.green,   label: 'TRANSCRIBE' },
  punctuation:   { color: TERM_COLORS.yellow,  label: 'PUNCTUATE' },
  lemmatization: { color: TERM_COLORS.yellow,  label: 'LEMMATIZE' },
  tts:           { color: TERM_COLORS.cyan,    label: 'TTS' },
  video:         { color: TERM_COLORS.magenta,  label: 'VIDEO' },
  complete:      { color: TERM_COLORS.green,   label: 'DONE' },
  error:         { color: TERM_COLORS.red,     label: 'ERROR' },
  connected:     { color: TERM_COLORS.cyan,    label: 'SSE' },
};

function renderProgressBar(percent, width = 30) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function printProgress(sessionId, type, progress, status, message) {
  const style = TYPE_STYLES[type] || { color: TERM_COLORS.white, label: type.toUpperCase() };
  const { color, label } = style;
  const { reset, bold, dim } = TERM_COLORS;

  if (type === 'connected') {
    console.log(`${dim}[${sessionId.slice(-6)}]${reset} ${color}${label}${reset} Client connected`);
    return;
  }

  if (type === 'error') {
    console.log(`${dim}[${sessionId.slice(-6)}]${reset} ${color}${bold}${label}${reset} ${message}`);
    return;
  }

  if (type === 'complete') {
    console.log(`${dim}[${sessionId.slice(-6)}]${reset} ${color}${bold}✓ ${label}${reset} ${message}`);
    return;
  }

  const bar = renderProgressBar(progress);
  const pct = `${String(progress).padStart(3)}%`;
  // Use \r to overwrite line for same-type updates
  process.stdout.write(`\r${dim}[${sessionId.slice(-6)}]${reset} ${color}${bold}${label.padEnd(10)}${reset} ${color}${bar}${reset} ${pct} ${dim}${message}${reset}\x1b[K`);

  // Print newline when a phase completes (100%) so next output starts fresh
  if (progress >= 100 || status === 'complete') {
    process.stdout.write('\n');
  }
}

/**
 * Send progress update to all connected clients for a session
 */
/**
 * Rewrite known API error messages into user-friendly versions with actionable links.
 */
function friendlyErrorMessage(message) {
  if (message && message.includes('exceeded your current quota')) {
    return 'OpenAI API quota exceeded. Add credits at https://platform.openai.com/settings/organization/billing';
  }
  return message;
}

function sendProgress(sessionId, type, progress, status, message, extra = {}) {
  if (status === 'error') message = friendlyErrorMessage(message);
  // Print to terminal
  printProgress(sessionId, type, progress, status, message);

  const clients = progressClients.get(sessionId);
  if (clients && clients.length > 0) {
    const data = JSON.stringify({ type, progress, status, message, ...extra });
    clients.forEach(client => {
      client.write(`data: ${data}\n\n`);
    });
  }
}

/**
 * GET /api/session/:sessionId
 * Get session data including chunk status
 */
app.get('/api/session/:sessionId', async (req, res) => {
  const session = await getAnalysisSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found. Please re-analyze the video.' });
  }

  if (session.status === 'ready') {
    // Return chunks with their current status (pending/downloading/ready)
    res.json({
      status: 'ready',
      title: session.title,
      contentType: session.contentType || 'video',
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
        audioUrl: chunk.audioUrl,
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
app.get('/api/session/:sessionId/chunk/:chunkId', async (req, res) => {
  const { sessionId, chunkId } = req.params;

  const session = await getAnalysisSession(sessionId);
  if (!session || session.status !== 'ready') {
    return res.status(404).json({ error: 'Session not found or not ready. Please re-analyze the video.' });
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
  const response = {
    transcript,
    title: `${session.title} - Part ${partNum}`,
  };
  if (session.contentType === 'text') {
    response.audioUrl = chunk.audioUrl;
  } else {
    response.videoUrl = chunk.videoUrl;
  }
  res.json(response);
});

/**
 * POST /api/download-chunk
 * Phase 2: Download video for a specific chunk
 * Request: { sessionId, chunkId, startTime, endTime }
 * Returns: { videoUrl, transcript }
 */
app.post('/api/download-chunk', async (req, res) => {
  const { sessionId, chunkId } = req.body;

  const session = await getAnalysisSession(sessionId);
  if (!session || session.status !== 'ready') {
    return res.status(404).json({ error: 'Session not found or not ready. Please re-analyze the video.' });
  }

  // Find the chunk in session
  const chunk = session.chunks.find(c => c.id === chunkId);
  if (!chunk) {
    return res.status(404).json({ error: 'Chunk not found' });
  }

  // If already ready, return cached data (videoUrl for video mode, audioUrl for text mode)
  if (chunk.status === 'ready' && (chunk.videoUrl || chunk.audioUrl)) {
    const transcript = session.chunkTranscripts.get(chunkId);
    const partNum = parseInt(chunkId.split('-')[1]) + 1;
    return res.json({
      videoUrl: chunk.videoUrl,
      audioUrl: chunk.audioUrl,
      transcript,
      title: `${session.title} - Part ${partNum}`,
    });
  }

  // If already being downloaded (e.g. by prefetch), wait for it to finish
  if (chunk.status === 'downloading') {
    const partNum = parseInt(chunkId.split('-')[1]) + 1;
    // Poll until the chunk becomes ready (prefetch will finish it)
    const maxWait = 120000; // 2 minutes
    const pollInterval = 500;
    const startWait = Date.now();
    while (Date.now() - startWait < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));
      if (chunk.status === 'ready' && (chunk.videoUrl || chunk.audioUrl)) {
        const transcript = session.chunkTranscripts.get(chunkId);
        return res.json({
          videoUrl: chunk.videoUrl,
          audioUrl: chunk.audioUrl,
          transcript,
          title: `${session.title} - Part ${partNum}`,
        });
      }
      if (chunk.status === 'pending') {
        // Prefetch failed, fall through to download below
        break;
      }
    }
    // If still downloading after timeout, fall through to re-download
    if (chunk.status === 'downloading') {
      console.log(`[Download-Chunk] Prefetch timeout for ${chunkId}, re-downloading`);
    }
  }

  // ── Text mode: TTS + Whisper pipeline ──
  if (session.contentType === 'text') {
    chunk.status = 'downloading';
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const audioPath = path.join(tempDir, `tts_${sessionId}_${chunkId}.mp3`);

    try {
      const chunkText = session.chunkTexts instanceof Map
        ? session.chunkTexts.get(chunkId)
        : null;
      if (!chunkText) {
        throw new Error('Chunk text not found');
      }

      const partNum = parseInt(chunkId.split('-')[1]) + 1;
      const onProgress = createProgressCallback(sessionId);
      console.log(`[Download-Chunk] Text mode: Session ${sessionId}, Chunk ${chunkId} (${chunkText.length} chars)`);

      // Step 1: Generate TTS audio
      await generateTtsAudio(chunkText, audioPath, { onProgress });

      // Step 2: Get audio duration and estimate word timestamps proportionally
      const duration = await getAudioDuration(audioPath);
      const rawChunkTranscript = estimateWordTimestamps(chunkText, duration);

      // Lemmatize words for frequency matching
      const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress });

      // Serve audio locally or upload to GCS
      let audioUrl;
      if (!IS_LOCAL && bucket) {
        const gcsFileName = `videos/${sessionId}_${chunkId}.mp3`;
        await bucket.upload(audioPath, {
          destination: gcsFileName,
          metadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=86400' },
        });
        await bucket.file(gcsFileName).makePublic();
        audioUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFileName}`;
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      } else {
        audioUrl = `/api/local-audio/${sessionId}_${chunkId}.mp3`;
        localSessions.set(`audio_${sessionId}_${chunkId}`, audioPath);
      }

      chunk.status = 'ready';
      chunk.audioUrl = audioUrl;
      session.chunkTranscripts.set(chunkId, chunkTranscript);
      await setAnalysisSession(sessionId, session);

      sendProgress(sessionId, 'tts', 100, 'complete', 'Ready');
      console.log(`[Download-Chunk] Text mode: Chunk ${chunkId} ready at ${audioUrl}`);

      res.json({
        audioUrl,
        transcript: chunkTranscript,
        title: `${session.title} - Part ${partNum}`,
      });

      // Prefetch next chunk
      const currentIndex = parseInt(chunkId.split('-')[1]);
      prefetchNextChunk(sessionId, currentIndex).catch(() => {});
      return;

    } catch (error) {
      console.error(`[Download-Chunk] Text mode error:`, error);
      chunk.status = 'pending';
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      const msg = friendlyErrorMessage(error.message);
      sendProgress(sessionId, 'tts', 0, 'error', msg);
      return res.status(500).json({ error: msg });
    }
  }

  // ── Video mode ──
  // Get startTime/endTime from the chunk (not from request body)
  const { startTime, endTime } = chunk;

  // Mark chunk as downloading
  chunk.status = 'downloading';

  const tempDir = path.join(__dirname, 'temp');
  const chunkPath = path.join(tempDir, `chunk_${sessionId}_${chunkId}.mp4`);

  try {
    const partNum = parseInt(chunkId.split('-')[1]) + 1;
    console.log(`[Download-Chunk] Session ${sessionId}, Chunk ${chunkId}: ${formatTime(startTime)} - ${formatTime(endTime)}`);

    // Check for cached extraction info (speeds up by ~2 min for ok.ru)
    let cachedInfoPath = null;
    const cachedExtraction = await getCachedExtraction(session.url);
    if (cachedExtraction) {
      cachedInfoPath = path.join(tempDir, `cached_info_${sessionId}_${chunkId}.json`);
      fs.writeFileSync(cachedInfoPath, JSON.stringify(cachedExtraction));
      console.log(`[Download-Chunk] Session ${sessionId}: Using cached extraction`);
    }

    // Download video chunk
    const onProgress = createProgressCallback(sessionId);
    const { size: videoSize } = await downloadVideoChunk(session.url, chunkPath, startTime, endTime, { onProgress, partNum, cachedInfoPath });
    console.log(`[Download-Chunk] Session ${sessionId}: Chunk downloaded (${(videoSize / 1024 / 1024).toFixed(1)} MB)`);

    // Clean up temp cached info file
    if (cachedInfoPath && fs.existsSync(cachedInfoPath)) {
      fs.unlinkSync(cachedInfoPath);
    }

    // Get chunk transcript with adjusted timestamps, then lemmatize per-chunk
    const rawChunkTranscript = getChunkTranscript(session.transcript, startTime, endTime);
    const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress });
    console.log(`[Download-Chunk] Chunk ${chunkId}: startTime=${startTime}, endTime=${endTime}`);
    console.log(`[Download-Chunk] Full transcript has ${session.transcript.words?.length} words`);
    console.log(`[Download-Chunk] Chunk transcript has ${chunkTranscript.words?.length} words`);
    console.log(`[Download-Chunk] First chunk word:`, chunkTranscript.words?.[0]);
    console.log(`[Download-Chunk] Last chunk word:`, chunkTranscript.words?.[chunkTranscript.words?.length - 1]);

    let videoUrl;
    if (!IS_LOCAL && bucket) {
      // Upload to GCS
      sendProgress(sessionId, 'video', 95, 'active', 'Uploading to cloud...');
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

    // Save session to GCS for persistence across restarts
    await setAnalysisSession(sessionId, session);

    sendProgress(sessionId, 'video', 100, 'complete', 'Ready');
    console.log(`[Download-Chunk] Session ${sessionId}: Chunk ready at ${videoUrl}`);

    res.json({
      videoUrl,
      transcript: chunkTranscript,
      title: `${session.title} - Part ${parseInt(chunkId.split('-')[1]) + 1}`,
    });

    // Prefetch next chunk in background (fire and forget)
    const currentIndex = parseInt(chunkId.split('-')[1]);
    prefetchNextChunk(sessionId, currentIndex).catch(() => {});

  } catch (error) {
    console.error(`[Download-Chunk] Error:`, error);

    // Mark chunk as pending again on error
    chunk.status = 'pending';

    // Clean up chunk file if it exists
    if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);

    sendProgress(sessionId, 'video', 0, 'error', error.message);
    res.status(500).json({ error: friendlyErrorMessage(error.message) });
  }
});

/**
 * Prefetch the next pending chunk in background
 * Called after a chunk download completes to make next chunk load feel instant
 */
async function prefetchNextChunk(sessionId, currentChunkIndex) {
  try {
    const session = await getAnalysisSession(sessionId);
    if (!session || session.status !== 'ready') return;

    // Find next pending chunk
    const nextChunk = session.chunks.find((c, i) =>
      i > currentChunkIndex && c.status === 'pending'
    );

    if (!nextChunk) {
      console.log(`[Prefetch] No more chunks to prefetch for session ${sessionId}`);
      return;
    }

    console.log(`[Prefetch] Starting prefetch of ${nextChunk.id} for session ${sessionId}`);

    const tempDir = path.join(__dirname, 'temp');
    nextChunk.status = 'downloading';

    // ── Text mode prefetch ──
    if (session.contentType === 'text') {
      const audioPath = path.join(tempDir, `tts_${sessionId}_${nextChunk.id}.mp3`);
      const chunkText = session.chunkTexts instanceof Map
        ? session.chunkTexts.get(nextChunk.id)
        : null;
      if (!chunkText) {
        nextChunk.status = 'pending';
        return;
      }

      const silentProgress = () => {};
      await generateTtsAudio(chunkText, audioPath, { onProgress: silentProgress });
      const duration = await getAudioDuration(audioPath);
      const rawChunkTranscript = estimateWordTimestamps(chunkText, duration);
      const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress: silentProgress });

      let audioUrl;
      if (!IS_LOCAL && bucket) {
        const gcsFileName = `videos/${sessionId}_${nextChunk.id}.mp3`;
        await bucket.upload(audioPath, {
          destination: gcsFileName,
          metadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=86400' },
        });
        await bucket.file(gcsFileName).makePublic();
        audioUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFileName}`;
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      } else {
        audioUrl = `/api/local-audio/${sessionId}_${nextChunk.id}.mp3`;
        localSessions.set(`audio_${sessionId}_${nextChunk.id}`, audioPath);
      }

      nextChunk.status = 'ready';
      nextChunk.audioUrl = audioUrl;
      session.chunkTranscripts.set(nextChunk.id, chunkTranscript);
      await setAnalysisSession(sessionId, session);
      console.log(`[Prefetch] Completed text chunk ${nextChunk.id}`);
      return;
    }

    // ── Video mode prefetch ──
    const chunkPath = path.join(tempDir, `chunk_${sessionId}_${nextChunk.id}.mp4`);
    const { startTime, endTime } = nextChunk;

    // Check for cached extraction info
    let cachedInfoPath = null;
    const cachedExtraction = await getCachedExtraction(session.url);
    if (cachedExtraction) {
      cachedInfoPath = path.join(tempDir, `cached_info_${sessionId}_prefetch_${nextChunk.id}.json`);
      fs.writeFileSync(cachedInfoPath, JSON.stringify(cachedExtraction));
      console.log(`[Prefetch] Using cached extraction`);
    }

    // Download silently (no progress updates to avoid confusing the user)
    const { size: videoSize } = await downloadVideoChunk(
      session.url, chunkPath, startTime, endTime,
      { onProgress: () => {}, partNum: parseInt(nextChunk.id.split('-')[1]) + 1, cachedInfoPath }
    );

    // Clean up cached info file
    if (cachedInfoPath && fs.existsSync(cachedInfoPath)) {
      fs.unlinkSync(cachedInfoPath);
    }

    // Get transcript and lemmatize per-chunk
    const rawChunkTranscript = getChunkTranscript(session.transcript, startTime, endTime);
    const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress: () => {} });

    // Upload to GCS
    let videoUrl;
    if (!IS_LOCAL && bucket) {
      const gcsFileName = `videos/${sessionId}_${nextChunk.id}.mp4`;
      await bucket.upload(chunkPath, {
        destination: gcsFileName,
        metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=86400' },
      });
      await bucket.file(gcsFileName).makePublic();
      videoUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFileName}`;
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
    } else {
      videoUrl = `/api/local-video/${sessionId}_${nextChunk.id}.mp4`;
      localSessions.set(`video_${sessionId}_${nextChunk.id}`, chunkPath);
    }

    // Update session
    nextChunk.status = 'ready';
    nextChunk.videoUrl = videoUrl;
    session.chunkTranscripts.set(nextChunk.id, chunkTranscript);
    await setAnalysisSession(sessionId, session);

    console.log(`[Prefetch] Completed ${nextChunk.id} (${(videoSize / 1024 / 1024).toFixed(1)} MB)`);
  } catch (err) {
    console.error(`[Prefetch] Error:`, err.message);
  }
}

// Serve static frontend files in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Export for tests
export { app, analysisSessions, localSessions, progressClients, translationCache, urlSessionCache };

// Only start listening when run directly (not when imported by tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`OpenAI API key: ${process.env.OPENAI_API_KEY ? 'loaded from .env' : 'not set'}`);
    console.log(`Google API key: ${process.env.GOOGLE_TRANSLATE_API_KEY ? 'loaded from .env' : 'not set'}`);

    // Run cleanup then rebuild URL cache on startup (non-blocking)
    cleanupOldSessions()
      .then(() => rebuildUrlCache())
      .catch(err => {
        console.error('[Startup] Cleanup/cache rebuild failed:', err.message);
      });
  });
}

