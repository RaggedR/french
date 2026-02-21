import fs from 'fs';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import ytdlpBase from 'yt-dlp-exec';
import { formatTime } from './chunking.js';
import { pipeline } from 'stream/promises';
import http from 'http';
import https from 'https';

// Use system yt-dlp binary instead of bundled one
const ytdlp = ytdlpBase.create('yt-dlp');

// Shared browser User-Agent string for proxy and scraping requests
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ok.ru extraction typically takes 90-120 seconds due to their anti-bot JS protection
const ESTIMATED_EXTRACTION_TIME = 100; // seconds

/**
 * Map a substage's 0-100 progress into its allocated range within the overall bar.
 * @param {number} substageProgress - Progress within the substage (0-100)
 * @param {number} rangeStart - Start of the substage's range in the overall bar (0-100)
 * @param {number} rangeEnd - End of the substage's range in the overall bar (0-100)
 * @returns {number} Overall progress percentage
 */
function mapProgress(substageProgress, rangeStart, rangeEnd) {
  return Math.round(rangeStart + (substageProgress / 100) * (rangeEnd - rangeStart));
}

/**
 * Compute range boundaries from an array of substage weights.
 * E.g. weights [60, 45, 5] → ranges [[0, 55], [55, 96], [96, 100]]
 * @param {number[]} weights - Estimated durations for each substage
 * @returns {number[][]} Array of [rangeStart, rangeEnd] pairs
 */
function computeRanges(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const ranges = [];
  let cursor = 0;
  for (const w of weights) {
    const rangeEnd = cursor + (w / total) * 100;
    ranges.push([Math.round(cursor), Math.round(rangeEnd)]);
    cursor = rangeEnd;
  }
  // Ensure last range ends at exactly 100
  if (ranges.length > 0) ranges[ranges.length - 1][1] = 100;
  return ranges;
}

// Process-level timeout: kills yt-dlp if it hangs (ok.ru CDN can be unreachable)
// 240s leaves a 60s buffer before Cloud Run's 300s request timeout
const YTDLP_TIMEOUT_MS = 240_000;

/**
 * Fast info fetch for ok.ru videos by scraping OG meta tags (~4-5s vs yt-dlp's ~15s)
 * @param {string} url - ok.ru video URL
 * @returns {Promise<{title: string, duration: number}>}
 */
