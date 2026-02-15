#!/usr/bin/env node
/**
 * Test punctuation in isolation — no video/audio/transcription needed.
 *
 * Usage:
 *   node server/test-punctuation.js "Нет их На этот раз медлить нельзя капитан"
 *   echo "some russian text" | node server/test-punctuation.js
 *   node server/test-punctuation.js              # uses built-in sample
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { addPunctuation } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SAMPLE_TEXT = `Нет их На этот раз медлить нельзя капитан Надо сообщить в полицию Внимание внимание Объявляю тревогу в радиусе 100 километров План Перехват Разыскивается частный вертолет место регистрации неизвестно Задача установить находится ли на борту профессор Турнесоль Внимание внимание Разыскивается частный вертолет`;

async function getInput() {
  // Check for command line argument
  if (process.argv[2]) {
    return process.argv.slice(2).join(' ');
  }

  // Check for piped stdin
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString().trim();
    if (text) return text;
  }

  // Fall back to sample
  console.log('No input provided, using sample text.\n');
  return SAMPLE_TEXT;
}

const text = await getInput();
const words = text.split(/\s+/).map((w, i) => ({
  word: (i === 0 ? '' : ' ') + w,
  start: i * 0.5,
  end: (i + 1) * 0.5,
}));

const transcript = {
  words,
  segments: [{ text, start: 0, end: words.length * 0.5 }],
  language: 'ru',
  duration: words.length * 0.5,
};

console.log(`Input (${words.length} words):`);
console.log(text);
console.log('');

const result = await addPunctuation(transcript, {
  onProgress: (type, pct, status, msg) => {
    process.stdout.write(`\r  ${msg}`);
    if (status === 'complete') process.stdout.write('\n');
  },
});

console.log('');
console.log('Output:');
console.log(result.words.map(w => w.word.trim()).join(' '));
