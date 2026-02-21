#!/usr/bin/env node

/**
 * Generate pre-processed demo content for first-time users.
 *
 * This script runs the normal transcription/TTS pipeline against two demo URLs,
 * saves the transcript JSON to server/demo/, and stores media files locally
 * (server/demo/media/) and optionally uploads them to GCS (demo/ prefix).
 *
 * Usage:
 *   cd server && node scripts/generate-demo.js [--video] [--text] [--upload-gcs]
 *
 * Requires:
 *   - OPENAI_API_KEY in ../.env
 *   - Network access to ok.ru and lib.ru
 *   - yt-dlp and ffmpeg installed
 *   - (optional) GCS_BUCKET env var for --upload-gcs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Storage } from '@google-cloud/storage';
import {
  downloadAudioChunk,
  downloadVideoChunk,
  transcribeAudioChunk,
  addPunctuation,
  lemmatizeWords,
  getOkRuVideoInfo,
  isLibRuUrl,
  fetchLibRuText,
  generateTtsAudio,
  transcribeAndAlignTTS,
} from '../media.js';
import { createChunks, createTextChunks, getChunkTranscript } from '../chunking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..');
const demoDir = path.join(serverDir, 'demo');
const mediaDir = path.join(demoDir, 'media');
const tempDir = path.join(serverDir, 'temp');

dotenv.config({ path: path.join(serverDir, '..', '.env') });

const DEMO_VIDEO_URL = 'https://ok.ru/video/400776431053';
const DEMO_TEXT_URL = 'http://az.lib.ru/t/tolstoj_lew_nikolaewich/text_0080.shtml';

// Limit demo content to first ~10 minutes / 3 chunks
const MAX_DEMO_CHUNKS = 3;
const MAX_DEMO_AUDIO_SECONDS = 10 * 60;

const args = process.argv.slice(2);
const doVideo = args.includes('--video') || (!args.includes('--text'));
const doText = args.includes('--text') || (!args.includes('--video'));
const uploadGcs = args.includes('--upload-gcs');

// Ensure directories exist
for (const dir of [demoDir, mediaDir, tempDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// No-op progress callback for pipeline functions
const silentProgress = () => {};

async function generateVideoDemo() {
  console.log('\n=== Generating Video Demo ===');
  console.log(`URL: ${DEMO_VIDEO_URL}`);

  // Step 1: Get video info
  console.log('[1/6] Fetching video info...');
  const info = await getOkRuVideoInfo(DEMO_VIDEO_URL);
  console.log(`  Title: ${info.title} (${Math.round(info.duration / 60)} min)`);

  // Step 2: Download audio (first ~10 min)
  const downloadEnd = Math.min(MAX_DEMO_AUDIO_SECONDS, info.duration);
  const audioPath = path.join(tempDir, 'demo_video_audio.mp3');
  console.log(`[2/6] Downloading audio (0 - ${Math.round(downloadEnd / 60)} min)...`);
  await downloadAudioChunk(DEMO_VIDEO_URL, audioPath, 0, downloadEnd, {
    onProgress: silentProgress,
    fetchInfo: true,
  });

  // Step 3: Transcribe
  console.log('[3/6] Transcribing with Whisper...');
  const rawTranscript = await transcribeAudioChunk(audioPath, { onProgress: silentProgress });

  // Step 4: Punctuate
  console.log('[4/6] Adding punctuation with GPT-4o...');
  const transcript = await addPunctuation(rawTranscript, { onProgress: silentProgress });

  // Clean up audio
  fs.unlinkSync(audioPath);

  // Step 5: Create chunks, take first N
  console.log('[5/6] Creating chunks...');
  const allChunks = createChunks(transcript);
  const demoChunks = allChunks.slice(0, MAX_DEMO_CHUNKS);
  console.log(`  ${allChunks.length} total chunks, keeping ${demoChunks.length}`);

  // Step 6: Download video for each chunk + lemmatize
  console.log('[6/6] Downloading video chunks + lemmatizing...');
  const gcsMediaKeys = {};
  const localMediaFiles = {};
  const chunkTranscripts = [];

  for (const chunk of demoChunks) {
    const videoFilename = `demo-video-${chunk.id}.mp4`;
    const videoPath = path.join(mediaDir, videoFilename);

    console.log(`  Chunk ${chunk.id}: ${Math.round(chunk.startTime)}s - ${Math.round(chunk.endTime)}s`);

    // Download video segment
    await downloadVideoChunk(DEMO_VIDEO_URL, videoPath, chunk.startTime, chunk.endTime, {
      onProgress: silentProgress,
      partNum: chunk.index + 1,
    });

    // Get chunk transcript and lemmatize
    const rawChunkTranscript = getChunkTranscript(transcript, chunk.startTime, chunk.endTime);
    const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress: silentProgress });

    chunkTranscripts.push([chunk.id, chunkTranscript]);
    gcsMediaKeys[chunk.id] = `demo/${videoFilename}`;
    localMediaFiles[chunk.id] = videoFilename;
  }

  const lastChunk = demoChunks[demoChunks.length - 1];
  const demoData = {
    title: info.title,
    contentType: 'video',
    totalDuration: lastChunk.endTime,
    originalUrl: DEMO_VIDEO_URL,
    hasMoreChunks: false,
    chunks: demoChunks.map(c => ({
      id: c.id,
      index: c.index,
      startTime: c.startTime,
      endTime: c.endTime,
      duration: c.duration,
      previewText: c.previewText,
      wordCount: c.wordCount,
      status: 'ready',
    })),
    chunkTranscripts,
    gcsMediaKeys,
    localMediaFiles,
  };

  const jsonPath = path.join(demoDir, 'demo-video.json');
  fs.writeFileSync(jsonPath, JSON.stringify(demoData, null, 2));
  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Media files in: ${mediaDir}`);

  return demoData;
}

async function generateTextDemo() {
  console.log('\n=== Generating Text Demo ===');
  console.log(`URL: ${DEMO_TEXT_URL}`);

  // Step 1: Fetch text
  console.log('[1/5] Fetching text from lib.ru...');
  const { title, author, text } = await fetchLibRuText(DEMO_TEXT_URL);
  const displayTitle = author ? `${author} — ${title}` : title;
  console.log(`  Title: ${displayTitle} (${text.length} chars)`);

  // Step 2: Create text chunks, take first N
  console.log('[2/5] Creating text chunks...');
  const allTextChunks = createTextChunks(text);
  const demoTextChunks = allTextChunks.slice(0, MAX_DEMO_CHUNKS);
  console.log(`  ${allTextChunks.length} total chunks, keeping ${demoTextChunks.length}`);

  // Step 3-5: Generate TTS + timestamps for each chunk
  console.log('[3/5] Generating TTS audio + timestamps...');
  const gcsMediaKeys = {};
  const localMediaFiles = {};
  const chunkTranscripts = [];
  const chunkTexts = [];

  for (const chunk of demoTextChunks) {
    const audioFilename = `demo-text-${chunk.id}.mp3`;
    const audioPath = path.join(mediaDir, audioFilename);

    console.log(`  Chunk ${chunk.id}: ${chunk.text.length} chars`);

    // Generate TTS
    await generateTtsAudio(chunk.text, audioPath, { onProgress: silentProgress });

    // Transcribe TTS audio with Whisper for real word timestamps (costs ~$0.006/min)
    const rawChunkTranscript = await transcribeAndAlignTTS(chunk.text, audioPath);

    // Lemmatize
    const chunkTranscript = await lemmatizeWords(rawChunkTranscript, { onProgress: silentProgress });

    chunkTranscripts.push([chunk.id, chunkTranscript]);
    chunkTexts.push([chunk.id, chunk.text]);
    gcsMediaKeys[chunk.id] = `demo/${audioFilename}`;
    localMediaFiles[chunk.id] = audioFilename;
  }

  const demoData = {
    title: displayTitle,
    contentType: 'text',
    totalDuration: 0,
    originalUrl: DEMO_TEXT_URL,
    hasMoreChunks: false,
    chunks: demoTextChunks.map(c => ({
      id: c.id,
      index: c.index,
      startTime: 0,
      endTime: 0,
      duration: 0,
      previewText: c.previewText,
      wordCount: c.wordCount,
      status: 'ready',
    })),
    chunkTranscripts,
    chunkTexts,
    gcsMediaKeys,
    localMediaFiles,
  };

  const jsonPath = path.join(demoDir, 'demo-text.json');
  fs.writeFileSync(jsonPath, JSON.stringify(demoData, null, 2));
  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Media files in: ${mediaDir}`);

  return demoData;
}

async function uploadToGcs(demoData) {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) {
    console.log('Skipping GCS upload (no GCS_BUCKET env var)');
    return;
  }

  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  for (const [chunkId, gcsKey] of Object.entries(demoData.gcsMediaKeys)) {
    const localFile = demoData.localMediaFiles[chunkId];
    const localPath = path.join(mediaDir, localFile);

    if (!fs.existsSync(localPath)) {
      console.log(`  Skipping ${localFile} (not found locally)`);
      continue;
    }

    const contentType = gcsKey.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4';
    console.log(`  Uploading ${localFile} → gs://${bucketName}/${gcsKey}`);
    await bucket.upload(localPath, {
      destination: gcsKey,
      metadata: { contentType, cacheControl: 'public, max-age=604800' },
    });
  }

  console.log('GCS upload complete');
}

async function main() {
  console.log('Demo Content Generator');
  console.log('======================');

  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY not set in .env');
    process.exit(1);
  }

  if (doVideo) {
    const videoData = await generateVideoDemo();
    if (uploadGcs) await uploadToGcs(videoData);
  }

  if (doText) {
    const textData = await generateTextDemo();
    if (uploadGcs) await uploadToGcs(textData);
  }

  console.log('\nDone! Commit server/demo/demo-*.json (media files are gitignored).');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