export async function getOkRuVideoInfo(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ok.ru page: ${response.status}`);
  }

  const html = await response.text();

  // Extract from Open Graph meta tags
  const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
  const durationMatch = html.match(/<meta property="og:video:duration" content="([^"]*)"/);

  return {
    title: titleMatch ? titleMatch[1] : 'Untitled Video',
    duration: durationMatch ? parseInt(durationMatch[1]) : 0,
  };
}

/**
 * Create a heartbeat interval that calls onProgress with incrementing seconds.
 * Returns an object with stop() method and isStopped() check.
 * @param {function} onProgress - Progress callback (type, percent, status, message)
 * @param {string} type - Progress type ('audio', 'video', 'transcription')
 * @param {function} messageBuilder - Function that takes seconds and returns {percent, message} or just message string
 * @param {number} intervalMs - Interval in milliseconds (default: 1000)
 * @returns {{stop: function, isStopped: function, getSeconds: function}}
 */
export function createHeartbeat(onProgress, type, messageBuilder, intervalMs = 1000) {
  let seconds = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (!stopped) {
      seconds++;
      const result = messageBuilder(seconds);
      // Support both string (old style) and {percent, message} (new style)
      if (typeof result === 'object' && result !== null) {
        onProgress(type, result.percent || 0, 'active', result.message);
      } else if (result) {
        onProgress(type, 0, 'active', result);
      }
    }
  }, intervalMs);

  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(interval);
      }
    },
    isStopped: () => stopped,
    getSeconds: () => seconds,
  };
}

/**
 * Download audio chunk using yt-dlp
 * @param {string} url - Video URL
 * @param {string} outputPath - Output file path
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {object} options - Options
 * @param {function} options.onProgress - Progress callback (type, percent, status, message)
 * @returns {Promise<{size: number}>} - File size in bytes
 */
export async function downloadAudioChunk(url, outputPath, startTime, endTime, options = {}) {
  const { onProgress = () => {}, fetchInfo = false, cachedInfoPath = null } = options;
  const duration = endTime - startTime;
  const sectionSpec = `*${formatTime(startTime)}-${formatTime(endTime)}`;
  const targetDuration = formatTime(duration);

  // Substage weights: [extraction, download, finalization] in estimated seconds
  const hasCachedInfo = cachedInfoPath && fs.existsSync(cachedInfoPath);
  const weights = hasCachedInfo ? [2, 45, 5] : [60, 45, 5];
  const ranges = computeRanges(weights);
  const [extractionRange, downloadRange, finalizationRange] = ranges;
  const extractionEstimate = weights[0];

  // Heartbeat with phase-aware messages using substage ranges
  let phase = 'connecting';
  const heartbeat = createHeartbeat(
    onProgress,
    'audio',
    (s) => {
      if (phase === 'connecting' || phase === 'extracting') {
        // Smooth fill over 1.5x the estimated extraction time (never reaches 100% of range)
        const subPct = Math.min(95, Math.round((s / (extractionEstimate * 1.5)) * 100));
        const pct = mapProgress(subPct, extractionRange[0], extractionRange[1]);
        const remaining = Math.max(0, extractionEstimate - s);
        return { percent: pct, message: `Step 1/3: Finding video stream... ${s}s (~${remaining}s remaining)` };
      }
      if (phase === 'starting') {
        return { percent: downloadRange[0], message: `Step 2/3: Starting download... (${s}s)` };
      }
      return { percent: downloadRange[0], message: `Processing... (${s}s)` };
    }
  );

  onProgress('audio', 0, 'active', `Step 1/3: Finding video stream...`);

  // Build args - optionally include --write-info-json to get metadata during download
  const infoJsonPath = fetchInfo ? outputPath + '.info.json' : null;
  const cacheDir = '/tmp/yt-dlp-cache';
  const args = [
    url,
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '8',  // Low quality is fine for speech transcription
    '--concurrent-fragments', '4',
    '--output', outputPath,
    '--no-warnings',
    '--download-sections', sectionSpec,
    '--newline',
    '--cache-dir', cacheDir,  // Cache extraction data for faster repeated access
  ];

  if (fetchInfo) {
    // --write-info-json writes metadata BEFORE download starts (saves ~15s separate call)
    args.push('--write-info-json');
  }

  // Use cached extraction info to skip the slow extraction phase
  if (hasCachedInfo) {
    args.push('--load-info-json', cachedInfoPath);
    phase = 'starting';
    onProgress('audio', downloadRange[0], 'active', 'Step 1/3: Using cached video info...');
  }

  let videoInfo = null;

  await new Promise((resolve, reject) => {
    const ytdlpProc = spawn('yt-dlp', args);
    let settled = false;

    // Kill yt-dlp if it hangs (ok.ru CDN can become unreachable)
    const processTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        heartbeat.stop();
        clearInterval(audioMonitor);
        ytdlpProc.kill('SIGTERM');
        reject(new Error(`Audio download timed out after ${YTDLP_TIMEOUT_MS / 1000}s — ok.ru may be unreachable. Try again later.`));
      }
    }, YTDLP_TIMEOUT_MS);

    let lastProgress = 0;
    let lastAudioSize = 0;
    let finalizationStart = 0;

    // Monitor file size during download (check for partial files too)
    const audioMonitor = setInterval(() => {
      try {
        // yt-dlp may use .part files or temp files during download
        const possiblePaths = [
          outputPath,
          outputPath + '.part',
          outputPath.replace('.mp3', '.m4a'),
          outputPath.replace('.mp3', '.m4a.part'),
          outputPath.replace('.mp3', '.webm'),
          outputPath.replace('.mp3', '.webm.part'),
        ];

        for (const checkPath of possiblePaths) {
          if (fs.existsSync(checkPath)) {
            const stats = fs.statSync(checkPath);
            if (stats.size > 0 && stats.size !== lastAudioSize) {
              lastAudioSize = stats.size;
              const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
              // Only show size if we're past the extraction phase
              if (phase === 'starting' || phase === 'downloading') {
                phase = 'downloading';
                heartbeat.stop();
                const pct = Math.max(lastProgress, downloadRange[0]);
                onProgress('audio', pct, 'active',
                  `Step 2/3: Downloading audio... (${sizeMB} MB)`);
              }
            }
            break;
          }
        }
      } catch (e) {
        // Ignore file access errors
      }
    }, 1000);

    // Parse stdout for phase info (yt-dlp outputs status messages here)
    ytdlpProc.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Extracting URL') || line.includes('Downloading webpage')) {
        phase = 'extracting';
      } else if (line.includes('Downloading') && (line.includes('m3u8') || line.includes('MPD'))) {
        phase = 'extracting';
      } else if (line.includes('Destination:') || line.includes('format(s)')) {
        phase = 'starting';
        heartbeat.stop();
        onProgress('audio', downloadRange[0], 'active', 'Step 2/3: Starting download...');
      }
    });

    ytdlpProc.stderr.on('data', (data) => {
      const line = data.toString();

      // Try to read info.json as soon as it's written (before download starts)
      if (fetchInfo && !videoInfo && infoJsonPath && fs.existsSync(infoJsonPath)) {
        try {
          const infoJson = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
          videoInfo = {
            title: infoJson.title || 'Untitled Video',
            duration: infoJson.duration || 0,
          };
        } catch (e) {
          // Info file not ready yet, will try again
        }
      }

      // Detect finalization phase (after download, during ffmpeg conversion)
      if (line.includes('Deleting original file') || line.includes('Post-process')) {
        heartbeat.stop();
        phase = 'finalizing';
        finalizationStart = Date.now();
        onProgress('audio', finalizationRange[0], 'active', 'Step 3/3: Finalizing audio...');
        return;
      }

      const timeMatch = line.match(/time=(\d+):(\d+):(\d+)/);
      if (timeMatch) {
        // Stop heartbeat on first real progress
        heartbeat.stop();
        phase = 'downloading';
        const hours = parseInt(timeMatch[1]);
        const mins = parseInt(timeMatch[2]);
        const secs = parseInt(timeMatch[3]);
        const currentSecs = hours * 3600 + mins * 60 + secs;
        // Map download progress into its allocated range
        const subPct = Math.min(100, Math.round((currentSecs / duration) * 100));
        const percent = mapProgress(subPct, downloadRange[0], downloadRange[1]);
        if (percent > lastProgress) {
          lastProgress = percent;
          const timeMsg = `${formatTime(currentSecs)} / ${targetDuration}`;
          const sizeMsg = lastAudioSize > 0 ? ` (${(lastAudioSize / 1024 / 1024).toFixed(1)} MB)` : '';
          onProgress('audio', percent, 'active', `Step 2/3: Downloading audio... ${timeMsg}${sizeMsg}`);
        }
      }
    });

    ytdlpProc.on('close', (code) => {
      clearTimeout(processTimer);
      if (settled) return;
      settled = true;
      heartbeat.stop();
      clearInterval(audioMonitor);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });

    ytdlpProc.on('error', (err) => {
      clearTimeout(processTimer);
      if (settled) return;
      settled = true;
      heartbeat.stop();
      clearInterval(audioMonitor);
      reject(err);
    });
  });

  // Final attempt to read info if not yet read
  if (fetchInfo && !videoInfo && infoJsonPath && fs.existsSync(infoJsonPath)) {
    try {
      const infoJson = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
      videoInfo = {
        title: infoJson.title || 'Untitled Video',
        duration: infoJson.duration || 0,
      };
      // Clean up info file
      fs.unlinkSync(infoJsonPath);
    } catch (e) {
      // Ignore
    }
  } else if (infoJsonPath && fs.existsSync(infoJsonPath)) {
    // Clean up info file even if we didn't need it
    fs.unlinkSync(infoJsonPath);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Audio download failed - file not found');
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) {
    throw new Error(`Audio file too small (${stats.size} bytes) - download may have failed`);
  }

  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  onProgress('audio', 100, 'complete', `Step 2/3 complete: Audio ready (${sizeMB} MB)`);

  return { size: stats.size, info: videoInfo };
}

/**
 * Download video chunk using yt-dlp
 * @param {string} url - Video URL
 * @param {string} outputPath - Output file path
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {object} options - Options
 * @param {function} options.onProgress - Progress callback (type, percent, status, message)
 * @param {number} options.partNum - Part number for display (default: 1)
 * @returns {Promise<{size: number}>} - File size in bytes
 */
export async function downloadVideoChunk(url, outputPath, startTime, endTime, options = {}) {
  const { onProgress = () => {}, partNum = 1, cachedInfoPath = null } = options;
  const sectionSpec = `*${formatTime(startTime)}-${formatTime(endTime)}`;

  // Substage weights: [extraction, download, upload] in estimated seconds
  // Upload range is reserved for index.js to use when uploading to GCS
  const hasCachedInfo = cachedInfoPath && fs.existsSync(cachedInfoPath);
  const weights = hasCachedInfo ? [2, 25, 10] : [60, 25, 10];
  const ranges = computeRanges(weights);
  const [extractionRange, downloadRange, uploadRange] = ranges;
  const extractionEstimate = weights[0];

  let phase = hasCachedInfo ? 'starting' : 'extracting';
  let downloadStart = Date.now();

  // Heartbeat with estimated progress during extraction
  const heartbeat = createHeartbeat(
    onProgress,
    'video',
    (s) => {
      if (phase === 'extracting') {
        const subPct = Math.min(95, Math.round((s / (extractionEstimate * 1.5)) * 100));
        const pct = mapProgress(subPct, extractionRange[0], extractionRange[1]);
        const remaining = Math.max(0, extractionEstimate - s);
        return { percent: pct, message: `Part ${partNum}: Finding stream... ${s}s (~${remaining}s remaining)` };
      }
      if (phase === 'starting' || phase === 'downloading') {
        // Time-estimate within download range (no real file-size progress available)
        const elapsed = (Date.now() - downloadStart) / 1000;
        const subPct = Math.min(95, Math.round((elapsed / (weights[1] * 1.5)) * 100));
        const pct = mapProgress(subPct, downloadRange[0], downloadRange[1]);
        return { percent: pct, message: `Part ${partNum}: Downloading... (${s}s)` };
      }
      return { percent: downloadRange[0], message: `Part ${partNum}: Processing... (${s}s)` };
    }
  );

  if (phase === 'extracting') {
    onProgress('video', 0, 'active', `Part ${partNum}: Finding stream...`);
  } else {
    onProgress('video', downloadRange[0], 'active', `Part ${partNum}: Using cached info...`);
  }

  let lastVideoSize = 0;
  const videoMonitor = setInterval(() => {
    try {
      const partPath = outputPath + '.part';
      const checkPath = fs.existsSync(partPath) ? partPath : (fs.existsSync(outputPath) ? outputPath : null);
      if (checkPath) {
        const stats = fs.statSync(checkPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        // Transition to download phase once file appears
        if (stats.size > 0 && phase === 'extracting') {
          heartbeat.stop();
          phase = 'downloading';
          downloadStart = Date.now();
        }
        if (stats.size !== lastVideoSize) {
          lastVideoSize = stats.size;
          // Let heartbeat handle progress (it time-estimates within download range)
          // Just update the size in the message
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }, 1000);

  // Build yt-dlp options
  const ytdlpOptions = {
    format: 'worst[ext=mp4]/worst',
    output: outputPath,
    noWarnings: true,
    downloadSections: sectionSpec,
    forceKeyframesAtCuts: true,
    cacheDir: '/tmp/yt-dlp-cache',
    concurrentFragments: 4,
  };

  // Use cached extraction info to skip slow extraction phase
  if (cachedInfoPath && fs.existsSync(cachedInfoPath)) {
    ytdlpOptions.loadInfoJson = cachedInfoPath;
    // Using cached extraction - progress will show in sendProgress
  }

  // Launch yt-dlp with a process-level timeout
  const ytdlpProcess = ytdlp(url, ytdlpOptions);
  const processTimer = setTimeout(() => {
    if (ytdlpProcess.kill) ytdlpProcess.kill('SIGTERM');
  }, YTDLP_TIMEOUT_MS);

  try {
    await ytdlpProcess;
  } catch (err) {
    // Provide a clear message if killed by our timeout
    if (err.killed || err.signal === 'SIGTERM') {
      throw new Error(`Video download timed out after ${YTDLP_TIMEOUT_MS / 1000}s — ok.ru may be unreachable. Try again later.`);
    }
    throw err;
  } finally {
    clearTimeout(processTimer);
    heartbeat.stop();
    clearInterval(videoMonitor);
  }

  const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  // Report download complete at upload range start — index.js handles upload progress and final 100%
  onProgress('video', uploadRange[0], 'active', `Part ${partNum}: Download complete (${sizeMB} MB)`);

  return { size };
}

/**
 * Transcribe audio chunk using OpenAI Whisper
 * @param {string} audioPath - Path to audio file
 * @param {object} options - Options
 * @param {function} options.onProgress - Progress callback (type, percent, status, message)
 * @param {string} options.apiKey - OpenAI API key (defaults to env var)
 * @param {string} options.language - Language code (default: 'ru')
 * @returns {Promise<{words: Array, segments: Array, language: string, duration: number}>}
 */
export async function transcribeAudioChunk(audioPath, options = {}) {
  const {
    onProgress = () => {},
    apiKey = process.env.OPENAI_API_KEY,
    language = 'ru',
  } = options;

  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / 1024 / 1024;
  const sizeMBStr = sizeMB.toFixed(1);

  // Over-estimate: ~10 seconds per MB — better to reach 70% and jump to 100%
  // than hang at 95% for a long time
  const estimatedSeconds = Math.max(Math.round(sizeMB * 10), 45);

  const startTime = Date.now();
  onProgress('transcription', 0, 'active',
    `Step 3/3: Transcribing ${sizeMBStr} MB... (estimated ~${estimatedSeconds}s)`);

  const transcribeInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, estimatedSeconds - elapsed);
    // Cap at 95% so progress reaches near-completion before the jump to 100%
    const percent = Math.min(95, Math.round((elapsed / estimatedSeconds) * 100));
    onProgress('transcription', percent, 'active',
      `Step 3/3: Transcribing... ${elapsed}s elapsed, ~${remaining}s remaining`);
  }, 2000);

  const openai = new OpenAI({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.log(`[Transcribe] Aborting after 5 minutes`);
    controller.abort();
  }, 5 * 60 * 1000);

  let transcription;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      language,
    }, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    clearInterval(transcribeInterval);
  }

  const actualTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Transcribe] Complete in ${actualTime}s`);
  onProgress('transcription', 100, 'complete', `Step 3/3 complete: Transcribed in ${actualTime}s`);

  return {
    words: transcription.words || [],
    segments: transcription.segments || [],
    language: transcription.language || language,
    duration: transcription.duration || 0,
  };
}

