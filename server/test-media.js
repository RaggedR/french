/**
 * Integration test for media functions
 *
 * IMPORTANT: Test videos must be from ok.ru and in Russian.
 *
 * Test video: https://ok.ru/video/400776431053
 *   - Russian language with clear speech
 *   - Duration: >30 minutes (required for multi-batch testing)
 *
 * This test verifies:
 * 1. downloadAudioChunk - downloads audio for a time range
 * 2. transcribeAudioChunk - transcribes audio using OpenAI Whisper
 * 3. downloadVideoChunk - downloads video for a time range
 *
 * Test procedure:
 * 1. Get the third "chunk of chunks" (audio from 40:00 to 60:00)
 * 2. Transcribe that audio
 * 3. Download video for the third part of that chunk (~46:00 to ~49:00)
 *
 * Run with: cd server && npm test
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { downloadAudioChunk, downloadVideoChunk, transcribeAudioChunk } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TEST_VIDEO_URL = 'https://ok.ru/video/400776431053';
const DOWNLOAD_BUFFER = 20 * 60; // 20 minutes per batch

// Third chunk of chunks starts at 2 * DOWNLOAD_BUFFER = 40 minutes
const THIRD_BATCH_START = 2 * DOWNLOAD_BUFFER; // 2400 seconds = 40:00
const THIRD_BATCH_END = 3 * DOWNLOAD_BUFFER;   // 3600 seconds = 60:00

// Third part within that batch (assuming ~3-5 min chunks, third part starts around 46:00)
const THIRD_PART_START = THIRD_BATCH_START + 6 * 60; // ~46:00
const THIRD_PART_END = THIRD_BATCH_START + 9 * 60;   // ~49:00

const tempDir = path.join(__dirname, 'temp');

// Stall detection timeout (seconds)
const STALL_TIMEOUT = 60;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Create a progress tracker that detects stalls
 * @param {string} name - Name of the operation for logging
 * @param {function} onStall - Called when stall detected
 * @returns {function} Progress callback
 */
function createProgressTracker(name, onStall) {
  let lastProgressTime = Date.now();
  let lastPercent = -1;
  let stallCheckInterval;

  const checkStall = () => {
    const elapsed = (Date.now() - lastProgressTime) / 1000;
    if (elapsed > STALL_TIMEOUT) {
      clearInterval(stallCheckInterval);
      onStall(new Error(`${name} stalled - no progress for ${STALL_TIMEOUT}s`));
    }
  };

  stallCheckInterval = setInterval(checkStall, 5000);

  const callback = (type, percent, status, message) => {
    const now = Date.now();
    const sinceLast = ((now - lastProgressTime) / 1000).toFixed(1);
    lastProgressTime = now;

    // Log every progress update
    const percentStr = String(percent).padStart(3);
    const statusStr = status.padEnd(8);
    log(`  [${type}] ${percentStr}% ${statusStr} ${message} (+${sinceLast}s)`);

    if (status === 'complete' || status === 'failed') {
      clearInterval(stallCheckInterval);
    }

    lastPercent = percent;
  };

  callback.stop = () => clearInterval(stallCheckInterval);

  return callback;
}

async function runTest() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const audioPath = path.join(tempDir, `test_audio_${timestamp}.mp3`);
  const videoPath = path.join(tempDir, `test_video_${timestamp}.mp4`);

  let audioProgress, transcribeProgress, videoProgress;

  try {
    // Step 1: Download audio for third batch (40:00 - 60:00)
    log(`Step 1: Downloading audio chunk (${THIRD_BATCH_START}s - ${THIRD_BATCH_END}s)`);
    log(`        This is the third "chunk of chunks"`);
    log(`        Stall timeout: ${STALL_TIMEOUT}s`);

    await new Promise((resolve, reject) => {
      audioProgress = createProgressTracker('Audio download', reject);

      downloadAudioChunk(
        TEST_VIDEO_URL,
        audioPath,
        THIRD_BATCH_START,
        THIRD_BATCH_END,
        { onProgress: audioProgress }
      ).then(resolve).catch(reject);
    });

    audioProgress.stop();
    const audioSize = fs.statSync(audioPath).size;
    log(`Audio downloaded: ${(audioSize / 1024 / 1024).toFixed(2)} MB`);

    // Step 2: Transcribe the audio
    log(`Step 2: Transcribing audio...`);
    log(`        Stall timeout: ${STALL_TIMEOUT}s`);

    const transcript = await new Promise((resolve, reject) => {
      transcribeProgress = createProgressTracker('Transcription', reject);

      transcribeAudioChunk(audioPath, { onProgress: transcribeProgress })
        .then(resolve)
        .catch(reject);
    });

    transcribeProgress.stop();
    log(`Transcription complete:`);
    log(`  - Words: ${transcript.words.length}`);
    log(`  - Segments: ${transcript.segments.length}`);
    log(`  - Duration: ${transcript.duration.toFixed(1)}s`);
    log(`  - Language: ${transcript.language}`);

    if (transcript.words.length > 0) {
      log(`  - First word: "${transcript.words[0].word}" at ${transcript.words[0].start.toFixed(2)}s`);
      log(`  - Last word: "${transcript.words[transcript.words.length - 1].word}" at ${transcript.words[transcript.words.length - 1].end.toFixed(2)}s`);
    }

    // Clean up audio file
    fs.unlinkSync(audioPath);
    log(`Audio file cleaned up`);

    // Step 3: Download video for third part of the third batch
    log(`Step 3: Downloading video chunk (${THIRD_PART_START}s - ${THIRD_PART_END}s)`);
    log(`        This is the third "part" of the third chunk of chunks`);
    log(`        Stall timeout: ${STALL_TIMEOUT}s`);

    await new Promise((resolve, reject) => {
      videoProgress = createProgressTracker('Video download', reject);

      downloadVideoChunk(
        TEST_VIDEO_URL,
        videoPath,
        THIRD_PART_START,
        THIRD_PART_END,
        { onProgress: videoProgress, partNum: 3 }
      ).then(resolve).catch(reject);
    });

    videoProgress.stop();
    const videoSize = fs.statSync(videoPath).size;
    log(`Video downloaded: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);

    // Verify video file exists and has content
    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      log(`Video file verified: ${stats.size} bytes`);
      fs.unlinkSync(videoPath);
      log(`Video file cleaned up`);
    }

    log(`\n✓ All tests passed!`);

  } catch (error) {
    log(`\n✗ Test failed: ${error.message}`);
    console.error(error);

    // Stop any running progress trackers
    if (audioProgress) audioProgress.stop();
    if (transcribeProgress) transcribeProgress.stop();
    if (videoProgress) videoProgress.stop();

    // Cleanup on failure
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    process.exit(1);
  }
}

runTest();
