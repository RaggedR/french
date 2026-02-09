import fs from 'fs';
import { spawn } from 'child_process';
import OpenAI from 'openai';
import ytdlpBase from 'yt-dlp-exec';
import { formatTime } from './chunking.js';

// Use system yt-dlp binary instead of bundled one
const ytdlp = ytdlpBase.create('yt-dlp');

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
  const { onProgress = () => {} } = options;
  const duration = endTime - startTime;
  const sectionSpec = `*${formatTime(startTime)}-${formatTime(endTime)}`;
  const targetDuration = formatTime(duration);

  // Heartbeat during initial connection (before yt-dlp starts reporting progress)
  let waitSeconds = 0;
  const heartbeat = setInterval(() => {
    waitSeconds++;
    onProgress('audio', 0, 'active', `Connecting... (${waitSeconds}s)`);
  }, 1000);

  onProgress('audio', 0, 'active', `Connecting...`);

  await new Promise((resolve, reject) => {
    const ytdlpProc = spawn('yt-dlp', [
      url,
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--concurrent-fragments', '4',
      '--output', outputPath,
      '--no-warnings',
      '--download-sections', sectionSpec,
      '--newline',
    ]);

    let lastProgress = 0;
    let heartbeatCleared = false;

    ytdlpProc.stderr.on('data', (data) => {
      const line = data.toString();
      const timeMatch = line.match(/time=(\d+):(\d+):(\d+)/);
      if (timeMatch) {
        // Clear heartbeat on first real progress
        if (!heartbeatCleared) {
          clearInterval(heartbeat);
          heartbeatCleared = true;
        }
        const hours = parseInt(timeMatch[1]);
        const mins = parseInt(timeMatch[2]);
        const secs = parseInt(timeMatch[3]);
        const currentSecs = hours * 3600 + mins * 60 + secs;
        const percent = Math.min(99, Math.round((currentSecs / duration) * 100));
        if (percent > lastProgress) {
          lastProgress = percent;
          const msg = `${formatTime(currentSecs)} / ${targetDuration}`;
          onProgress('audio', percent, 'active', `Downloading... ${msg}`);
        }
      }
    });

    ytdlpProc.on('close', (code) => {
      clearInterval(heartbeat);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });

    ytdlpProc.on('error', (err) => {
      clearInterval(heartbeat);
      reject(err);
    });
  });

  if (!fs.existsSync(outputPath)) {
    throw new Error('Audio download failed - file not found');
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) {
    throw new Error(`Audio file too small (${stats.size} bytes) - download may have failed`);
  }

  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  onProgress('audio', 100, 'complete', `Audio ready (${sizeMB} MB)`);

  return { size: stats.size };
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
  const { onProgress = () => {}, partNum = 1 } = options;
  const sectionSpec = `*${formatTime(startTime)}-${formatTime(endTime)}`;

  // Heartbeat during initial connection (before download starts)
  let waitSeconds = 0;
  const heartbeat = setInterval(() => {
    waitSeconds++;
    onProgress('video', 0, 'active', `Downloading Part ${partNum}... connecting (${waitSeconds}s)`);
  }, 1000);

  onProgress('video', 0, 'active', `Downloading Part ${partNum}... connecting`);

  let lastVideoSize = 0;
  let heartbeatCleared = false;
  const videoMonitor = setInterval(() => {
    try {
      const partPath = outputPath + '.part';
      const checkPath = fs.existsSync(partPath) ? partPath : (fs.existsSync(outputPath) ? outputPath : null);
      if (checkPath) {
        const stats = fs.statSync(checkPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        // Clear heartbeat once download actually starts
        if (!heartbeatCleared && stats.size > 0) {
          clearInterval(heartbeat);
          heartbeatCleared = true;
        }
        if (stats.size !== lastVideoSize) {
          lastVideoSize = stats.size;
          onProgress('video', 50, 'active', `Downloading Part ${partNum}... (${sizeMB} MB)`);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }, 1000);

  try {
    await ytdlp(url, {
      format: 'worst[ext=mp4]/worst',
      output: outputPath,
      noWarnings: true,
      downloadSections: sectionSpec,
      forceKeyframesAtCuts: true,
    });
  } finally {
    clearInterval(heartbeat);
    clearInterval(videoMonitor);
  }

  const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  onProgress('video', 100, 'complete', `Video ready (${sizeMB} MB)`);

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

  // Generous estimate: ~7 seconds per MB of audio
  // This ensures progress bar jumps from ~80% to complete rather than hanging at 95%
  const estimatedSeconds = Math.max(Math.round(sizeMB * 7), 45);

  const startTime = Date.now();
  onProgress('transcription', 0, 'active',
    `Transcribing ${sizeMBStr} MB... (please wait, estimated ~${estimatedSeconds}s)`);

  const transcribeInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, estimatedSeconds - elapsed);
    // Cap at 85% so there's a visible jump to 100% when complete
    const percent = Math.min(85, Math.round((elapsed / estimatedSeconds) * 100));
    onProgress('transcription', percent, 'active',
      `Transcribing... ${elapsed}s elapsed, ~${remaining}s remaining`);
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
  onProgress('transcription', 100, 'complete', `Transcribed in ${actualTime}s`);

  return {
    words: transcription.words || [],
    segments: transcription.segments || [],
    language: transcription.language || language,
    duration: transcription.duration || 0,
  };
}