/**
 * Strip punctuation from the edges of a word (for matching purposes)
 * Handles Russian and common punctuation: . , ! ? ; : — – - « » " ' ( ) …
 */
export function stripPunctuation(word) {
  return word.replace(/^[.,!?;:—–\-«»""''()…\s]+|[.,!?;:—–\-«»""''()…\s]+$/g, '');
}

/**
 * Levenshtein edit distance between two strings (O(min(n,m)) space).
 * Uses a rolling 2-row approach instead of a full matrix.
 */
export function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for O(min(n,m)) space
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array(a.length + 1);

  for (let i = 1; i <= b.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/**
 * Check if two words are a fuzzy match (likely a spelling correction).
 * Allows up to ~30% character difference for words of 4+ characters.
 */
export function isFuzzyMatch(a, b) {
  if (a.length < 4 || b.length < 4) return false;
  const dist = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return dist <= Math.max(2, Math.floor(maxLen * 0.3));
}

/**
 * Add punctuation and fix spelling errors in a Whisper transcript using GPT-4o.
 * Takes the raw words, sends text to the LLM, and maps corrected words back
 * to the original WordTimestamp array using fuzzy matching.
 *
 * @param {Object} transcript - Whisper transcript { words, segments, language, duration }
 * @param {Object} options
 * @param {string} options.apiKey - OpenAI API key
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<Object>} - Transcript with punctuated words and segments
 */
export async function addPunctuation(transcript, options = {}) {
  const {
    apiKey = process.env.OPENAI_API_KEY,
    onProgress = () => {},
  } = options;

  if (!apiKey || !transcript.words || transcript.words.length === 0) {
    return transcript;
  }

  const startTime = Date.now();
  const totalWords = transcript.words.length;
  onProgress('punctuation', 0, 'active', `Adding punctuation to ${totalWords} words...`);

  const openai = new OpenAI({ apiKey });

  // Process in batches of ~500 words to stay within token limits
  const BATCH_SIZE = 500;
  const punctuatedWords = [];

  for (let i = 0; i < transcript.words.length; i += BATCH_SIZE) {
    const batchWords = transcript.words.slice(i, i + BATCH_SIZE);
    // Whisper words have leading spaces (e.g. " привет") — trim before joining
    const batchText = batchWords.map(w => w.word.trim()).join(' ');

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(transcript.words.length / BATCH_SIZE);
    const percent = Math.round((i / transcript.words.length) * 95);
    onProgress('punctuation', percent, 'active',
      `Adding punctuation... (batch ${batchNum}/${totalBatches})`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are a punctuation and spelling restoration tool for transcribed spoken Russian. The text comes from speech recognition (Whisper) and has no punctuation. It may also contain transcription errors.

This is spoken dialogue, so expect short sentences, questions, exclamations, and commands. Err on the side of MORE punctuation — prefer splitting into shorter sentences over long run-on sentences.

Rules:
- Add punctuation marks to words (. , ! ? : ; — «»)
- Capitalize the first word of each sentence
- Add periods at natural sentence boundaries — spoken Russian has many short sentences
- Use commas generously for pauses, vocatives, and subordinate clauses
- Use dashes (—) to separate abrupt shifts or consequences within a sentence
- Use ! for commands, exclamations, and urgent speech
- Use ? for questions
- Fix obvious transcription/spelling errors (e.g. "пограмма" → "программа", "скажым" → "скажем")
- Do NOT add, remove, or reorder words — only correct misspellings of existing words
- Do NOT change words that are already correctly spelled, even if unusual
- Return ONLY the corrected and punctuated text, nothing else`,
          },
          {
            role: 'user',
            content: batchText,
          },
        ],
      });

      const punctuatedText = response.choices[0].message.content.trim();
      const punctuatedBatch = punctuatedText.split(/\s+/);

      console.log(`[Punctuation] Batch ${batchNum}: sent ${batchWords.length} words, got ${punctuatedBatch.length} back`);
      console.log(`[Punctuation] First 5 original: ${batchWords.slice(0, 5).map(w => `"${w.word.trim()}"`).join(', ')}`);
      console.log(`[Punctuation] First 5 returned: ${punctuatedBatch.slice(0, 5).map(w => `"${w}"`).join(', ')}`);

      // Two-pointer alignment: walk through both arrays matching by base word.
      // Tolerates the LLM occasionally splitting or merging words.
      let oi = 0; // original index
      let pi = 0; // punctuated index
      let matched = 0;

      while (oi < batchWords.length) {
        const original = batchWords[oi];
        const leadingSpace = original.word.match(/^\s*/)[0];
        const origBase = stripPunctuation(original.word).toLowerCase();

        if (pi < punctuatedBatch.length) {
          const punctBase = stripPunctuation(punctuatedBatch[pi]).toLowerCase();

          if (origBase === punctBase || isFuzzyMatch(origBase, punctBase)) {
            // Direct or fuzzy match (spelling correction) — use punctuated version
            punctuatedWords.push({
              ...original,
              word: leadingSpace + punctuatedBatch[pi],
            });
            matched++;
            oi++;
            pi++;
          } else {
            // Try to re-align: check if LLM inserted extra token(s)
            let found = false;
            for (let lookahead = 1; lookahead <= 3 && pi + lookahead < punctuatedBatch.length; lookahead++) {
              const lookaheadBase = stripPunctuation(punctuatedBatch[pi + lookahead]).toLowerCase();
              if (lookaheadBase === origBase || isFuzzyMatch(lookaheadBase, origBase)) {
                // LLM added extra token(s) — skip them
                pi += lookahead;
                punctuatedWords.push({
                  ...original,
                  word: leadingSpace + punctuatedBatch[pi],
                });
                matched++;
                oi++;
                pi++;
                found = true;
                break;
              }
            }
            // Try reverse: check if LLM merged tokens (punctuated is shorter)
            if (!found) {
              for (let lookahead = 1; lookahead <= 3 && oi + lookahead < batchWords.length; lookahead++) {
                const futureBase = stripPunctuation(batchWords[oi + lookahead].word).toLowerCase();
                if (futureBase === punctBase || isFuzzyMatch(futureBase, punctBase)) {
                  // LLM merged word(s) — keep skipped originals as-is
                  for (let skip = 0; skip < lookahead; skip++) {
                    punctuatedWords.push(batchWords[oi + skip]);
                  }
                  oi += lookahead;
                  // Don't advance pi — the match will happen on next iteration
                  found = true;
                  break;
                }
              }
            }
            if (!found) {
              // Can't align — keep original word, only advance oi (not pi)
              // pi stays put so we can try matching the next original against the same punctuated word
              punctuatedWords.push(original);
              oi++;
            }
          }
        } else {
          // Ran out of punctuated words — keep remaining originals
          punctuatedWords.push(original);
          oi++;
        }
      }

      console.log(`[Punctuation] Batch ${batchNum}: aligned ${matched}/${batchWords.length} words`);

    } catch (err) {
      console.error(`[Punctuation] Error in batch ${batchNum}:`, err.message);
      // Fall back to original words for this batch
      punctuatedWords.push(...batchWords);
    }
  }

  // Rebuild segments from punctuated words
  // Whisper words have leading spaces (e.g. " привет"), so join with '' and trim
  const punctuatedSegments = transcript.segments.map(segment => {
    const segmentWords = punctuatedWords.filter(
      w => w.start >= segment.start && w.end <= segment.end
    );
    return {
      ...segment,
      text: segmentWords.map(w => w.word).join('').trim() || segment.text,
    };
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Punctuation] Complete in ${elapsed}s for ${totalWords} words`);
  onProgress('punctuation', 100, 'complete', `Punctuation added in ${elapsed}s`);

  return {
    ...transcript,
    words: punctuatedWords,
    segments: punctuatedSegments,
  };
}

/**
 * Lemmatize transcript words using GPT-4o.
 * Extracts unique words, sends them in batches to GPT-4o for lemmatization,
 * and attaches a `lemma` field to each WordTimestamp.
 *
 * @param {Object} transcript - Transcript { words, segments, language, duration }
 * @param {Object} options
 * @param {string} options.apiKey - OpenAI API key
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<Object>} - Transcript with lemma fields on words
 */
export async function lemmatizeWords(transcript, options = {}) {
  const {
    apiKey = process.env.OPENAI_API_KEY,
    onProgress = () => {},
  } = options;

  if (!apiKey || !transcript.words || transcript.words.length === 0) {
    return transcript;
  }

  const startTime = Date.now();

  // Extract unique normalized words
  const wordSet = new Set();
  for (const w of transcript.words) {
    const normalized = stripPunctuation(w.word).toLowerCase();
    if (normalized) wordSet.add(normalized);
  }

  const uniqueWords = Array.from(wordSet);
  console.log(`[Lemmatize] ${uniqueWords.length} unique words from ${transcript.words.length} total`);
  onProgress('lemmatization', 0, 'active', `Lemmatizing ${uniqueWords.length} unique words...`);

  const openai = new OpenAI({ apiKey });
  const BATCH_SIZE = 300;
  const lemmaMap = new Map();

  // Estimate ~5s per batch of 300 words for time-based progress during API calls
  const totalBatches = Math.ceil(uniqueWords.length / BATCH_SIZE);
  const estimatedSecsPerBatch = 12;

  for (let i = 0; i < uniqueWords.length; i += BATCH_SIZE) {
    const batch = uniqueWords.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchRangeStart = Math.round((i / uniqueWords.length) * 95);
    const batchRangeEnd = Math.round(((i + batch.length) / uniqueWords.length) * 95);
    onProgress('lemmatization', batchRangeStart, 'active',
      `Lemmatizing... (batch ${batchNum}/${totalBatches})`);

    // Heartbeat within each batch so single-batch runs don't show 0% → 100%
    const batchStart = Date.now();
    const batchHeartbeat = setInterval(() => {
      const elapsed = (Date.now() - batchStart) / 1000;
      const subPct = Math.min(90, Math.round((elapsed / (estimatedSecsPerBatch * 1.5)) * 100));
      const pct = mapProgress(subPct, batchRangeStart, batchRangeEnd);
      onProgress('lemmatization', pct, 'active',
        `Lemmatizing... (batch ${batchNum}/${totalBatches}, ${Math.round(elapsed)}s)`);
    }, 1500);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are a Russian morphology tool. For each word, return its most commonly used dictionary lemma (nominative singular for nouns, masculine nominative singular for adjectives, infinitive for verbs). Prefer the everyday form over literary forms (e.g. маленький over малый, большой over великий). For short-form adjectives (мал, мала, велик, велика, etc.), return the common full-form adjective. Return ONLY a JSON object mapping each input word to its lemma. No explanation.`,
          },
          {
            role: 'user',
            content: JSON.stringify(batch),
          },
        ],
      });

      const content = response.choices[0].message.content.trim();
      // Strip markdown code fences if present
      const jsonStr = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(jsonStr);

      for (const [word, lemma] of Object.entries(parsed)) {
        if (typeof lemma === 'string' && lemma.length > 0) {
          lemmaMap.set(word.toLowerCase(), lemma.toLowerCase());
        }
      }

      console.log(`[Lemmatize] Batch ${batchNum}: got ${Object.keys(parsed).length} lemmas`);
    } catch (err) {
      console.error(`[Lemmatize] Error in batch ${batchNum}:`, err.message);
      // Skip this batch — words will just have no lemma
    } finally {
      clearInterval(batchHeartbeat);
    }
  }

  // Attach lemma to each word
  const lemmatizedWords = transcript.words.map(w => {
    const normalized = stripPunctuation(w.word).toLowerCase();
    const lemma = lemmaMap.get(normalized);
    return lemma ? { ...w, lemma } : w;
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const coverage = lemmatizedWords.filter(w => w.lemma).length;
  console.log(`[Lemmatize] Complete in ${elapsed}s: ${coverage}/${transcript.words.length} words lemmatized`);
  onProgress('lemmatization', 100, 'complete', `Lemmatized in ${elapsed}s`);

  return {
    ...transcript,
    words: lemmatizedWords,
  };
}

/**
 * Check if a URL is a lib.ru text URL
 * @param {string} url
 * @returns {boolean}
 */
export function isLibRuUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'lib.ru' || u.hostname.endsWith('.lib.ru');
  } catch {
    return false;
  }
}

/**
 * Fetch and extract Russian text from a lib.ru page.
 * lib.ru pages have varying encodings (KOI8-R, windows-1251) and messy HTML.
 * We strip tags, then use GPT-4o to identify where the literary prose begins.
 * @param {string} url - lib.ru URL
 * @param {object} options
 * @param {string} options.apiKey - OpenAI API key
 * @returns {Promise<{title: string, author: string, text: string}>}
 */
export async function fetchLibRuText(url, options = {}) {
  const { apiKey = process.env.OPENAI_API_KEY } = options;

  // Use http/https.get with insecureHTTPParser because lib.ru sends malformed
  // HTTP chunked encoding that Node's strict parser rejects (HPE_INVALID_CHUNK_SIZE).
  // lib.ru serves over plain HTTP, so we pick the right module based on protocol.
  const httpModule = url.startsWith('https') ? https : http;
  const { status, buffer, contentType } = await new Promise((resolve, reject) => {
    httpModule.get(url, {
      insecureHTTPParser: true,
      headers: { 'User-Agent': BROWSER_UA },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || '',
      }));
      res.on('error', reject);
    }).on('error', reject);
  });

  if (status !== 200) {
    throw new Error(`Failed to fetch lib.ru page: ${status}`);
  }

  // Detect encoding: prefer Content-Type charset header, fall back to heuristic.
  // Both KOI8-R and windows-1251 map bytes to Cyrillic Unicode, so counting
  // Cyrillic chars can't distinguish them — we must use the declared charset.
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const declaredCharset = charsetMatch ? charsetMatch[1].toLowerCase() : null;

  let html;
  if (declaredCharset && (declaredCharset.includes('koi8') || declaredCharset.includes('1251'))) {
    html = new TextDecoder(declaredCharset).decode(buffer);
  } else {
    // No charset declared — try both and pick the one with more lowercase Cyrillic
    // (real Russian text has mostly lowercase; wrong encoding produces mostly uppercase)
    const koi8 = new TextDecoder('koi8-r').decode(buffer);
    const win1251 = new TextDecoder('windows-1251').decode(buffer);
    const countLower = (s) => (s.slice(0, 2000).match(/[а-я]/g) || []).length;
    html = countLower(koi8) >= countLower(win1251) ? koi8 : win1251;
  }

  // Extract title from <title> tag
  let title = 'Untitled';
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Strip all HTML tags to get raw text
  let rawText = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&copy;/g, '(c)')
    .trim();

  // Use GPT-4o to find where the literary prose begins.
  // We send the first ~200 numbered lines and ask for just the line number.
  // This handles the wide variety of lib.ru page layouts (metadata, ratings,
  // chapter headings, OCR credits, etc.) without brittle heuristics.
  const lines = rawText.split('\n');
  const headerLines = lines.slice(0, 200);
  const numberedHeader = headerLines.map((l, i) => `${i}: ${l}`).join('\n');

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Below are the first 200 numbered lines of a Russian literary text from lib.ru, after HTML tags were stripped. The page starts with metadata (title, author, navigation, ratings, OCR credits, publisher info, dashed separators) followed by the actual literary prose (novel, story, poem, etc).

Reply with ONLY the line number where the actual literary prose begins. Not chapter headings, not epigraphs — the first sentence of narrative text. Just the number, nothing else.

${numberedHeader}`
      }],
    });

    const lineNum = parseInt(response.choices[0].message.content.trim(), 10);
    if (!isNaN(lineNum) && lineNum > 0 && lineNum < lines.length) {
      rawText = lines.slice(lineNum).join('\n').trim();
      console.log(`[LibRu] GPT-4o-mini: content starts at line ${lineNum}: "${rawText.slice(0, 80)}..."`);
    } else {
      console.log(`[LibRu] GPT-4o-mini returned invalid line number: ${response.choices[0].message.content}, using full text`);
    }
  } catch (err) {
    // Quota/auth errors mean ALL subsequent OpenAI calls (TTS, lemmatization) will also fail.
    // Fail fast rather than proceeding with garbage text.
    if (err.status === 429 || err.code === 'insufficient_quota' || err.status === 401) {
      throw new Error('OpenAI API quota exceeded. Add credits at https://platform.openai.com/settings/organization/billing');
    }
    console.error(`[LibRu] GPT-4o-mini content extraction failed, using full text:`, err.message);
  }

  // Strip common lib.ru title prefixes like "Lib.ru/Классика: " or "Lib.ru: "
  title = title.replace(/^Lib\.ru\/[^:]*:\s*/i, '').replace(/^Lib\.ru:\s*/i, '').trim();

  // Extract author from title (lib.ru titles are often "Author. Title" or "Author Full Name. Title")
  // Match author: sequence of capitalized words ending with a period, before the title
  let author = '';
  const authorMatch = title.match(/^([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)*)\.\s+/);
  if (authorMatch) {
    author = authorMatch[1].trim();
    title = title.slice(authorMatch[0].length).trim();
  }

  if (!rawText || rawText.length < 50) {
    throw new Error('Extracted text is too short — page may not contain readable content');
  }

  console.log(`[LibRu] Fetched "${title}" by ${author || 'unknown'} (${rawText.length} chars)`);
  return { title, author, text: rawText };
}

