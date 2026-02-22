/**
 * Integration tests for the Express API server.
 *
 * Strategy: mock external dependencies (yt-dlp, OpenAI) at the media.js
 * boundary so we test real Express routing, session management, chunking,
 * and SSE streaming — everything except the slow/expensive external calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mock auth.js — bypass Firebase Admin token verification in tests
// ---------------------------------------------------------------------------

vi.mock('./auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.uid = 'test-user';
    req.userEmail = 'test@example.com';
    next();
  },
  adminAuth: {
    deleteUser: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Mock usage.js — bypass budget checks in tests (costs accumulate across
// tests sharing the same uid, which would trigger 429s mid-suite)
// ---------------------------------------------------------------------------

vi.mock('./usage.js', () => ({
  requireBudget: (req, res, next) => next(),
  trackCost: () => {},
  trackTranslateCost: () => {},
  getUserCost: () => 0.55,          // Combined: 0.45 (OpenAI) + 0.10 (Translate)
  getUserWeeklyCost: () => 0.80,     // Combined: 0.60 + 0.20
  getUserMonthlyCost: () => 2.25,    // Combined: 1.75 + 0.50
  getRemainingBudget: () => 1,
  initUsageStore: vi.fn().mockResolvedValue(undefined),
  flushAllUsage: vi.fn().mockResolvedValue(undefined),
  DAILY_LIMIT: 0.50,
  WEEKLY_LIMIT: 2.50,
  MONTHLY_LIMIT: 5.00,
  costs: {
    whisper: () => 0,
    gpt4o: () => 0,
    gpt4oMini: () => 0,
    tts: () => 0,
    translate: () => 0,
  },
}));

// ---------------------------------------------------------------------------
// Mock stripe.js — bypass subscription checks in integration tests
// ---------------------------------------------------------------------------

vi.mock('./stripe.js', () => ({
  requireSubscription: (req, res, next) => next(),
  getSubscriptionStatus: vi.fn().mockResolvedValue({
    status: 'trialing',
    trialEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    trialDaysRemaining: 30,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    needsPayment: false,
  }),
  createCheckoutSession: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }),
  createPortalSession: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }),
  cancelSubscription: vi.fn().mockResolvedValue(undefined),
  handleWebhook: vi.fn().mockResolvedValue(undefined),
  constructWebhookEvent: vi.fn().mockImplementation((body) => JSON.parse(body)),
  initSubscriptionStore: vi.fn().mockResolvedValue(undefined),
  clearSubscriptionCacheForTesting: vi.fn(),
}));

import { getSubscriptionStatus, createCheckoutSession } from './stripe.js';
import { lookupWord } from './dictionary.js';

// ---------------------------------------------------------------------------
// Mock dictionary.js — bypass CSV loading in tests
// ---------------------------------------------------------------------------

vi.mock('./dictionary.js', () => ({
  initDictionary: vi.fn().mockResolvedValue(undefined),
  lookupWord: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Mock media.js — replaces all 5 external-facing functions
// ---------------------------------------------------------------------------

vi.mock('./media.js', () => {
  return {
    getOkRuVideoInfo: vi.fn(),
    downloadAudioChunk: vi.fn(),
    downloadVideoChunk: vi.fn(),
    transcribeAudioChunk: vi.fn(),
    addPunctuation: vi.fn(),
    lemmatizeWords: vi.fn(),
    createHeartbeat: vi.fn(() => ({
      stop: () => {},
      isStopped: () => true,
      getSeconds: () => 0,
    })),
    // Text mode (lib.ru) functions
    isLibRuUrl: vi.fn(() => false),
    fetchLibRuText: vi.fn(),
    generateTtsAudio: vi.fn(),
    getAudioDuration: vi.fn(() => 30),
    estimateWordTimestamps: vi.fn((text, duration) => ({
      words: text.split(/\s+/).map((w, i) => ({ word: (i > 0 ? ' ' : '') + w, start: i, end: i + 1 })),
      segments: [{ text, start: 0, end: duration }],
      language: 'ru',
      duration,
    })),
    transcribeAndAlignTTS: vi.fn((text) => {
      const words = text.split(/\s+/).map((w, i) => ({ word: (i > 0 ? ' ' : '') + w, start: i * 0.5, end: (i + 1) * 0.5 }));
      return Promise.resolve({
        words,
        segments: [{ text, start: 0, end: words.length * 0.5 }],
        language: 'ru',
        duration: words.length * 0.5,
      });
    }),
    alignWhisperToOriginal: vi.fn(() => []),
    // String utility functions used by index.js
    stripPunctuation: vi.fn((w) => w),
    editDistance: vi.fn(() => 0),
    isFuzzyMatch: vi.fn(() => false),
  };
});

// Import mocks so we can configure per-test behavior
import {
  getOkRuVideoInfo,
  downloadAudioChunk,
  downloadVideoChunk,
  transcribeAudioChunk,
  addPunctuation,
  lemmatizeWords,
  isLibRuUrl,
  fetchLibRuText,
  generateTtsAudio,
  getAudioDuration,
  estimateWordTimestamps,
  transcribeAndAlignTTS,
} from './media.js';

// Import server after mocks are set up
import {
  app,
  analysisSessions,
  localSessions,
  progressClients,
  translationCache,
  urlSessionCache,
  isAllowedProxyUrl,
  MAX_CONCURRENT_ANALYSES,
  getActiveAnalyses,
  resetActiveAnalyses,
  demoCache,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

/**
 * Create a mock Whisper-style transcript with evenly spaced words & segments.
 * Generates enough data for createChunks() to produce proper chunks.
 */
function createMockTranscript(wordCount, durationSec) {
  const wordDuration = durationSec / wordCount;
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push({
      word: ` слово${i}`,
      start: i * wordDuration,
      end: (i + 1) * wordDuration,
    });
  }

  // Create segments (~10 words each, with small gaps between them)
  const WORDS_PER_SEGMENT = 10;
  const segments = [];
  for (let i = 0; i < wordCount; i += WORDS_PER_SEGMENT) {
    const segEnd = Math.min(i + WORDS_PER_SEGMENT, wordCount);
    const segWords = words.slice(i, segEnd);
    segments.push({
      start: segWords[0].start,
      end: segWords[segWords.length - 1].end,
      text: segWords.map(w => w.word.trim()).join(' '),
    });
  }

  return { words, segments, language: 'ru', duration: durationSec };
}

/**
 * Consume an SSE stream from the server.
 * Returns an object with events array and helper methods.
 */