/**
 * Generate TTS audio from text using OpenAI TTS API.
 * @param {string} text - Text to convert to speech
 * @param {string} outputPath - Output file path (MP3)
 * @param {object} options
 * @param {string} options.apiKey - OpenAI API key
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<{size: number}>}
 */
export async function generateTtsAudio(text, outputPath, options = {}) {
  const {
    apiKey = process.env.OPENAI_API_KEY,
    onProgress = () => {},
  } = options;

  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }

  // Over-estimate TTS time: ~1s per 70 chars (empirical: 2477 chars = 30s, 3432 chars = 48s)
  // Better to reach ~70% and jump to 100% than hang at 95%
  const estimatedSeconds = Math.max(5, Math.round(text.length / 70));
  console.log(`[TTS] Generating speech for ${text.length} chars (est. ${estimatedSeconds}s)...`);

  const heartbeat = createHeartbeat(
    onProgress,
    'tts',
    (ticks) => {
      const elapsed = ticks / 2; // 500ms ticks
      const pct = Math.min(95, Math.round((elapsed / estimatedSeconds) * 100));
      return { percent: pct, message: `Generating speech... ${elapsed.toFixed(0)}s / ~${estimatedSeconds}s` };
    },
    500, // tick every 500ms for smooth progress
  );

  const openai = new OpenAI({ apiKey });
  const ttsStart = Date.now();
  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
    });

    // Stream response body to file
    // OpenAI SDK returns a Node.js PassThrough stream, not a web ReadableStream
    const fileStream = fs.createWriteStream(outputPath);
    await pipeline(response.body, fileStream);
  } finally {
    heartbeat.stop();
  }

  const elapsed = ((Date.now() - ttsStart) / 1000).toFixed(1);
  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`[TTS] Done: ${sizeMB} MB in ${elapsed}s`);
  onProgress('tts', 100, 'complete', `Speech generated (${sizeMB} MB)`);

  return { size: stats.size };
}