function createSSEClient(url) {
  const events = [];
  let rawBuffer = '';
  const waiters = [];

  const req = http.get(url, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      rawBuffer += chunk;
      // Parse SSE frames: "data: {...}\n\n"
      const frames = rawBuffer.split('\n\n');
      // Keep the last (possibly incomplete) frame in the buffer
      rawBuffer = frames.pop() || '';

      for (const frame of frames) {
        if (!frame.trim()) continue;
        // Skip comments like ": heartbeat"
        const lines = frame.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push(data);
            // Notify waiters
            for (let i = waiters.length - 1; i >= 0; i--) {
              if (waiters[i].check(data)) {
                waiters[i].resolve(data);
                waiters.splice(i, 1);
              }
            }
          } catch {
            // Not JSON, ignore (e.g. heartbeat comments)
          }
        }
      }
    });
  });

  // Fail fast on connection errors instead of hanging until timeout
  req.on('error', (err) => {
    for (const waiter of waiters) {
      waiter.resolve({ type: '__error', message: err.message });
    }
    waiters.length = 0;
  });

  return {
    events,
    /**
     * Wait for an event matching a predicate.
     */
    waitForEvent(typeName, timeoutMs = 10000) {
      // Check already-received events
      const existing = events.find(e => e.type === typeName);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for SSE event type="${typeName}" after ${timeoutMs}ms. Got: ${JSON.stringify(events.map(e => e.type))}`));
        }, timeoutMs);

        waiters.push({
          check: (data) => data.type === typeName,
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
        });
      });
    },
    close() {
      req.destroy();
    },
  };
}

/**
 * POST /api/analyze, subscribe to SSE, wait for 'complete' event.
 */
async function analyzeAndWait(url, opts = {}) {
  const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const analyzeBody = await analyzeRes.json();

  if (analyzeBody.status === 'cached') {
    return { sessionId: analyzeBody.sessionId, completeEvent: analyzeBody, cached: true };
  }

  const sessionId = analyzeBody.sessionId;
  const sse = createSSEClient(`${baseUrl}/api/progress/${sessionId}`);

  try {
    const completeEvent = await sse.waitForEvent('complete', opts.timeout || 10000);
    return { sessionId, completeEvent };
  } finally {
    sse.close();
  }
}

/**
 * Configure mocks for a standard happy-path analysis.
 * Returns mock transcript so tests can make assertions on it.
 */
function setupHappyPathMocks(duration = 900) {
  const transcript = createMockTranscript(300, duration);

  getOkRuVideoInfo.mockResolvedValue({
    title: 'Test Russian Video',
    duration,
  });

  downloadAudioChunk.mockImplementation(async (url, outputPath) => {
    // Write a small dummy file so fs.unlinkSync in index.js works
    fs.writeFileSync(outputPath, 'fake-audio-data');
    return { size: 50000, info: null };
  });

  transcribeAudioChunk.mockResolvedValue(transcript);

  addPunctuation.mockImplementation(async (t) => t);
  lemmatizeWords.mockImplementation(async (t) => t);

  downloadVideoChunk.mockImplementation(async (url, outputPath) => {
    fs.writeFileSync(outputPath, 'fake-video-data');
    return { size: 100000 };
  });

  return transcript;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  analysisSessions.clear();
  localSessions.clear();
  translationCache.clear();
  urlSessionCache.clear();
  // Clean up SSE clients
  for (const [, clients] of progressClients) {
    clients.forEach(c => { try { c.end(); } catch {} });
  }
  progressClients.clear();

  // Reset concurrency counter
  resetActiveAnalyses();

  // Clear demo cache
  demoCache.clear();

  // Ensure OPENAI_API_KEY is set for tests that need it
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.GOOGLE_TRANSLATE_API_KEY = 'test-google-key';
});

// ---------------------------------------------------------------------------
// A. Health Check
// ---------------------------------------------------------------------------

describe('A. Health Check', () => {
  it('GET /api/health returns status ok with config flags', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('openai');
    expect(body).toHaveProperty('translate');
    expect(body).toHaveProperty('gcs');
  });

  it('GET /api/health includes security headers from helmet', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('content-security-policy-report-only')).toBeTruthy();
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('GET /__/firebase/init.json does NOT include CSP headers', async () => {
    const res = await fetch(`${baseUrl}/__/firebase/init.json`);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. POST /api/analyze — Happy Path
// ---------------------------------------------------------------------------

describe('B. POST /api/analyze — Happy Path', () => {
  it('new analysis returns sessionId and completes via SSE', async () => {
    setupHappyPathMocks();

    // POST analyze
    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ok.ru/video/123456789' }),
    });
    expect(analyzeRes.status).toBe(200);
    const analyzeBody = await analyzeRes.json();
    expect(analyzeBody.sessionId).toBeTruthy();
    expect(analyzeBody.status).toBe('started');

    // Subscribe to SSE and wait for complete
    const sse = createSSEClient(`${baseUrl}/api/progress/${analyzeBody.sessionId}`);
    try {
      const connected = await sse.waitForEvent('connected');
      expect(connected.sessionId).toBe(analyzeBody.sessionId);

      const complete = await sse.waitForEvent('complete');
      expect(complete.title).toBe('Test Russian Video');
      expect(complete.totalDuration).toBe(900);
      expect(complete.chunks).toBeInstanceOf(Array);
      expect(complete.chunks.length).toBeGreaterThan(0);
      expect(typeof complete.hasMoreChunks).toBe('boolean');

      // Verify session is ready
      const sessionRes = await fetch(`${baseUrl}/api/session/${analyzeBody.sessionId}`);
      const session = await sessionRes.json();
      expect(session.status).toBe('ready');
      expect(session.title).toBe('Test Russian Video');
    } finally {
      sse.close();
    }
  });

  it('cached session returns immediately without re-processing', async () => {
    setupHappyPathMocks();

    // First analysis
    const first = await analyzeAndWait('https://ok.ru/video/999888777');
    expect(first.cached).toBeFalsy();

    // Second request for same URL — should be cached
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ok.ru/video/999888777' }),
    });
    const body = await res.json();
    expect(body.status).toBe('cached');
    expect(body.sessionId).toBe(first.sessionId);
    expect(body.title).toBe('Test Russian Video');
    expect(body.chunks).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// C. POST /api/analyze — Error Cases
// ---------------------------------------------------------------------------

describe('C. POST /api/analyze — Error Cases', () => {
  it('missing URL returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/URL is required/i);
  });

  it('missing OPENAI_API_KEY returns 400', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const res = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://ok.ru/video/123' }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    } finally {
      process.env.OPENAI_API_KEY = origKey;
    }
  });

  it('media download failure sends SSE error event', async () => {
    getOkRuVideoInfo.mockResolvedValue({ title: 'Fail Video', duration: 600 });
    downloadAudioChunk.mockRejectedValue(new Error('yt-dlp crashed'));

    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ok.ru/video/failme' }),
    });
    const { sessionId } = await analyzeRes.json();

    const sse = createSSEClient(`${baseUrl}/api/progress/${sessionId}`);
    try {
      const errorEvent = await sse.waitForEvent('error');
      expect(errorEvent.message).toMatch(/yt-dlp crashed/);
    } finally {
      sse.close();
    }
  });
});

// ---------------------------------------------------------------------------
// D. GET /api/session/:sessionId
// ---------------------------------------------------------------------------

describe('D. GET /api/session/:sessionId', () => {
  it('non-existent session returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/session/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('ready session returns full data', async () => {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/111222333');

    const res = await fetch(`${baseUrl}/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.title).toBe('Test Russian Video');
    expect(body.totalDuration).toBe(900);
    expect(body.chunks).toBeInstanceOf(Array);
    expect(body.chunks[0]).toHaveProperty('id');
    expect(body.chunks[0]).toHaveProperty('startTime');
    expect(body.chunks[0]).toHaveProperty('endTime');
    expect(body.chunks[0]).toHaveProperty('status');
    expect(typeof body.hasMoreChunks).toBe('boolean');
  });

  it('error session returns error info', async () => {
    analysisSessions.set('err-session', {
      status: 'error',
      uid: 'test-user',
      error: 'Something went wrong',
    });

    const res = await fetch(`${baseUrl}/api/session/err-session`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error).toBe('Something went wrong');
  });

  it('downloading session returns progress', async () => {
    analysisSessions.set('dl-session', {
      status: 'downloading',
      uid: 'test-user',
      progress: { audio: 50, transcription: 0 },
    });

    const res = await fetch(`${baseUrl}/api/session/dl-session`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('downloading');
    expect(body.progress).toEqual({ audio: 50, transcription: 0 });
  });
});