/**
 * Get audio duration in seconds using ffprobe.
 * @param {string} audioPath - Path to audio file
 * @returns {Promise<number>} Duration in seconds
 */
export function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath,
    ]);
    let output = '';
    proc.stdout.on('data', (data) => { output += data; });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffprobe exited with code ${code}`));
      else resolve(parseFloat(output.trim()));
    });
    proc.on('error', reject);
  });
}

/**
 * Estimate word-level timestamps by distributing audio duration proportionally
 * across words based on character length.
 * @param {string} text - Original text
 * @param {number} duration - Audio duration in seconds
 * @returns {{words: Array<{word: string, start: number, end: number}>, segments: Array, duration: number}}
 */
export function estimateWordTimestamps(text, duration) {
  const rawWords = text.split(/\s+/).filter(w => w.length > 0);
  const totalChars = rawWords.reduce((sum, w) => sum + w.length, 0);

  const words = [];
  let cursor = 0;
  for (let i = 0; i < rawWords.length; i++) {
    const wordDuration = (rawWords[i].length / totalChars) * duration;
    const start = cursor;
    const end = cursor + wordDuration;
    words.push({
      word: (i > 0 ? ' ' : '') + rawWords[i],
      start,
      end,
    });
    cursor = end;
  }

  // Build segments (~20 words each)
  const segments = [];
  for (let i = 0; i < words.length; i += 20) {
    const segWords = words.slice(i, i + 20);
    segments.push({
      text: segWords.map(w => w.word).join('').trim(),
      start: segWords[0].start,
      end: segWords[segWords.length - 1].end,
    });
  }

  return { words, segments, language: 'ru', duration };
}

/**
 * Align Whisper-transcribed words back to original text words.
 * Uses two-pointer fuzzy matching (same approach as addPunctuation).
 * For matched words: use Whisper timestamps with original word text.
 * For unmatched: interpolate timestamps from neighbors.
 *
 * @param {Array<{word: string, start: number, end: number}>} whisperWords - From Whisper transcription
 * @param {string[]} originalWords - Original text split into words
 * @returns {Array<{word: string, start: number, end: number}>}
 */
export function alignWhisperToOriginal(whisperWords, originalWords) {
  if (!whisperWords.length || !originalWords.length) {
    return originalWords.map((w, i) => ({
      word: (i > 0 ? ' ' : '') + w,
      start: 0,
      end: 0,
    }));
  }

  const result = [];
  let wi = 0; // whisper index
  let oi = 0; // original index

  while (oi < originalWords.length) {
    const origWord = originalWords[oi];
    const origBase = stripPunctuation(origWord).toLowerCase();
    const leadingSpace = oi > 0 ? ' ' : '';

    if (wi < whisperWords.length) {
      const whisperBase = stripPunctuation(whisperWords[wi].word).toLowerCase();

      if (origBase === whisperBase || isFuzzyMatch(origBase, whisperBase)) {
        // Direct match — use original word text with Whisper timing
        result.push({
          word: leadingSpace + origWord,
          start: whisperWords[wi].start,
          end: whisperWords[wi].end,
        });
        wi++;
        oi++;
      } else {
        // Try lookahead in whisper words (TTS may have added/skipped words)
        let found = false;
        for (let la = 1; la <= 3 && wi + la < whisperWords.length; la++) {
          const laBase = stripPunctuation(whisperWords[wi + la].word).toLowerCase();
          if (laBase === origBase || isFuzzyMatch(laBase, origBase)) {
            wi += la;
            result.push({
              word: leadingSpace + origWord,
              start: whisperWords[wi].start,
              end: whisperWords[wi].end,
            });
            wi++;
            oi++;
            found = true;
            break;
          }
        }

        if (!found) {
          // Try lookahead in original words
          for (let la = 1; la <= 3 && oi + la < originalWords.length; la++) {
            const futureBase = stripPunctuation(originalWords[oi + la]).toLowerCase();
            if (futureBase === whisperBase || isFuzzyMatch(futureBase, whisperBase)) {
              // Original has extra words — interpolate timestamps
              for (let skip = 0; skip < la; skip++) {
                result.push({
                  word: (oi + skip > 0 ? ' ' : '') + originalWords[oi + skip],
                  start: -1, // will be interpolated
                  end: -1,
                });
              }
              oi += la;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          // No match — mark for interpolation
          result.push({
            word: leadingSpace + origWord,
            start: -1,
            end: -1,
          });
          oi++;
        }
      }
    } else {
      // No more whisper words — mark remaining for interpolation
      result.push({
        word: leadingSpace + origWord,
        start: -1,
        end: -1,
      });
      oi++;
    }
  }

  // Interpolate timestamps for unmatched words
  const totalDuration = whisperWords[whisperWords.length - 1].end;
  for (let i = 0; i < result.length; i++) {
    if (result[i].start === -1) {
      // Find nearest known timestamps before and after
      let prevEnd = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (result[j].end !== -1) {
          prevEnd = result[j].end;
          break;
        }
      }
      let nextStart = totalDuration;
      let gapCount = 1; // count of consecutive unmatched words including this one
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].start !== -1) {
          nextStart = result[j].start;
          break;
        }
        gapCount++;
      }

      // Distribute the gap evenly
      const step = (nextStart - prevEnd) / (gapCount + 1);
      let pos = 0;
      for (let j = i; j < result.length && result[j].start === -1; j++) {
        pos++;
        result[j].start = prevEnd + step * pos;
        result[j].end = prevEnd + step * (pos + 0.8);
      }
    }
  }

  return result;
}

/**
 * Transcribe TTS audio with Whisper and align back to original text.
 * Produces accurate word-level timestamps instead of character-proportional estimates.
 *
 * @param {string} text - Original text that was synthesized to audio
 * @param {string} audioPath - Path to the TTS audio file
 * @param {object} options - Passed through to transcribeAudioChunk (onProgress, apiKey, language)
 * @returns {Promise<{words: Array<{word: string, start: number, end: number}>, segments: Array, language: string, duration: number}>}
 */
export async function transcribeAndAlignTTS(text, audioPath, options = {}) {
  const whisperResult = await transcribeAudioChunk(audioPath, options);

  const originalWords = text.split(/\s+/).filter(w => w.length > 0);
  const alignedWords = alignWhisperToOriginal(whisperResult.words, originalWords);

  // Build segments (~20 words each), same shape as estimateWordTimestamps
  const segments = [];
  for (let i = 0; i < alignedWords.length; i += 20) {
    const segWords = alignedWords.slice(i, i + 20);
    segments.push({
      text: segWords.map(w => w.word).join('').trim(),
      start: segWords[0].start,
      end: segWords[segWords.length - 1].end,
    });
  }

  return {
    words: alignedWords,
    segments,
    language: whisperResult.language || 'ru',
    duration: whisperResult.duration,
  };
}