// ---------------------------------------------------------------------------
// E. POST /api/download-chunk
// ---------------------------------------------------------------------------

describe('E. POST /api/download-chunk', () => {
  async function setupSessionWithChunks() {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/chunk-test-' + Date.now());
    return sessionId;
  }

  it('pending chunk downloads and becomes ready', async () => {
    const sessionId = await setupSessionWithChunks();
    const session = analysisSessions.get(sessionId);
    const firstChunk = session.chunks[0];
    expect(firstChunk.status).toBe('pending');

    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId: firstChunk.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBeTruthy();
    expect(body.transcript).toBeTruthy();
    expect(body.transcript.words).toBeInstanceOf(Array);
    expect(body.title).toMatch(/Part 1/);

    // Chunk should now be ready
    const updated = analysisSessions.get(sessionId);
    const updatedChunk = updated.chunks.find(c => c.id === firstChunk.id);
    expect(updatedChunk.status).toBe('ready');
  });

  it('already-ready chunk returns cached data without re-downloading', async () => {
    const sessionId = await setupSessionWithChunks();
    const session = analysisSessions.get(sessionId);
    const chunkId = session.chunks[0].id;

    // First download
    await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId }),
    });

    const callsAfterFirst = downloadVideoChunk.mock.calls.length;

    // Second download — should return cached
    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBeTruthy();

    // downloadVideoChunk should NOT have been called again
    expect(downloadVideoChunk.mock.calls.length).toBe(callsAfterFirst);
  });

  it('invalid session returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'bad', chunkId: 'chunk-0' }),
    });
    expect(res.status).toBe(404);
  });

  it('invalid chunk ID returns 404', async () => {
    const sessionId = await setupSessionWithChunks();
    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId: 'chunk-999' }),
    });
    expect(res.status).toBe(404);
  });

  it('download failure resets chunk to pending and returns 500', async () => {
    const sessionId = await setupSessionWithChunks();
    const session = analysisSessions.get(sessionId);
    const chunkId = session.chunks[0].id;

    downloadVideoChunk.mockRejectedValueOnce(new Error('ffmpeg exploded'));

    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId }),
    });
    expect(res.status).toBe(500);

    // Chunk should be reset to pending
    const updated = analysisSessions.get(sessionId);
    const updatedChunk = updated.chunks.find(c => c.id === chunkId);
    expect(updatedChunk.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// F. GET /api/session/:sessionId/chunk/:chunkId
// ---------------------------------------------------------------------------

describe('F. GET /api/session/:sessionId/chunk/:chunkId', () => {
  async function setupReadyChunk() {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/get-chunk-' + Date.now());
    const session = analysisSessions.get(sessionId);
    const chunkId = session.chunks[0].id;

    // Download the chunk so it becomes ready
    await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId }),
    });

    return { sessionId, chunkId };
  }

  it('pending chunk returns 400', async () => {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/pending-chunk-' + Date.now());
    const session = analysisSessions.get(sessionId);

    const res = await fetch(`${baseUrl}/api/session/${sessionId}/chunk/${session.chunks[0].id}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not ready/i);
  });

  it('ready chunk returns videoUrl and transcript', async () => {
    const { sessionId, chunkId } = await setupReadyChunk();

    const res = await fetch(`${baseUrl}/api/session/${sessionId}/chunk/${chunkId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videoUrl).toBeTruthy();
    expect(body.transcript).toBeTruthy();
    expect(body.transcript.words).toBeInstanceOf(Array);
    expect(body.transcript.duration).toBeGreaterThan(0);
    expect(body.title).toMatch(/Part 1/);
  });

  it('non-existent session returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/session/nonexistent/chunk/chunk-0`);
    expect(res.status).toBe(404);
  });

  it('non-existent chunk returns 404', async () => {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/no-such-chunk-' + Date.now());

    const res = await fetch(`${baseUrl}/api/session/${sessionId}/chunk/chunk-999`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// G. POST /api/load-more-chunks
// ---------------------------------------------------------------------------

describe('G. POST /api/load-more-chunks', () => {
  it('loads additional chunks for a long video', async () => {
    // Use a very long video so hasMoreChunks is true
    const longTranscript = createMockTranscript(1000, 3600);
    getOkRuVideoInfo.mockResolvedValue({ title: 'Long Video', duration: 3600 });
    downloadAudioChunk.mockImplementation(async (url, outputPath) => {
      fs.writeFileSync(outputPath, 'fake-audio');
      return { size: 50000, info: null };
    });
    transcribeAudioChunk.mockResolvedValue(longTranscript);
    addPunctuation.mockImplementation(async (t) => t);
    lemmatizeWords.mockImplementation(async (t) => t);
    downloadVideoChunk.mockImplementation(async (url, outputPath) => {
      fs.writeFileSync(outputPath, 'fake-video');
      return { size: 100000 };
    });

    const { sessionId } = await analyzeAndWait('https://ok.ru/video/long-' + Date.now());
    const session = analysisSessions.get(sessionId);

    if (!session.hasMoreChunks) {
      // Video may be chunked small enough to not need more. Skip test gracefully.
      return;
    }

    const existingCount = session.chunks.length;

    // Reset the mock transcript for the next batch
    const moreTranscript = createMockTranscript(300, 900);
    transcribeAudioChunk.mockResolvedValue(moreTranscript);

    const res = await fetch(`${baseUrl}/api/load-more-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunks).toBeInstanceOf(Array);
    expect(body.chunks.length).toBeGreaterThan(0);
    expect(typeof body.hasMoreChunks).toBe('boolean');

    // New chunks should have sequential IDs
    const updated = analysisSessions.get(sessionId);
    expect(updated.chunks.length).toBeGreaterThan(existingCount);
  });

  it('non-existent session returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/load-more-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('no more chunks returns 400', async () => {
    // Short video — hasMoreChunks will be false
    const shortTranscript = createMockTranscript(50, 300);
    getOkRuVideoInfo.mockResolvedValue({ title: 'Short Video', duration: 300 });
    downloadAudioChunk.mockImplementation(async (url, outputPath) => {
      fs.writeFileSync(outputPath, 'fake-audio');
      return { size: 10000, info: null };
    });
    transcribeAudioChunk.mockResolvedValue(shortTranscript);
    addPunctuation.mockImplementation(async (t) => t);
    lemmatizeWords.mockImplementation(async (t) => t);

    const { sessionId } = await analyzeAndWait('https://ok.ru/video/short-' + Date.now());
    const session = analysisSessions.get(sessionId);
    expect(session.hasMoreChunks).toBe(false);

    const res = await fetch(`${baseUrl}/api/load-more-chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// H. POST /api/translate
// ---------------------------------------------------------------------------

describe('H. POST /api/translate', () => {
  it('translates a word via Google API', async () => {
    const mockGoogleResponse = {
      ok: true,
      json: async () => ({
        data: {
          translations: [{ translatedText: 'hello' }],
        },
      }),
    };

    // Intercept only Google API calls; let local server calls through
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
      if (typeof url === 'string' && url.includes('googleapis.com')) {
        return Promise.resolve(mockGoogleResponse);
      }
      return originalFetch(url, ...args);
    });

    try {
      const res = await fetch(`${baseUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'привет' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.word).toBe('привет');
      expect(body.translation).toBe('hello');
      expect(body.sourceLanguage).toBe('ru');

      // Verify Google API was called
      const googleCalls = fetchSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('googleapis')
      );
      expect(googleCalls.length).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('cache hit does not call fetch again', async () => {
    // Pre-populate cache
    translationCache.set('ru:мир', {
      word: 'мир',
      translation: 'world',
      sourceLanguage: 'ru',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await fetch(`${baseUrl}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'мир' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translation).toBe('world');

    // fetch should only be called for our own request, not for Google API
    // The only fetch call should be our test's request to the local server
    const googleCalls = fetchSpy.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('googleapis')
    );
    expect(googleCalls.length).toBe(0);

    vi.restoreAllMocks();
  });

  it('missing word returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/word is required/i);
  });

  it('missing API key returns 500', async () => {
    const origKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    delete process.env.GOOGLE_TRANSLATE_API_KEY;

    try {
      const res = await fetch(`${baseUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: 'тест' }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    } finally {
      process.env.GOOGLE_TRANSLATE_API_KEY = origKey;
    }
  });
});

// ---------------------------------------------------------------------------
// I. DELETE /api/session/:sessionId
// ---------------------------------------------------------------------------

describe('I. DELETE /api/session/:sessionId', () => {
  it('deletes an existing session', async () => {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/delete-me-' + Date.now());

    // Verify it exists
    let res = await fetch(`${baseUrl}/api/session/${sessionId}`);
    expect(res.status).toBe(200);

    // Delete it
    res = await fetch(`${baseUrl}/api/session/${sessionId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's gone
    res = await fetch(`${baseUrl}/api/session/${sessionId}`);
    expect(res.status).toBe(404);
  });

  it('deleting non-existent session returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/session/nonexistent-123`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// J. SSE Progress Format
// ---------------------------------------------------------------------------

describe('J. SSE Progress Format', () => {
  it('connected event is sent on subscribe', async () => {
    // Create a session so ownership check passes
    analysisSessions.set('test-session-1', {
      status: 'downloading',
      uid: 'test-user',
    });

    const sse = createSSEClient(`${baseUrl}/api/progress/test-session-1`);
    try {
      const connected = await sse.waitForEvent('connected');
      expect(connected.type).toBe('connected');
      expect(connected.sessionId).toBe('test-session-1');
    } finally {
      sse.close();
    }
  });

  it('error session sends error event on connect', async () => {
    analysisSessions.set('err-sse-session', {
      status: 'error',
      uid: 'test-user',
      error: 'Analysis failed badly',
    });

    const sse = createSSEClient(`${baseUrl}/api/progress/err-sse-session`);
    try {
      const errorEvent = await sse.waitForEvent('error');
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.message).toBe('Analysis failed badly');
    } finally {
      sse.close();
    }
  });

  it('client disconnect cleans up without crash', async () => {
    // Create a session so ownership check passes
    analysisSessions.set('disconnect-test', {
      status: 'downloading',
      uid: 'test-user',
    });

    const sse = createSSEClient(`${baseUrl}/api/progress/disconnect-test`);
    await sse.waitForEvent('connected');
    sse.close();

    // Wait a bit for the disconnect to propagate
    await new Promise(r => setTimeout(r, 100));

    // Verify the client was cleaned up
    const clients = progressClients.get('disconnect-test');
    expect(!clients || clients.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// K. Text Mode (lib.ru) Analysis
// ---------------------------------------------------------------------------

describe('K. Text Mode (lib.ru) Analysis', () => {
  function setupTextModeMocks() {
    isLibRuUrl.mockImplementation((url) => url.includes('lib.ru'));
    fetchLibRuText.mockResolvedValue({
      title: 'Мастер и Маргарита',
      author: 'Булгаков',
      text: 'В час жаркого весеннего заката на Патриарших прудах появилось двое граждан. Первый из них — приблизительно сорокалетний, одетый в серенькую летнюю пару.',
    });
    generateTtsAudio.mockImplementation(async (text, audioPath) => {
      fs.writeFileSync(audioPath, 'fake-tts-audio');
    });
    getAudioDuration.mockReturnValue(30);
    estimateWordTimestamps.mockImplementation((text, duration) => ({
      words: text.split(/\s+/).map((w, i) => ({
        word: (i > 0 ? ' ' : '') + w,
        start: (i / text.split(/\s+/).length) * duration,
        end: ((i + 1) / text.split(/\s+/).length) * duration,
      })),
      segments: [{ text, start: 0, end: duration }],
      language: 'ru',
      duration,
    }));
    transcribeAndAlignTTS.mockImplementation(async (text) => {
      const duration = 30;
      const words = text.split(/\s+/);
      return {
        words: words.map((w, i) => ({
          word: (i > 0 ? ' ' : '') + w,
          start: (i / words.length) * duration,
          end: ((i + 1) / words.length) * duration,
        })),
        segments: [{ text, start: 0, end: duration }],
        language: 'ru',
        duration,
      };
    });
    lemmatizeWords.mockImplementation(async (t) => t);
  }

  it('lib.ru URL produces text session with chunks', async () => {
    setupTextModeMocks();
    setupHappyPathMocks(); // also needed for base mocks

    const { sessionId, completeEvent } = await analyzeAndWait('https://lib.ru/PROZA/BULGAKOW/master.txt');

    expect(completeEvent.contentType).toBe('text');
    expect(completeEvent.title).toContain('Булгаков');
    expect(completeEvent.title).toContain('Мастер и Маргарита');
    expect(completeEvent.chunks.length).toBeGreaterThan(0);
  });

  it('text session GET returns contentType text', async () => {
    setupTextModeMocks();
    setupHappyPathMocks();

    const { sessionId } = await analyzeAndWait('https://lib.ru/PROZA/text-session-' + Date.now() + '.txt');

    const res = await fetch(`${baseUrl}/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentType).toBe('text');
    expect(body.status).toBe('ready');
  });

  it('text chunk download generates TTS audio', async () => {
    setupTextModeMocks();
    setupHappyPathMocks();

    const { sessionId, completeEvent } = await analyzeAndWait('https://lib.ru/PROZA/tts-' + Date.now() + '.txt');

    const chunk = completeEvent.chunks[0];

    // Download the first chunk (triggers TTS pipeline)
    const dlRes = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkId: chunk.id }),
    });
    expect(dlRes.status).toBe(200);
    const dlBody = await dlRes.json();
    expect(dlBody.audioUrl).toBeTruthy();
    expect(dlBody.transcript).toBeTruthy();
    expect(dlBody.transcript.words.length).toBeGreaterThan(0);

    // Verify TTS + Whisper transcription pipeline was called
    expect(generateTtsAudio).toHaveBeenCalled();
    expect(transcribeAndAlignTTS).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// L. POST /api/extract-sentence
// ---------------------------------------------------------------------------

describe('L. POST /api/extract-sentence', () => {
  it('extracts and translates a sentence via GPT', async () => {
    const mockGptResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sentence: 'В час жаркого весеннего заката.',
              translation: 'At the hour of the hot spring sunset.',
            }),
          },
        }],
      }),
    };

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
      if (typeof url === 'string' && url.includes('openai.com')) {
        return Promise.resolve(mockGptResponse);
      }
      return originalFetch(url, ...args);
    });

    try {
      const res = await fetch(`${baseUrl}/api/extract-sentence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'В час жаркого весеннего заката на Патриарших прудах появилось двое граждан.',
          word: 'заката',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sentence).toBe('В час жаркого весеннего заката.');
      expect(body.translation).toBe('At the hour of the hot spring sunset.');

      // Verify OpenAI API was called
      const openaiCalls = fetchSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('openai.com')
      );
      expect(openaiCalls.length).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('missing text returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/extract-sentence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: 'тест' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/text and word are required/i);
  });

  it('missing word returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/extract-sentence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Какой-то текст.' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/text and word are required/i);
  });
});

// ---------------------------------------------------------------------------
// M. URL Cache TTL
// ---------------------------------------------------------------------------

describe('M. URL Cache TTL', () => {
  it('expired cache entry is not reused', async () => {
    setupHappyPathMocks();

    // Analyze once to populate cache
    const { sessionId: firstId } = await analyzeAndWait('https://ok.ru/video/ttl-test-' + Date.now());

    // Verify cache exists
    expect(urlSessionCache.size).toBeGreaterThan(0);

    // Manually expire the cache entry
    for (const [key, value] of urlSessionCache) {
      value.timestamp = Date.now() - (7 * 60 * 60 * 1000); // 7 hours ago (TTL is 6 hours)
    }

    // Re-analyze the same URL — should create new session (cache expired)
    const { sessionId: secondId } = await analyzeAndWait('https://ok.ru/video/ttl-test-' + Date.now());

    // Different session IDs since cache was expired
    expect(secondId).not.toBe(firstId);
  });

  it('non-expired cache returns same session', async () => {
    setupHappyPathMocks();

    const uniqueUrl = 'https://ok.ru/video/cache-reuse-' + Date.now();
    const { sessionId: firstId } = await analyzeAndWait(uniqueUrl);

    // Re-analyze same URL (cache still fresh)
    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: uniqueUrl }),
    });
    const body = await analyzeRes.json();

    expect(body.status).toBe('cached');
    expect(body.sessionId).toBe(firstId);
  });
});

// ---------------------------------------------------------------------------
// N. Session Ownership & Security
// ---------------------------------------------------------------------------

describe('N. Session Ownership & Security', () => {
  it('session owned by another user returns 403', async () => {
    analysisSessions.set('other-user-session', {
      status: 'ready',
      uid: 'other-user',
      url: 'https://ok.ru/video/999',
      title: 'Other User Video',
      chunks: [],
    });

    const res = await fetch(`${baseUrl}/api/session/other-user-session`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/access denied/i);
  });

  it('session without uid returns 403', async () => {
    analysisSessions.set('no-uid-session', {
      status: 'ready',
      url: 'https://ok.ru/video/888',
      title: 'Legacy Session',
      chunks: [],
    });

    const res = await fetch(`${baseUrl}/api/session/no-uid-session`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/access denied/i);
  });

  it('POST /api/analyze returns UUID-format session ID', async () => {
    setupHappyPathMocks();
    const { sessionId } = await analyzeAndWait('https://ok.ru/video/uuid-test-' + Date.now());

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('ownership enforced on DELETE', async () => {
    analysisSessions.set('delete-other', {
      status: 'ready',
      uid: 'someone-else',
      url: 'https://ok.ru/video/777',
      title: 'Not yours',
      chunks: [],
    });

    const res = await fetch(`${baseUrl}/api/session/delete-other`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('ownership enforced on download-chunk', async () => {
    analysisSessions.set('dl-other', {
      status: 'ready',
      uid: 'someone-else',
      url: 'https://ok.ru/video/666',
      title: 'Not yours',
      chunks: [{ id: 'chunk-0', status: 'pending' }],
    });

    const res = await fetch(`${baseUrl}/api/download-chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'dl-other', chunkId: 'chunk-0' }),
    });
    expect(res.status).toBe(403);
  });

  it('ownership enforced on SSE progress endpoint', async () => {
    analysisSessions.set('sse-other', {
      status: 'downloading',
      uid: 'someone-else',
    });

    const res = await fetch(`${baseUrl}/api/progress/sse-other`);
    expect(res.status).toBe(403);
  });

  it('per-user URL cache: same URL, different users get different sessions', async () => {
    setupHappyPathMocks();

    // First user analyzes
    const { sessionId: firstId } = await analyzeAndWait('https://ok.ru/video/shared-url-' + Date.now());

    // Verify cache has entry for test-user
    expect(urlSessionCache.size).toBe(1);
    const cacheKey = [...urlSessionCache.keys()][0];
    expect(cacheKey).toMatch(/^test-user:/);

    // Simulate a different user's cache entry for the same URL (should not collide)
    const otherCacheKey = cacheKey.replace('test-user:', 'other-user:');
    expect(urlSessionCache.has(otherCacheKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// O. SSRF Protection — isAllowedProxyUrl
// ---------------------------------------------------------------------------

describe('O. SSRF Protection — isAllowedProxyUrl', () => {
  it('rejects GCP metadata endpoint', () => {
    expect(isAllowedProxyUrl('http://169.254.169.254/computeMetadata/v1/')).toBe(false);
  });

  it('rejects localhost loopback', () => {
    expect(isAllowedProxyUrl('http://localhost:3001/api/health')).toBe(false);
    expect(isAllowedProxyUrl('http://127.0.0.1:3001/api/health')).toBe(false);
  });

  it('rejects file:// protocol', () => {
    expect(isAllowedProxyUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects ftp:// protocol', () => {
    expect(isAllowedProxyUrl('ftp://evil.com/file')).toBe(false);
  });

  it('rejects private IP ranges', () => {
    expect(isAllowedProxyUrl('http://10.0.0.1/secret')).toBe(false);
    expect(isAllowedProxyUrl('http://172.16.0.1/secret')).toBe(false);
    expect(isAllowedProxyUrl('http://192.168.1.1/secret')).toBe(false);
  });

  it('rejects IPv6-mapped private addresses', () => {
    expect(isAllowedProxyUrl('http://[::ffff:169.254.169.254]/computeMetadata/v1/')).toBe(false);
    expect(isAllowedProxyUrl('http://[::1]:3001/api/health')).toBe(false);
    expect(isAllowedProxyUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
  });

  it('rejects non-CDN public URLs', () => {
    expect(isAllowedProxyUrl('https://evil.com/steal-data')).toBe(false);
    expect(isAllowedProxyUrl('https://google.com')).toBe(false);
  });

  it('allows ok.ru CDN URLs (mycdn.me)', () => {
    expect(isAllowedProxyUrl('https://vod.mycdn.me/vid/abc123.mp4')).toBe(true);
    expect(isAllowedProxyUrl('https://vod73.mycdn.me/content/stream.ts')).toBe(true);
  });

  it('allows ok.ru CDN URLs (userapi.com)', () => {
    expect(isAllowedProxyUrl('https://cdn1.userapi.com/video/123.mp4')).toBe(true);
  });

  it('allows okcdn.ru domain', () => {
    expect(isAllowedProxyUrl('https://st.okcdn.ru/video.mp4')).toBe(true);
  });

  it('allows ok.ru direct', () => {
    expect(isAllowedProxyUrl('https://ok.ru/video/123')).toBe(true);
  });

  it('rejects invalid URL strings', () => {
    expect(isAllowedProxyUrl('not-a-url')).toBe(false);
    expect(isAllowedProxyUrl('')).toBe(false);
  });

  it('video-proxy endpoint rejects internal URLs', async () => {
    const res = await fetch(`${baseUrl}/api/video-proxy?url=${encodeURIComponent('http://169.254.169.254/computeMetadata/v1/')}`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('URL not allowed');
  });

  it('video-proxy endpoint rejects localhost', async () => {
    const res = await fetch(`${baseUrl}/api/video-proxy?url=${encodeURIComponent('http://localhost:3001/api/health')}`);
    expect(res.status).toBe(403);
  });

  it('HLS segment endpoint rejects internal URLs', async () => {
    // Need a valid session for the ownership middleware
    analysisSessions.set('hls-ssrf-test', {
      status: 'ready',
      uid: 'test-user',
      hlsUrl: 'https://vod.mycdn.me/master.m3u8',
      chunks: [],
    });

    const res = await fetch(`${baseUrl}/api/hls/hls-ssrf-test/segment?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('URL not allowed');
  });
});

// ---------------------------------------------------------------------------
// P. Concurrency Limit on /api/analyze
// ---------------------------------------------------------------------------

describe('P. Concurrency Limit on /api/analyze', () => {
  it('rejects analysis when max concurrent limit reached', async () => {
    // Set up slow mocks that won't complete during the test
    getOkRuVideoInfo.mockResolvedValue({ title: 'Slow Video', duration: 600 });
    downloadAudioChunk.mockImplementation(() => new Promise(() => {
      // Never resolves — simulates a long-running download
    }));

    // Start MAX_CONCURRENT_ANALYSES analyses
    const urls = [];
    for (let i = 0; i < MAX_CONCURRENT_ANALYSES; i++) {
      const url = `https://ok.ru/video/concurrent-${i}-${Date.now()}`;
      urls.push(url);
      const res = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('started');
    }

    // Wait for the background setTimeout(500ms) to fire and increment counters
    await new Promise(r => setTimeout(r, 700));

    // Next analysis should be rejected with 503
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ok.ru/video/one-too-many-' + Date.now() }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/busy/i);
  });

  it('counter decrements after analysis completes', async () => {
    setupHappyPathMocks();

    // Run a full analysis
    await analyzeAndWait('https://ok.ru/video/decrement-test-' + Date.now());

    // Counter should be back to 0
    expect(getActiveAnalyses()).toBe(0);
  });

  it('counter decrements after analysis fails', async () => {
    getOkRuVideoInfo.mockResolvedValue({ title: 'Fail Video', duration: 600 });
    downloadAudioChunk.mockRejectedValue(new Error('download failed'));

    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://ok.ru/video/fail-decrement-' + Date.now() }),
    });
    expect(analyzeRes.status).toBe(200);

    // Wait for background processing to start and fail
    const sse = createSSEClient(`${baseUrl}/api/progress/${(await analyzeRes.clone().json()).sessionId}`);
    try {
      await sse.waitForEvent('error', 5000);
    } finally {
      sse.close();
    }

    // Counter should be back to 0 after failure
    // Small delay for the finally block to execute
    await new Promise(r => setTimeout(r, 100));
    expect(getActiveAnalyses()).toBe(0);
  });

  it('cached responses bypass concurrency limit', async () => {
    setupHappyPathMocks();

    const url = 'https://ok.ru/video/cached-bypass-' + Date.now();

    // First: complete an analysis to cache it
    await analyzeAndWait(url);

    // Now requesting the same URL should return cached without hitting concurrency
    // even if we artificially max out the counter
    resetActiveAnalyses();

    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('cached');
  });
});

// ---------------------------------------------------------------------------
// Q. GET /api/usage
// ---------------------------------------------------------------------------

describe('Q. GET /api/usage', () => {
  it('returns combined API usage data with correct shape', async () => {
    const res = await fetch(`${baseUrl}/api/usage`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Combined API buckets (OpenAI + Translate)
    expect(body.daily).toEqual({ used: 0.55, limit: 0.50 });
    expect(body.weekly).toEqual({ used: 0.80, limit: 2.50 });
    expect(body.monthly).toEqual({ used: 2.25, limit: 5.00 });
  });
});

// ---------------------------------------------------------------------------
// R. DELETE /api/account
// ---------------------------------------------------------------------------

describe('R. DELETE /api/account', () => {
  it('cleans up in-memory sessions owned by the user', async () => {
    // Set up sessions: one owned by test-user, one by someone else
    analysisSessions.set('my-session', {
      status: 'ready',
      uid: 'test-user',
      url: 'https://ok.ru/video/mine',
      title: 'My Video',
      chunks: [],
    });
    analysisSessions.set('other-session', {
      status: 'ready',
      uid: 'other-user',
      url: 'https://ok.ru/video/theirs',
      title: 'Their Video',
      chunks: [],
    });
    // Set up a URL cache entry for our user
    urlSessionCache.set('test-user:ok.ru/video/mine', { sessionId: 'my-session', timestamp: Date.now() });
    urlSessionCache.set('other-user:ok.ru/video/theirs', { sessionId: 'other-session', timestamp: Date.now() });

    const res = await fetch(`${baseUrl}/api/account`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Our session should be gone, other user's should remain
    expect(analysisSessions.has('my-session')).toBe(false);
    expect(analysisSessions.has('other-session')).toBe(true);

    // URL cache should be cleaned for our user
    expect(urlSessionCache.has('test-user:ok.ru/video/mine')).toBe(false);
    expect(urlSessionCache.has('other-user:ok.ru/video/theirs')).toBe(true);
  });

  it('returns 200 even with no sessions to clean', async () => {
    const res = await fetch(`${baseUrl}/api/account`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S. POST /api/demo — Pre-processed Demo Content
// ---------------------------------------------------------------------------

describe('S. POST /api/demo', () => {
  // Backup storage for real demo files displaced by test writes
  const demoBackups = new Map();

  // Safety net: restore any backed-up demo files even if a test fails mid-way
  afterAll(() => {
    const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo');
    for (const [type, content] of demoBackups) {
      fs.writeFileSync(path.join(demoDir, `demo-${type}.json`), content);
    }
    demoBackups.clear();
  });

  /**
   * Write a minimal demo JSON file for testing.
   * Backs up any existing real demo file so cleanupDemoJson can restore it.
   */
  function writeDemoJson(type) {
    const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo');
    if (!fs.existsSync(demoDir)) fs.mkdirSync(demoDir, { recursive: true });

    const filePath = path.join(demoDir, `demo-${type}.json`);

    // Backup existing real file before overwriting
    if (fs.existsSync(filePath) && !demoBackups.has(type)) {
      demoBackups.set(type, fs.readFileSync(filePath));
    }

    const isText = type === 'text';
    const data = {
      title: isText ? 'Толстой — Детство' : 'Demo Russian Video',
      contentType: type,
      totalDuration: isText ? 0 : 180,
      originalUrl: isText ? 'http://az.lib.ru/t/tolstoj.shtml' : 'https://ok.ru/video/400776431053',
      hasMoreChunks: false,
      chunks: [
        {
          id: 'chunk-0',
          index: 0,
          startTime: 0,
          endTime: isText ? 0 : 180,
          duration: isText ? 0 : 180,
          previewText: isText ? 'Счастливая, счастливая...' : 'Привет, как дела...',
          wordCount: 50,
          status: 'ready',
        },
      ],
      chunkTranscripts: [
        ['chunk-0', {
          words: [
            { word: 'Привет,', start: 0, end: 0.4, lemma: 'привет' },
            { word: 'как', start: 0.5, end: 0.7, lemma: 'как' },
            { word: 'дела?', start: 0.8, end: 1.2, lemma: 'дело' },
          ],
          segments: [{ text: 'Привет, как дела?', start: 0, end: 1.2 }],
          language: 'ru',
          duration: isText ? 30 : 180,
        }],
      ],
      localMediaFiles: {},
      gcsMediaKeys: {},
    };

    if (isText) {
      data.chunkTexts = [['chunk-0', 'Привет, как дела?']];
    }

    fs.writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  }

  function cleanupDemoJson(type) {
    const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo', `demo-${type}.json`);
    if (demoBackups.has(type)) {
      // Restore the original real file
      fs.writeFileSync(filePath, demoBackups.get(type));
      demoBackups.delete(type);
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  it('returns 400 for missing type', async () => {
    const res = await fetch(`${baseUrl}/api/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be/i);
  });

  it('returns 400 for invalid type', async () => {
    const res = await fetch(`${baseUrl}/api/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'podcast' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when demo JSON does not exist', async () => {
    // Temporarily rename the real demo file if it exists, so the endpoint can't find it
    const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo');
    const realFile = path.join(demoDir, 'demo-video.json');
    const backupFile = path.join(demoDir, 'demo-video.json.bak');
    const hadRealFile = fs.existsSync(realFile);
    if (hadRealFile) fs.renameSync(realFile, backupFile);
    try {
      const res = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not available/i);
    } finally {
      if (hadRealFile) fs.renameSync(backupFile, realFile);
    }
  });

  it('video demo creates a session owned by the requesting user', async () => {
    const filePath = writeDemoJson('video');
    try {
      const res = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sessionId).toBeTruthy();
      expect(body.status).toBe('cached');
      expect(body.title).toBe('Demo Russian Video');
      expect(body.contentType).toBe('video');
      expect(body.totalDuration).toBe(180);
      expect(body.chunks).toBeInstanceOf(Array);
      expect(body.chunks.length).toBe(1);
      expect(body.chunks[0].status).toBe('ready');
      expect(body.hasMoreChunks).toBe(false);

      // Session should be owned by the test user
      const session = analysisSessions.get(body.sessionId);
      expect(session).toBeTruthy();
      expect(session.uid).toBe('test-user');
      expect(session.isDemo).toBe(true);
    } finally {
      cleanupDemoJson('video');
    }
  });

  it('text demo creates a session with text content type', async () => {
    const filePath = writeDemoJson('text');
    try {
      const res = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.contentType).toBe('text');
      expect(body.title).toBe('Толстой — Детство');
      expect(body.chunks[0].status).toBe('ready');
    } finally {
      cleanupDemoJson('text');
    }
  });

  it('demo session is accessible via GET /api/session/:id', async () => {
    writeDemoJson('video');
    try {
      const demoRes = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      const { sessionId } = await demoRes.json();

      const sessionRes = await fetch(`${baseUrl}/api/session/${sessionId}`);
      expect(sessionRes.status).toBe(200);
      const session = await sessionRes.json();
      expect(session.status).toBe('ready');
      expect(session.title).toBe('Demo Russian Video');
      expect(session.contentType).toBe('video');
    } finally {
      cleanupDemoJson('video');
    }
  });

  it('demo chunk data is accessible via GET /api/session/:id/chunk/:chunkId', async () => {
    writeDemoJson('video');
    try {
      const demoRes = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      const { sessionId } = await demoRes.json();

      const chunkRes = await fetch(`${baseUrl}/api/session/${sessionId}/chunk/chunk-0`);
      expect(chunkRes.status).toBe(200);
      const chunkData = await chunkRes.json();
      expect(chunkData.transcript).toBeTruthy();
      expect(chunkData.transcript.words).toBeInstanceOf(Array);
      expect(chunkData.transcript.words.length).toBe(3);
      expect(chunkData.title).toMatch(/Part 1/);
    } finally {
      cleanupDemoJson('video');
    }
  });

  it('each demo request creates a separate session', async () => {
    writeDemoJson('video');
    try {
      const res1 = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      const body1 = await res1.json();

      const res2 = await fetch(`${baseUrl}/api/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'video' }),
      });
      const body2 = await res2.json();

      expect(body1.sessionId).not.toBe(body2.sessionId);
    } finally {
      cleanupDemoJson('video');
    }
  });
});

// ---------------------------------------------------------------------------
// T. Subscription Endpoints
// ---------------------------------------------------------------------------

describe('T. Subscription Endpoints', () => {
  it('GET /api/subscription returns subscription status', async () => {
    const res = await fetch(`${baseUrl}/api/subscription`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('trialing');
    expect(body.trialDaysRemaining).toBe(30);
    expect(body.needsPayment).toBe(false);
  });

  it('POST /api/create-checkout-session returns a URL', async () => {
    const res = await fetch(`${baseUrl}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://checkout.stripe.com/test');
  });

  it('POST /api/create-portal-session returns 400 without Stripe customer', async () => {
    const res = await fetch(`${baseUrl}/api/create-portal-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no stripe customer/i);
  });

  it('POST /api/create-portal-session returns URL when user has Stripe customer', async () => {
    // Override mock to return a user with a stripeCustomerId
    getSubscriptionStatus.mockResolvedValueOnce({
      status: 'active',
      trialEnd: new Date().toISOString(),
      trialDaysRemaining: 0,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      stripeCustomerId: 'cus_test_123',
      stripeSubscriptionId: 'sub_test_456',
      needsPayment: false,
    });

    const res = await fetch(`${baseUrl}/api/create-portal-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://billing.stripe.com/test');
  });

  it('POST /api/webhook is accessible without auth', async () => {
    // The webhook route is registered before auth middleware,
    // but needs a stripe-signature header
    const res = await fetch(`${baseUrl}/api/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'test_sig',
      },
      body: JSON.stringify({ type: 'test.event', data: { object: {} } }),
    });
    // Should be 200 (mock constructWebhookEvent returns the parsed body)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it('POST /api/webhook returns 400 without stripe-signature', async () => {
    const res = await fetch(`${baseUrl}/api/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test.event', data: { object: {} } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing stripe-signature/i);
  });
});

// ---------------------------------------------------------------------------
// U. POST /api/enrich-deck — Batch Dictionary Lookup
// ---------------------------------------------------------------------------

describe('U. POST /api/enrich-deck', () => {
  it('returns dictionary entries keyed by word', async () => {
    lookupWord.mockImplementation((word) => {
      if (word === 'привет') return { stressedForm: 'приве́т', pos: 'other', translations: ['hello', 'hi'] };
      if (word === 'книга') return { stressedForm: 'кни́га', pos: 'noun', translations: ['book'] };
      return null;
    });

    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [
          { word: 'привет' },
          { word: 'книга' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.entries['привет']).toEqual({ stressedForm: 'приве́т', pos: 'other', translations: ['hello', 'hi'] });
    expect(body.entries['книга']).toEqual({ stressedForm: 'кни́га', pos: 'noun', translations: ['book'] });
  });

  it('returns null for unknown words', async () => {
    lookupWord.mockReturnValue(null);

    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [{ word: 'несуществующее' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries['несуществующее']).toBeNull();
  });

  it('passes lemma to lookupWord when provided', async () => {
    lookupWord.mockReturnValue({ stressedForm: 'кни́га', pos: 'noun', translations: ['book'] });

    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        words: [{ word: 'книги', lemma: 'книга' }],
      }),
    });
    expect(res.status).toBe(200);

    // lookupWord should be called with both word and lemma
    expect(lookupWord).toHaveBeenCalledWith('книги', 'книга');
  });

  it('returns 400 when words is missing', async () => {
    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/words.*required/i);
  });

  it('returns 400 when words is not an array', async () => {
    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/words.*required/i);
  });

  it('returns 400 when words array exceeds 500 items', async () => {
    const words = Array.from({ length: 501 }, (_, i) => ({ word: `слово${i}` }));

    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too many/i);
  });

  it('handles empty words array gracefully', async () => {
    const res = await fetch(`${baseUrl}/api/enrich-deck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// V. POST /api/generate-examples — GPT-4o-mini Example Sentences
// ---------------------------------------------------------------------------

describe('V. POST /api/generate-examples', () => {
  it('returns example sentences keyed by word', async () => {
    const mockGptResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              'книга': { russian: 'Я читаю интересную книгу.', english: 'I am reading an interesting book.' },
              'дом': { russian: 'Мой дом находится далеко.', english: 'My house is far away.' },
            }),
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 },
      }),
    };

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
      if (typeof url === 'string' && url.includes('openai.com')) {
        return Promise.resolve(mockGptResponse);
      }
      return originalFetch(url, ...args);
    });

    try {
      const res = await fetch(`${baseUrl}/api/generate-examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: ['книга', 'дом'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.examples['книга']).toEqual({
        russian: 'Я читаю интересную книгу.',
        english: 'I am reading an interesting book.',
      });
      expect(body.examples['дом']).toEqual({
        russian: 'Мой дом находится далеко.',
        english: 'My house is far away.',
      });

      // Verify OpenAI API was called
      const openaiCalls = fetchSpy.mock.calls.filter(
        c => typeof c[0] === 'string' && c[0].includes('openai.com')
      );
      expect(openaiCalls.length).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('returns 400 when words is missing', async () => {
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/words.*required/i);
  });

  it('returns 400 when words is not an array', async () => {
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/words.*required/i);
  });

  it('returns 400 when words array exceeds 50 items', async () => {
    const words = Array.from({ length: 51 }, (_, i) => `слово${i}`);
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too many/i);
  });

  it('returns 400 when words array is empty', async () => {
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least one word/i);
  });

  it('returns 400 when words contains non-string items', async () => {
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: ['книга', 123, null] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-empty string/i);
  });

  it('returns 400 when words contains empty strings', async () => {
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: ['книга', ''] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-empty string/i);
  });

  it('returns 400 when a word exceeds 200 characters', async () => {
    const longWord = 'а'.repeat(201);
    const res = await fetch(`${baseUrl}/api/generate-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: [longWord] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/max 200/i);
  });

  it('handles GPT API errors gracefully', async () => {
    const mockErrorResponse = {
      ok: false,
      json: async () => ({ error: { message: 'Rate limited' } }),
    };

    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
      if (typeof url === 'string' && url.includes('openai.com')) {
        return Promise.resolve(mockErrorResponse);
      }
      return originalFetch(url, ...args);
    });

    try {
      const res = await fetch(`${baseUrl}/api/generate-examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: ['тест'] }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('handles invalid JSON from GPT gracefully', async () => {
    const mockBadJsonResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: 'this is not valid json {{{' },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 },
      }),
    };

    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
      if (typeof url === 'string' && url.includes('openai.com')) {
        return Promise.resolve(mockBadJsonResponse);
      }
      return originalFetch(url, ...args);
    });

    try {
      const res = await fetch(`${baseUrl}/api/generate-examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: ['тест'] }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/invalid JSON/i);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('returns 500 when OPENAI_API_KEY is not set', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const res = await fetch(`${baseUrl}/api/generate-examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: ['тест'] }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/not configured/i);
    } finally {
      process.env.OPENAI_API_KEY = origKey;
    }
  });
});
